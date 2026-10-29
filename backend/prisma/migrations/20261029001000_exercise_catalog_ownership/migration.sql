-- Expand the existing exercise catalog without removing the legacy primary
-- muscle labels before they have been copied to the normalized reference table.

CREATE TYPE "ExerciseOrigin" AS ENUM ('GLOBAL', 'PERSONAL');
CREATE TYPE "ExerciseEquipmentType" AS ENUM ('BARBELL', 'EZ_BAR', 'DUMBBELL', 'MACHINE', 'SMITH_MACHINE', 'CABLE', 'BODYWEIGHT', 'KETTLEBELL', 'RESISTANCE_BAND', 'MEDICINE_BALL', 'RINGS', 'LANDMINE', 'OTHER');
CREATE TYPE "ExerciseMachineType" AS ENUM ('SELECTORIZED', 'PLATE_LOADED', 'CONVERGING', 'SMITH', 'CABLE', 'LEVER', 'HACK_SQUAT', 'LEG_PRESS', 'OTHER');
CREATE TYPE "ExerciseResistanceType" AS ENUM ('FREE_WEIGHT', 'BODYWEIGHT', 'WEIGHT_STACK', 'PLATE_LOADED', 'CABLE', 'ELASTIC', 'MEDICINE_BALL', 'ISOMETRIC', 'OTHER');
CREATE TYPE "ExerciseMovementType" AS ENUM ('COMPOUND', 'ISOLATION', 'OLYMPIC', 'PLYOMETRIC', 'ISOMETRIC', 'CARRY', 'MOBILITY');
CREATE TYPE "ExerciseMovementPattern" AS ENUM ('SQUAT', 'HIP_HINGE', 'LUNGE', 'HORIZONTAL_PUSH', 'VERTICAL_PUSH', 'HORIZONTAL_PULL', 'VERTICAL_PULL', 'ELBOW_FLEXION', 'ELBOW_EXTENSION', 'SHOULDER_ABDUCTION', 'SHOULDER_ROTATION', 'HIP_EXTENSION', 'HIP_ABDUCTION', 'HIP_ADDUCTION', 'KNEE_EXTENSION', 'KNEE_FLEXION', 'CALF_RAISE', 'TRUNK_FLEXION', 'TRUNK_EXTENSION', 'ROTATION', 'ANTI_ROTATION', 'CARRY', 'OLYMPIC_LIFT', 'JUMP', 'OTHER');
CREATE TYPE "ExerciseGrip" AS ENUM ('PRONATED', 'SUPINATED', 'NEUTRAL', 'MIXED', 'HOOK', 'STRAPPED', 'NONE', 'VARIABLE');
CREATE TYPE "ExerciseGripWidth" AS ENUM ('NARROW', 'SHOULDER_WIDTH', 'WIDE', 'VARIABLE', 'NOT_APPLICABLE');
CREATE TYPE "ExerciseBodyPosition" AS ENUM ('STANDING', 'SEATED', 'SUPINE', 'PRONE', 'SIDE_LYING', 'KNEELING', 'HALF_KNEELING', 'HANGING', 'QUADRUPED', 'OTHER');
CREATE TYPE "ExerciseLaterality" AS ENUM ('UNILATERAL', 'BILATERAL', 'ALTERNATING', 'NOT_APPLICABLE');
CREATE TYPE "ExerciseMovementPlane" AS ENUM ('SAGITTAL', 'FRONTAL', 'TRANSVERSE', 'MULTIPLANAR');
CREATE TYPE "ExerciseDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "OneRmSuitability" AS ENUM ('SUITABLE', 'NOT_SUITABLE', 'UNDETERMINED');

CREATE TABLE "muscle_groups" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "muscle_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "muscle_groups_key_key" ON "muscle_groups"("key");
CREATE UNIQUE INDEX "muscle_groups_name_key" ON "muscle_groups"("name");

-- Preserve all existing muscle labels as reference records before replacing
-- the denormalized text column. The legacy-prefixed keys cannot collide with
-- the stable keys used by the catalog seed.
INSERT INTO "muscle_groups" ("id", "key", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), 'legacy_' || md5("muscle_group"), "muscle_group", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "muscle_group" FROM "exercises") AS legacy_groups;

