BEGIN;
ALTER TABLE training_plans ALTER COLUMN starts_on DROP NOT NULL, ADD COLUMN creation_request_hash CHAR(64), ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_days ADD COLUMN retired_at TIMESTAMPTZ(6), ADD COLUMN retired_from_on DATE, ADD COLUMN is_editable_override BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_days ADD CONSTRAINT plan_days_retirement_check CHECK((retired_at IS NULL)=(retired_from_on IS NULL));
DROP INDEX plan_days_plan_week_id_position_key;
CREATE UNIQUE INDEX plan_days_active_position_key ON plan_days(plan_week_id,position) WHERE retired_at IS NULL;
CREATE INDEX plan_days_plan_week_id_retired_at_position_idx ON plan_days(plan_week_id,retired_at,position);
CREATE TYPE "ScheduledActivityStatus" AS ENUM ('PLANNED','RESCHEDULED','OMITTED','WITHDRAWN','REST');
CREATE TABLE scheduled_activities (
 id UUID PRIMARY KEY, athlete_id UUID NOT NULL, plan_week_id UUID, plan_day_id UUID, original_plan_day_id UUID,
 original_on DATE NOT NULL, scheduled_on DATE NOT NULL, time_zone VARCHAR(100) NOT NULL, title VARCHAR(160) NOT NULL,
 status "ScheduledActivityStatus" NOT NULL DEFAULT 'PLANNED', version INTEGER NOT NULL DEFAULT 0, creation_request_hash CHAR(64),
 CONSTRAINT scheduled_activities_athlete_id_fkey FOREIGN KEY(athlete_id) REFERENCES athletes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT scheduled_activities_plan_week_id_fkey FOREIGN KEY(plan_week_id) REFERENCES plan_weeks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT scheduled_activities_plan_day_id_plan_week_id_fkey FOREIGN KEY(plan_day_id,plan_week_id) REFERENCES plan_days(id,plan_week_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT scheduled_activities_original_plan_day_id_fkey FOREIGN KEY(original_plan_day_id) REFERENCES plan_days(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT scheduled_activities_values_check CHECK(version>=0 AND length(btrim(title))>0 AND ((status='REST' AND plan_day_id IS NULL) OR (status<>'REST' AND plan_day_id IS NOT NULL AND plan_week_id IS NOT NULL)))
);
CREATE UNIQUE INDEX scheduled_activities_id_athlete_id_key ON scheduled_activities(id,athlete_id);
CREATE UNIQUE INDEX scheduled_activities_id_athlete_id_plan_week_id_plan_day_id_key ON scheduled_activities(id,athlete_id,plan_week_id,plan_day_id);
CREATE INDEX scheduled_activities_athlete_id_scheduled_on_status_idx ON scheduled_activities(athlete_id,scheduled_on,status);
CREATE INDEX scheduled_activities_plan_day_id_scheduled_on_idx ON scheduled_activities(plan_day_id,scheduled_on);
ALTER TABLE workout_sessions ADD COLUMN scheduled_activity_id UUID,
 ADD CONSTRAINT workout_sessions_scheduled_activity_id_athlete_id_fkey FOREIGN KEY(scheduled_activity_id,athlete_id,plan_week_id,plan_day_id) REFERENCES scheduled_activities(id,athlete_id,plan_week_id,plan_day_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_scheduled_activity_day_check CHECK(scheduled_activity_id IS NULL OR (plan_week_id IS NOT NULL AND plan_day_id IS NOT NULL));
CREATE INDEX workout_sessions_scheduled_activity_id_athlete_id_idx ON workout_sessions(scheduled_activity_id,athlete_id);
CREATE TABLE planning_operations (
 id UUID PRIMARY KEY, athlete_id UUID NOT NULL, plan_id UUID NOT NULL, request_hash CHAR(64) NOT NULL, result JSONB NOT NULL,
 CONSTRAINT planning_operations_athlete_id_fkey FOREIGN KEY(athlete_id) REFERENCES athletes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT planning_operations_plan_id_athlete_id_fkey FOREIGN KEY(plan_id,athlete_id) REFERENCES training_plans(id,athlete_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX planning_operations_plan_id_athlete_id_idx ON planning_operations(plan_id,athlete_id);
CREATE FUNCTION pulso_activity_owner_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.plan_week_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plan_weeks w JOIN training_plans p ON p.id=w.training_plan_id WHERE w.id=NEW.plan_week_id AND p.athlete_id=NEW.athlete_id) THEN RAISE EXCEPTION 'Invalid activity ownership' USING ERRCODE='23503'; END IF;
 IF NEW.original_plan_day_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plan_days d JOIN plan_weeks w ON w.id=d.plan_week_id JOIN training_plans p ON p.id=w.training_plan_id WHERE d.id=NEW.original_plan_day_id AND p.athlete_id=NEW.athlete_id) THEN RAISE EXCEPTION 'Invalid activity origin ownership' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scheduled_activities_owner_check BEFORE INSERT OR UPDATE OF athlete_id,plan_week_id,original_plan_day_id ON scheduled_activities FOR EACH ROW EXECUTE FUNCTION pulso_activity_owner_check();
-- No sessions, dates, daily associations or outcomes are invented for existing rows.
COMMIT;
