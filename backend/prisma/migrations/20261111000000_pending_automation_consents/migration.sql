BEGIN;
CREATE TABLE progression_automation_consents (
 id UUID PRIMARY KEY, athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 training_plan_id UUID, state VARCHAR(24) NOT NULL, version INTEGER NOT NULL,
 contract_key CHAR(64) NOT NULL, snapshot JSONB NOT NULL,
 valid_from TIMESTAMPTZ(6) NOT NULL, valid_until TIMESTAMPTZ(6) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMPTZ(6),
 CONSTRAINT progression_automation_consents_id_athlete_id_key UNIQUE(id,athlete_id),
 CONSTRAINT automation_consent_plan_owner_fkey FOREIGN KEY(training_plan_id,athlete_id) REFERENCES training_plans(id,athlete_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT automation_consent_shape CHECK(COALESCE(
 state IN ('PENDING_CONFIRMATION','REVOKED') AND version>0 AND contract_key ~ '^[0-9a-f]{64}$'
 AND valid_from<valid_until AND isfinite(valid_from) AND isfinite(valid_until) AND created_at<=updated_at
 AND ((state='PENDING_CONFIRMATION' AND revoked_at IS NULL) OR (state='REVOKED' AND revoked_at=updated_at))
 AND jsonb_typeof(snapshot->'engine')='object' AND length(snapshot->'engine'->>'recommendation')>0 AND length(snapshot->'engine'->>'numeric')>0
 AND snapshot->>'schemaVersion'='automation-consent-snapshot-v1' AND snapshot->>'athleteId'=athlete_id::text
 AND snapshot->>'humanAcceptance'='NOT_RECORDED' AND snapshot->>'operationalAuthorization'='NOT_AVAILABLE_IN_PROG_5C_A'
 AND snapshot->'contract'->>'schemaVersion'='automation-consent-contract-v1' AND snapshot->'contract'->>'exerciseId'=exercise_id::text
 AND snapshot->'contract'->'trainingPlanId'=COALESCE(to_jsonb(training_plan_id::text),'null'::jsonb)
 AND snapshot->'contract'->'provenance'->>'source'='INTERNAL_CONFIGURATION_REQUEST'
 AND (snapshot->'contract'->'validity'->>'startsAt')::timestamptz=valid_from AND (snapshot->'contract'->'validity'->>'endsAt')::timestamptz=valid_until
 AND snapshot->'contract'->'selector'->>'kind'='EXACT_PRESCRIPTION_ALLOWLIST'
 AND snapshot->'contract'->'selector'->>'futureOnly'='true' AND snapshot->'contract'->'selector'->>'planState'='DRAFT'
 AND snapshot->'contract'->'selector'->>'versionPolicy'='READ_CURRENT_AND_CAS'
 AND jsonb_typeof(snapshot->'contract'->'selector'->'prescriptionIds')='array'
 AND jsonb_array_length(snapshot->'contract'->'selector'->'prescriptionIds') BETWEEN 1 AND 100

 AND snapshot->'contract'->'limits'->>'unit' IN ('KG','LB') AND snapshot->'contract'->'limits'->>'loadMeaning'='EXTERNAL_TOTAL'
 AND (snapshot->'contract'->'limits'->>'maximumAbsoluteIncrement')::numeric>0 AND (snapshot->'contract'->'limits'->>'maximumAbsoluteIncrement')::numeric<1000000000000000000
 AND (snapshot->'contract'->'limits'->>'maximumPercentIncrement')::numeric>0 AND (snapshot->'contract'->'limits'->>'maximumPercentIncrement')::numeric<1000000000000000000
 AND (snapshot->'contract'->'limits'->>'maximumLoad')::numeric>0 AND (snapshot->'contract'->'limits'->>'maximumLoad')::numeric<1000000000000000000
 AND scale((snapshot->'contract'->'limits'->>'maximumAbsoluteIncrement')::numeric)<=6 AND scale((snapshot->'contract'->'limits'->>'maximumPercentIncrement')::numeric)<=6 AND scale((snapshot->'contract'->'limits'->>'maximumLoad')::numeric)<=6
 AND (snapshot->'contract'->'limits'->>'maximumApplicationsPerWeek')::integer>0 AND (snapshot->'contract'->'limits'->>'weekStartsOn')::integer BETWEEN 1 AND 7
 AND (snapshot->'contract'->>'historyWindowDays')::integer BETWEEN 1 AND 3660
 AND snapshot->'contract'->'policy'->'grid'->>'rounding'='FLOOR'
 AND snapshot->'contract'->'policy'->'grid'->>'unit'=snapshot->'contract'->'limits'->>'unit'
 AND jsonb_typeof(snapshot->'destinations')='array' AND jsonb_typeof(snapshot->'bindings')='array'
 ,false))
);
CREATE INDEX automation_consents_scope_validity_idx ON progression_automation_consents(athlete_id,exercise_id,state,valid_from,valid_until);
CREATE TABLE progression_automation_consent_events (
 id UUID PRIMARY KEY, consent_id UUID NOT NULL, athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 action VARCHAR(12) NOT NULL,intent_id UUID NOT NULL,request_key CHAR(64) NOT NULL,
 from_version INTEGER,version INTEGER NOT NULL,from_state VARCHAR(24),state VARCHAR(24) NOT NULL,
 contract_key CHAR(64) NOT NULL,snapshot JSONB NOT NULL,recorded_at TIMESTAMPTZ(6) NOT NULL,reason VARCHAR(40),
 CONSTRAINT automation_consent_event_owner_fkey FOREIGN KEY(consent_id,athlete_id) REFERENCES progression_automation_consents(id,athlete_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT automation_consent_event_shape CHECK(COALESCE(
 request_key ~ '^[0-9a-f]{64}$' AND contract_key ~ '^[0-9a-f]{64}$' AND version>0 AND
 ((action='CREATE' AND version=1 AND from_version IS NULL AND from_state IS NULL AND state='PENDING_CONFIRMATION' AND reason IS NULL)
 OR (action='REVISE' AND version=from_version+1 AND from_state='PENDING_CONFIRMATION' AND state='PENDING_CONFIRMATION' AND reason IS NULL)
 OR (action='REVOKE' AND version=from_version+1 AND from_state='PENDING_CONFIRMATION' AND state='REVOKED' AND reason='OWNER_REQUEST')),false))
);
CREATE UNIQUE INDEX progression_automation_consent_events_athlete_id_intent_id_key ON progression_automation_consent_events(athlete_id,intent_id);
CREATE UNIQUE INDEX progression_automation_consent_events_consent_id_version_key ON progression_automation_consent_events(consent_id,version);

CREATE FUNCTION guard_automation_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Consent history cannot be deleted' USING ERRCODE='55000'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Consent writes require READ COMMITTED owner fences' USING ERRCODE='25001'; END IF;
 -- Shared owner fence with existing manual progression; no session is simulated.
 PERFORM id FROM athletes WHERE id=NEW.athlete_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING_CONFIRMATION' OR NEW.version<>1 OR NEW.created_at<>NEW.updated_at THEN RAISE EXCEPTION 'Only an unaffirmed pending request may be created' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.state<>'PENDING_CONFIRMATION' OR NEW.version<>OLD.version+1
   OR (NEW.id,NEW.athlete_id,NEW.actor_user_id,NEW.exercise_id,NEW.training_plan_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.athlete_id,OLD.actor_user_id,OLD.exercise_id,OLD.training_plan_id,OLD.created_at)
   OR (NEW.state='REVOKED' AND (NEW.snapshot,NEW.contract_key,NEW.valid_from,NEW.valid_until) IS DISTINCT FROM (OLD.snapshot,OLD.contract_key,OLD.valid_from,OLD.valid_until))
  THEN RAISE EXCEPTION 'Illegal consent transition or ownership change' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id WHERE a.id=NEW.athlete_id AND u.id=NEW.actor_user_id AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Consent owner mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.state='PENDING_CONFIRMATION' THEN
  PERFORM clock_timestamp() AT TIME ZONE (NEW.snapshot->'contract'->'validity'->>'timeZone');
  IF NOT EXISTS(SELECT 1 FROM exercises e WHERE e.id=NEW.exercise_id AND e.is_active AND (e.origin='GLOBAL' OR (e.origin='PERSONAL' AND e.owner_id=NEW.actor_user_id)))
   OR (SELECT count(DISTINCT p.value) FROM jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds') p)<>jsonb_array_length(NEW.snapshot->'contract'->'selector'->'prescriptionIds')
   OR (SELECT count(DISTINCT z->>'prescriptionId') FROM jsonb_array_elements(NEW.snapshot->'destinations') z)<>jsonb_array_length(NEW.snapshot->'destinations')
   OR jsonb_array_length(NEW.snapshot->'destinations')<>jsonb_array_length(NEW.snapshot->'contract'->'selector'->'prescriptionIds')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds') p WHERE NOT EXISTS(SELECT 1 FROM plan_exercises x JOIN plan_days d ON d.id=x.plan_day_id JOIN plan_weeks w ON w.id=x.plan_week_id JOIN training_plans t ON t.id=w.training_plan_id WHERE x.id::text=p.value AND x.exercise_id=NEW.exercise_id AND t.athlete_id=NEW.athlete_id AND (NEW.training_plan_id IS NULL OR t.id=NEW.training_plan_id) AND d.plan_week_id=w.id AND d.retired_at IS NULL AND t.status='DRAFT' AND x.target_load_unit::text=NEW.snapshot->'contract'->'limits'->>'unit'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'destinations') z WHERE NOT EXISTS(SELECT 1 FROM plan_exercises x JOIN plan_weeks w ON w.id=x.plan_week_id JOIN training_plans t ON t.id=w.training_plan_id WHERE x.id::text=z->>'prescriptionId' AND x.id::text IN (SELECT jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds')) AND x.exercise_id::text=z->>'exerciseId' AND x.plan_day_id::text=z->>'dayId' AND x.plan_week_id::text=z->>'weekId' AND t.id::text=z->>'planId' AND t.version=(z->>'recordedPlanVersion')::integer AND t.athlete_id=NEW.athlete_id))
  THEN RAISE EXCEPTION 'Consent destinations must be explicit owned prescriptions' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM progression_automation_consents c WHERE c.id<>NEW.id AND c.athlete_id=NEW.athlete_id AND c.exercise_id=NEW.exercise_id AND c.state='PENDING_CONFIRMATION' AND tstzrange(c.valid_from,c.valid_until,'[)') && tstzrange(NEW.valid_from,NEW.valid_until,'[)') AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.snapshot->'contract'->'selector'->'prescriptionIds') x JOIN jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds') y ON x.value=y.value)) THEN RAISE EXCEPTION 'Ambiguous automation consent' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER automation_consents_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_automation_consents FOR EACH ROW EXECUTE FUNCTION guard_automation_consent();

