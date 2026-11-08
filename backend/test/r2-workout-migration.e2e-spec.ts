import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const isolated = process.env.R2_TEST_DATABASE_URL ? describe : describe.skip;
isolated('R2-D additive migration with historical training records', () => {
  it('preserves identifiers, statuses, dates, unknown units and historical relationships', async () => {
    const source = process.env.R2_TEST_DATABASE_URL!;
    if (
      source !== process.env.DATABASE_URL ||
      new URL(source).pathname !== '/pulso_f06_test'
    )
      throw new Error('Only the disposable cluster is allowed.');
    const name = 'pulso_r2_migration_' + randomUUID().replaceAll('-', '');
    const admin = new pg.Client({ connectionString: source });
    await admin.connect();
    const target = new URL(source);
    target.pathname = '/' + name;
    const db = new pg.Client({ connectionString: target.toString() });
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      await db.connect();
      const folder = resolve('prisma/migrations');
      const migrations = (await readdir(folder, { withFileTypes: true }))
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort();
      for (const migration of migrations.filter(
        (item) => item < '20261105001000_workout_day_origin',
      ))
        await db.query(
          await readFile(resolve(folder, migration, 'migration.sql'), 'utf8'),
        );
      const [
        user,
        athlete,
        group,
        exercise,
        plan,
        week,
        day,
        prescription,
        session,
        workout,
        set,
        estimate,
        recommendation,
        feedback,
      ] = Array.from({ length: 14 }, () => randomUUID());
      await db.query(
        'INSERT INTO users(id,email,password_hash,updated_at) VALUES($1,$2,$3,now())',
        [user, `r2-${user}@example.test`, 'fixture'],
      );
      await db.query(
        'INSERT INTO athletes(id,user_id,updated_at) VALUES($1,$2,now())',
        [athlete, user],
      );
      await db.query(
        'INSERT INTO muscle_groups(id,key,name,updated_at) VALUES($1,$2,$2,now())',
        [group, `r2-${group}`],
      );
      await db.query(
        'INSERT INTO exercises(id,name,equipment,primary_muscle_group_id,updated_at) VALUES($1,$2,$3,$4,now())',
        [exercise, 'R2 fixture', 'Barra', group],
      );
      await db.query(
        'INSERT INTO training_plans(id,athlete_id,name,starts_on,updated_at) VALUES($1,$2,$3,current_date,now())',
        [plan, athlete, 'R2 old plan'],
      );
      await db.query(
        'INSERT INTO plan_weeks(id,training_plan_id,week_number) VALUES($1,$2,17)',
        [week, plan],
      );
      await db.query(
        'INSERT INTO plan_days(id,plan_week_id,name,position,weekday) VALUES($1,$2,$3,1,1)',
        [day, week, 'R1 day'],
      );
      await db.query(
        'INSERT INTO plan_exercises(id,plan_week_id,exercise_id,position,target_sets,target_reps,target_load) VALUES($1,$2,$3,1,3,8,42.125)',
        [prescription, week, exercise],
      );
      await db.query(
        "INSERT INTO workout_sessions(id,athlete_id,training_plan_id,plan_week_id,status,started_at,finished_at,updated_at) VALUES($1,$2,$3,$4,'COMPLETED','2025-01-01T12:00:00Z','2025-01-01T13:00:00Z',now())",
        [session, athlete, plan, week],
      );
      await db.query(
        'INSERT INTO workout_exercises(id,session_id,exercise_id,plan_exercise_id,order_in_session) VALUES($1,$2,$3,$4,1)',
        [workout, session, exercise, prescription],
      );
      await db.query(
        'INSERT INTO set_records(id,workout_exercise_id,set_number,load,repetitions,rpe,is_completed) VALUES($1,$2,1,42.125,5,7.5,false)',
        [set, workout],
      );
      await db.query(
        "INSERT INTO one_rm_estimates(id,athlete_id,exercise_id,source_set_id,input_load,input_reps,estimated_one_rm,formula,algorithm_version) VALUES($1,$2,$3,$4,42.125,5,50,'EPLEY','fixture')",
        [estimate, athlete, exercise, set],
      );
      await db.query(
        "INSERT INTO progression_recommendations(id,athlete_id,exercise_id,plan_week_id,plan_exercise_id,recommended_load,justification,algorithm_version,effective_settings) VALUES($1,$2,$3,$4,$5,45,'Fixture','fixture','{}')",
        [recommendation, athlete, exercise, week, prescription],
      );
      await db.query(
        'INSERT INTO session_feedback(id,session_id,global_rpe) VALUES($1,$2,7.5)',
        [feedback, session],
      );
      const tables = [
        'users',
        'athletes',
        'exercises',
        'training_plans',
        'plan_weeks',
        'plan_days',
        'plan_exercises',
        'workout_sessions',
        'workout_exercises',
        'set_records',
        'one_rm_estimates',
        'progression_recommendations',
        'session_feedback',
      ];
      const snapshots = new Map<string, Array<Record<string, unknown>>>();
      for (const table of tables)
        snapshots.set(
          table,
          (
            await db.query(
              `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
            )
          ).rows.map((item) => item.row as Record<string, unknown>),
        );
      for (const migration of migrations.filter(
        (item) => item >= '20261105001000_workout_day_origin',
      ))
        await db.query(
          await readFile(resolve(folder, migration, 'migration.sql'), 'utf8'),
        );
      for (const table of tables) {
        const before = snapshots.get(table)!;
        const after: Array<Record<string, unknown>> = (
          await db.query(
            `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
          )
        ).rows.map((item) => item.row as Record<string, unknown>);
        expect(
          after.map((row) =>
            Object.fromEntries(
              Object.keys(before[0]).map((key) => [key, row[key]]),
            ),
          ),
        ).toEqual(before);
      }
      expect(
        (
          await db.query(
            'SELECT plan_day_id,performed_on,time_zone,source_snapshot,completed_at FROM workout_sessions WHERE id=$1',
            [session],
          )
        ).rows[0],
      ).toEqual({
        plan_day_id: null,
        performed_on: null,
        time_zone: null,
        source_snapshot: null,
        completed_at: null,
      });
      expect(
        (
          await db.query(
            'SELECT status,kind,load_unit,load_kg,is_completed FROM set_records WHERE id=$1',
            [set],
          )
        ).rows[0],
      ).toEqual({
        status: null,
        kind: null,
        load_unit: null,
        load_kg: null,
        is_completed: false,
      });
      const secondWeek = randomUUID();
      const secondDay = randomUUID();
      await db.query(
        'INSERT INTO plan_weeks(id,training_plan_id,week_number) VALUES($1,$2,18)',
        [secondWeek, plan],
      );
      await db.query(
        'INSERT INTO plan_days(id,plan_week_id,name,position) VALUES($1,$2,$3,1)',
        [secondDay, secondWeek, 'Another week'],
      );
      await expect(
        db.query('UPDATE workout_sessions SET plan_day_id=$1 WHERE id=$2', [
          secondDay,
          session,
        ]),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        db.query("UPDATE set_records SET load_unit='KG' WHERE id=$1", [set]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(
          'UPDATE workout_sessions SET plan_day_id=$1,plan_week_id=NULL WHERE id=$2',
          [day, session],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(
          "UPDATE set_records SET status='FAILED',kind='WORK',load_unit='KG',load_kg=42.125 WHERE id=$1",
          [set],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(
          "UPDATE set_records SET status='COMPLETED',kind='WORK',load_unit='KG',load_kg=40,is_completed=true WHERE id=$1",
          [set],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  }, 20000);
});
