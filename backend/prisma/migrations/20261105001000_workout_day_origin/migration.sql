BEGIN;
ALTER TABLE plan_weeks ADD COLUMN starts_on DATE;
CREATE INDEX plan_weeks_training_plan_id_starts_on_idx ON plan_weeks(training_plan_id,starts_on);
ALTER TABLE workout_sessions
  ADD COLUMN plan_day_id UUID,
  ADD COLUMN performed_on DATE,
  ADD COLUMN time_zone VARCHAR(100),
  ADD COLUMN recording_mode VARCHAR(20),
  ADD COLUMN name VARCHAR(160),
  ADD COLUMN creation_request_hash CHAR(64),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN completed_at TIMESTAMPTZ(6),
  ADD CONSTRAINT workout_sessions_recording_mode_check CHECK (recording_mode IS NULL OR recording_mode IN ('LIVE', 'RETROSPECTIVE')),
  ADD CONSTRAINT workout_sessions_version_check CHECK (version >= 0),
  ADD CONSTRAINT workout_sessions_day_pair_check CHECK (plan_day_id IS NULL OR plan_week_id IS NOT NULL),
  ADD CONSTRAINT workout_sessions_local_date_check CHECK ((performed_on IS NULL) = (time_zone IS NULL)),
  ADD CONSTRAINT workout_sessions_completion_check CHECK (completed_at IS NULL OR (status = 'COMPLETED' AND finished_at IS NOT NULL AND completed_at = finished_at)),
  ADD CONSTRAINT workout_sessions_plan_day_id_plan_week_id_fkey FOREIGN KEY (plan_day_id, plan_week_id) REFERENCES plan_days(id, plan_week_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX workout_sessions_id_athlete_id_key ON workout_sessions(id,athlete_id);
CREATE INDEX workout_sessions_athlete_id_performed_on_status_idx ON workout_sessions(athlete_id,performed_on,status);
CREATE INDEX workout_sessions_plan_day_id_plan_week_id_idx ON workout_sessions(plan_day_id,plan_week_id);
-- Dates, timezone, day and creation intents of legacy rows remain unknown. No historical backfill.
COMMIT;
