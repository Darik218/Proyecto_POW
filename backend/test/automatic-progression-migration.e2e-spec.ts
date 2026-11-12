import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../src/database/prisma.service';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { AutomationConsentService } from '../src/progression/automation-consent.service';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { applicationFixture } from './helpers/recommendation-application-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated(
  'FINAL-MVP additive migration from the real eighteen-migration schema',
  () => {
    it('preserves all old rows, precise dates, decimals, null legacy metadata and accepted consent without inventing operational grants', async () => {
      const url = await progressionIsolation(),
        admin = new pg.Client({ connectionString: url }),
        name = 'pulso_automatic_migration_' + randomUUID().replaceAll('-', ''),
        target = new URL(url);
      target.pathname = '/' + name;
      const sql = new pg.Client({ connectionString: target.toString() }),
        db = new PrismaClient({
          adapter: new PrismaPg({ connectionString: target.toString() }),
        });
      await admin.connect();
      try {
        await admin.query(`CREATE DATABASE "${name}"`);
        await sql.connect();
        const dir = resolve('prisma/migrations'),
          migration = '20261112001000_operational_progression_mvp',
          previous = (await readdir(dir, { withFileTypes: true }))
            .filter((d) => d.isDirectory() && d.name < migration)
            .map((d) => d.name)
            .sort();
        expect(previous).toHaveLength(18);
        for (const item of previous)
          await sql.query(
            await readFile(resolve(dir, item, 'migration.sql'), 'utf8'),
          );
        const client = db as unknown as PrismaService,
          consents = new AutomationConsentService(
            new PrismaProgressionRepository(client),
          );
        for (const state of [
          'PENDING_CONFIRMATION',
          'ACCEPTED_INACTIVE',
          'REVOKED',
        ]) {
          const f = await automationConsentFixture(client),
            request = await consents.requestMyAutomationConsent(f.identity, {
              intentId: randomUUID(),
              contract: f.contract,
            });
          if (state === 'ACCEPTED_INACTIVE') {
            const c = await consents.challengeMyAutomationConsent(
              f.identity,
              request.consentId,
              1,
            );
            await consents.acceptMyAutomationConsent(f.identity, {
              consentId: c.consentId,
              intentId: randomUUID(),
              challengeId: c.id,
              expectedVersion: 1,
              expectedState: 'PENDING_CONFIRMATION',
              contractKey: c.contractKey,
              conditionsKey: c.conditionsKey,
              contextKey: c.contextKey,
              termsVersion: c.termsVersion,
              presentationVersion: c.presentationVersion,
              conditionsPresented: true,
              acknowledgments: {
                policy: true,
                limits: true,
                destinations: true,
                validity: true,
                revocation: true,
              },
            });
          } else if (state === 'REVOKED')
            await consents.revokeMyAutomationConsent(f.identity, {
              intentId: randomUUID(),
              consentId: request.consentId,
              expectedVersion: 1,
              reason: 'OWNER_REQUEST',
            });
        }
        const f = await applicationFixture(client);
        for (const origin of ['MANUAL', 'AUTOMATIC']) {
          const id = randomUUID();
          await sql.query(
            "INSERT INTO progression_recommendations(id,athlete_id,exercise_id,previous_load,recommended_load,justification,status,algorithm_version,effective_settings,created_at) VALUES($1,$2,$3,40.001,42.125,'pre-MVP legacy fixture','APPLIED','legacy','{\"unknownUnit\":true}','2025-01-01T12:00:00.123456Z')",
            [id, f.athleteId, f.e.id],
          );
          await sql.query(
            "INSERT INTO progression_applications(id,recommendation_id,applied_load,origin,effective_at) VALUES($1,$2,42.125,$3,'2025-01-02T12:00:00.654321Z')",
            [randomUUID(), id, origin],
          );
        }
        const tables: string[] = (
            await sql.query(
              "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
            )
          ).rows.map((r) => r.table_name as string),
          before: Record<string, unknown> = {};
        for (const table of tables)
          before[table] = (
            await sql.query(
              `SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows;
        await sql.query(
          await readFile(resolve(dir, migration, 'migration.sql'), 'utf8'),
        );
        for (const table of tables) {
          const value =
            table === 'progression_applications'
              ? "to_jsonb(t)-ARRAY['operational_grant_id','grant_version','executor_id']"
              : 'to_jsonb(t)';
          expect(
            (
              await sql.query(
                `SELECT (${value})::text AS row FROM "${table}" t ORDER BY (${value})::text`,
              )
            ).rows,
          ).toEqual(before[table]);
        }
        expect(
          (
            await sql.query(
              'SELECT operational_grant_id,grant_version,executor_id FROM progression_applications',
            )
          ).rows,
        ).toEqual([
          {
            operational_grant_id: null,
            grant_version: null,
            executor_id: null,
          },
          {
            operational_grant_id: null,
            grant_version: null,
            executor_id: null,
          },
        ]);
        for (const table of [
          'progression_operational_grants',
          'progression_operational_events',
          'progression_automatic_runs',
          'progression_automatic_batches',
        ])
          expect(
            (await sql.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]
              .n,
          ).toBe(0);
        expect(
          (
            await sql.query(
              'SELECT state FROM progression_automation_consents ORDER BY state',
            )
          ).rows.map((r) => r.state),
        ).toEqual(['ACCEPTED_INACTIVE', 'PENDING_CONFIRMATION', 'REVOKED']);
        expect(
          (
            await sql.query(
              "SELECT applied_load::text AS load,to_char(effective_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS at,athlete_id,review_id,audit FROM progression_applications ORDER BY id",
            )
          ).rows.every(
            (r) =>
              r.load === '42.125' &&
              r.at === '2025-01-02 12:00:00.654321' &&
              r.athlete_id === null &&
              r.review_id === null &&
              r.audit === null,
          ),
        ).toBe(true);
      } finally {
        await db.$disconnect();
        await sql.end();
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.end();
      }
    });
  },
);
