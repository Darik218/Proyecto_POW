import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../src/database/prisma.service';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
import { buildConsentSnapshot } from '../src/progression/automation-consent.sources';
import { recommendationIdentity } from '../src/domain/progression/recommendation-evidence.policy';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated(
  'PROG-6B-B additive migration from the sixteen-migration schema',
  () => {
    it('preserves pending/revised/revoked legacy audit, snapshots and dates with null acceptance fields', async () => {
      const url = await progressionIsolation(),
        admin = new pg.Client({ connectionString: url }),
        name = 'pulso_acceptance_migration_' + randomUUID().replaceAll('-', ''),
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
        const migration = '20261111002000_inactive_consent_acceptance',
          dir = resolve('prisma/migrations');
        for (const m of (await readdir(dir))
          .filter((n) => n < migration)
          .sort()) {
          if (m === 'migration_lock.toml') continue;
          await sql.query(
            await readFile(resolve(dir, m, 'migration.sql'), 'utf8'),
          );
        }
        async function legacy(revoke: boolean) {
          const f = await automationConsentFixture(
              db as unknown as PrismaService,
            ),
            snapshot = await db.$transaction((tx) =>
              buildConsentSnapshot(
                tx,
                f.athleteId,
                f.identity.account.id,
                f.contract,
                false,
              ),
            ),
            key = recommendationIdentity(snapshot),
            id = randomUUID();
          await db.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
            const [at] = await tx.$queryRaw<
              { now: Date }[]
            >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
            await tx.progressionAutomationConsent.create({
              data: {
                id,
                athleteId: f.athleteId,
                actorUserId: f.identity.account.id,
                exerciseId: f.e.id,
                trainingPlanId: f.target.plan.id,
                state: 'PENDING_CONFIRMATION',
                version: 1,
                contractKey: key,
                snapshot: snapshot as unknown as Prisma.InputJsonValue,
                validFrom: new Date(f.contract.validity.startsAt),
                validUntil: new Date(f.contract.validity.endsAt),
                createdAt: at.now,
                updatedAt: at.now,
              },
              select: { id: true },
            });
            await tx.progressionAutomationConsentEvent.create({
              data: {
                consentId: id,
                athleteId: f.athleteId,
                actorUserId: f.identity.account.id,
                action: 'CREATE',
                intentId: randomUUID(),
                requestKey: 'a'.repeat(64),
                version: 1,
                state: 'PENDING_CONFIRMATION',
                contractKey: key,
                snapshot: snapshot as unknown as Prisma.InputJsonValue,
                recordedAt: at.now,
              },
              select: { id: true },
            });
          });
          if (revoke) {
            for (const version of [2, 3])
              await db.$transaction(async (tx) => {
                await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
                const [at] = await tx.$queryRaw<
                  { now: Date }[]
                >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
                const state =
                  version === 2 ? 'PENDING_CONFIRMATION' : 'REVOKED';
                await tx.progressionAutomationConsent.updateMany({
                  where: { id, version: version - 1 },
                  data: {
                    version,
                    state,
                    updatedAt: at.now,
                    revokedAt: version === 3 ? at.now : null,
                  },
                });
                await tx.progressionAutomationConsentEvent.create({
                  data: {
                    consentId: id,
                    athleteId: f.athleteId,
                    actorUserId: f.identity.account.id,
                    action: version === 2 ? 'REVISE' : 'REVOKE',
                    intentId: randomUUID(),
                    requestKey: 'b'.repeat(64),
                    fromVersion: version - 1,
                    version,
                    fromState: 'PENDING_CONFIRMATION',
                    state,
                    contractKey: key,
                    snapshot: snapshot as unknown as Prisma.InputJsonValue,
                    recordedAt: at.now,
                    reason: version === 3 ? 'OWNER_REQUEST' : null,
                  },
                  select: { id: true },
                });
              });
          }
        }
        await legacy(false);
        await legacy(true);
        const tables = (
            await sql.query(
              "SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
            )
          ).rows.map((r) => r.name as string),
          before: Record<string, unknown> = {};
        for (const table of tables)
          before[table] = (
            await sql.query(
              `SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows;
        await sql.query(
          await readFile(resolve(dir, migration, 'migration.sql'), 'utf8'),
        );
        for (const table of tables) {
          const value =
            table === 'progression_automation_consent_events'
              ? "to_jsonb(t)-'acceptance_evidence'-'acceptance_challenge_id'"
              : 'to_jsonb(t)';
          expect(
            (
              await sql.query(
                `SELECT ${value} AS value FROM "${table}" t ORDER BY (${value})::text`,
              )
            ).rows,
          ).toEqual(before[table]);
        }
        expect(
          (
            await sql.query(
              'SELECT count(*)::int AS n FROM progression_automation_consent_events WHERE acceptance_evidence IS NOT NULL OR acceptance_challenge_id IS NOT NULL',
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await sql.query(
              'SELECT count(*)::int AS n FROM progression_consent_acceptance_challenges',
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await sql.query(
              'SELECT state FROM progression_automation_consents ORDER BY state',
            )
          ).rows.map((r) => r.state),
        ).toEqual(['PENDING_CONFIRMATION', 'REVOKED']);
      } finally {
        await db.$disconnect();
        await sql.end();
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.end();
      }
    });
  },
);
