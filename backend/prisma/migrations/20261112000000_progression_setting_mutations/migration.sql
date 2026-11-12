-- Additive SETTINGS-1 receipts; no setting row, snapshot or acceptance is rewritten.
BEGIN;
CREATE FUNCTION progression_setting_revision(s progression_settings) RETURNS TEXT LANGUAGE SQL STABLE STRICT AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array('progression-setting-row-revision-v1',to_jsonb(s))::text,'UTF8')),'hex');
$$;
CREATE TABLE progression_setting_mutations (
 id UUID PRIMARY KEY,
 athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 actor_session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 setting_id UUID NOT NULL REFERENCES progression_settings(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 intent_id UUID NOT NULL, action VARCHAR(12) NOT NULL, request_key CHAR(64) NOT NULL,
 before_revision CHAR(64), revision CHAR(64) NOT NULL, snapshot JSONB NOT NULL,recorded_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT progression_setting_mutation_shape CHECK(COALESCE(request_key ~ '^[0-9a-f]{64}$' AND revision ~ '^[0-9a-f]{64}$' AND ((action='CREATE' AND before_revision IS NULL) OR (action='REPLACE' AND before_revision ~ '^[0-9a-f]{64}$')) AND snapshot->>'schemaVersion'='progression-setting-receipt-v1' AND snapshot->'result'->>'id'=setting_id::text AND snapshot->'result'->>'athleteId'=athlete_id::text AND snapshot->'result'->>'revision'=revision AND isfinite(recorded_at),false))
);
CREATE UNIQUE INDEX progression_setting_mutation_intent_key ON progression_setting_mutations(athlete_id,intent_id);
CREATE FUNCTION guard_progression_setting_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s progression_settings; r JSONB;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Setting receipts are immutable' USING ERRCODE='55000'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Setting receipt requires owner fences' USING ERRCODE='25001'; END IF;
 PERFORM id FROM users WHERE id=NEW.actor_user_id FOR SHARE NOWAIT;
 PERFORM id FROM auth_sessions WHERE id=NEW.actor_session_id FOR SHARE NOWAIT;
 PERFORM id FROM athletes WHERE id=NEW.athlete_id FOR UPDATE NOWAIT;
 SELECT * INTO s FROM progression_settings WHERE id=NEW.setting_id FOR SHARE NOWAIT;
 r:=NEW.snapshot->'result';
 IF s.id IS NULL OR s.athlete_id<>NEW.athlete_id OR NEW.revision<>progression_setting_revision(s) OR NEW.recorded_at>clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id JOIN auth_sessions t ON t.user_id=u.id WHERE a.id=NEW.athlete_id AND u.id=NEW.actor_user_id AND t.id=NEW.actor_session_id AND u.status='ACTIVE' AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() AND t.absolute_expires_at>clock_timestamp())
 OR (r->'exerciseId') IS DISTINCT FROM COALESCE(to_jsonb(s.exercise_id::text),'null'::jsonb) OR (r->'trainingPlanId') IS DISTINCT FROM COALESCE(to_jsonb(s.training_plan_id::text),'null'::jsonb)
 OR r->'minSuccessfulSessions' IS DISTINCT FROM to_jsonb(s.min_successful_sessions)
 OR (r->>'targetRpeMin')::numeric IS DISTINCT FROM s.target_rpe_min OR (r->>'targetRpeMax')::numeric IS DISTINCT FROM s.target_rpe_max
 OR (r->>'incrementPercent')::numeric IS DISTINCT FROM s.increment_percent OR (r->>'incrementAbsolute')::numeric IS DISTINCT FROM s.increment_absolute
 OR (r->>'maxIncrementPercent')::numeric IS DISTINCT FROM s.max_increment_percent OR (r->>'maxLoad')::numeric IS DISTINCT FROM s.max_load
 OR (r->>'autoApplyAuthorized')::boolean IS DISTINCT FROM s.auto_apply_authorized
 OR (r->>'updatedAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',s.updated_at)
 THEN RAISE EXCEPTION 'Setting receipt does not match the committed owned row' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER progression_setting_mutations_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_setting_mutations FOR EACH ROW EXECUTE FUNCTION guard_progression_setting_mutation();
COMMIT;
