BEGIN;
-- R1: additive transition. NULL plan_day_id means a legacy prescription pending distribution.
CREATE TABLE "plan_days" (
  "id" UUID NOT NULL,
  "plan_week_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "position" INTEGER NOT NULL,
  "weekday" INTEGER,
  CONSTRAINT "plan_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_days_values_check" CHECK (length(btrim("name")) > 0 AND "position" > 0 AND ("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7)),
  CONSTRAINT "plan_days_plan_week_id_fkey" FOREIGN KEY ("plan_week_id") REFERENCES "plan_weeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "plan_days_plan_week_id_position_key" ON "plan_days"("plan_week_id", "position");
CREATE UNIQUE INDEX "plan_days_id_plan_week_id_key" ON "plan_days"("id", "plan_week_id");
ALTER TABLE "plan_exercises"
  ADD COLUMN "plan_day_id" UUID,
  ADD COLUMN "target_reps_min" INTEGER,
  ADD COLUMN "target_reps_max" INTEGER,
  ADD COLUMN "target_load_unit" "MeasurementUnit",
  ALTER COLUMN "target_reps" DROP NOT NULL;
-- Retain the scalar, all identities and every historical FK. Never infer a load unit.
UPDATE "plan_exercises" SET "target_reps_min" = "target_reps", "target_reps_max" = "target_reps";
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_plan_day_id_plan_week_id_fkey"
  FOREIGN KEY ("plan_day_id", "plan_week_id") REFERENCES "plan_days"("id", "plan_week_id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX "plan_exercises_plan_week_id_position_key";
CREATE UNIQUE INDEX "plan_exercises_pending_position_key" ON "plan_exercises"("plan_week_id", "position") WHERE "plan_day_id" IS NULL;
CREATE UNIQUE INDEX "plan_exercises_plan_day_id_position_key" ON "plan_exercises"("plan_day_id", "position");
CREATE INDEX "plan_exercises_plan_week_id_idx" ON "plan_exercises"("plan_week_id");
ALTER TABLE "plan_exercises" DROP CONSTRAINT "plan_exercises_targets_valid_check";
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_targets_valid_check" CHECK (
  "position" > 0 AND "target_sets" > 0
  AND (
    ("target_reps_min" IS NULL AND "target_reps_max" IS NULL AND "target_reps" IS NOT NULL AND "target_reps" > 0)
    OR ("target_reps_min" IS NOT NULL AND "target_reps_max" IS NOT NULL AND "target_reps_min" > 0 AND "target_reps_max" >= "target_reps_min"
      AND (("target_reps_min" = "target_reps_max" AND "target_reps" = "target_reps_min" AND "target_reps" IS NOT NULL)
        OR ("target_reps_min" < "target_reps_max" AND "target_reps" IS NULL)))
  )
  AND ("target_rpe" IS NULL OR "target_rpe" BETWEEN 0 AND 10)
  AND ("target_load" IS NULL OR "target_load" >= 0)
  AND ("target_load_unit" IS NULL OR "target_load" IS NOT NULL)
);
COMMIT;
