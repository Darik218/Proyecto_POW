-- FINAL-MVP additive operational branch. No legacy grants or acceptances are backfilled.
BEGIN;
ALTER TABLE progression_applications ADD COLUMN operational_grant_id UUID, ADD COLUMN grant_version INTEGER, ADD COLUMN executor_id VARCHAR(64);
CREATE TABLE "progression_operational_grants" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "acceptance_event_id" UUID NOT NULL,
    "consent_version" INTEGER NOT NULL,
    "accepted_version" INTEGER NOT NULL,
    "contract_key" CHAR(64) NOT NULL,
    "principal_id" VARCHAR(64) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "version" INTEGER NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_session_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "activated_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "progression_operational_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "progression_operational_events" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_session_id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "action" VARCHAR(12) NOT NULL,
    "version" INTEGER NOT NULL,
    "request_key" CHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "progression_operational_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "progression_automatic_runs" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "operation_key" CHAR(64) NOT NULL,
    "result" VARCHAR(12) NOT NULL,
    "reasons" JSONB NOT NULL,
    "application_id" UUID,
    "previous_load" DECIMAL(24,6),
    "applied_load" DECIMAL(24,6),
    "unit" "MeasurementUnit",
    "cycle_key" CHAR(64),
    "audit" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "progression_automatic_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "progression_automatic_batches" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "grant_version" INTEGER NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_session_id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "candidate_ids" JSONB NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "progression_automatic_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "progression_operational_grants_consent_id_key" ON "progression_operational_grants"("consent_id");

CREATE UNIQUE INDEX "progression_operational_grants_acceptance_event_id_key" ON "progression_operational_grants"("acceptance_event_id");

CREATE INDEX "progression_operational_grants_state_activated_at_idx" ON "progression_operational_grants"("state", "activated_at");

CREATE INDEX "progression_operational_events_grant_id_recorded_at_idx" ON "progression_operational_events"("grant_id", "recorded_at");

CREATE UNIQUE INDEX "progression_operational_events_athlete_id_intent_id_key" ON "progression_operational_events"("athlete_id", "intent_id");

CREATE UNIQUE INDEX "progression_automatic_runs_operation_key_key" ON "progression_automatic_runs"("operation_key");

CREATE UNIQUE INDEX "progression_automatic_runs_application_id_key" ON "progression_automatic_runs"("application_id");

CREATE INDEX "progression_automatic_runs_grant_id_recorded_at_idx" ON "progression_automatic_runs"("grant_id", "recorded_at");

CREATE UNIQUE INDEX "progression_automatic_batches_athlete_id_intent_id_key" ON "progression_automatic_batches"("athlete_id", "intent_id");

ALTER TABLE "progression_applications" ADD CONSTRAINT "progression_applications_operational_grant_id_fkey" FOREIGN KEY ("operational_grant_id") REFERENCES "progression_operational_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_grants" ADD CONSTRAINT "progression_operational_grants_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_grants" ADD CONSTRAINT "progression_operational_grants_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "progression_automation_consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_grants" ADD CONSTRAINT "progression_operational_grants_acceptance_event_id_fkey" FOREIGN KEY ("acceptance_event_id") REFERENCES "progression_automation_consent_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_grants" ADD CONSTRAINT "progression_operational_grants_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_grants" ADD CONSTRAINT "progression_operational_grants_actor_session_id_fkey" FOREIGN KEY ("actor_session_id") REFERENCES "auth_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_events" ADD CONSTRAINT "progression_operational_events_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "progression_operational_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_events" ADD CONSTRAINT "progression_operational_events_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_events" ADD CONSTRAINT "progression_operational_events_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "progression_automation_consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_events" ADD CONSTRAINT "progression_operational_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_operational_events" ADD CONSTRAINT "progression_operational_events_actor_session_id_fkey" FOREIGN KEY ("actor_session_id") REFERENCES "auth_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_runs" ADD CONSTRAINT "progression_automatic_runs_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "progression_operational_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_runs" ADD CONSTRAINT "progression_automatic_runs_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_runs" ADD CONSTRAINT "progression_automatic_runs_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "progression_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_runs" ADD CONSTRAINT "progression_automatic_runs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "progression_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_batches" ADD CONSTRAINT "progression_automatic_batches_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_batches" ADD CONSTRAINT "progression_automatic_batches_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "progression_automation_consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_batches" ADD CONSTRAINT "progression_automatic_batches_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "progression_operational_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_batches" ADD CONSTRAINT "progression_automatic_batches_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progression_automatic_batches" ADD CONSTRAINT "progression_automatic_batches_actor_session_id_fkey" FOREIGN KEY ("actor_session_id") REFERENCES "auth_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE progression_operational_grants ADD CONSTRAINT operational_grant_shape CHECK (
 principal_id='PULSO_INTERNAL_PROGRESSION_WORKER_V1' AND contract_key ~ '^[0-9a-f]{64}$' AND accepted_version>0 AND consent_version=accepted_version+1
 AND ((state='ACTIVE' AND version=1 AND revoked_at IS NULL) OR(state='REVOKED' AND version=2 AND revoked_at>=activated_at))
 AND snapshot->>'schemaVersion'='operational-grant-snapshot-v1' AND snapshot->>'termsVersion'='saved-recommendations-activation-v1' AND snapshot->'confirmed'='true'::jsonb AND isfinite(activated_at));
