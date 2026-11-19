import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Decimal } from '@prisma/client/runtime/client';
import { progressionIsolation } from './helpers/progression-isolation';

const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-1B previous-schema migration and legacy evidence', () => {
  it('preserves exact values, IDs, dates, nullable source and relationships without inventing metadata', async () => {
    const url = await progressionIsolation();
    const admin = new pg.Client({ connectionString: url });
    const name = 'pulso_prog1b_migration_' + randomUUID().replaceAll('-', '');
    const target = new URL(url);
    target.pathname = '/' + name;
    const db = new pg.Client({ connectionString: target.toString() });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      await db.connect();
      const folder = resolve('prisma/migrations'),
        migration = '20261109000000_descriptive_one_rm_estimates';
      for (const item of (await readdir(folder, { withFileTypes: true }))
        .filter((x) => x.isDirectory() && x.name < migration)
        .map((x) => x.name)
        .sort())
        await db.query(
          await readFile(resolve(folder, item, 'migration.sql'), 'utf8'),
        );
      const [
        user,
        athlete,
        group,
        exercise,
        session,
        workout,
        set,
        estimate,
        sourceless,
      ] = Array.from({ length: 9 }, () => randomUUID());
      await db.query(
        'INSERT INTO users(id,email,password_hash,updated_at) VALUES($1,$2,$3,now())',
        [user, `prog1b-${user}@example.test`, 'fixture'],
      );
      await db.query(
        'INSERT INTO athletes(id,user_id,updated_at) VALUES($1,$2,now())',
        [athlete, user],
      );
      await db.query(
        'INSERT INTO muscle_groups(id,key,name,updated_at) VALUES($1,$2,$2,now())',
        [group, 'prog1b-' + group],
      );
      await db.query(
        'INSERT INTO exercises(id,name,equipment,primary_muscle_group_id,updated_at) VALUES($1,$2,$3,$4,now())',
        [exercise, 'Legacy exercise', 'Fixture', group],
      );
      await db.query(
        "INSERT INTO workout_sessions(id,athlete_id,status,started_at,finished_at,updated_at) VALUES($1,$2,'COMPLETED','2025-01-01T12:00:00Z','2025-01-01T13:00:00Z',now())",
        [session, athlete],
      );
      await db.query(
        'INSERT INTO workout_exercises(id,session_id,exercise_id,order_in_session) VALUES($1,$2,$3,1)',
        [workout, session, exercise],
      );
      await db.query(
        'INSERT INTO set_records(id,workout_exercise_id,set_number,load,repetitions,is_completed) VALUES($1,$2,1,42.125,5,false)',
        [set, workout],
      );
      await db.query(
        "INSERT INTO one_rm_estimates(id,athlete_id,exercise_id,source_set_id,input_load,input_reps,estimated_one_rm,formula,algorithm_version,calculated_at) VALUES($1,$2,$3,$4,42.125,5,50.123,'EPLEY','legacy-fixture','2025-01-01T13:01:02.123456Z'),($5,$2,$3,NULL,99999.999,1,99999.999,'BRZYCKI','unknown-units','2025-01-02T00:00:00Z')",
        [estimate, athlete, exercise, set, sourceless],
      );
      const projection =
        'id,athlete_id,exercise_id,source_set_id,input_load::text,input_reps,estimated_one_rm::text,formula,algorithm_version,calculated_at::text';
      const before = (
        await db.query(`SELECT ${projection} FROM one_rm_estimates ORDER BY id`)
      ).rows;
      const sourceBefore = (
        await db.query('SELECT row_to_json(s) AS value FROM set_records s')
      ).rows;
      const relationsBefore = (
        await db.query(
          "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='one_rm_estimates'::regclass AND contype='f' ORDER BY conname",
        )
      ).rows;
      await db.query(
        await readFile(resolve(folder, migration, 'migration.sql'), 'utf8'),
      );
      const after = (
        await db.query(`SELECT ${projection} FROM one_rm_estimates ORDER BY id`)
      ).rows;
      expect(after).toEqual(
        before.map((row) => ({
          ...row,
          estimated_one_rm: new Decimal(row.estimated_one_rm).toFixed(6),
        })),
      );
      expect(
        (await db.query('SELECT row_to_json(s) AS value FROM set_records s'))
          .rows,
      ).toEqual(sourceBefore);
      expect(
        (
          await db.query(
            "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='one_rm_estimates'::regclass AND contype='f' ORDER BY conname",
          )
        ).rows,
      ).toEqual(relationsBefore);
      const extra = (
        await db.query(
          'SELECT input_load_unit,input_load_kg,result_unit,source_set_version,eligibility_version,estimate_kind,calculation_key,snapshot FROM one_rm_estimates',
        )
      ).rows;
      for (const row of extra)
        expect(Object.values(row).every((v) => v === null)).toBe(true);
      expect(
        (
          await db.query(
            "SELECT numeric_precision,numeric_scale FROM information_schema.columns WHERE table_name='one_rm_estimates' AND column_name='estimated_one_rm'",
          )
        ).rows[0],
      ).toEqual({ numeric_precision: 24, numeric_scale: 6 });
      await expect(
        db.query(
          "UPDATE one_rm_estimates SET estimate_kind='DESCRIPTIVE' WHERE id=$1",
          [estimate],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query('UPDATE one_rm_estimates SET source_set_id=$1 WHERE id=$2', [
          randomUUID(),
          estimate,
        ]),
      ).rejects.toMatchObject({ code: '23503' });
      expect(
        (
          await db.query(
            "SELECT indexname FROM pg_indexes WHERE tablename='one_rm_estimates'",
          )
        ).rows.map((r) => r.indexname),
      ).toContain('one_rm_estimates_calculation_key_key');
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  }, 60000);
});
