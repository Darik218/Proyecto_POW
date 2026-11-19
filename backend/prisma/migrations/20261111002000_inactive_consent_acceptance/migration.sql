-- Human confirmation is non-operational. No legacy row is accepted or rewritten.
BEGIN;
CREATE TABLE progression_consent_acceptance_challenges (
 id UUID PRIMARY KEY, consent_id UUID NOT NULL, athlete_id UUID NOT NULL,
 actor_user_id UUID NOT NULL, actor_session_id UUID NOT NULL,
 version INTEGER NOT NULL, contract_key CHAR(64) NOT NULL, conditions_key CHAR(64) NOT NULL, context_key CHAR(64) NOT NULL,
 terms_version VARCHAR(160) NOT NULL, presentation_version VARCHAR(48) NOT NULL,
 dependencies JSONB NOT NULL, issued_at TIMESTAMPTZ(6) NOT NULL, expires_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT consent_acceptance_challenge_owner_fkey FOREIGN KEY(consent_id,athlete_id) REFERENCES progression_automation_consents(id,athlete_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT progression_consent_acceptance_challenges_actor_session_id_fkey FOREIGN KEY(actor_session_id) REFERENCES auth_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT consent_acceptance_challenge_shape CHECK(version>0 AND contract_key ~ '^[0-9a-f]{64}$' AND conditions_key ~ '^[0-9a-f]{64}$' AND context_key ~ '^[0-9a-f]{64}$' AND length(terms_version)>0 AND presentation_version='recurring-consent-presentation-v1' AND jsonb_typeof(dependencies)='object' AND isfinite(issued_at) AND isfinite(expires_at) AND expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes')
);
CREATE INDEX consent_acceptance_challenge_context_idx ON progression_consent_acceptance_challenges(consent_id,actor_session_id,issued_at);
ALTER TABLE progression_automation_consent_events ADD COLUMN acceptance_challenge_id UUID,
 ADD COLUMN acceptance_evidence JSONB,
 ADD CONSTRAINT consent_acceptance_event_challenge_fkey FOREIGN KEY(acceptance_challenge_id) REFERENCES progression_consent_acceptance_challenges(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX consent_acceptance_event_challenge_key ON progression_automation_consent_events(acceptance_challenge_id);

-- Explicit dependency projection; decimals stay textual, no loads are calculated here.
CREATE FUNCTION automation_acceptance_dependencies(c progression_automation_consents) RETURNS JSONB LANGUAGE SQL STABLE AS $$
 SELECT jsonb_build_object(
 'schemaVersion','consent-acceptance-dependencies-v1',
 'targets',COALESCE((SELECT jsonb_agg((to_jsonb(x)-'target_load'-'target_rpe')||jsonb_build_object('target_load',x.target_load::text,'target_rpe',x.target_rpe::text) ORDER BY x.id) FROM plan_exercises x WHERE x.id::text IN(SELECT jsonb_array_elements_text(c.snapshot->'contract'->'selector'->'prescriptionIds'))),'[]'::jsonb),
 'plans',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'athleteId',t.athlete_id,'status',t.status,'version',t.version) ORDER BY t.id) FROM training_plans t WHERE t.id::text IN(SELECT DISTINCT z->>'planId' FROM jsonb_array_elements(c.snapshot->'destinations') z)),'[]'::jsonb),
 'days',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'weekId',d.plan_week_id,'retiredAt',d.retired_at) ORDER BY d.id) FROM plan_days d WHERE d.id::text IN(SELECT DISTINCT z->>'dayId' FROM jsonb_array_elements(c.snapshot->'destinations') z)),'[]'::jsonb),
 'exercise',(SELECT jsonb_build_object('id',e.id,'active',e.is_active,'origin',e.origin,'ownerId',e.owner_id) FROM exercises e WHERE e.id=c.exercise_id),
 'settings',COALESCE((SELECT jsonb_agg((to_jsonb(s)-'updated_at'-'auto_apply_authorized'-'target_rpe_min'-'target_rpe_max'-'increment_absolute'-'increment_percent'-'max_increment_percent'-'max_load')||jsonb_build_object('target_rpe_min',s.target_rpe_min::text,'target_rpe_max',s.target_rpe_max::text,'increment_absolute',s.increment_absolute::text,'increment_percent',s.increment_percent::text,'max_increment_percent',s.max_increment_percent::text,'max_load',s.max_load::text) ORDER BY s.id) FROM progression_settings s WHERE s.athlete_id=c.athlete_id AND (s.exercise_id IS NULL OR s.exercise_id=c.exercise_id) AND (s.training_plan_id IS NULL OR s.training_plan_id::text IN(SELECT DISTINCT z->>'planId' FROM jsonb_array_elements(c.snapshot->'destinations') z))),'[]'::jsonb));
