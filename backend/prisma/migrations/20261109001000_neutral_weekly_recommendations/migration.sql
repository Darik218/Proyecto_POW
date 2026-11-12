BEGIN;
-- All new columns stay NULL for existing rows. No unit or policy is inferred.
ALTER TABLE progression_recommendations
  ALTER COLUMN previous_load TYPE DECIMAL(24,6),
  ALTER COLUMN recommended_load TYPE DECIMAL(24,6),
  ADD COLUMN load_unit "MeasurementUnit",
  ADD COLUMN previous_load_kg DECIMAL(24,6),
  ADD COLUMN recommended_load_kg DECIMAL(24,6),
  ADD COLUMN semantic_key CHAR(64),
  ADD COLUMN cycle_key CHAR(64),
  ADD COLUMN cycle_slot CHAR(64),
  ADD COLUMN request_key CHAR(64),
  ADD COLUMN snapshot JSONB,
  ADD COLUMN dependency_keys JSONB,
  ADD COLUMN proposal_kind VARCHAR(24);
CREATE UNIQUE INDEX progression_recommendations_semantic_key_key ON progression_recommendations(semantic_key);
-- A reservation, not a permanent uniqueness constraint on the logical cycle.
-- PROG-4B never releases it or silently replaces a previous proposal.
CREATE UNIQUE INDEX progression_recommendations_cycle_slot_key ON progression_recommendations(cycle_slot);
CREATE INDEX progression_recommendations_athlete_id_cycle_key_idx ON progression_recommendations(athlete_id,cycle_key);

ALTER TABLE progression_recommendations ADD CONSTRAINT progression_recommendations_generation_check CHECK (
 (load_unit IS NULL AND previous_load_kg IS NULL AND recommended_load_kg IS NULL
  AND semantic_key IS NULL AND cycle_key IS NULL AND cycle_slot IS NULL
  AND request_key IS NULL AND snapshot IS NULL AND dependency_keys IS NULL AND proposal_kind IS NULL)
 OR COALESCE((
   proposal_kind='NEUTRAL_INTERNAL' AND semantic_key ~ '^[0-9a-f]{64}$'
   AND cycle_key ~ '^[0-9a-f]{64}$' AND request_key ~ '^[0-9a-f]{64}$'
   AND (cycle_slot IS NULL OR cycle_slot=cycle_key)
   AND load_unit IS NOT NULL AND previous_load>0 AND recommended_load>previous_load
   AND recommended_load < 'Infinity'::numeric AND previous_load < 'Infinity'::numeric
   AND previous_load_kg>0 AND previous_load_kg < 'Infinity'::numeric
   AND recommended_load_kg>=previous_load_kg AND recommended_load_kg < 'Infinity'::numeric
   AND plan_week_id IS NULL AND plan_exercise_id IS NULL
   AND jsonb_typeof(snapshot)='object'
   AND jsonb_typeof(snapshot->'source')='object'
   AND jsonb_typeof(snapshot->'source'->'tasks')='array'
   AND jsonb_array_length(snapshot->'source'->'tasks')>0
   AND jsonb_typeof(snapshot->'source'->'sets')='array'
   AND jsonb_typeof(snapshot->'period')='object'
   AND jsonb_typeof(snapshot->'destination')='object'
   AND snapshot->'destination'->>'kind' IN ('WORKOUT_TASK','PRESCRIPTION')
   AND snapshot->>'schemaVersion'='recommendation-evidence-v1'
   AND snapshot->>'engineVersion'=algorithm_version
   AND snapshot->>'decision'='INCREASE'
   AND snapshot->>'athleteId'=athlete_id::text
   AND snapshot->>'exerciseId'=exercise_id::text
   AND snapshot->'configuration'->>'status'='VALID'
   AND snapshot->'configuration'->'policy'->'provenance'->>'source'='EXPLICIT_INTERNAL_POLICY'
   AND snapshot->'increment'->>'status'='INCREASE'
   AND snapshot->'increment'->>'unit'=load_unit::text
   AND (snapshot->'increment'->>'currentLoad')::numeric=previous_load
   AND (snapshot->'increment'->>'proposedLoad')::numeric=recommended_load
   AND (snapshot->'increment'->>'currentLoadKg')::numeric=previous_load_kg
   AND (snapshot->'increment'->>'proposedLoadKg')::numeric=recommended_load_kg
   AND snapshot->'configuration'=effective_settings
   AND previous_load_kg=round(CASE WHEN load_unit='KG' THEN previous_load ELSE previous_load*0.45359237 END,6)
   AND recommended_load_kg=round(CASE WHEN load_unit='KG' THEN recommended_load ELSE recommended_load*0.45359237 END,6)
   AND jsonb_typeof(dependency_keys)='object'
   AND dependency_keys->>'configuration' ~ '^[0-9a-f]{64}$'
   AND dependency_keys->>'period' ~ '^[0-9a-f]{64}$'
   AND dependency_keys->>'destination' ~ '^[0-9a-f]{64}$'
   AND dependency_keys->>'evidence' ~ '^[0-9a-f]{64}$'
   AND dependency_keys-ARRAY['configuration','period','destination','evidence']='{}'::jsonb
 ),false)
);
CREATE FUNCTION protect_weekly_recommendation_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.semantic_key IS NOT NULL AND (NEW.status<>'PENDING' OR NEW.cycle_slot IS DISTINCT FROM NEW.cycle_key OR NEW.reviewed_at IS NOT NULL OR NEW.expires_at IS NOT NULL) THEN
     RAISE EXCEPTION 'New neutral proposals must be pending and reserved' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
 END IF;
 IF OLD.semantic_key IS NOT NULL THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recommendation generation is immutable' USING ERRCODE='55000'; END IF;
   -- Operational fields are deliberately separate. Future authorized services
   -- must validate their transitions; this migration does not approve them.
   IF (to_jsonb(OLD)-ARRAY['status','reviewed_at','expires_at','cycle_slot']) IS DISTINCT FROM
      (to_jsonb(NEW)-ARRAY['status','reviewed_at','expires_at','cycle_slot']) THEN
      RAISE EXCEPTION 'Recommendation generation is immutable' USING ERRCODE='55000';
   END IF;
   IF NEW.cycle_slot IS DISTINCT FROM OLD.cycle_slot AND NOT (OLD.cycle_slot=OLD.cycle_key AND NEW.cycle_slot IS NULL) THEN
      RAISE EXCEPTION 'A released cycle reservation cannot be reassigned' USING ERRCODE='55000';
   END IF;
 ELSIF TG_OP='UPDATE' AND NEW.semantic_key IS NOT NULL THEN
   RAISE EXCEPTION 'Legacy recommendations cannot acquire fabricated generation metadata' USING ERRCODE='55000';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER progression_recommendations_generation_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_recommendations
 FOR EACH ROW EXECUTE FUNCTION protect_weekly_recommendation_generation();

