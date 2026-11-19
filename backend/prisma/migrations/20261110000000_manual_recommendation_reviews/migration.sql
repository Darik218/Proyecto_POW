BEGIN;
-- NULL is deliberate: no preexisting decision acquires a fabricated reviewer.
ALTER TABLE progression_recommendations ADD COLUMN review_version INTEGER;
ALTER TABLE progression_recommendations ADD CONSTRAINT progression_recommendations_review_version_check CHECK(review_version IS NULL OR review_version>0);
CREATE TABLE recommendation_reviews (
 id UUID PRIMARY KEY,
 recommendation_id UUID NOT NULL REFERENCES progression_recommendations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 intent_id UUID NOT NULL,
 payload_key CHAR(64) NOT NULL,
 schema_version VARCHAR(40) NOT NULL,
 action VARCHAR(8) NOT NULL,
 from_status "RecommendationStatus" NOT NULL,
 to_status "RecommendationStatus" NOT NULL,
 from_version INTEGER,
 version INTEGER NOT NULL,
 semantic_key CHAR(64), cycle_key CHAR(64), dependency_keys JSONB, acceptance JSONB,
 justification VARCHAR(2000), decided_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CONSTRAINT recommendation_reviews_shape_check CHECK (COALESCE((
  schema_version='manual-recommendation-review-v1' AND payload_key ~ '^[0-9a-f]{64}$'
  AND from_status='PENDING' AND from_version IS NULL AND version=1
  AND ((action='APPROVE' AND to_status='APPROVED') OR (action='REJECT' AND to_status='REJECTED'))
  AND (action<>'REJECT' OR length(btrim(justification))>0)
  AND ((semantic_key IS NULL AND cycle_key IS NULL AND dependency_keys IS NULL) OR
      (semantic_key ~ '^[0-9a-f]{64}$' AND cycle_key ~ '^[0-9a-f]{64}$' AND jsonb_typeof(dependency_keys)='object'))
  AND ((action='REJECT' AND acceptance IS NULL) OR (action='APPROVE' AND COALESCE(
      jsonb_typeof(acceptance)='object'
      AND acceptance->>'schemaVersion'='manual-proposal-acceptance-v1'
      AND acceptance->>'scope'='THIS_PROPOSAL_ONLY'
      AND acceptance->>'authorizationKey' ~ '^[0-9a-f]{64}$'
      AND acceptance->>'policyKey' ~ '^[0-9a-f]{64}$'
      AND acceptance->'acceptPolicy'='true'::jsonb AND acceptance->'acceptEvidence'='true'::jsonb
      AND acceptance-ARRAY['schemaVersion','scope','authorizationKey','policyKey','acceptPolicy','acceptEvidence']='{}'::jsonb,false)))
 ),false))
);
CREATE UNIQUE INDEX recommendation_reviews_athlete_id_intent_id_key ON recommendation_reviews(athlete_id,intent_id);
CREATE UNIQUE INDEX recommendation_reviews_recommendation_id_version_key ON recommendation_reviews(recommendation_id,version);
CREATE INDEX recommendation_reviews_recommendation_id_decided_at_idx ON recommendation_reviews(recommendation_id,decided_at);
CREATE OR REPLACE FUNCTION protect_weekly_recommendation_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.semantic_key IS NOT NULL AND (NEW.status<>'PENDING' OR NEW.cycle_slot IS DISTINCT FROM NEW.cycle_key OR NEW.reviewed_at IS NOT NULL OR NEW.expires_at IS NOT NULL OR NEW.review_version IS NOT NULL) THEN
     RAISE EXCEPTION 'New neutral proposals must be pending and reserved' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
 END IF;
 IF OLD.semantic_key IS NOT NULL OR OLD.review_version IS NOT NULL THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recommendation generation is immutable' USING ERRCODE='55000'; END IF;
   -- Operational fields are deliberately separate. Future authorized services
   -- must validate their transitions; this migration does not approve them.
   IF (to_jsonb(OLD)-ARRAY['status','reviewed_at','expires_at','cycle_slot','review_version']) IS DISTINCT FROM
      (to_jsonb(NEW)-ARRAY['status','reviewed_at','expires_at','cycle_slot','review_version']) THEN
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

CREATE FUNCTION guard_recommendation_review_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p progression_recommendations;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Review events are append-only' USING ERRCODE='55000'; END IF;
 SELECT * INTO p FROM progression_recommendations WHERE id=NEW.recommendation_id FOR UPDATE;
 IF p.id IS NULL OR p.athlete_id<>NEW.athlete_id OR p.status<>'PENDING' OR p.review_version IS NOT NULL OR p.reviewed_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM athletes a JOIN users u ON u.id=a.user_id WHERE a.id=NEW.athlete_id AND u.id=NEW.actor_user_id AND u.status='ACTIVE')
  OR NEW.semantic_key IS DISTINCT FROM p.semantic_key OR NEW.cycle_key IS DISTINCT FROM p.cycle_key OR NEW.dependency_keys IS DISTINCT FROM p.dependency_keys
 THEN RAISE EXCEPTION 'Review source, actor or revision mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.action='APPROVE' AND (p.semantic_key IS NULL OR p.cycle_slot IS DISTINCT FROM p.cycle_key OR (p.expires_at IS NOT NULL AND p.expires_at<=clock_timestamp())) THEN
  RAISE EXCEPTION 'Approval requires modern reserved evidence' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER recommendation_reviews_event_guard BEFORE INSERT OR UPDATE OR DELETE ON recommendation_reviews FOR EACH ROW EXECUTE FUNCTION guard_recommendation_review_event();

CREATE FUNCTION check_recommendation_review_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p progression_recommendations; e recommendation_reviews;
BEGIN
 IF TG_TABLE_NAME='recommendation_reviews' THEN
  SELECT * INTO p FROM progression_recommendations WHERE id=NEW.recommendation_id;
 ELSE
  SELECT * INTO p FROM progression_recommendations WHERE id=NEW.id;
 END IF;
 IF p.review_version IS NULL THEN
  IF EXISTS(SELECT 1 FROM recommendation_reviews WHERE recommendation_id=p.id) THEN
   RAISE EXCEPTION 'Review audit without matching transition' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO e FROM recommendation_reviews WHERE recommendation_id=p.id AND version=p.review_version;
 IF e.id IS NULL OR p.review_version<>1 OR p.reviewed_at IS DISTINCT FROM e.decided_at OR p.athlete_id<>e.athlete_id
  OR p.semantic_key IS DISTINCT FROM e.semantic_key OR p.cycle_key IS DISTINCT FROM e.cycle_key OR p.dependency_keys IS DISTINCT FROM e.dependency_keys
  OR p.status<>e.to_status
 THEN RAISE EXCEPTION 'Review transition and audit must commit together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER recommendation_reviews_pair AFTER INSERT ON recommendation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_recommendation_review_pair();
CREATE CONSTRAINT TRIGGER progression_recommendations_review_pair AFTER INSERT OR UPDATE ON progression_recommendations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_recommendation_review_pair();

CREATE FUNCTION guard_recommendation_review_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.review_version IS DISTINCT FROM OLD.review_version AND NOT (OLD.review_version IS NULL AND NEW.review_version=1) THEN
  RAISE EXCEPTION 'Review revision cannot be reset or overwritten' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER progression_recommendations_review_version_guard BEFORE UPDATE ON progression_recommendations FOR EACH ROW EXECUTE FUNCTION guard_recommendation_review_version();
COMMIT;