$$;
CREATE FUNCTION automation_acceptance_conditions_key(k TEXT,d JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array('consent-presented-conditions-v1',k,d)::text,'UTF8')),'hex');
$$;
CREATE FUNCTION automation_acceptance_evidence_key(e JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array('recurring-consent-acceptance-fingerprint-v1',e->>'schemaVersion',e->>'challengeId',e->>'actorSessionId',e->>'acceptedVersion',e->>'contractKey',e->>'conditionsKey',e->>'contextKey',e->>'termsVersion',e->>'presentationVersion',e->'conditionsPresented',e->'acknowledgments',e->>'provenance')::text,'UTF8')),'hex');
$$;
CREATE FUNCTION guard_consent_acceptance_challenge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c progression_automation_consents;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Acceptance challenges are immutable' USING ERRCODE='55000'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Challenge requires owner fences' USING ERRCODE='25001'; END IF;
 PERFORM id FROM athletes WHERE id=NEW.athlete_id FOR UPDATE;
 SELECT * INTO c FROM progression_automation_consents WHERE id=NEW.consent_id FOR UPDATE;
 IF c.id IS NULL OR c.state<>'PENDING_CONFIRMATION' OR c.version<>NEW.version OR c.athlete_id<>NEW.athlete_id OR c.actor_user_id<>NEW.actor_user_id OR c.contract_key<>NEW.contract_key OR c.snapshot->'contract'->>'termsVersion'<>NEW.terms_version OR NEW.issued_at<c.updated_at OR NEW.issued_at>clock_timestamp() OR NEW.expires_at>c.valid_until OR NEW.expires_at<=clock_timestamp() OR NEW.dependencies IS DISTINCT FROM automation_acceptance_dependencies(c) OR NEW.conditions_key<>automation_acceptance_conditions_key(c.contract_key,NEW.dependencies)
 OR NEW.context_key<>encode(sha256(convert_to('consent-acceptance-context-v1'||E'\n'||NEW.actor_user_id::text||E'\n'||NEW.actor_session_id::text,'UTF8')),'hex')
 OR NOT EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN athletes a ON a.user_id=u.id WHERE s.id=NEW.actor_session_id AND u.id=NEW.actor_user_id AND a.id=NEW.athlete_id AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'Invalid acceptance challenge binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER consent_acceptance_challenges_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_consent_acceptance_challenges FOR EACH ROW EXECUTE FUNCTION guard_consent_acceptance_challenge();

ALTER TABLE progression_automation_consents DROP CONSTRAINT automation_consent_shape, ADD CONSTRAINT automation_consent_shape CHECK(COALESCE(
 state IN ('PENDING_CONFIRMATION','ACCEPTED_INACTIVE','REVOKED') AND version>0 AND contract_key ~ '^[0-9a-f]{64}$'
 AND valid_from<valid_until AND isfinite(valid_from) AND isfinite(valid_until) AND created_at<=updated_at
 AND ((state IN ('PENDING_CONFIRMATION','ACCEPTED_INACTIVE') AND revoked_at IS NULL) OR (state='REVOKED' AND revoked_at=updated_at))
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
 ,false));
ALTER TABLE progression_automation_consent_events DROP CONSTRAINT automation_consent_event_shape, ADD CONSTRAINT automation_consent_event_shape CHECK(COALESCE(
 request_key ~ '^[0-9a-f]{64}$' AND contract_key ~ '^[0-9a-f]{64}$' AND version>0 AND
 ((action='CREATE' AND version=1 AND from_version IS NULL AND from_state IS NULL AND state='PENDING_CONFIRMATION' AND reason IS NULL)
 OR (action='REVISE' AND version=from_version+1 AND from_state='PENDING_CONFIRMATION' AND state='PENDING_CONFIRMATION' AND reason IS NULL)
 OR (action='REVOKE' AND version=from_version+1 AND from_state IN ('PENDING_CONFIRMATION','ACCEPTED_INACTIVE') AND state='REVOKED' AND reason='OWNER_REQUEST')
 OR (action='ACCEPT' AND version=from_version+1 AND from_state='PENDING_CONFIRMATION' AND state='ACCEPTED_INACTIVE' AND reason IS NULL)),false));