ALTER TABLE progression_operational_events ADD CONSTRAINT operational_event_shape CHECK(action IN('ACTIVATE','REVOKE','CHECK') AND version>0 AND request_key ~ '^[0-9a-f]{64}$' AND jsonb_typeof(snapshot)='object' AND isfinite(recorded_at));
CREATE UNIQUE INDEX operational_transition_version ON progression_operational_events(grant_id,version) WHERE action IN('ACTIVATE','REVOKE');
ALTER TABLE progression_automatic_runs ADD CONSTRAINT automatic_run_shape CHECK(operation_key ~ '^[0-9a-f]{64}$' AND jsonb_typeof(reasons)='array' AND jsonb_typeof(audit)='object' AND isfinite(recorded_at) AND ((result='APPLIED' AND application_id IS NOT NULL AND jsonb_array_length(reasons)=0 AND applied_load>previous_load AND previous_load>0 AND unit IS NOT NULL AND cycle_key IS NOT NULL) OR(result='BLOCKED' AND application_id IS NULL AND jsonb_array_length(reasons)>0)));
ALTER TABLE progression_automatic_batches ADD CONSTRAINT automatic_batch_shape CHECK(grant_version>0 AND jsonb_typeof(candidate_ids)='array' AND jsonb_array_length(candidate_ids)<=100 AND isfinite(created_at) AND (completed_at IS NULL OR(completed_at>=created_at AND isfinite(completed_at))));
CREATE FUNCTION guard_operational_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c progression_automation_consents; e progression_automation_consent_events;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Operational grants are retained' USING ERRCODE='55000';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Operational writes require fences' USING ERRCODE='25001';END IF;
 PERFORM id FROM users WHERE id=NEW.actor_user_id FOR SHARE NOWAIT;
 PERFORM id FROM athletes WHERE id=NEW.athlete_id FOR UPDATE NOWAIT;
 IF TG_OP='UPDATE' THEN
  IF OLD.state<>'ACTIVE' OR NEW.state<>'REVOKED' OR NEW.version<>OLD.version+1 OR (to_jsonb(OLD)-ARRAY['state','version','revoked_at']) IS DISTINCT FROM(to_jsonb(NEW)-ARRAY['state','version','revoked_at']) THEN RAISE EXCEPTION 'Only terminal grant revocation is allowed' USING ERRCODE='55000';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO c FROM progression_automation_consents WHERE id=NEW.consent_id FOR UPDATE NOWAIT;
 SELECT * INTO e FROM progression_automation_consent_events WHERE id=NEW.acceptance_event_id;
 IF c.id IS NULL OR c.state<>'ACCEPTED_INACTIVE' OR c.athlete_id<>NEW.athlete_id OR c.version<>NEW.consent_version OR c.contract_key<>NEW.contract_key OR e.consent_id<>c.id OR e.athlete_id<>c.athlete_id OR e.action<>'ACCEPT' OR e.actor_user_id<>NEW.actor_user_id OR e.version<>c.version OR e.from_version<>NEW.accepted_version OR e.acceptance_evidence->>'contractKey' IS DISTINCT FROM c.contract_key
 OR e.acceptance_evidence->>'acceptedVersion' IS DISTINCT FROM NEW.accepted_version::text OR NEW.snapshot->'consent' IS DISTINCT FROM c.snapshot OR NEW.activated_at<c.valid_from OR NEW.activated_at>=c.valid_until OR NEW.activated_at>clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id JOIN auth_sessions s ON s.user_id=u.id WHERE a.id=c.athlete_id AND u.id=NEW.actor_user_id AND s.id=NEW.actor_session_id AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'Operational activation requires exact accepted owned contract and session' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER operational_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_operational_grants FOR EACH ROW EXECUTE FUNCTION guard_operational_grant();
