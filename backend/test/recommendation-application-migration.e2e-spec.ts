import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../src/database/prisma.service';
import { applicationFixture } from './helpers/recommendation-application-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-5B migration from the real preceding schema', () => {
  it('preserves legacy applications, exact dates/decimals, approved recommendation and its immutable 5A event without inventing metadata', async () => {
    const url = await progressionIsolation(),
      writer = new PrismaService(),
      admin = new pg.Client({ connectionString: url }),
      name = 'pulso_prog5b_migration_' + randomUUID().replaceAll('-', ''),
      target = new URL(url);
    target.pathname = '/' + name;
    const older = new pg.Client({ connectionString: target.toString() });
    await writer.$connect();
    await admin.connect();
    try {
      const f = await applicationFixture(writer);
      for (const origin of ['MANUAL', 'AUTOMATIC']) {
        const id = randomUUID();
        await admin.query(
          `INSERT INTO progression_recommendations(id,athlete_id,exercise_id,previous_load,recommended_load,justification,status,algorithm_version,effective_settings,created_at) VALUES($1,$2,$3,40.001,42.125,'legacy fixture','APPLIED','legacy','{"unknownUnit":true}','2025-01-01T12:00:00.123456Z')`,
          [id, f.athleteId, f.e.id],
        );
        await admin.query(
          "INSERT INTO progression_applications(id,recommendation_id,applied_load,origin,effective_at) VALUES($1,$2,42.125,$3,'2025-01-02T12:00:00.654321Z')",
          [randomUUID(), id, origin],
        );
      }
      await admin.query(`CREATE DATABASE "${name}"`);
      await older.connect();
      const folder = resolve('prisma/migrations'),
        migration = '20261110001000_authorized_progression_applications';
      for (const item of (await readdir(folder, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name < migration)
        .map((d) => d.name)
        .sort())
        await older.query(
          await readFile(resolve(folder, item, 'migration.sql'), 'utf8'),
        );
      const sets = await writer.setRecord.findMany({
        where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
        select: { id: true },
      });
      const groups = (
        await writer.exercise.findUniqueOrThrow({ where: { id: f.e.id } })
      ).primaryMuscleGroupId;
      const tables: readonly [string, string[]][] = [
        ['users', [f.identity.account.id]],
        ['athletes', [f.athleteId]],
        ['muscle_groups', [groups]],
        ['exercises', [f.e.id]],
        ['training_plans', [f.target.plan.id]],
        ['plan_weeks', [f.target.week.id]],
        ['plan_days', [f.target.day.id]],
        ['plan_exercises', [f.target.p.id]],
        ['scheduled_activities', [f.activity.id]],
        ['workout_sessions', f.tasks.map((t) => t.sessionId)],
        ['workout_exercises', f.tasks.map((t) => t.id)],
        ['set_records', sets.map((s) => s.id)],
        ['progression_settings', [f.setting.id]],
      ];
      for (const [table, ids] of tables) {
        const rows = await admin.query(
          `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE id=ANY($1::uuid[])`,
          [ids],
        );
        for (const row of rows.rows)
          await older.query(
            `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb)`,
            [row.row],
          );
      }
      await older.query('BEGIN');
      const recs = await admin.query(
        'SELECT id,to_jsonb(t)::text AS row FROM progression_recommendations t WHERE athlete_id=$1 ORDER BY id',
        [f.athleteId],
      );
      for (const r of recs.rows)
        await older.query(
          `INSERT INTO progression_recommendations SELECT * FROM jsonb_populate_record(NULL::progression_recommendations,$1::jsonb ${r.id === f.proposal.id ? `|| '{"status":"PENDING","review_version":null,"reviewed_at":null}'::jsonb` : ''})`,
          [r.row],
        );
      const evidence = await admin.query(
        'SELECT to_jsonb(t)::text AS row FROM recommendation_evidence t WHERE recommendation_id=$1',
        [f.proposal.id],
      );
      for (const r of evidence.rows)
        await older.query(
          'INSERT INTO recommendation_evidence SELECT * FROM jsonb_populate_record(NULL::recommendation_evidence,$1::jsonb)',
          [r.row],
        );
      const reviews = await admin.query(
        'SELECT to_jsonb(t)::text AS row FROM recommendation_reviews t WHERE recommendation_id=$1',
        [f.proposal.id],
      );
      for (const r of reviews.rows)
        await older.query(
          'INSERT INTO recommendation_reviews SELECT * FROM jsonb_populate_record(NULL::recommendation_reviews,$1::jsonb)',
          [r.row],
        );
      await older.query(
        "UPDATE progression_recommendations SET status='APPROVED',review_version=1,reviewed_at=(SELECT decided_at FROM recommendation_reviews WHERE recommendation_id=$1) WHERE id=$1",
        [f.proposal.id],
      );
      const apps = await admin.query(
        "SELECT (to_jsonb(t)-ARRAY['athlete_id','actor_user_id','review_id','plan_exercise_id','scheduled_activity_id','previous_load','load_unit','intent_id','request_key','cycle_key','audit'])::text AS row FROM progression_applications t WHERE recommendation_id IN (SELECT id FROM progression_recommendations WHERE athlete_id=$1)",
        [f.athleteId],
      );
      for (const r of apps.rows)
        await older.query(
          'INSERT INTO progression_applications SELECT * FROM jsonb_populate_record(NULL::progression_applications,$1::jsonb)',
          [r.row],
        );
      await older.query('COMMIT');
      const originals: Record<string, unknown> = {};
      for (const table of [
        'progression_recommendations',
        'recommendation_reviews',
        'recommendation_evidence',
        'progression_applications',
      ])
        originals[table] = (
          await older.query(
            `SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY id`,
          )
        ).rows;
      await older.query(
        await readFile(resolve(folder, migration, 'migration.sql'), 'utf8'),
      );
      for (const table of [
        'progression_recommendations',
        'recommendation_reviews',
        'recommendation_evidence',
      ])
        expect(
          (
            await older.query(
              `SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY id`,
            )
          ).rows,
        ).toEqual(originals[table]);
      expect(
        (
          await older.query(
            "SELECT (to_jsonb(t)-ARRAY['athlete_id','actor_user_id','review_id','plan_exercise_id','scheduled_activity_id','previous_load','load_unit','intent_id','request_key','cycle_key','audit'])::text AS row FROM progression_applications t ORDER BY id",
          )
        ).rows,
      ).toEqual(originals.progression_applications);
      expect(
        (
          await older.query(
            'SELECT athlete_id,actor_user_id,review_id,plan_exercise_id,scheduled_activity_id,previous_load,load_unit,intent_id,request_key,cycle_key,audit FROM progression_applications',
          )
        ).rows.every((r) => Object.values(r).every((v) => v === null)),
      ).toBe(true);
      const app = (
        await older.query('SELECT id FROM progression_applications LIMIT 1')
      ).rows[0].id;
      await expect(
        older.query(
          "UPDATE progression_applications SET request_key=repeat('a',64) WHERE id=$1",
          [app],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        older.query(
          "UPDATE recommendation_reviews SET justification='rewrite'",
        ),
      ).rejects.toMatchObject({ code: '55000' });
    } finally {
      await older.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
      await writer.$disconnect();
    }
  });
});