DROP INDEX "exercises_muscle_group_is_active_idx";
DROP INDEX "exercises_name_idx";

ALTER TABLE "exercises"
  ADD COLUMN "body_position" "ExerciseBodyPosition",
  ADD COLUMN "catalog_key" VARCHAR(140),
  ADD COLUMN "difficulty" "ExerciseDifficulty",
  ADD COLUMN "equipment_type" "ExerciseEquipmentType" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "grip" "ExerciseGrip",
  ADD COLUMN "grip_width" "ExerciseGripWidth",
  ADD COLUMN "instructions" TEXT,
  ADD COLUMN "laterality" "ExerciseLaterality",
  ADD COLUMN "machine_type" "ExerciseMachineType",
  ADD COLUMN "movement_pattern" "ExerciseMovementPattern",
  ADD COLUMN "movement_plane" "ExerciseMovementPlane",
  ADD COLUMN "movement_type" "ExerciseMovementType",
  ADD COLUMN "one_rm_suitability" "OneRmSuitability" NOT NULL DEFAULT 'UNDETERMINED',
  ADD COLUMN "origin" "ExerciseOrigin" NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN "owner_id" UUID,
  ADD COLUMN "primary_muscle_group_id" UUID,
  ADD COLUMN "resistance_type" "ExerciseResistanceType";

UPDATE "exercises" AS exercise
SET "primary_muscle_group_id" = muscle_group."id"
FROM "muscle_groups" AS muscle_group
WHERE muscle_group."name" = exercise."muscle_group";

ALTER TABLE "exercises"
  ALTER COLUMN "primary_muscle_group_id" SET NOT NULL,
  DROP COLUMN "muscle_group";

CREATE TABLE "exercise_secondary_muscle_groups" (
    "exercise_id" UUID NOT NULL,
    "muscle_group_id" UUID NOT NULL,
    CONSTRAINT "exercise_secondary_muscle_groups_pkey" PRIMARY KEY ("exercise_id", "muscle_group_id")
);

CREATE UNIQUE INDEX "exercises_catalog_key_key" ON "exercises"("catalog_key");
CREATE INDEX "exercises_origin_is_active_name_id_idx" ON "exercises"("origin", "is_active", "name", "id");
CREATE INDEX "exercises_owner_id_is_active_name_id_idx" ON "exercises"("owner_id", "is_active", "name", "id");
CREATE INDEX "exercises_primary_muscle_group_id_is_active_idx" ON "exercises"("primary_muscle_group_id", "is_active");
CREATE INDEX "exercises_equipment_type_is_active_idx" ON "exercises"("equipment_type", "is_active");
CREATE INDEX "exercises_machine_type_is_active_idx" ON "exercises"("machine_type", "is_active");
CREATE INDEX "exercises_resistance_type_is_active_idx" ON "exercises"("resistance_type", "is_active");
CREATE INDEX "exercises_movement_type_is_active_idx" ON "exercises"("movement_type", "is_active");
CREATE INDEX "exercises_movement_pattern_is_active_idx" ON "exercises"("movement_pattern", "is_active");
CREATE INDEX "exercises_difficulty_is_active_idx" ON "exercises"("difficulty", "is_active");
CREATE INDEX "exercise_secondary_muscle_groups_muscle_group_id_exercise_i_idx" ON "exercise_secondary_muscle_groups"("muscle_group_id", "exercise_id");

ALTER TABLE "exercises"
  ADD CONSTRAINT "exercises_origin_owner_consistency_check"
    CHECK (("origin" = 'GLOBAL' AND "owner_id" IS NULL)
      OR ("origin" = 'PERSONAL' AND "owner_id" IS NOT NULL AND "catalog_key" IS NULL)),
  ADD CONSTRAINT "exercises_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "exercises_primary_muscle_group_id_fkey"
    FOREIGN KEY ("primary_muscle_group_id") REFERENCES "muscle_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exercise_secondary_muscle_groups"
  ADD CONSTRAINT "exercise_secondary_muscle_groups_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "exercise_secondary_muscle_groups_muscle_group_id_fkey"
    FOREIGN KEY ("muscle_group_id") REFERENCES "muscle_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
