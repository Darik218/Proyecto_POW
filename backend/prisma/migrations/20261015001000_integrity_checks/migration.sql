-- PostgreSQL checks not expressible in the Prisma schema.
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_valid_lifetime_check"
  CHECK ("expires_at" > "created_at" AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at"));

ALTER TABLE "body_measurements"
  ADD CONSTRAINT "body_measurements_weight_positive_check" CHECK ("body_weight" > 0);

ALTER TABLE "training_plans"
  ADD CONSTRAINT "training_plans_dates_valid_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");

ALTER TABLE "plan_weeks"
  ADD CONSTRAINT "plan_weeks_number_positive_check" CHECK ("week_number" > 0);

ALTER TABLE "plan_exercises"
  ADD CONSTRAINT "plan_exercises_targets_valid_check"
  CHECK ("position" > 0 AND "target_sets" > 0 AND "target_reps" > 0
    AND ("target_rpe" IS NULL OR ("target_rpe" >= 0 AND "target_rpe" <= 10))
    AND ("target_load" IS NULL OR "target_load" >= 0));

ALTER TABLE "workout_sessions"
  ADD CONSTRAINT "workout_sessions_dates_valid_check"
  CHECK ("finished_at" IS NULL OR ("started_at" IS NOT NULL AND "finished_at" >= "started_at")),
  ADD CONSTRAINT "workout_sessions_plan_week_pair_check"
  CHECK (("training_plan_id" IS NULL) = ("plan_week_id" IS NULL));

ALTER TABLE "workout_exercises"
  ADD CONSTRAINT "workout_exercises_order_positive_check" CHECK ("order_in_session" > 0);

ALTER TABLE "set_records"
  ADD CONSTRAINT "set_records_values_valid_check"
  CHECK ("set_number" > 0 AND "load" >= 0 AND "repetitions" > 0
    AND ("rpe" IS NULL OR ("rpe" >= 0 AND "rpe" <= 10)));

ALTER TABLE "one_rm_estimates"
  ADD CONSTRAINT "one_rm_estimates_values_positive_check"
  CHECK ("input_load" > 0 AND "input_reps" > 0 AND "estimated_one_rm" > 0);

ALTER TABLE "session_feedback"
  ADD CONSTRAINT "session_feedback_rpe_range_check"
  CHECK ("global_rpe" IS NULL OR ("global_rpe" >= 0 AND "global_rpe" <= 10));

ALTER TABLE "progression_settings"
  ADD CONSTRAINT "progression_settings_scope_check"
  CHECK ("training_plan_id" IS NULL OR "exercise_id" IS NOT NULL),
  ADD CONSTRAINT "progression_settings_values_valid_check"
  CHECK ("min_successful_sessions" > 0
    AND "target_rpe_min" >= 0 AND "target_rpe_max" <= 10 AND "target_rpe_min" <= "target_rpe_max"
    AND "max_increment_percent" >= 0
    AND ("increment_percent" IS NULL OR ("increment_percent" >= 0 AND "increment_percent" <= "max_increment_percent"))
    AND ("increment_absolute" IS NULL OR "increment_absolute" >= 0)
    AND ("max_load" IS NULL OR "max_load" > 0));

CREATE UNIQUE INDEX "progression_settings_athlete_general_scope_key"
  ON "progression_settings" ("athlete_id")
  WHERE "exercise_id" IS NULL AND "training_plan_id" IS NULL;

CREATE UNIQUE INDEX "progression_settings_athlete_exercise_scope_key"
  ON "progression_settings" ("athlete_id", "exercise_id")
  WHERE "exercise_id" IS NOT NULL AND "training_plan_id" IS NULL;

CREATE UNIQUE INDEX "progression_settings_athlete_exercise_plan_scope_key"
  ON "progression_settings" ("athlete_id", "exercise_id", "training_plan_id")
  WHERE "exercise_id" IS NOT NULL AND "training_plan_id" IS NOT NULL;

ALTER TABLE "progression_recommendations"
  ADD CONSTRAINT "progression_recommendations_loads_valid_check"
  CHECK ("recommended_load" > 0 AND ("previous_load" IS NULL OR "previous_load" >= 0)),
  ADD CONSTRAINT "progression_recommendations_expiration_valid_check"
  CHECK ("expires_at" IS NULL OR "expires_at" > "created_at"),
  ADD CONSTRAINT "progression_recommendations_plan_exercise_pair_check"
  CHECK ("plan_exercise_id" IS NULL OR "plan_week_id" IS NOT NULL);

ALTER TABLE "progression_applications"
  ADD CONSTRAINT "progression_applications_load_positive_check" CHECK ("applied_load" > 0);
