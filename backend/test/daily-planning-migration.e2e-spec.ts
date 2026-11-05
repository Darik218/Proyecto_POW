import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const isolated = process.env.R1_TEST_DATABASE_URL ? describe : describe.skip;
isolated(
  'R1 migration preserves pre-existing data in a disposable PostgreSQL database',
  () => {
    it('preserves IDs, raw loads, executed data and recommendations, and enforces transitional SQL constraints', async () => {
      const source = process.env.R1_TEST_DATABASE_URL!;
      if (
        source !== process.env.DATABASE_URL ||
        new URL(source).pathname !== '/pulso_f06_test'
      )
        throw new Error('Only the isolated runner is permitted.');
      const name = `pulso_r1_migration_${randomUUID().replaceAll('-', '')}`;
      const admin = new pg.Client({ connectionString: source });
      await admin.connect();
      const target = new URL(source);
      target.pathname = '/' + name;
      const client = new pg.Client({ connectionString: target.toString() });
      try {
        await admin.query(`CREATE DATABASE "${name}"`);
        await client.connect();
        const folder = resolve('prisma/migrations');
        const migrations = (await readdir(folder, { withFileTypes: true }))
          .filter((item) => item.isDirectory())
          .map((item) => item.name)
          .sort();
        for (const migration of migrations.filter(
          (item) => item < '20261105000000_daily_planning',
        ))
          await client.query(
            await readFile(resolve(folder, migration, 'migration.sql'), 'utf8'),
          );
        const [
          user,
          athlete,
          group,
          exercise,
          plan,
          week,
          prescription,
          session,
          workout,
          set,
          estimate,
          recommendation,
          feedback,
        ] = Array.from({ length: 13 }, () => randomUUID());
        await client.query(
          'INSERT INTO users(id,email,password_hash,updated_at) VALUES($1,$2,$3,now())',
          [user, `r1-${user}@example.test`, 'fixture-only'],
        );
        await client.query(
          'INSERT INTO athletes(id,user_id,updated_at) VALUES($1,$2,now())',
          [athlete, user],
        );
        await client.query(
          'INSERT INTO muscle_groups(id,key,name,updated_at) VALUES($1,$2,$2,now())',
          [group, `r1-${group}`],
        );
        await client.query(
          'INSERT INTO exercises(id,name,equipment,primary_muscle_group_id,updated_at) VALUES($1,$2,$3,$4,now())',
          [exercise, 'R1 fixture', 'Barra', group],
        );
        await client.query(
          'INSERT INTO training_plans(id,athlete_id,name,starts_on,updated_at) VALUES($1,$2,$3,current_date,now())',
          [plan, athlete, 'R1 legacy'],
        );
        await client.query(
          'INSERT INTO plan_weeks(id,training_plan_id,week_number) VALUES($1,$2,1)',
          [week, plan],
        );
        await client.query(
          'INSERT INTO plan_exercises(id,plan_week_id,exercise_id,position,target_sets,target_reps,target_load) VALUES($1,$2,$3,1,3,8,42.125)',
          [prescription, week, exercise],
        );
        await client.query(
          "INSERT INTO workout_sessions(id,athlete_id,training_plan_id,plan_week_id,status,started_at,finished_at,updated_at) VALUES($1,$2,$3,$4,'COMPLETED',now(),now(),now())",
          [session, athlete, plan, week],
        );
        await client.query(
          'INSERT INTO workout_exercises(id,session_id,exercise_id,plan_exercise_id,order_in_session) VALUES($1,$2,$3,$4,1)',
          [workout, session, exercise, prescription],
        );
        await client.query(
          'INSERT INTO set_records(id,workout_exercise_id,set_number,load,repetitions,rpe) VALUES($1,$2,1,42.125,8,7.5)',
          [set, workout],
        );
        await client.query(
          "INSERT INTO one_rm_estimates(id,athlete_id,exercise_id,source_set_id,input_load,input_reps,estimated_one_rm,formula,algorithm_version) VALUES($1,$2,$3,$4,42.125,8,50,'EPLEY','fixture')",
          [estimate, athlete, exercise, set],
        );
        await client.query(
          "INSERT INTO progression_recommendations(id,athlete_id,exercise_id,plan_week_id,plan_exercise_id,recommended_load,justification,algorithm_version,effective_settings) VALUES($1,$2,$3,$4,$5,45,'Fixture','fixture','{}')",
          [recommendation, athlete, exercise, week, prescription],
        );
        await client.query(
          'INSERT INTO session_feedback(id,session_id,global_rpe) VALUES($1,$2,7.5)',
          [feedback, session],
        );
        const tables = [
          'users',
          'athletes',
          'exercises',
          'training_plans',
          'plan_weeks',
          'workout_sessions',
          'workout_exercises',
          'set_records',
          'one_rm_estimates',
          'progression_recommendations',
          'session_feedback',
        ];
        const snapshots = [];
        for (const table of tables)
          snapshots.push(
            await client.query(
              `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
            ),
          );
        await client.query(
          await readFile(
            resolve(folder, '20261105000000_daily_planning/migration.sql'),
            'utf8',
          ),
        );
        for (const [index, table] of tables.entries())
          expect(
            (
              await client.query(
                `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
              )
            ).rows,
          ).toEqual(snapshots[index].rows);
        expect(
          (
            await client.query(
              'SELECT id,plan_day_id,target_reps,target_reps_min,target_reps_max,target_load::text,target_load_unit FROM plan_exercises',
            )
          ).rows,
        ).toEqual([
          {
            id: prescription,
            plan_day_id: null,
            target_reps: 8,
            target_reps_min: 8,
            target_reps_max: 8,
            target_load: '42.125',
            target_load_unit: null,
          },
        ]);
        expect(
          (await client.query('SELECT count(*)::int AS count FROM plan_days'))
            .rows[0].count,
        ).toBe(0);
        const day = randomUUID();
        const secondWeek = randomUUID();
        const secondDay = randomUUID();
        await client.query(
          'INSERT INTO plan_days(id,plan_week_id,name,position,weekday) VALUES($1,$2,$3,1,1)',
          [day, week, 'R1'],
        );
        await client.query(
          'INSERT INTO plan_days(id,plan_week_id,name,position,weekday) VALUES($1,$2,$3,2,1)',
          [randomUUID(), week, 'Another Monday'],
        );
        await expect(
          client.query('UPDATE plan_days SET weekday=8 WHERE id=$1', [day]),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query('UPDATE plan_days SET position=0 WHERE id=$1', [day]),
        ).rejects.toMatchObject({ code: '23514' });
        await client.query(
          'INSERT INTO plan_weeks(id,training_plan_id,week_number) VALUES($1,$2,2)',
          [secondWeek, plan],
        );
        await client.query(
          'INSERT INTO plan_days(id,plan_week_id,name,position) VALUES($1,$2,$3,1)',
          [secondDay, secondWeek, 'Foreign week'],
        );
        await expect(
          client.query('UPDATE plan_exercises SET plan_day_id=$1 WHERE id=$2', [
            secondDay,
            prescription,
          ]),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          client.query(
            'UPDATE plan_exercises SET target_reps=NULL,target_reps_max=7 WHERE id=$1',
            [prescription],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query(
            'UPDATE plan_exercises SET target_reps=NULL,target_reps_min=NULL,target_reps_max=NULL WHERE id=$1',
            [prescription],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query(
            "UPDATE plan_exercises SET target_load=NULL,target_load_unit='KG' WHERE id=$1",
            [prescription],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        // Old weekly writers remain valid and cannot duplicate positions. A daily prescription may use the same numeric position.
        const insert =
          'INSERT INTO plan_exercises(id,plan_week_id,exercise_id,position,target_sets,target_reps,plan_day_id) VALUES($1,$2,$3,1,3,8,$4)';
        await expect(
          client.query(insert, [randomUUID(), week, exercise, null]),
        ).rejects.toMatchObject({ code: '23505' });
        await client.query(insert, [randomUUID(), week, exercise, day]);
        await expect(
          client.query(insert, [randomUUID(), week, exercise, day]),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query('DELETE FROM plan_exercises WHERE id=$1', [
            prescription,
          ]),
        ).rejects.toMatchObject({ code: '23001' });
        expect(
          (
            await client.query(
              'SELECT plan_exercise_id FROM workout_exercises WHERE id=$1',
              [workout],
            )
          ).rows[0].plan_exercise_id,
        ).toBe(prescription);
      } finally {
        await client.end();
        // This database was created above in the disposable cluster, never an existing/development database.
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.end();
      }
    }, 20000);
  },
);
