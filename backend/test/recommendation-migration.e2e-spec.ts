import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Decimal } from '@prisma/client/runtime/client';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-4B migration from the actual previous schema', () => {
  it('preserves every legacy state, nullable destinations, evidence, loads, dates, IDs and FKs without backfilling unknown information', async () => {
    const url = await progressionIsolation(),
      admin = new pg.Client({ connectionString: url }),
      name = 'pulso_prog4b_migration_' + randomUUID().replaceAll('-', ''),
      target = new URL(url);
    target.pathname = '/' + name;
    const db = new pg.Client({ connectionString: target.toString() });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      await db.connect();
      const directory = resolve('prisma/migrations'),
        migration = '20261109001000_neutral_weekly_recommendations';
      for (const item of (await readdir(directory, { withFileTypes: true }))
        .filter((i) => i.isDirectory() && i.name < migration)
        .map((i) => i.name)
        .sort())
        await db.query(
          await readFile(resolve(directory, item, 'migration.sql'), 'utf8'),
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
      ] = Array.from({ length: 9 }, () => randomUUID());
      await db.query(
        "INSERT INTO users(id,email,password_hash,updated_at) VALUES($1,$2,'fixture',now())",
        [user, user + '@example.test'],
      );
      await db.query(
        'INSERT INTO athletes(id,user_id,updated_at) VALUES($1,$2,now())',
        [athlete, user],
      );
      await db.query(
        'INSERT INTO muscle_groups(id,key,name,updated_at) VALUES($1,$2,$2,now())',
        [group, group],
      );
      await db.query(
        "INSERT INTO exercises(id,name,equipment,primary_muscle_group_id,updated_at) VALUES($1,'Legacy','Unknown',$2,now())",
        [exercise, group],
      );
      await db.query(
        "INSERT INTO training_plans(id,athlete_id,name,updated_at) VALUES($1,$2,'Legacy',now())",
        [plan, athlete],
      );
      await db.query(
        'INSERT INTO plan_weeks(id,training_plan_id,week_number) VALUES($1,$2,1)',
        [week, plan],
      );
      await db.query(
        "INSERT INTO plan_days(id,plan_week_id,name,position) VALUES($1,$2,'Legacy',1)",
        [day, week],
      );
      await db.query(
        'INSERT INTO plan_exercises(id,plan_week_id,plan_day_id,exercise_id,position,target_sets,target_reps) VALUES($1,$2,$3,$4,1,3,5)',
        [prescription, week, day, exercise],
      );
      await db.query(
        "INSERT INTO workout_sessions(id,athlete_id,status,updated_at) VALUES($1,$2,'COMPLETED',now())",
        [session, athlete],
      );
      for (const [index, status] of [
        'PENDING',
        'APPROVED',
        'REJECTED',
        'APPLIED',
        'BLOCKED',
        'EXPIRED',
      ].entries()) {
        const id = randomUUID();
        await db.query(
          `INSERT INTO progression_recommendations(id,athlete_id,exercise_id,plan_week_id,plan_exercise_id,previous_load,recommended_load,justification,status,algorithm_version,effective_settings,created_at,reviewed_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,99999.999,'legacy fixture',$7,'legacy-v0','{"unknownUnit":true}','2025-01-01T12:00:00.123456Z','2025-01-02T13:00:00.654321Z',NULL)`,
          [
            id,
            athlete,
            exercise,
            index % 2 ? null : week,
            index % 2 ? null : prescription,
            index % 2 ? null : '42.125',
            status,
          ],
        );
        await db.query(
          "INSERT INTO recommendation_evidence(id,recommendation_id,session_id,role,associated_at) VALUES($1,$2,$3,$4,'2025-01-01T14:00:00.111111Z')",
          [
            randomUUID(),
            id,
            session,
            ['SATISFACTORY', 'UNSATISFACTORY', 'CONTEXT'][index % 3],
          ],
        );
      }
      const projection =
        'id,athlete_id,exercise_id,plan_week_id,plan_exercise_id,previous_load::text,recommended_load::text,justification,status,algorithm_version,effective_settings,created_at::text,reviewed_at::text,expires_at::text';
      const before = (
        await db.query(
          `SELECT ${projection} FROM progression_recommendations ORDER BY id`,
        )
      ).rows;
      const evidence = (
        await db.query(
          'SELECT row_to_json(e) AS value FROM recommendation_evidence e ORDER BY id',
        )
      ).rows;
      const sources = (
        await db.query('SELECT row_to_json(s) AS value FROM workout_sessions s')
      ).rows;
      const refs = (
        await db.query(
          "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='progression_recommendations'::regclass AND contype='f' ORDER BY conname",
        )
      ).rows;
      await db.query(
        await readFile(resolve(directory, migration, 'migration.sql'), 'utf8'),
      );
      expect(
        (
          await db.query(
            `SELECT ${projection} FROM progression_recommendations ORDER BY id`,
          )
        ).rows,
      ).toEqual(
        before.map((r) => ({
          ...r,
          previous_load:
            r.previous_load === null
              ? null
              : new Decimal(r.previous_load).toFixed(6),
          recommended_load: new Decimal(r.recommended_load).toFixed(6),
        })),
      );
      expect(
        (
          await db.query(
            'SELECT row_to_json(e) AS value FROM recommendation_evidence e ORDER BY id',
          )
        ).rows,
      ).toEqual(evidence);
      expect(
        (
          await db.query(
            'SELECT row_to_json(s) AS value FROM workout_sessions s',
          )
        ).rows,
      ).toEqual(sources);
      expect(
        (
          await db.query(
            "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='progression_recommendations'::regclass AND contype='f' ORDER BY conname",
          )
        ).rows,
      ).toEqual(refs);
      const extras = (
        await db.query(
          'SELECT load_unit,previous_load_kg,recommended_load_kg,semantic_key,cycle_key,cycle_slot,request_key,snapshot,dependency_keys,proposal_kind FROM progression_recommendations',
        )
      ).rows;
      expect(extras).toHaveLength(6);
      extras.forEach((r) =>
        expect(Object.values(r).every((v) => v === null)).toBe(true),
      );
      expect(
        (
          await db.query(
            "SELECT numeric_precision,numeric_scale FROM information_schema.columns WHERE table_name='progression_recommendations' AND column_name IN ('previous_load','recommended_load') ORDER BY column_name",
          )
        ).rows,
      ).toEqual([
        { numeric_precision: 24, numeric_scale: 6 },
        { numeric_precision: 24, numeric_scale: 6 },
      ]);
      const indexes = (
        await db.query(
          "SELECT indexdef FROM pg_indexes WHERE tablename='progression_recommendations'",
        )
      ).rows
        .map((r) => r.indexdef)
        .join('\n');
      expect(indexes).toContain(
        'UNIQUE INDEX progression_recommendations_semantic_key_key',
      );
      expect(indexes).toContain(
        'UNIQUE INDEX progression_recommendations_cycle_slot_key',
      );
      await expect(
        db.query(
          "UPDATE progression_recommendations SET load_unit='KG' WHERE id=$1",
          [before[0].id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(
          "UPDATE progression_recommendations SET semantic_key=repeat('a',64) WHERE id=$1",
          [before[0].id],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await db.query(
        "UPDATE progression_recommendations SET status='REJECTED' WHERE id=$1",
        [before[0].id],
      );
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });
});