CREATE FUNCTION guard_automation_consent_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c progression_automation_consents; previous progression_automation_consent_events;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Consent audit is immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO c FROM progression_automation_consents WHERE id=NEW.consent_id FOR UPDATE;
 IF c.id IS NULL OR NEW.athlete_id<>c.athlete_id OR NEW.actor_user_id<>c.actor_user_id OR NEW.version<>c.version OR NEW.state<>c.state OR NEW.snapshot IS DISTINCT FROM c.snapshot OR NEW.contract_key<>c.contract_key OR NEW.recorded_at<>c.updated_at OR NEW.recorded_at>clock_timestamp() THEN RAISE EXCEPTION 'Consent audit does not match transition' USING ERRCODE='23514'; END IF;
 IF NEW.version>1 THEN
  SELECT * INTO previous FROM progression_automation_consent_events WHERE consent_id=NEW.consent_id AND version=NEW.version-1;
  IF previous.id IS NULL OR previous.state IS DISTINCT FROM NEW.from_state OR previous.version IS DISTINCT FROM NEW.from_version OR NEW.recorded_at<previous.recorded_at OR (NEW.action='REVOKE' AND (NEW.snapshot,NEW.contract_key) IS DISTINCT FROM (previous.snapshot,previous.contract_key)) THEN RAISE EXCEPTION 'Consent audit chain is incomplete' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER automation_consent_events_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_automation_consent_events FOR EACH ROW EXECUTE FUNCTION guard_automation_consent_event();
CREATE FUNCTION check_automation_consent_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e progression_automation_consent_events;
BEGIN
 -- Validate this captured transition even if another version is written in the same transaction.
 SELECT * INTO e FROM progression_automation_consent_events WHERE consent_id=NEW.id AND version=NEW.version;
 IF e.id IS NULL OR e.athlete_id<>NEW.athlete_id OR e.actor_user_id<>NEW.actor_user_id OR e.state<>NEW.state OR e.snapshot IS DISTINCT FROM NEW.snapshot OR e.contract_key<>NEW.contract_key OR e.recorded_at<>NEW.updated_at THEN RAISE EXCEPTION 'Consent transition requires its exact audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER automation_consents_audit_pair AFTER INSERT OR UPDATE ON progression_automation_consents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_automation_consent_pair();
COMMIT;
