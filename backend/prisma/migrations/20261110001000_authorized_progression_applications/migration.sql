BEGIN;
ALTER TABLE progression_applications
 ADD COLUMN athlete_id UUID REFERENCES athletes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN review_id UUID REFERENCES recommendation_reviews(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN plan_exercise_id UUID REFERENCES plan_exercises(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN scheduled_activity_id UUID REFERENCES scheduled_activities(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN previous_load DECIMAL(8,3), ADD COLUMN load_unit "MeasurementUnit",
 ADD COLUMN intent_id UUID, ADD COLUMN request_key CHAR(64), ADD COLUMN cycle_key CHAR(64), ADD COLUMN audit JSONB;
CREATE UNIQUE INDEX progression_applications_review_id_key ON progression_applications(review_id);
CREATE UNIQUE INDEX progression_applications_cycle_key_key ON progression_applications(cycle_key);
CREATE UNIQUE INDEX progression_applications_athlete_id_intent_id_key ON progression_applications(athlete_id,intent_id);
ALTER TABLE progression_applications ADD CONSTRAINT progression_applications_audit_check CHECK (
 (athlete_id IS NULL AND actor_user_id IS NULL AND review_id IS NULL AND plan_exercise_id IS NULL AND scheduled_activity_id IS NULL AND previous_load IS NULL AND load_unit IS NULL AND intent_id IS NULL AND request_key IS NULL AND cycle_key IS NULL AND audit IS NULL)
 OR COALESCE((athlete_id IS NOT NULL AND actor_user_id IS NOT NULL AND review_id IS NOT NULL AND plan_exercise_id IS NOT NULL AND scheduled_activity_id IS NOT NULL AND intent_id IS NOT NULL
 AND previous_load>0 AND applied_load>previous_load AND applied_load<'Infinity'::numeric AND previous_load<'Infinity'::numeric
 AND load_unit IS NOT NULL AND origin='MANUAL' AND request_key ~ '^[0-9a-f]{64}$' AND cycle_key ~ '^[0-9a-f]{64}$'
 AND jsonb_typeof(audit)='object' AND audit->>'schemaVersion'='manual-progression-application-v1'
 AND audit->>'action'='APPLY' AND audit->>'fromStatus'='APPROVED' AND audit->>'toStatus'='APPLIED'
 AND audit->'authorization'->>'reviewId'=review_id::text AND audit->'authorization'->>'cycleKey'=cycle_key
 AND audit->'destination'->>'prescriptionId'=plan_exercise_id::text
 AND (audit->'destination'->>'planVersionBefore')::integer>=0
 AND (audit->'destination'->>'planVersionAfter')::integer=(audit->'destination'->>'planVersionBefore')::integer+1
 AND (audit->'load'->>'previousLoad')::numeric=previous_load AND (audit->'load'->>'appliedLoad')::numeric=applied_load AND audit->'load'->>'unit'=load_unit::text
 AND audit->'temporal'->>'localOn'=(effective_at AT TIME ZONE (audit->'temporal'->>'timeZone'))::date::text
 AND audit->'temporal'->>'activityId'=scheduled_activity_id::text AND (audit->'temporal'->>'checkedAt')::timestamptz=effective_at
 AND jsonb_typeof(audit->'temporal'->'relatedActivityIds')='array'
 ),false));

CREATE FUNCTION guard_authorized_progression_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p progression_recommendations; r recommendation_reviews;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.audit IS NOT NULL THEN RAISE EXCEPTION 'Application receipts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['id','recommendation_id','applied_load','origin','effective_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['id','recommendation_id','applied_load','origin','effective_at']) THEN
   RAISE EXCEPTION 'Legacy applications cannot acquire fabricated provenance' USING ERRCODE='55000'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF NEW.audit IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM progression_recommendations WHERE id=NEW.recommendation_id FOR UPDATE;
 SELECT * INTO r FROM recommendation_reviews WHERE id=NEW.review_id;
 IF p.id IS NULL OR p.status<>'APPROVED' OR p.semantic_key IS NULL OR p.review_version<>1 OR p.cycle_slot IS DISTINCT FROM p.cycle_key
  OR r.id IS NULL OR r.recommendation_id<>p.id OR r.athlete_id<>p.athlete_id OR r.actor_user_id<>NEW.actor_user_id OR NEW.athlete_id<>p.athlete_id
  OR NEW.effective_at<r.decided_at OR NEW.effective_at>clock_timestamp()
  OR r.action<>'APPROVE' OR r.to_status<>'APPROVED' OR r.version<>p.review_version OR p.reviewed_at IS DISTINCT FROM r.decided_at
  OR r.semantic_key IS DISTINCT FROM p.semantic_key OR r.cycle_key IS DISTINCT FROM p.cycle_key OR r.dependency_keys IS DISTINCT FROM p.dependency_keys
  OR NEW.cycle_key IS DISTINCT FROM p.cycle_key OR NEW.previous_load IS DISTINCT FROM p.previous_load OR NEW.applied_load IS DISTINCT FROM p.recommended_load OR NEW.load_unit IS DISTINCT FROM p.load_unit
  OR NEW.audit->'authorization'->>'semanticKey' IS DISTINCT FROM p.semantic_key
  OR NEW.audit->'authorization'->'dependencyKeys' IS DISTINCT FROM p.dependency_keys
  OR NEW.audit->'authorization'->>'authorizationKey' IS DISTINCT FROM r.acceptance->>'authorizationKey'
  OR (NEW.audit->'authorization'->>'reviewVersion')::integer IS DISTINCT FROM r.version
  OR NEW.audit->'destination'->>'planId' IS DISTINCT FROM p.snapshot->'destination'->>'planId'
  OR NEW.audit->'destination'->>'weekId' IS DISTINCT FROM p.snapshot->'destination'->>'weekId'
  OR NEW.audit->'destination'->>'dayId' IS DISTINCT FROM p.snapshot->'destination'->>'dayId'
  OR NEW.plan_exercise_id::text IS DISTINCT FROM p.snapshot->'destination'->>'prescriptionId'
  OR NEW.audit->'destination'->>'exerciseId' IS DISTINCT FROM p.exercise_id::text
  OR (NEW.audit->'destination'->>'planVersionBefore')::integer IS DISTINCT FROM (p.snapshot->'destination'->>'planVersion')::integer
  OR NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id WHERE a.id=NEW.athlete_id AND u.id=NEW.actor_user_id AND u.status='ACTIVE')
  OR (p.expires_at IS NOT NULL AND p.expires_at<=clock_timestamp())
 THEN RAISE EXCEPTION 'Application does not match an accredited approval' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER progression_applications_authorized_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_applications FOR EACH ROW EXECUTE FUNCTION guard_authorized_progression_application();

CREATE OR REPLACE FUNCTION check_recommendation_review_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p progression_recommendations; e recommendation_reviews; a progression_applications;
BEGIN
 IF TG_TABLE_NAME='recommendation_reviews' THEN SELECT * INTO p FROM progression_recommendations WHERE id=NEW.recommendation_id;
 ELSE SELECT * INTO p FROM progression_recommendations WHERE id=NEW.id; END IF;
 IF p.review_version IS NULL THEN
  IF EXISTS(SELECT 1 FROM recommendation_reviews WHERE recommendation_id=p.id) THEN RAISE EXCEPTION 'Review audit without matching transition' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO e FROM recommendation_reviews WHERE recommendation_id=p.id AND version=p.review_version;
 IF e.id IS NULL OR p.review_version<>1 OR p.reviewed_at IS DISTINCT FROM e.decided_at OR p.athlete_id<>e.athlete_id OR p.semantic_key IS DISTINCT FROM e.semantic_key OR p.cycle_key IS DISTINCT FROM e.cycle_key OR p.dependency_keys IS DISTINCT FROM e.dependency_keys THEN
  RAISE EXCEPTION 'Review transition and audit must commit together' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM progression_applications WHERE recommendation_id=p.id AND audit IS NOT NULL;
 IF a.id IS NOT NULL THEN
  IF p.status<>'APPLIED' OR e.to_status<>'APPROVED' OR a.review_id<>e.id OR a.cycle_key IS DISTINCT FROM p.cycle_key OR a.athlete_id<>p.athlete_id THEN
   RAISE EXCEPTION 'Applied state must retain its accredited receipt' USING ERRCODE='23514'; END IF;
 ELSIF p.status<>e.to_status THEN RAISE EXCEPTION 'Applied state requires an accredited application' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;

CREATE FUNCTION check_authorized_application_destination() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a progression_applications; p progression_recommendations; x plan_exercises; d plan_days; w plan_weeks; t training_plans; s scheduled_activities;
BEGIN
 IF TG_TABLE_NAME='progression_applications' THEN
  IF NEW.audit IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM progression_applications WHERE id=NEW.id;
 ELSE
  IF OLD.status<>'APPROVED' THEN RAISE EXCEPTION 'Application transition requires APPROVED origin' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM progression_applications WHERE recommendation_id=NEW.id AND audit IS NOT NULL;
 END IF;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Missing application receipt' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM progression_recommendations WHERE id=a.recommendation_id;
 SELECT * INTO x FROM plan_exercises WHERE id=a.plan_exercise_id;
 SELECT * INTO d FROM plan_days WHERE id=x.plan_day_id;
 SELECT * INTO w FROM plan_weeks WHERE id=x.plan_week_id;
 SELECT * INTO t FROM training_plans WHERE id=w.training_plan_id;
 SELECT * INTO s FROM scheduled_activities WHERE id=a.scheduled_activity_id;
 IF p.status<>'APPLIED' OR x.id IS NULL OR d.id IS NULL OR w.id IS NULL OR t.id IS NULL OR s.id IS NULL
  OR t.athlete_id<>a.athlete_id OR t.status<>'DRAFT' OR d.retired_at IS NOT NULL OR d.plan_week_id<>w.id
  OR x.exercise_id<>p.exercise_id OR x.target_load IS DISTINCT FROM a.applied_load OR x.target_load_unit IS DISTINCT FROM a.load_unit
  OR x.id::text IS DISTINCT FROM a.audit->'destination'->>'prescriptionId' OR w.id::text IS DISTINCT FROM a.audit->'destination'->>'weekId' OR d.id::text IS DISTINCT FROM a.audit->'destination'->>'dayId' OR t.id::text IS DISTINCT FROM a.audit->'destination'->>'planId'
  OR t.version IS DISTINCT FROM (a.audit->'destination'->>'planVersionAfter')::integer
  OR s.athlete_id<>a.athlete_id OR s.plan_week_id IS DISTINCT FROM w.id OR s.plan_day_id IS DISTINCT FROM d.id
  OR s.version IS DISTINCT FROM (a.audit->'temporal'->>'activityVersion')::integer OR s.scheduled_on::text IS DISTINCT FROM a.audit->'temporal'->>'scheduledOn' OR s.time_zone IS DISTINCT FROM a.audit->'temporal'->>'timeZone'
  OR s.status NOT IN ('PLANNED','RESCHEDULED') OR s.scheduled_on<=(clock_timestamp() AT TIME ZONE s.time_zone)::date
  OR (t.starts_on IS NOT NULL AND s.scheduled_on<t.starts_on) OR (t.ends_on IS NOT NULL AND s.scheduled_on>t.ends_on)
  OR EXISTS(SELECT 1 FROM workout_sessions WHERE training_plan_id=t.id OR plan_week_id=w.id OR plan_day_id=d.id)
  OR EXISTS(SELECT 1 FROM workout_exercises WHERE plan_exercise_id=x.id)
  OR EXISTS(SELECT 1 FROM progression_recommendations WHERE plan_exercise_id=x.id)
  OR EXISTS(SELECT 1 FROM scheduled_activities z WHERE z.plan_day_id=d.id AND (z.athlete_id<>a.athlete_id OR z.plan_week_id<>w.id OR z.status NOT IN ('PLANNED','RESCHEDULED') OR z.scheduled_on<=(clock_timestamp() AT TIME ZONE z.time_zone)::date OR EXISTS(SELECT 1 FROM workout_sessions q WHERE q.scheduled_activity_id=z.id)))
  OR EXISTS(SELECT id::text FROM scheduled_activities WHERE plan_day_id=d.id EXCEPT SELECT jsonb_array_elements_text(a.audit->'temporal'->'relatedActivityIds'))
  OR EXISTS(SELECT jsonb_array_elements_text(a.audit->'temporal'->'relatedActivityIds') EXCEPT SELECT id::text FROM scheduled_activities WHERE plan_day_id=d.id)
 THEN RAISE EXCEPTION 'Application, future destination, versions and audit must commit together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER progression_applications_destination_pair AFTER INSERT ON progression_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_authorized_application_destination();
CREATE CONSTRAINT TRIGGER progression_recommendations_application_pair AFTER UPDATE ON progression_recommendations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.review_version IS NOT NULL AND NEW.status='APPLIED' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION check_authorized_application_destination();
COMMIT;
