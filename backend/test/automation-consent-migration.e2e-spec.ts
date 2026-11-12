import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../src/database/prisma.service';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { RecommendationService } from '../src/progression/recommendation.service';
import { AutomationConsentService } from '../src/progression/automation-consent.service';
import { applicationFixture } from './helpers/recommendation-application-fixtures';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated(
  'PROG-5C-A additive migration preserves the real 14-migration predecessor',
  () => {
    it('keeps exact legacy rows, preference=true and 5A/5B application audit without backfilling consent', async () => {
      const url = await progressionIsolation(),
        admin = new pg.Client({ connectionString: url }),
        name = 'pulso_prog5ca_migration_' + randomUUID().replaceAll('-', ''),
        target = new URL(url);
      target.pathname = '/' + name;
      const before = new pg.Client({ connectionString: target.toString() }),
        client = new PrismaClient({
          adapter: new PrismaPg({ connectionString: target.toString() }),
        });
      await admin.connect();
      try {
        await admin.query(`CREATE DATABASE "${name}"`);
        await before.connect();
        const dir = resolve('prisma/migrations'),
          migration = '20261111000000_pending_automation_consents';
        for (const item of (await readdir(dir, { withFileTypes: true }))
          .filter((x) => x.isDirectory() && x.name < migration)
          .map((x) => x.name)
          .sort())
          await before.query(
            await readFile(resolve(dir, item, 'migration.sql'), 'utf8'),
          );
        const db = client as unknown as PrismaService;
        await client.$connect();
        const f = await applicationFixture(db),
          repo = new PrismaProgressionRepository(db),
          applied = await new RecommendationService(
            repo,
          ).applyMyApprovedRecommendation(f.identity, f.input);
        await db.progressionSetting.update({
          where: { id: f.setting.id },
          data: { autoApplyAuthorized: true },
        });
        const tableNames = (
            await before.query(
              "SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name",
            )
          ).rows.map((r) => r.name as string),
          originals: Record<string, unknown> = {};
        for (const table of tableNames)
          originals[table] = (
            await before.query(
              `SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows;
        await before.query(
          await readFile(resolve(dir, migration, 'migration.sql'), 'utf8'),
        );
        for (const table of tableNames)
          expect(
            (
              await before.query(
                `SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          ).toEqual(originals[table]);
        expect(
          (
            await before.query(
              'SELECT count(*)::int AS count FROM progression_automation_consents',
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await before.query(
              'SELECT count(*)::int AS count FROM progression_automation_consent_events',
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await db.progressionSetting.findUniqueOrThrow({
              where: { id: f.setting.id },
            })
          ).autoApplyAuthorized,
        ).toBe(true);
        expect(
          await new RecommendationService(repo).applyMyApprovedRecommendation(
            f.identity,
            f.input,
          ),
        ).toEqual(applied);
        // The generated client includes later additive columns; historical checks above
        // still verify the exact PROG-5C-A boundary before advancing to current.
        for (const later of (await readdir(dir, { withFileTypes: true }))
          .filter((x) => x.isDirectory() && x.name > migration)
          .map((x) => x.name)
          .sort())
          await before.query(
            await readFile(resolve(dir, later, 'migration.sql'), 'utf8'),
          );
        const fresh = await automationConsentFixture(db),
          r = await new AutomationConsentService(
            repo,
          ).requestMyAutomationConsent(fresh.identity, {
            intentId: randomUUID(),
            contract: fresh.contract,
          });
        expect(r.state).toBe('PENDING_CONFIRMATION');
        expect(r.snapshot.humanAcceptance).toBe('NOT_RECORDED');
      } finally {
        await client.$disconnect();
        await before.end();
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.end();
      }
    });
  },
);
