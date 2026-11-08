BEGIN;
ALTER TABLE workout_sessions ADD COLUMN import_operations JSONB, ADD COLUMN source_snapshot JSONB, ADD COLUMN copied_from_session_id UUID;
ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_copied_from_session_id_athlete_id_fkey FOREIGN KEY (copied_from_session_id,athlete_id) REFERENCES workout_sessions(id,athlete_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX workout_sessions_copied_from_session_id_athlete_id_idx ON workout_sessions(copied_from_session_id,athlete_id);
ALTER TABLE plan_days ADD COLUMN source_workout_session_id UUID, ADD COLUMN creation_request_hash CHAR(64);
ALTER TABLE plan_days ADD CONSTRAINT plan_days_source_workout_session_id_fkey FOREIGN KEY (source_workout_session_id) REFERENCES workout_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX plan_days_source_workout_session_id_idx ON plan_days(source_workout_session_id);
ALTER TABLE workout_exercises
 ADD COLUMN original_snapshot JSONB,
 ADD COLUMN creation_request_hash CHAR(64),
 ADD COLUMN is_omitted BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN target_sets INTEGER,
 ADD COLUMN target_reps_min INTEGER,
 ADD COLUMN target_reps_max INTEGER,
 ADD COLUMN target_load DECIMAL(8,3),
 ADD COLUMN target_load_unit "MeasurementUnit",
 ADD COLUMN target_rpe DECIMAL(3,1),
 ADD COLUMN replaces_workout_exercise_id UUID,
 ADD CONSTRAINT workout_exercises_targets_check CHECK (
  (target_sets IS NULL OR target_sets BETWEEN 1 AND 1000)
  AND ((target_reps_min IS NULL AND target_reps_max IS NULL) OR (target_reps_min IS NOT NULL AND target_reps_max IS NOT NULL AND target_reps_min BETWEEN 1 AND 10000 AND target_reps_max BETWEEN target_reps_min AND 10000))
  AND (target_load IS NULL OR target_load >= 0)
  AND (target_load_unit IS NULL OR target_load IS NOT NULL)
  AND (target_rpe IS NULL OR target_rpe BETWEEN 0 AND 10)
 );
CREATE UNIQUE INDEX workout_exercises_id_session_id_key ON workout_exercises(id,session_id);
ALTER TABLE workout_exercises ADD CONSTRAINT workout_exercises_replaces_workout_exercise_id_session_id_fkey FOREIGN KEY (replaces_workout_exercise_id,session_id) REFERENCES workout_exercises(id,session_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX workout_exercises_replaces_workout_exercise_id_session_id_idx ON workout_exercises(replaces_workout_exercise_id,session_id);
-- No snapshots or adjusted objectives are invented for legacy rows.
COMMIT;
