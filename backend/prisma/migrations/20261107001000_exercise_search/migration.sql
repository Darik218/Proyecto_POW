BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- STABLE normalization is applied on writes, never misdeclared IMMUTABLE in an expression index.
CREATE FUNCTION pulso_search_normalize(value TEXT) RETURNS TEXT LANGUAGE sql STABLE STRICT PARALLEL SAFE
AS $$ SELECT btrim(regexp_replace(lower(public.unaccent('public.unaccent',value)), '[^a-z0-9]+',' ','g')) $$;
ALTER TABLE exercises ADD COLUMN search_name TEXT NOT NULL DEFAULT '', ADD COLUMN search_description TEXT NOT NULL DEFAULT '', ADD COLUMN featured_rank INTEGER;
CREATE FUNCTION pulso_exercise_search_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.search_name := pulso_search_normalize(NEW.name); NEW.search_description := pulso_search_normalize(COALESCE(NEW.description,'')); RETURN NEW; END $$;
CREATE TRIGGER exercises_search_write BEFORE INSERT OR UPDATE OF name,description ON exercises FOR EACH ROW EXECUTE FUNCTION pulso_exercise_search_write();
UPDATE exercises SET search_name=pulso_search_normalize(name),search_description=pulso_search_normalize(COALESCE(description,''));
CREATE INDEX exercises_search_name_gin ON exercises USING GIN(search_name gin_trgm_ops);
CREATE INDEX exercises_search_description_gin ON exercises USING GIN(search_description gin_trgm_ops);
CREATE INDEX exercises_featured_rank_idx ON exercises(featured_rank);
CREATE TABLE exercise_aliases (
 id UUID PRIMARY KEY, exercise_id UUID NOT NULL, name VARCHAR(160) NOT NULL, normalized_name TEXT NOT NULL DEFAULT '',
 CONSTRAINT exercise_aliases_exercise_id_fkey FOREIGN KEY(exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT exercise_aliases_name_check CHECK(length(btrim(name)) BETWEEN 2 AND 160 AND length(normalized_name)>0)
);
CREATE FUNCTION pulso_exercise_alias_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.name := btrim(NEW.name); NEW.normalized_name := pulso_search_normalize(NEW.name); RETURN NEW; END $$;
CREATE TRIGGER exercise_aliases_search_write BEFORE INSERT OR UPDATE OF name,normalized_name ON exercise_aliases FOR EACH ROW EXECUTE FUNCTION pulso_exercise_alias_write();
CREATE UNIQUE INDEX exercise_aliases_exercise_id_normalized_name_key ON exercise_aliases(exercise_id,normalized_name);
CREATE INDEX exercise_aliases_normalized_name_gin ON exercise_aliases USING GIN(normalized_name gin_trgm_ops);
COMMIT;
