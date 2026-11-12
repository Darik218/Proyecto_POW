import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../src/database/prisma.service';
import { applicationFixture } from './helpers/recommendation-application-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated(
  'SETTINGS-1 additive receipt migration from seventeen migrations',
  () => {
    it('preserves every pre-existing row, Decimal/defaults/flags/dates and old unique indexes without backfill', async () => {
      const url = await progressionIsolation(),
        admin = new pg.Client({ connectionString: url }),
        name = 'pulso_settings_migration_' + randomUUID().replaceAll('-', ''),
        target = new URL(url);
      target.pathname = '/' + name;
      const sql = new pg.Client({ connectionString: target.toString() }),
        client = new PrismaClient({
          adapter: new PrismaPg({ connectionString: target.toString() }),
        });
      await admin.connect();
      try {
        await admin.query(`CREATE DATABASE "${name}"`);
        await sql.connect();
        const dir = resolve('prisma/migrations'),
          migration = '20261112000000_progression_setting_mutations';
        for (const n of (await readdir(dir))
          .filter((n) => n < migration && n !== 'migration_lock.toml')
          .sort())
          await sql.query(
            await readFile(resolve(dir, n, 'migration.sql'), 'utf8'),
          );
        const db = client as unknown as PrismaService,
          f = await applicationFixture(db);
        await db.progressionSetting.create({
          data: {
            athleteId: f.athleteId,
            exerciseId: f.e.id,
            targetRpeMin: '0',
            targetRpeMax: '10',
            incrementAbsolute: null,
            incrementPercent: '0',
            maxIncrementPercent: '0',
            autoApplyAuthorized: true,
          },
        });
        const tables = (
            await sql.query(
              "SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
            )
          ).rows.map((r) => r.name as string),
          before: Record<string, unknown> = {};
        for (const table of tables)
          before[table] = (
            await sql.query(
              `SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows;
        const indexes = (
          await sql.query(
            "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='progression_settings' ORDER BY indexname",
          )
        ).rows;
        await sql.query(
          await readFile(resolve(dir, migration, 'migration.sql'), 'utf8'),
        );
        for (const table of tables)
          expect(
            (
              await sql.query(
                `SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          ).toEqual(before[table]);
        expect(
          (
            await sql.query(
              "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='progression_settings' ORDER BY indexname",
            )
          ).rows,
        ).toEqual(indexes);
        expect(
          (
            await sql.query(
              'SELECT count(*)::int AS n FROM progression_setting_mutations',
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await sql.query(
              'SELECT min_successful_sessions AS n FROM progression_settings WHERE exercise_id IS NOT NULL',
            )
          ).rows[0].n,
        ).toBe(3);
      } finally {
        await client.$disconnect();
        await sql.end();
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.end();
      }
    });
  },
);