CREATE FUNCTION guard_operational_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g progression_operational_grants;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Operational events are immutable' USING ERRCODE='55000';END IF;
 SELECT * INTO g FROM progression_operational_grants WHERE id=NEW.grant_id;
 IF g.id IS NULL OR g.athlete_id<>NEW.athlete_id OR g.consent_id<>NEW.consent_id OR NEW.recorded_at>clock_timestamp() OR NEW.version>g.version OR NEW.snapshot->>'intentId' IS DISTINCT FROM NEW.intent_id::text OR NEW.snapshot->>'consentId' IS DISTINCT FROM NEW.consent_id::text OR NEW.snapshot->>'action' IS DISTINCT FROM NEW.action
 OR (NEW.action='ACTIVATE' AND(g.state<>'ACTIVE' OR g.version<>1 OR NEW.version<>1 OR g.actor_user_id<>NEW.actor_user_id OR g.actor_session_id<>NEW.actor_session_id OR NEW.recorded_at<>g.activated_at))
 OR (NEW.action='REVOKE' AND(g.state<>'REVOKED' OR g.version<>2 OR NEW.version<>2 OR NEW.recorded_at<>g.revoked_at))
 OR NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id JOIN auth_sessions s ON s.user_id=u.id WHERE a.id=g.athlete_id AND u.id=NEW.actor_user_id AND s.id=NEW.actor_session_id AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'Operational event mismatch' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER operational_events_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_operational_events FOR EACH ROW EXECUTE FUNCTION guard_operational_event();
CREATE FUNCTION check_operational_grant_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g progression_operational_grants;
BEGIN
 IF TG_TABLE_NAME='progression_operational_grants' THEN SELECT * INTO g FROM progression_operational_grants WHERE id=NEW.id;ELSE SELECT * INTO g FROM progression_operational_grants WHERE id=NEW.grant_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM progression_operational_events WHERE grant_id=g.id AND action='ACTIVATE' AND version=1) OR(g.state='REVOKED' AND NOT EXISTS(SELECT 1 FROM progression_operational_events WHERE grant_id=g.id AND action='REVOKE' AND version=2)) THEN RAISE EXCEPTION 'Grant transition and audit must commit together' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER operational_grant_pair AFTER INSERT OR UPDATE ON progression_operational_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_operational_grant_pair();
CREATE CONSTRAINT TRIGGER operational_event_pair AFTER INSERT ON progression_operational_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_operational_grant_pair();
CREATE FUNCTION guard_automatic_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a progression_applications;g progression_operational_grants;p progression_recommendations;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Automatic audit is immutable' USING ERRCODE='55000';END IF;
 SELECT * INTO g FROM progression_operational_grants WHERE id=NEW.grant_id;SELECT * INTO p FROM progression_recommendations WHERE id=NEW.recommendation_id;
 IF g.athlete_id IS DISTINCT FROM NEW.athlete_id OR p.athlete_id IS DISTINCT FROM NEW.athlete_id THEN RAISE EXCEPTION 'Run owner mismatch' USING ERRCODE='23514';END IF;
 IF NEW.result='APPLIED' THEN
  SELECT * INTO a FROM progression_applications WHERE id=NEW.application_id;
  IF a.id IS NULL OR a.origin<>'AUTOMATIC' OR a.operational_grant_id<>g.id OR a.recommendation_id<>p.id OR a.audit->'authorization'->>'executionEventId' IS DISTINCT FROM NEW.id::text OR a.request_key<>NEW.operation_key OR a.applied_load<>NEW.applied_load OR a.previous_load<>NEW.previous_load OR a.cycle_key<>NEW.cycle_key OR a.effective_at<>NEW.recorded_at THEN RAISE EXCEPTION 'Run must match automatic application' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER automatic_runs_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_automatic_runs FOR EACH ROW EXECUTE FUNCTION guard_automatic_run();
