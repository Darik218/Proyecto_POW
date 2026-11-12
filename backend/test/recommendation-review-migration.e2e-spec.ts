import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { RecommendationService } from '../src/progression/recommendation.service';
import {
  reviewFixture,
  plannedReviewTarget,
} from './helpers/recommendation-review-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated(
  'PROG-5A additive migration preserves unknown historical review provenance',
  () => {
    it('preserves all six legacy statuses and a real PROG-4B generation exactly, with NULL review version and no invented events', async () => {
      const url = await progressionIsolation(),
        writer = new PrismaService(),
        admin = new pg.Client({ connectionString: url }),
        name = 'pulso_prog5a_migration_' + randomUUID().replaceAll('-', '');
      const target = new URL(url);
      target.pathname = '/' + name;
      const older = new pg.Client({ connectionString: target.toString() });
      await writer.$connect();
      await admin.connect();
      try {
        const f = await reviewFixture(writer),
          p = await plannedReviewTarget(writer, f),
          service = new RecommendationService(
            new PrismaProgressionRepository(writer),
          ),
          draft = await service.proposeMyExercise(f.identity, f.command);
        const modern = await service.saveMyProposal(f.identity, {
          command: f.command,
          expectedSemanticKey: draft.semanticKey,
          expectedDependencyKeys: draft.dependencyKeys,
        });
        for (const [index, status] of [
          'PENDING',
          'APPROVED',
          'REJECTED',
          'APPLIED',
          'BLOCKED',
          'EXPIRED',
        ].entries())
          await admin.query(
            `INSERT INTO progression_recommendations(id,athlete_id,exercise_id,previous_load,recommended_load,justification,status,algorithm_version,effective_settings,created_at,reviewed_at)
    VALUES($1,$2,$3,$4,42.125,'legacy audit fixture',$5,'legacy','{"unknown":true}','2025-01-01T12:00:00.123456Z','2025-01-02T12:00:00.654321Z')`,
            [
              randomUUID(),
              f.athleteId,
              f.e.id,
              index % 2 ? null : '40.001',
              status,
            ],
          );
        await admin.query(`CREATE DATABASE "${name}"`);
        await older.connect();
        const folder = resolve('prisma/migrations'),
          migration = '20261110000000_manual_recommendation_reviews';
        for (const item of (await readdir(folder, { withFileTypes: true }))
          .filter((d) => d.isDirectory() && d.name < migration)
          .map((d) => d.name)
          .sort())
          await older.query(
            await readFile(resolve(folder, item, 'migration.sql'), 'utf8'),
          );
        const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
        const group = (
          await writer.exercise.findUniqueOrThrow({ where: { id: f.e.id } })
        ).primaryMuscleGroupId;
        const sources: readonly [string, string[]][] = [
          ['users', [f.identity.account.id]],
          ['athletes', [f.athleteId]],
          ['muscle_groups', [group]],
          ['exercises', [f.e.id]],
          ['training_plans', [p.plan.id]],
          ['plan_weeks', [p.week.id]],
          ['plan_days', [p.day.id]],
          ['plan_exercises', [p.p.id]],
          ['workout_sessions', f.tasks.map((t) => t.sessionId)],
          ['workout_exercises', f.tasks.map((t) => t.id)],
          [
            'set_records',
            ids(
              await writer.setRecord.findMany({
                where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
                select: { id: true },
              }),
            ),
          ],
          ['progression_settings', [f.setting.id]],
        ];
        // Copy JSON as PostgreSQL text, never through JS numbers: decimals and microseconds survive exactly.
        for (const [table, values] of sources) {
          const rows = await admin.query(
            `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE id=ANY($1::uuid[])`,
            [values],
          );
          for (const row of rows.rows)
            await older.query(
              `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb)`,
              [row.row],
            );
        }
        await older.query('BEGIN');
        const recs = await admin.query(
          "SELECT (to_jsonb(t)-'review_version')::text AS row FROM progression_recommendations t WHERE athlete_id=$1 ORDER BY id",
          [f.athleteId],
        );
        for (const row of recs.rows)
          await older.query(
            'INSERT INTO progression_recommendations SELECT * FROM jsonb_populate_record(NULL::progression_recommendations,$1::jsonb)',
            [row.row],
          );
        const links = await admin.query(
          'SELECT to_jsonb(t)::text AS row FROM recommendation_evidence t WHERE recommendation_id=$1',
          [modern.id],
        );
        for (const row of links.rows)
          await older.query(
            'INSERT INTO recommendation_evidence SELECT * FROM jsonb_populate_record(NULL::recommendation_evidence,$1::jsonb)',
            [row.row],
          );
        await older.query('COMMIT');
        const before = (
          await older.query(
            'SELECT to_jsonb(t)::text AS row FROM progression_recommendations t ORDER BY id',
          )
        ).rows;
        const evidence = (
          await older.query(
            'SELECT to_jsonb(t)::text AS row FROM recommendation_evidence t ORDER BY id',
          )
        ).rows;
        await older.query(
          await readFile(resolve(folder, migration, 'migration.sql'), 'utf8'),
        );
        expect(
          (
            await older.query(
              "SELECT (to_jsonb(t)-'review_version')::text AS row FROM progression_recommendations t ORDER BY id",
            )
          ).rows,
        ).toEqual(before);
        expect(
          (
            await older.query(
              'SELECT to_jsonb(t)::text AS row FROM recommendation_evidence t ORDER BY id',
            )
          ).rows,
        ).toEqual(evidence);
        expect(
          (
            await older.query(
              'SELECT count(*)::int AS n FROM recommendation_reviews',
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await older.query(
              'SELECT review_version FROM progression_recommendations',
            )
          ).rows.every((r) => r.review_version === null),
        ).toBe(true);
        await expect(
          older.query(
            "UPDATE progression_recommendations SET snapshot='{}' WHERE id=$1",
            [modern.id],
          ),
        ).rejects.toMatchObject({ code: '55000' });
        await expect(
          older.query(
            "UPDATE progression_recommendations SET review_version=1,status='APPROVED',reviewed_at=now() WHERE id=$1",
            [modern.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await older.end();
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.end();
        await writer.$disconnect();
      }
    });
  },
);
