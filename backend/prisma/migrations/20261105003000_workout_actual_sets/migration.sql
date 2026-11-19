BEGIN;
CREATE TYPE "WorkoutSetStatus" AS ENUM ('PENDING','COMPLETED','INCOMPLETE','FAILED','SKIPPED');
CREATE TYPE "WorkoutSetKind" AS ENUM ('WARMUP','WORK');
ALTER TABLE set_records
 ALTER COLUMN load DROP NOT NULL,
 ALTER COLUMN repetitions DROP NOT NULL,
 ADD COLUMN load_unit "MeasurementUnit",
 ADD COLUMN load_kg DECIMAL(12,6),
 ADD COLUMN status "WorkoutSetStatus",
 ADD COLUMN kind "WorkoutSetKind",
 ADD COLUMN creation_request_hash CHAR(64),
 ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE set_records DROP CONSTRAINT set_records_values_valid_check;
ALTER TABLE set_records ADD CONSTRAINT set_records_values_valid_check CHECK (
 set_number > 0 AND version >= 0 AND (rpe IS NULL OR rpe BETWEEN 0 AND 10)
 AND (
   (status IS NULL AND load IS NOT NULL AND load >= 0 AND repetitions IS NOT NULL AND repetitions > 0 AND load_unit IS NULL AND load_kg IS NULL)
   OR (status IS NOT NULL AND kind IS NOT NULL AND (
    (status IN ('PENDING','SKIPPED') AND load IS NULL AND load_unit IS NULL AND load_kg IS NULL AND repetitions IS NULL AND rpe IS NULL AND NOT is_completed)
    OR (status IN ('COMPLETED','INCOMPLETE','FAILED') AND load IS NOT NULL AND load >= 0 AND load_unit IS NOT NULL AND load_kg IS NOT NULL AND repetitions IS NOT NULL
      AND ((status='COMPLETED' AND repetitions > 0 AND is_completed) OR (status='INCOMPLETE' AND repetitions >= 0 AND NOT is_completed) OR (status='FAILED' AND repetitions=0 AND NOT is_completed))
      AND load_kg = round(CASE WHEN load_unit='KG' THEN load ELSE load * 0.45359237 END, 6)
    )
   ))
 )
);
-- Historical is_completed=false remains unclassified. No unit or result status is guessed.
COMMIT;
