BEGIN;
-- Numeric widening preserves every old value. No legacy metadata is inferred.
ALTER TABLE one_rm_estimates
  ALTER COLUMN estimated_one_rm TYPE DECIMAL(24,6),
  ADD COLUMN input_load_unit "MeasurementUnit",
  ADD COLUMN input_load_kg DECIMAL(24,6),
  ADD COLUMN result_unit "MeasurementUnit",
  ADD COLUMN source_set_version INTEGER,
  ADD COLUMN eligibility_version VARCHAR(40),
  ADD COLUMN estimate_kind VARCHAR(24),
  ADD COLUMN calculation_key CHAR(64),
  ADD COLUMN snapshot JSONB;

CREATE UNIQUE INDEX one_rm_estimates_calculation_key_key ON one_rm_estimates(calculation_key);

ALTER TABLE one_rm_estimates ADD CONSTRAINT one_rm_estimates_descriptive_evidence_check CHECK (
  (calculation_key IS NULL AND input_load_unit IS NULL AND input_load_kg IS NULL
    AND result_unit IS NULL AND source_set_version IS NULL AND eligibility_version IS NULL
    AND estimate_kind IS NULL AND snapshot IS NULL)
  OR COALESCE((
    calculation_key ~ '^[0-9a-f]{64}$' AND source_set_id IS NOT NULL
    AND input_load_unit IS NOT NULL AND input_load_kg > 0 AND input_load_kg < 'Infinity'::numeric
    AND input_load > 0 AND input_load < 'Infinity'::numeric
    AND estimated_one_rm > 0 AND estimated_one_rm < 'Infinity'::numeric
    AND result_unit = 'KG' AND source_set_version >= 0
    AND length(eligibility_version) > 0 AND estimate_kind = 'DESCRIPTIVE'
    AND input_reps BETWEEN 1 AND 10 AND jsonb_typeof(snapshot) = 'object'
    AND snapshot->>'schemaVersion' = 'one-rm-evidence-v1'
    AND snapshot->>'estimateKind' = 'DESCRIPTIVE'
    AND snapshot->>'evidenceStatus' = 'NOT_ASSESSED'
    AND snapshot->>'formula' = formula::text
    AND snapshot->>'calculationVersion' = algorithm_version
    AND snapshot->>'eligibilityVersion' = eligibility_version
    AND snapshot->'source'->>'athleteId' = athlete_id::text
    AND snapshot->'source'->>'exerciseId' = exercise_id::text
    AND snapshot->'source'->>'setId' = source_set_id::text
    AND snapshot->'source'->>'setVersion' = source_set_version::text
    AND snapshot->'eligibility'->>'status' = 'ELIGIBLE_WITH_WARNINGS'
    AND snapshot->'source'->>'sessionStatus' = 'COMPLETED'
    AND snapshot->'source'->>'status' = 'COMPLETED'
    AND snapshot->'source'->>'kind' = 'WORK'
    AND snapshot->'source'->>'isCompleted' = 'true'
    AND snapshot->'source'->>'isOmitted' = 'false'
    AND snapshot->'exercise'->>'oneRmSuitability' = 'SUITABLE'
    AND snapshot->'interpretation'->>'meaning' = 'EXTERNAL_TOTAL'
    AND snapshot->'interpretation'->>'source' = 'OWNER_DECLARATION_AFTER_RECORDING'
    AND snapshot->'eligibility'->'warnings' @> '["EFFORT_UNVERIFIED"]'::jsonb
    AND snapshot->'input'->>'loadUnit' = input_load_unit::text
    AND (snapshot->'input'->>'load')::numeric = input_load
    AND (snapshot->'input'->>'loadKg')::numeric = input_load_kg
    AND (snapshot->'input'->>'repetitions')::integer = input_reps
    AND snapshot->'result'->>'unit' = result_unit::text
    AND (snapshot->'result'->>'estimatedOneRm')::numeric = estimated_one_rm
    AND input_load_kg = round(CASE WHEN input_load_unit='KG' THEN input_load ELSE input_load * 0.45359237 END, 6)
  ), false)
);

-- Protect new evidence from accidental overwrites/deletions. Legacy rows retain
-- their previous behavior; the application never updates either kind on retry.
CREATE FUNCTION protect_descriptive_one_rm_estimate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.calculation_key IS NOT NULL THEN
    RAISE EXCEPTION 'Descriptive one-RM evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER one_rm_estimates_immutable BEFORE UPDATE OR DELETE ON one_rm_estimates
  FOR EACH ROW EXECUTE FUNCTION protect_descriptive_one_rm_estimate();
COMMIT;