ALTER TABLE progression_automation_consent_events ADD CONSTRAINT automation_acceptance_evidence_shape CHECK((action='ACCEPT' AND acceptance_challenge_id IS NOT NULL AND acceptance_evidence IS NOT NULL) OR (action<>'ACCEPT' AND acceptance_challenge_id IS NULL AND acceptance_evidence IS NULL));
CREATE OR REPLACE FUNCTION guard_automation_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Consent history cannot be deleted' USING ERRCODE='55000'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Consent writes require READ COMMITTED owner fences' USING ERRCODE='25001'; END IF;
 -- Shared owner fence with existing manual progression; no session is simulated.
 PERFORM id FROM athletes WHERE id=NEW.athlete_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING_CONFIRMATION' OR NEW.version<>1 OR NEW.created_at<>NEW.updated_at THEN RAISE EXCEPTION 'Only an unaffirmed pending request may be created' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT ((OLD.state='PENDING_CONFIRMATION' AND NEW.state IN ('PENDING_CONFIRMATION','ACCEPTED_INACTIVE','REVOKED')) OR (OLD.state='ACCEPTED_INACTIVE' AND NEW.state='REVOKED')) OR NEW.version<>OLD.version+1
   OR (NEW.id,NEW.athlete_id,NEW.actor_user_id,NEW.exercise_id,NEW.training_plan_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.athlete_id,OLD.actor_user_id,OLD.exercise_id,OLD.training_plan_id,OLD.created_at)
   OR (NEW.state IN ('ACCEPTED_INACTIVE','REVOKED') AND (NEW.snapshot,NEW.contract_key,NEW.valid_from,NEW.valid_until) IS DISTINCT FROM (OLD.snapshot,OLD.contract_key,OLD.valid_from,OLD.valid_until))
  THEN RAISE EXCEPTION 'Illegal consent transition or ownership change' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id WHERE a.id=NEW.athlete_id AND u.id=NEW.actor_user_id AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Consent owner mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.state IN ('PENDING_CONFIRMATION','ACCEPTED_INACTIVE') THEN
  PERFORM clock_timestamp() AT TIME ZONE (NEW.snapshot->'contract'->'validity'->>'timeZone');
  IF NOT EXISTS(SELECT 1 FROM exercises e WHERE e.id=NEW.exercise_id AND e.is_active AND (e.origin='GLOBAL' OR (e.origin='PERSONAL' AND e.owner_id=NEW.actor_user_id)))
   OR (SELECT count(DISTINCT p.value) FROM jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds') p)<>jsonb_array_length(NEW.snapshot->'contract'->'selector'->'prescriptionIds')
   OR (SELECT count(DISTINCT z->>'prescriptionId') FROM jsonb_array_elements(NEW.snapshot->'destinations') z)<>jsonb_array_length(NEW.snapshot->'destinations')
   OR jsonb_array_length(NEW.snapshot->'destinations')<>jsonb_array_length(NEW.snapshot->'contract'->'selector'->'prescriptionIds')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds') p WHERE NOT EXISTS(SELECT 1 FROM plan_exercises x JOIN plan_days d ON d.id=x.plan_day_id JOIN plan_weeks w ON w.id=x.plan_week_id JOIN training_plans t ON t.id=w.training_plan_id WHERE x.id::text=p.value AND x.exercise_id=NEW.exercise_id AND t.athlete_id=NEW.athlete_id AND (NEW.training_plan_id IS NULL OR t.id=NEW.training_plan_id) AND d.plan_week_id=w.id AND d.retired_at IS NULL AND t.status='DRAFT' AND x.target_load_unit::text=NEW.snapshot->'contract'->'limits'->>'unit'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'destinations') z WHERE NOT EXISTS(SELECT 1 FROM plan_exercises x JOIN plan_weeks w ON w.id=x.plan_week_id JOIN training_plans t ON t.id=w.training_plan_id WHERE x.id::text=z->>'prescriptionId' AND x.id::text IN (SELECT jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds')) AND x.exercise_id::text=z->>'exerciseId' AND x.plan_day_id::text=z->>'dayId' AND x.plan_week_id::text=z->>'weekId' AND t.id::text=z->>'planId' AND t.version=(z->>'recordedPlanVersion')::integer AND t.athlete_id=NEW.athlete_id))
  THEN RAISE EXCEPTION 'Consent destinations must be explicit owned prescriptions' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM progression_automation_consents c WHERE c.id<>NEW.id AND c.athlete_id=NEW.athlete_id AND c.exercise_id=NEW.exercise_id AND c.state IN ('PENDING_CONFIRMATION','ACCEPTED_INACTIVE') AND tstzrange(c.valid_from,c.valid_until,'[)') && tstzrange(NEW.valid_from,NEW.valid_until,'[)') AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.snapshot->'contract'->'selector'->'prescriptionIds') x JOIN jsonb_array_elements_text(NEW.snapshot->'contract'->'selector'->'prescriptionIds') y ON x.value=y.value)) THEN RAISE EXCEPTION 'Ambiguous automation consent' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION guard_automation_consent_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c progression_automation_consents; previous progression_automation_consent_events;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Consent audit is immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO c FROM progression_automation_consents WHERE id=NEW.consent_id FOR UPDATE;
 IF c.id IS NULL OR NEW.athlete_id<>c.athlete_id OR NEW.actor_user_id<>c.actor_user_id OR NEW.version<>c.version OR NEW.state<>c.state OR NEW.snapshot IS DISTINCT FROM c.snapshot OR NEW.contract_key<>c.contract_key OR NEW.recorded_at<>c.updated_at OR NEW.recorded_at>clock_timestamp() THEN RAISE EXCEPTION 'Consent audit does not match transition' USING ERRCODE='23514'; END IF;
 IF NEW.version>1 THEN
  SELECT * INTO previous FROM progression_automation_consent_events WHERE consent_id=NEW.consent_id AND version=NEW.version-1;
  IF previous.id IS NULL OR previous.state IS DISTINCT FROM NEW.from_state OR previous.version IS DISTINCT FROM NEW.from_version OR NEW.recorded_at<previous.recorded_at OR (NEW.action IN ('ACCEPT','REVOKE') AND (NEW.snapshot,NEW.contract_key) IS DISTINCT FROM (previous.snapshot,previous.contract_key)) THEN RAISE EXCEPTION 'Consent audit chain is incomplete' USING ERRCODE='23514'; END IF;
 END IF;

 IF NEW.action='ACCEPT' THEN
  IF NOT EXISTS(SELECT 1 FROM progression_consent_acceptance_challenges h JOIN auth_sessions s ON s.id=h.actor_session_id JOIN users u ON u.id=s.user_id WHERE h.id=NEW.acceptance_challenge_id AND h.consent_id=c.id AND h.athlete_id=c.athlete_id AND h.actor_user_id=NEW.actor_user_id AND u.id=NEW.actor_user_id AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp() AND h.version=NEW.from_version AND h.contract_key=NEW.contract_key AND h.expires_at>NEW.recorded_at AND NEW.recorded_at<c.valid_until AND h.expires_at>clock_timestamp() AND c.valid_until>clock_timestamp() AND h.issued_at<=NEW.recorded_at AND h.dependencies=automation_acceptance_dependencies(c)
  AND jsonb_typeof(NEW.acceptance_evidence)='object' AND (NEW.acceptance_evidence-ARRAY['schemaVersion','challengeId','actorSessionId','acceptedVersion','contractKey','conditionsKey','contextKey','termsVersion','presentationVersion','conditionsPresented','acknowledgments','provenance','acceptanceKey'])='{}'::jsonb
  AND NEW.acceptance_evidence->>'schemaVersion'='recurring-consent-acceptance-v1'
  AND NEW.acceptance_evidence->>'challengeId'=h.id::text AND NEW.acceptance_evidence->>'actorSessionId'=h.actor_session_id::text
  AND NEW.acceptance_evidence->>'acceptedVersion'=NEW.from_version::text AND NEW.acceptance_evidence->>'contractKey'=h.contract_key
  AND NEW.acceptance_evidence->>'conditionsKey'=h.conditions_key AND NEW.acceptance_evidence->>'contextKey'=h.context_key
  AND NEW.acceptance_evidence->>'termsVersion'=h.terms_version AND NEW.acceptance_evidence->>'presentationVersion'=h.presentation_version
  AND NEW.acceptance_evidence->'conditionsPresented'='true'::jsonb AND NEW.acceptance_evidence->'acknowledgments'='{"policy":true,"limits":true,"destinations":true,"validity":true,"revocation":true}'::jsonb
  AND NEW.acceptance_evidence->>'provenance'='AUTHENTICATED_CONSENT_CONFIRMATION'
  AND NEW.acceptance_evidence->>'acceptanceKey'=automation_acceptance_evidence_key(NEW.acceptance_evidence))
  THEN RAISE EXCEPTION 'Acceptance requires exact issued conditions, live session and explicit acknowledgments' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

COMMIT;
