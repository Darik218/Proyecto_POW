-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('KG', 'LB');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OneRmFormula" AS ENUM ('EPLEY', 'BRZYCKI');

-- CreateEnum
CREATE TYPE "EvidenceRole" AS ENUM ('SATISFACTORY', 'UNSATISFACTORY', 'CONTEXT');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'BLOCKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicationOrigin" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "athletes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "birth_date" DATE,
    "preferred_unit" "MeasurementUnit" NOT NULL DEFAULT 'KG',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "athletes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_family_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_measurements" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "body_weight" DECIMAL(7,3) NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "muscle_group" VARCHAR(100) NOT NULL,
    "equipment" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plans" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "training_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_weeks" (
    "id" UUID NOT NULL,
    "training_plan_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "objective" TEXT,

    CONSTRAINT "plan_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_exercises" (
    "id" UUID NOT NULL,
    "plan_week_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "target_sets" INTEGER NOT NULL,
    "target_reps" INTEGER NOT NULL,
    "target_rpe" DECIMAL(3,1),
    "target_load" DECIMAL(8,3),
    "notes" TEXT,

    CONSTRAINT "plan_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "training_plan_id" UUID,
    "plan_week_id" UUID,
    "status" "WorkoutStatus" NOT NULL DEFAULT 'PLANNED',
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "plan_exercise_id" UUID,
    "order_in_session" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_records" (
    "id" UUID NOT NULL,
    "workout_exercise_id" UUID NOT NULL,
    "set_number" INTEGER NOT NULL,
    "load" DECIMAL(8,3) NOT NULL,
    "repetitions" INTEGER NOT NULL,
    "rpe" DECIMAL(3,1),
    "is_completed" BOOLEAN NOT NULL DEFAULT true,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "set_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_rm_estimates" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "source_set_id" UUID,
    "input_load" DECIMAL(8,3) NOT NULL,
    "input_reps" INTEGER NOT NULL,
    "estimated_one_rm" DECIMAL(8,3) NOT NULL,
    "formula" "OneRmFormula" NOT NULL,
    "algorithm_version" VARCHAR(40) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_rm_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_feedback" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "global_rpe" DECIMAL(3,1),
    "fatigue_score" DECIMAL(5,2),
    "notes" TEXT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progression_settings" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "exercise_id" UUID,
    "training_plan_id" UUID,
    "min_successful_sessions" INTEGER NOT NULL DEFAULT 3,
    "target_rpe_min" DECIMAL(3,1) NOT NULL,
    "target_rpe_max" DECIMAL(3,1) NOT NULL,
    "increment_percent" DECIMAL(6,3),
    "increment_absolute" DECIMAL(8,3),
    "max_increment_percent" DECIMAL(6,3) NOT NULL,
    "max_load" DECIMAL(8,3),
    "auto_apply_authorized" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "progression_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progression_recommendations" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "plan_week_id" UUID,
    "plan_exercise_id" UUID,
    "previous_load" DECIMAL(8,3),
    "recommended_load" DECIMAL(8,3) NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "algorithm_version" VARCHAR(40) NOT NULL,
    "effective_settings" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "progression_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_evidence" (
    "id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "EvidenceRole" NOT NULL,
    "associated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progression_applications" (
    "id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "applied_load" DECIMAL(8,3) NOT NULL,
    "origin" "ApplicationOrigin" NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "progression_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "athletes_user_id_key" ON "athletes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_token_family_id_revoked_at_idx" ON "auth_sessions"("token_family_id", "revoked_at");

-- CreateIndex
CREATE INDEX "body_measurements_athlete_id_measured_at_idx" ON "body_measurements"("athlete_id", "measured_at");

-- CreateIndex
CREATE INDEX "exercises_name_idx" ON "exercises"("name");

-- CreateIndex
CREATE INDEX "exercises_muscle_group_is_active_idx" ON "exercises"("muscle_group", "is_active");

-- CreateIndex
CREATE INDEX "training_plans_athlete_id_status_starts_on_idx" ON "training_plans"("athlete_id", "status", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "training_plans_id_athlete_id_key" ON "training_plans"("id", "athlete_id");

-- CreateIndex
CREATE INDEX "plan_weeks_training_plan_id_idx" ON "plan_weeks"("training_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_weeks_training_plan_id_week_number_key" ON "plan_weeks"("training_plan_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "plan_weeks_id_training_plan_id_key" ON "plan_weeks"("id", "training_plan_id");

-- CreateIndex
CREATE INDEX "plan_exercises_exercise_id_idx" ON "plan_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_exercises_plan_week_id_position_key" ON "plan_exercises"("plan_week_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "plan_exercises_id_exercise_id_key" ON "plan_exercises"("id", "exercise_id");

-- CreateIndex
CREATE INDEX "workout_sessions_athlete_id_started_at_status_idx" ON "workout_sessions"("athlete_id", "started_at", "status");

-- CreateIndex
CREATE INDEX "workout_sessions_training_plan_id_plan_week_id_idx" ON "workout_sessions"("training_plan_id", "plan_week_id");

-- CreateIndex
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_exercises_session_id_order_in_session_key" ON "workout_exercises"("session_id", "order_in_session");

-- CreateIndex
CREATE INDEX "set_records_recorded_at_idx" ON "set_records"("recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "set_records_workout_exercise_id_set_number_key" ON "set_records"("workout_exercise_id", "set_number");

-- CreateIndex
CREATE INDEX "one_rm_estimates_athlete_id_exercise_id_calculated_at_idx" ON "one_rm_estimates"("athlete_id", "exercise_id", "calculated_at");

-- CreateIndex
CREATE INDEX "one_rm_estimates_source_set_id_idx" ON "one_rm_estimates"("source_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_feedback_session_id_key" ON "session_feedback"("session_id");

-- CreateIndex
CREATE INDEX "session_feedback_recorded_at_idx" ON "session_feedback"("recorded_at");

-- CreateIndex
CREATE INDEX "progression_settings_athlete_id_exercise_id_training_plan_i_idx" ON "progression_settings"("athlete_id", "exercise_id", "training_plan_id");

-- CreateIndex
CREATE INDEX "progression_recommendations_athlete_id_status_created_at_idx" ON "progression_recommendations"("athlete_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "progression_recommendations_exercise_id_created_at_idx" ON "progression_recommendations"("exercise_id", "created_at");

-- CreateIndex
CREATE INDEX "progression_recommendations_plan_week_id_idx" ON "progression_recommendations"("plan_week_id");

-- CreateIndex
CREATE INDEX "recommendation_evidence_session_id_idx" ON "recommendation_evidence"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_evidence_recommendation_id_session_id_key" ON "recommendation_evidence"("recommendation_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "progression_applications_recommendation_id_key" ON "progression_applications"("recommendation_id");

-- CreateIndex
CREATE INDEX "progression_applications_effective_at_idx" ON "progression_applications"("effective_at");

-- AddForeignKey
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_training_plan_id_fkey" FOREIGN KEY ("training_plan_id") REFERENCES "training_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_plan_week_id_fkey" FOREIGN KEY ("plan_week_id") REFERENCES "plan_weeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_training_plan_id_athlete_id_fkey" FOREIGN KEY ("training_plan_id", "athlete_id") REFERENCES "training_plans"("id", "athlete_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_week_id_training_plan_id_fkey" FOREIGN KEY ("plan_week_id", "training_plan_id") REFERENCES "plan_weeks"("id", "training_plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_plan_exercise_id_exercise_id_fkey" FOREIGN KEY ("plan_exercise_id", "exercise_id") REFERENCES "plan_exercises"("id", "exercise_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_records" ADD CONSTRAINT "set_records_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_rm_estimates" ADD CONSTRAINT "one_rm_estimates_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_rm_estimates" ADD CONSTRAINT "one_rm_estimates_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_rm_estimates" ADD CONSTRAINT "one_rm_estimates_source_set_id_fkey" FOREIGN KEY ("source_set_id") REFERENCES "set_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback" ADD CONSTRAINT "session_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_settings" ADD CONSTRAINT "progression_settings_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_settings" ADD CONSTRAINT "progression_settings_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_settings" ADD CONSTRAINT "progression_settings_training_plan_id_athlete_id_fkey" FOREIGN KEY ("training_plan_id", "athlete_id") REFERENCES "training_plans"("id", "athlete_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_recommendations" ADD CONSTRAINT "progression_recommendations_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_recommendations" ADD CONSTRAINT "progression_recommendations_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_recommendations" ADD CONSTRAINT "progression_recommendations_plan_week_id_fkey" FOREIGN KEY ("plan_week_id") REFERENCES "plan_weeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_recommendations" ADD CONSTRAINT "progression_recommendations_plan_exercise_id_exercise_id_fkey" FOREIGN KEY ("plan_exercise_id", "exercise_id") REFERENCES "plan_exercises"("id", "exercise_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_evidence" ADD CONSTRAINT "recommendation_evidence_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "progression_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_evidence" ADD CONSTRAINT "recommendation_evidence_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_applications" ADD CONSTRAINT "progression_applications_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "progression_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