CREATE FUNCTION guard_automatic_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR(TG_OP='UPDATE' AND(OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL OR(to_jsonb(OLD)-'completed_at') IS DISTINCT FROM(to_jsonb(NEW)-'completed_at'))) THEN RAISE EXCEPTION 'Batch selection and final result are immutable' USING ERRCODE='55000';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER automatic_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_automatic_batches FOR EACH ROW EXECUTE FUNCTION guard_automatic_batch();
-- Preserve the exact old manual/legacy CHECK and add a disjoint operational branch.
DO $$DECLARE old_expression TEXT;BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO old_expression FROM pg_constraint WHERE conname='progression_applications_audit_check' AND conrelid='progression_applications'::regclass;
 ALTER TABLE progression_applications DROP CONSTRAINT progression_applications_audit_check;
 EXECUTE 'ALTER TABLE progression_applications ADD CONSTRAINT progression_applications_audit_check CHECK ((('||old_expression||') AND operational_grant_id IS NULL AND grant_version IS NULL AND executor_id IS NULL) OR COALESCE((origin=''AUTOMATIC'' AND operational_grant_id IS NOT NULL AND grant_version>0 AND executor_id=''PULSO_INTERNAL_PROGRESSION_WORKER_V1'' AND athlete_id IS NOT NULL AND actor_user_id IS NULL AND review_id IS NULL AND plan_exercise_id IS NOT NULL AND scheduled_activity_id IS NOT NULL AND intent_id IS NOT NULL AND request_key ~ ''^[0-9a-f]{64}$'' AND cycle_key ~ ''^[0-9a-f]{64}$'' AND previous_load>0 AND applied_load>previous_load AND applied_load<''Infinity''::numeric AND load_unit IS NOT NULL AND audit->>''schemaVersion''=''automatic-progression-application-v1'' AND audit->>''fromStatus''=''PENDING'' AND audit->>''toStatus''=''APPLIED'' AND audit->''authorization''->>''grantId''=operational_grant_id::text AND (audit->''authorization''->>''grantVersion'')::integer=grant_version),false))';
END;$$;
-- Keep the old function untouched for manual INSERT and all immutable UPDATE/DELETE.
DROP TRIGGER progression_applications_authorized_guard ON progression_applications;
CREATE TRIGGER progression_applications_authorized_guard BEFORE INSERT ON progression_applications FOR EACH ROW WHEN(NOT(NEW.origin='AUTOMATIC' AND NEW.audit IS NOT NULL)) EXECUTE FUNCTION guard_authorized_progression_application();
CREATE TRIGGER progression_applications_immutable_guard BEFORE UPDATE OR DELETE ON progression_applications FOR EACH ROW EXECUTE FUNCTION guard_authorized_progression_application();
CREATE FUNCTION guard_automatic_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g progression_operational_grants;c progression_automation_consents;p progression_recommendations;e progression_automation_consent_events; n INTEGER;tz TEXT;day0 DATE;week0 DATE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Automatic application requires READ COMMITTED' USING ERRCODE='25001';END IF;
 SELECT * INTO g FROM progression_operational_grants WHERE id=NEW.operational_grant_id;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Missing operational grant' USING ERRCODE='23514';END IF;
 PERFORM id FROM athletes WHERE id=g.athlete_id FOR UPDATE NOWAIT;
 SELECT * INTO g FROM progression_operational_grants WHERE id=g.id FOR SHARE NOWAIT;
 SELECT * INTO c FROM progression_automation_consents WHERE id=g.consent_id FOR SHARE NOWAIT;
 SELECT * INTO e FROM progression_automation_consent_events WHERE id=g.acceptance_event_id;
 SELECT * INTO p FROM progression_recommendations WHERE id=NEW.recommendation_id FOR UPDATE NOWAIT;
 IF g.state<>'ACTIVE' OR g.version<>NEW.grant_version OR NEW.executor_id<>g.principal_id OR c.state<>'ACCEPTED_INACTIVE' OR c.version<>g.consent_version OR c.contract_key<>g.contract_key OR c.athlete_id<>NEW.athlete_id OR p.athlete_id<>g.athlete_id OR p.exercise_id<>c.exercise_id OR p.status<>'PENDING' OR p.semantic_key IS NULL OR p.review_version IS NOT NULL OR p.reviewed_at IS NOT NULL OR p.cycle_slot IS DISTINCT FROM p.cycle_key OR NEW.cycle_key IS DISTINCT FROM p.cycle_key
 OR e.action<>'ACCEPT' OR e.version<>c.version OR e.contract_key<>c.contract_key OR NEW.effective_at<c.valid_from OR NEW.effective_at>=c.valid_until OR NEW.effective_at>clock_timestamp() OR(p.expires_at IS NOT NULL AND p.expires_at<=NEW.effective_at)
 OR NEW.previous_load IS DISTINCT FROM p.previous_load OR NEW.applied_load IS DISTINCT FROM p.recommended_load OR NEW.load_unit IS DISTINCT FROM p.load_unit
 OR NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id WHERE a.id=g.athlete_id AND u.status='ACTIVE')
 OR NOT(c.snapshot->'contract'->'selector'->'prescriptionIds' ? NEW.plan_exercise_id::text)
 OR NEW.plan_exercise_id::text IS DISTINCT FROM p.snapshot->'destination'->>'prescriptionId'
 OR NEW.audit->'authorization'->>'consentId' IS DISTINCT FROM c.id::text OR NEW.audit->'authorization'->>'acceptanceEventId' IS DISTINCT FROM e.id::text OR NEW.audit->'authorization'->>'contractKey' IS DISTINCT FROM c.contract_key OR NEW.audit->'authorization'->>'semanticKey' IS DISTINCT FROM p.semantic_key OR NEW.audit->'authorization'->'dependencyKeys' IS DISTINCT FROM p.dependency_keys
 OR NEW.audit->'load'->>'previousLoad' IS DISTINCT FROM NEW.previous_load::text AND (NEW.audit->'load'->>'previousLoad')::numeric IS DISTINCT FROM NEW.previous_load
 OR (NEW.audit->'load'->>'appliedLoad')::numeric IS DISTINCT FROM NEW.applied_load OR NEW.audit->'load'->>'unit' IS DISTINCT FROM NEW.load_unit::text
 OR NEW.applied_load-NEW.previous_load>(c.snapshot->'contract'->'limits'->>'maximumAbsoluteIncrement')::numeric
 OR (NEW.applied_load-NEW.previous_load)*100>NEW.previous_load*(c.snapshot->'contract'->'limits'->>'maximumPercentIncrement')::numeric
 OR NEW.applied_load>(c.snapshot->'contract'->'limits'->>'maximumLoad')::numeric OR NEW.load_unit::text IS DISTINCT FROM c.snapshot->'contract'->'limits'->>'unit'
 THEN RAISE EXCEPTION 'Automatic application lacks exact active operational authority' USING ERRCODE='23514';END IF;
 tz:=c.snapshot->'contract'->'validity'->>'timeZone';day0:=(NEW.effective_at AT TIME ZONE tz)::date;week0:=day0-((extract(isodow FROM day0)::integer-(c.snapshot->'contract'->'limits'->>'weekStartsOn')::integer+7)%7);
 SELECT count(*) INTO n FROM progression_applications a JOIN progression_recommendations r ON r.id=a.recommendation_id WHERE r.athlete_id=g.athlete_id AND r.exercise_id=c.exercise_id AND (a.effective_at AT TIME ZONE tz)::date>=week0 AND (a.effective_at AT TIME ZONE tz)::date<week0+7;
 IF n>=(c.snapshot->'contract'->'limits'->>'maximumApplicationsPerWeek')::integer THEN RAISE EXCEPTION 'Weekly frequency exhausted' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER automatic_application_guard BEFORE INSERT ON progression_applications FOR EACH ROW WHEN(NEW.origin='AUTOMATIC' AND NEW.audit IS NOT NULL) EXECUTE FUNCTION guard_automatic_application();