CREATE FUNCTION protect_weekly_recommendation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent progression_recommendations;
BEGIN
 SELECT * INTO parent FROM progression_recommendations WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.recommendation_id ELSE NEW.recommendation_id END;
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM progression_recommendations WHERE id=OLD.recommendation_id AND semantic_key IS NOT NULL) THEN
   RAISE EXCEPTION 'Generation evidence links are immutable' USING ERRCODE='55000';
 END IF;
 IF parent.semantic_key IS NOT NULL THEN
   IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Generation evidence links are immutable' USING ERRCODE='55000'; END IF;
   IF NEW.role<>'CONTEXT' OR NOT EXISTS(
      SELECT 1 FROM workout_sessions s WHERE s.id=NEW.session_id AND s.athlete_id=parent.athlete_id AND s.status='COMPLETED'
   ) OR NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(parent.snapshot->'source'->'tasks') t WHERE t->>'sessionId'=NEW.session_id::text
   ) THEN RAISE EXCEPTION 'Neutral evidence must reference an owned captured session context' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER recommendation_evidence_generation_guard BEFORE INSERT OR UPDATE OR DELETE ON recommendation_evidence
 FOR EACH ROW EXECUTE FUNCTION protect_weekly_recommendation_evidence();

CREATE FUNCTION check_weekly_recommendation_evidence_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.semantic_key IS NOT NULL AND (
  EXISTS(SELECT t->>'sessionId' FROM jsonb_array_elements(NEW.snapshot->'source'->'tasks') t
         EXCEPT SELECT session_id::text FROM recommendation_evidence WHERE recommendation_id=NEW.id)
  OR EXISTS(SELECT session_id::text FROM recommendation_evidence WHERE recommendation_id=NEW.id
         EXCEPT SELECT t->>'sessionId' FROM jsonb_array_elements(NEW.snapshot->'source'->'tasks') t)
 ) THEN RAISE EXCEPTION 'Generation evidence is incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER progression_recommendations_complete_evidence AFTER INSERT OR UPDATE ON progression_recommendations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_weekly_recommendation_evidence_complete();
COMMIT;
