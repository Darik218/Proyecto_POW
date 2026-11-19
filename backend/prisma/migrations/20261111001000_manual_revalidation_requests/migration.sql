BEGIN;
CREATE TABLE progression_revalidation_requests (
 recommendation_id UUID PRIMARY KEY REFERENCES progression_recommendations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 request_key CHAR(64) NOT NULL,command_key CHAR(64) NOT NULL,schema_version VARCHAR(40) NOT NULL,
 command JSONB NOT NULL,provenance VARCHAR(40) NOT NULL,recorded_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT manual_revalidation_request_shape CHECK(COALESCE(
 request_key ~ '^[0-9a-f]{64}$' AND command_key ~ '^[0-9a-f]{64}$' AND schema_version='manual-revalidation-request-v1'
 AND jsonb_typeof(command)='object' AND jsonb_typeof(command->'history')='object' AND jsonb_typeof(command->'period')='object' AND jsonb_typeof(command->'destination')='object'
 AND provenance IN ('HTTP_SAVE_REQUEST','MATCHING_REPLAY_REQUEST') AND isfinite(recorded_at),false))
);
CREATE FUNCTION guard_manual_revalidation_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Revalidation request records are immutable' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM progression_recommendations p WHERE p.id=NEW.recommendation_id AND p.semantic_key IS NOT NULL AND p.request_key=NEW.request_key AND p.exercise_id::text=NEW.command->'history'->>'exerciseId') OR NEW.recorded_at>clock_timestamp() THEN
 RAISE EXCEPTION 'Request does not match the saved neutral proposal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER manual_revalidation_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON progression_revalidation_requests FOR EACH ROW EXECUTE FUNCTION guard_manual_revalidation_request();
COMMIT;