CREATE FUNCTION check_automatic_application_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a progression_applications;r progression_automatic_runs;p progression_recommendations;
BEGIN
 IF TG_TABLE_NAME='progression_recommendations' THEN
  IF OLD.status<>'PENDING' THEN RAISE EXCEPTION 'Automatic transition requires neutral PENDING' USING ERRCODE='23514';END IF;
  SELECT * INTO a FROM progression_applications WHERE recommendation_id=NEW.id AND origin='AUTOMATIC' AND audit IS NOT NULL;
 ELSE SELECT * INTO a FROM progression_applications WHERE id=NEW.id;IF a.origin<>'AUTOMATIC' OR a.audit IS NULL THEN RETURN NULL;END IF;END IF;
 SELECT * INTO p FROM progression_recommendations WHERE id=a.recommendation_id;SELECT * INTO r FROM progression_automatic_runs WHERE application_id=a.id AND result='APPLIED';
 IF a.id IS NULL OR p.status<>'APPLIED' OR p.review_version IS NOT NULL OR r.id IS NULL OR a.audit->'authorization'->>'executionEventId' IS DISTINCT FROM r.id::text THEN RAISE EXCEPTION 'Automatic transition, authorization event and application must commit together' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER automatic_application_pair AFTER INSERT ON progression_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_automatic_application_pair();
CREATE CONSTRAINT TRIGGER automatic_recommendation_pair AFTER UPDATE ON progression_recommendations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.semantic_key IS NOT NULL AND NEW.review_version IS NULL AND NEW.status='APPLIED' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION check_automatic_application_pair();
COMMIT;
