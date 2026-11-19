import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  ValidatedRecommendationCommand,
  RecommendationContext,
} from '../models/progression/recommendation-draft.model';
import type {
  ActivateOperationalInput,
  RevokeOperationalInput,
  OperationalStatus,
  OperationalCommandReceipt,
  AutomaticRunPublic,
  GrantPublic,
} from '../models/progression/automatic-progression.model';
import {
  AutomaticProgressionError as Failure,
  AUTOMATIC_PRINCIPAL,
  OPERATIONAL_TERMS,
} from '../models/progression/automatic-progression.model';
import {
  assertInternalProgressionCapability,
  type InternalProgressionCapability,
} from './internal-progression-principal';
import { activeActor, readState } from './recommendation-review.persistence';
import { retryable } from './recommendation.persistence';
import {
  ownedConsent,
  readConsentSnapshot,
  buildConsentSnapshot,
  consentNow,
} from './automation-consent.sources';
import {
  consentLifecycle,
  settingsBindingKey,
} from '../domain/progression/automation-consent.policy';
import { recommendationIdentity } from '../domain/progression/recommendation-evidence.policy';
import { compareDrafts } from '../domain/progression/recommendation.policy';
import { deriveRecommendation } from './recommendation.service';
import { replayRequest } from './revalidation-request.persistence';
import {
  target,
  fenceMutableSources,
} from './recommendation-application.persistence';
import { assertFutureTarget } from '../domain/progression/recommendation-application.policy';
import { commitAuthorizedProgressionApplication } from './commit-progression-application';
import { evaluateAutomationConsent } from '../domain/progression/automation-eligibility.policy';
import {
  automaticWeek,
  automaticIntent,
  operationalKey,
} from '../domain/progression/automatic-progression.policy';
import { resolveEffectiveSettings } from '../domain/progression/effective-settings.policy';
import { readConsentSettings } from './automation-consent.sources';
import type { ConsentSnapshot } from '../models/progression/automation-consent.model';
import type {
  FutureTargetExpectation,
  ApplicationTarget,
} from '../models/progression/recommendation-application.model';
type Tx = Prisma.TransactionClient;
export type AutomaticReader = (
  tx: Tx,
  userId: string,
  c: ValidatedRecommendationCommand,
) => Promise<RecommendationContext>;
type Grant = Prisma.ProgressionOperationalGrantGetPayload<object>;
type Actor = { userId: string; sessionId: string };
// Scheduling cursors only: authorization, exclusion and idempotency remain PostgreSQL enforced.
const scheduling = new WeakMap<
  PrismaService,
  { grant: string; candidates: Map<string, string> }
>();
function cursor(db: PrismaService) {
  let v = scheduling.get(db);
  if (!v) {
    v = { grant: '', candidates: new Map() };
    scheduling.set(db, v);
  }
  return v;
}
async function candidatesPage(
  db: PrismaService,
  tx: Tx | PrismaService,
  grantId: string,
  athleteId: string,
  exerciseId: string,
  limit: number,
) {
  const c = cursor(db),
    after = c.candidates.get(grantId) ?? '',
    where = {
      athleteId,
      exerciseId,
      status: 'PENDING' as const,
      semanticKey: { not: null },
    };
  const rows = await tx.progressionRecommendation.findMany({
    where: { ...where, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  });
  if (after && rows.length < limit)
    rows.push(
      ...(await tx.progressionRecommendation.findMany({
        where: { ...where, id: { lte: after } },
        orderBy: { id: 'asc' },
        take: limit - rows.length,
        select: { id: true },
      })),
    );
  if (rows.length) c.candidates.set(grantId, rows[rows.length - 1].id);
  if (c.candidates.size > 1024)
    c.candidates.delete(c.candidates.keys().next().value!);
  return rows;
}
async function fenceAllowlist(tx: Tx, s: ConsentSnapshot) {
  const ids = (field: 'planId' | 'weekId' | 'dayId' | 'prescriptionId') =>
    Prisma.join(
      [...new Set(s.destinations.map((d) => d[field]))]
        .sort()
        .map((id) => Prisma.sql`${id}::uuid`),
    );
  if (!s.destinations.length)
    throw new Failure('AUTOMATION_BLOCKED', ['DESTINATION_UNAVAILABLE']);
  // Parent UPDATE locks also fence FK inserts into the enumerated destination hierarchy.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM training_plans WHERE id IN (${ids('planId')}) ORDER BY id FOR UPDATE NOWAIT`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM plan_weeks WHERE id IN (${ids('weekId')}) ORDER BY id FOR UPDATE NOWAIT`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM plan_days WHERE id IN (${ids('dayId')}) ORDER BY id FOR UPDATE NOWAIT`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM plan_exercises WHERE id IN (${ids('prescriptionId')}) ORDER BY id FOR UPDATE NOWAIT`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM scheduled_activities WHERE plan_day_id IN (${ids('dayId')}) ORDER BY id FOR UPDATE NOWAIT`,
  );
}

export function grantPublic(g: Grant): GrantPublic {
  return {
    id: g.id,
    consentId: g.consentId,
    state: g.state as GrantPublic['state'],
    version: g.version,
    activatedAt: g.activatedAt.toISOString(),
    revokedAt: g.revokedAt?.toISOString() ?? null,
  };
}
export function runPublic(
  r: Prisma.ProgressionAutomaticRunGetPayload<object>,
): AutomaticRunPublic {
  return {
    id: r.id,
    grantId: r.grantId,
    recommendationId: r.recommendationId,
    result: r.result as AutomaticRunPublic['result'],
    reasons: r.reasons as string[],
    applicationId: r.applicationId,
    previousLoad: r.previousLoad?.toFixed(6) ?? null,
    appliedLoad: r.appliedLoad?.toFixed(6) ?? null,
    unit: r.unit,
    recordedAt: r.recordedAt.toISOString(),
    cycleKey: r.cycleKey,
  };
}
const eventReceipt = (
  e: Prisma.ProgressionOperationalEventGetPayload<object>,
) => e.snapshot as unknown as OperationalCommandReceipt;
async function transaction<T>(
  db: PrismaService,
  fn: (tx: Tx) => Promise<T>,
  write = true,
): Promise<T> {
  for (let n = 0; n < 5; n++) {
    try {
      return await db.$transaction(
        async (tx) => {
          if (!write) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          return fn(tx);
        },
        {
          isolationLevel: write
            ? Prisma.TransactionIsolationLevel.ReadCommitted
            : Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 20000,
        },
      );
    } catch (e) {
      if (e instanceof Error && e.message === 'AUTHENTICATION_REQUIRED')
        throw new Failure('AUTHENTICATION_REQUIRED');
      if (!write || !retryable(e)) throw e;
      if (n === 4) throw new Failure('SOURCE_BUSY');
      await new Promise((r) => setTimeout(r, 20 * 2 ** n));
    }
  }
  throw new Failure('SOURCE_BUSY');
}
async function humanFences(tx: Tx, a: Actor) {
  const owner = await activeActor(tx, a.userId, a.sessionId);
  await tx.$queryRaw`SELECT id FROM users WHERE id=${a.userId}::uuid FOR SHARE NOWAIT`;
  await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id=${a.sessionId}::uuid FOR SHARE NOWAIT`;
  await tx.$queryRaw`SELECT id FROM athletes WHERE id=${owner.athleteId}::uuid FOR UPDATE NOWAIT`;
  await activeActor(tx, a.userId, a.sessionId);
  return owner;
}
async function statusWithin(
  tx: Tx,
  a: Actor,
  consentId: string,
): Promise<OperationalStatus> {
  const owner = await activeActor(tx, a.userId, a.sessionId),
    c = await ownedConsent(tx, owner.athleteId, consentId),
    s = readConsentSnapshot(c.snapshot, c.contractKey),
    at = await consentNow(tx),
    g = await tx.progressionOperationalGrant.findUnique({
      where: { consentId },
    }),
    e = await tx.progressionAutomationConsentEvent.findFirst({
      where: { consentId, athleteId: owner.athleteId, action: 'ACCEPT' },
      orderBy: { version: 'desc' },
    });
  let state: OperationalStatus['effectiveState'] = 'INACTIVE',
    reasons: string[] = [],
    current: ConsentSnapshot | null = null;
  const life = consentLifecycle(
    c.state as 'PENDING_CONFIRMATION' | 'ACCEPTED_INACTIVE' | 'REVOKED',
    s.contract,
    at,
  );
  if (life === 'REVOKED' || g?.state === 'REVOKED') {
    state = 'REVOKED';
    reasons = ['GRANT_OR_CONSENT_REVOKED'];
  } else if (life === 'EXPIRED') {
    state = 'EXPIRED';
    reasons = ['CONSENT_EXPIRED'];
  } else if (life === 'NOT_YET_VALID') {
    state = 'NOT_YET_VALID';
    reasons = ['CONSENT_NOT_YET_VALID'];
  } else if (
    life !== 'ACCEPTED_INACTIVE' ||
    !e ||
    e.version !== c.version ||
    e.contractKey !== c.contractKey
  ) {
    state = 'CONSENT_NOT_ACCEPTED';
    reasons = ['ACCEPTANCE_EVENT_REQUIRED'];
  } else {
    try {
      current = await buildConsentSnapshot(
        tx,
        owner.athleteId,
        a.userId,
        s.contract,
        false,
      );
      const match =
        recommendationIdentity(current.engine) ===
          recommendationIdentity(s.engine) &&
        s.bindings.length === current.bindings.length &&
        s.bindings.every((b) =>
          current!.bindings.some(
            (k) =>
              k.planId === b.planId &&
              k.configurationKey === b.configurationKey,
          ),
        );
      if (!match) {
        state = 'CONFIGURATION_CHANGED';
        reasons = ['CONFIGURATION_CHANGED'];
      } else state = g?.state === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
    } catch (err) {
      state = 'UNAVAILABLE';
      reasons =
        err instanceof Error ? [err.message] : ['DESTINATION_UNAVAILABLE'];
    }
  }
  const conditionsKey = operationalKey({
    terms: OPERATIONAL_TERMS,
    consentId: c.id,
    version: c.version,
    contractKey: c.contractKey,
    acceptanceEventId: e?.id ?? null,
    current: current
      ? {
          engine: current.engine,
          destinations: current.destinations,
          bindings: current.bindings.map((b) => ({
            planId: b.planId,
            key: b.configurationKey,
          })),
        }
      : null,
  });
  return {
    consentId,
    consentVersion: c.version,
    contractKey: c.contractKey,
    acceptanceEventId: e?.id ?? null,
    activationTermsVersion: OPERATIONAL_TERMS,
    conditionsKey,
    grant: g ? grantPublic(g) : null,
    effectiveState: state,
    executionAuthorized: state === 'ACTIVE',
    reasons,
    principal: AUTOMATIC_PRINCIPAL,
  };
}
export function operationalStatus(db: PrismaService, a: Actor, id: string) {
  return transaction(db, (tx) => statusWithin(tx, a, id), false);
}
export function operationalOperation(
  db: PrismaService,
  a: Actor,
  intentId: string,
) {
  return transaction(
    db,
    async (tx) => {
      const o = await activeActor(tx, a.userId, a.sessionId),
        e = await tx.progressionOperationalEvent.findUnique({
          where: { athleteId_intentId: { athleteId: o.athleteId, intentId } },
        });
      if (!e) {
        if (
          await tx.progressionAutomaticBatch.count({
            where: { athleteId: o.athleteId, intentId },
          })
        )
          throw new Failure('SOURCE_BUSY');
        throw new Failure('SOURCE_NOT_FOUND');
      }
      return eventReceipt(e);
    },
    false,
  );
}
async function recordCommand(
  tx: Tx,
  a: Actor,
  g: Grant,
  intentId: string,
  action: OperationalCommandReceipt['action'],
  requestKey: string,
  results: readonly AutomaticRunPublic[] = [],
  at?: Date,
) {
  const recordedAt = at ?? (await consentNow(tx)),
    id = randomUUID(),
    receipt: OperationalCommandReceipt = {
      eventId: id,
      intentId,
      action,
      consentId: g.consentId,
      grant: grantPublic(g),
      results,
      recordedAt: recordedAt.toISOString(),
    };
  await tx.progressionOperationalEvent.create({
    data: {
      id,
      grantId: g.id,
      athleteId: g.athleteId,
      consentId: g.consentId,
      actorUserId: a.userId,
      actorSessionId: a.sessionId,
      intentId,
      action,
      version: g.version,
      requestKey,
      snapshot: receipt as unknown as Prisma.InputJsonValue,
      recordedAt,
    },
  });
  return receipt;
}
export function mutateOperationalGrant(
  db: PrismaService,
  a: Actor,
  id: string,
  action: 'ACTIVATE' | 'REVOKE',
  input: ActivateOperationalInput | RevokeOperationalInput,
) {
  return transaction(db, async (tx) => {
    const o = await humanFences(tx, a),
      requestKey = operationalKey({ id, action, input }),
      prior = await tx.progressionOperationalEvent.findUnique({
        where: {
          athleteId_intentId: {
            athleteId: o.athleteId,
            intentId: input.intentId,
          },
        },
      });
    if (prior) {
      if (prior.requestKey !== requestKey || prior.actorUserId !== a.userId)
        throw new Failure('INTENT_REUSED');
      return eventReceipt(prior);
    }
    await ownedConsent(tx, o.athleteId, id);
    await tx.$queryRaw`SELECT id FROM progression_automation_consents WHERE id=${id}::uuid FOR UPDATE NOWAIT`;
    let g = await tx.progressionOperationalGrant.findUnique({
      where: { consentId: id },
    });
    const at = await consentNow(tx);
    if (action === 'ACTIVATE') {
      const i = input as ActivateOperationalInput,
        st = await statusWithin(tx, a, id);
      if (g)
        throw new Failure(
          g.state === 'REVOKED' ? 'GRANT_REVOKED' : 'STALE_GRANT',
        );
      if (st.effectiveState !== 'INACTIVE')
        throw new Failure('AUTOMATION_BLOCKED', st.reasons);
      if (
        st.consentVersion !== i.expectedConsentVersion ||
        st.contractKey !== i.expectedContractKey ||
        st.acceptanceEventId !== i.acceptanceEventId ||
        st.conditionsKey !== i.conditionsKey ||
        i.activationTermsVersion !== OPERATIONAL_TERMS ||
        i.confirmActivation !== true
      )
        throw new Failure('STALE_GRANT');
      const c = await ownedConsent(tx, o.athleteId, id),
        e = await tx.progressionAutomationConsentEvent.findUniqueOrThrow({
          where: { id: i.acceptanceEventId },
        });
      g = await tx.progressionOperationalGrant.create({
        data: {
          athleteId: o.athleteId,
          consentId: id,
          acceptanceEventId: e.id,
          consentVersion: c.version,
          acceptedVersion: e.fromVersion!,
          contractKey: c.contractKey,
          principalId: AUTOMATIC_PRINCIPAL,
          state: 'ACTIVE',
          version: 1,
          actorUserId: a.userId,
          actorSessionId: a.sessionId,
          snapshot: {
            schemaVersion: 'operational-grant-snapshot-v1',
            termsVersion: OPERATIONAL_TERMS,
            conditionsKey: i.conditionsKey,
            confirmed: true,
            consent: c.snapshot,
          },
          activatedAt: at,
        },
      });
    } else {
      const i = input as RevokeOperationalInput;
      if (!g || g.id !== i.grantId) throw new Failure('SOURCE_NOT_FOUND');
      await tx.$queryRaw`SELECT id FROM progression_operational_grants WHERE id=${g.id}::uuid FOR UPDATE NOWAIT`;
      if (g.state === 'REVOKED') throw new Failure('GRANT_REVOKED');
      if (g.version !== i.expectedGrantVersion || i.confirmRevocation !== true)
        throw new Failure('STALE_GRANT');
      g = await tx.progressionOperationalGrant.update({
        where: { id: g.id },
        data: { state: 'REVOKED', version: { increment: 1 }, revokedAt: at },
      });
    }
    await activeActor(tx, a.userId, a.sessionId);
    return recordCommand(tx, a, g, input.intentId, action, requestKey, [], at);
  });
}
export function automaticHistory(
  db: PrismaService,
  a: Actor,
  id: string,
  page: number,
  limit: number,
) {
  return transaction(
    db,
    async (tx) => {
      const o = await activeActor(tx, a.userId, a.sessionId);
      await ownedConsent(tx, o.athleteId, id);
      const where = { athleteId: o.athleteId, grant: { consentId: id } },
        total = await tx.progressionAutomaticRun.count({ where }),
        rows = await tx.progressionAutomaticRun.findMany({
          where,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        });
      return { items: rows.map(runPublic), page, limit, total };
    },
    false,
  );
}
export function automaticReceipt(db: PrismaService, a: Actor, id: string) {
  return transaction(
    db,
    async (tx) => {
      const o = await activeActor(tx, a.userId, a.sessionId),
        r = await tx.progressionAutomaticRun.findFirst({
          where: {
            athleteId: o.athleteId,
            recommendationId: id,
            result: 'APPLIED',
          },
          include: { grant: true },
        });
      if (!r) throw new Failure('SOURCE_NOT_FOUND');
      return { consentId: r.grant.consentId, run: runPublic(r) };
    },
    false,
  );
}
async function selection(
  tx: Tx,
  athleteId: string,
  exerciseId: string,
  s: ConsentSnapshot,
  command: ValidatedRecommendationCommand,
  previousLoad: string,
  appliedLoad: string,
  unit: 'KG' | 'LB',
  now: Date,
) {
  const candidates: {
    target: ApplicationTarget;
    expectation: FutureTargetExpectation;
  }[] = [];
  let ambiguousActivity = false;
  for (const d of s.destinations) {
    const destination = {
        planId: d.planId,
        weekId: d.weekId,
        dayId: d.dayId,
        prescriptionId: d.prescriptionId,
      },
      t = await target(
        tx,
        athleteId,
        { destination, command: { history: { exerciseId } } },
        false,
      );
    if (!t) continue;
    if (t.activities.length > 1) {
      ambiguousActivity = true;
      continue;
    }
    if (t.activities.length !== 1) continue;
    const [w] = t.activities,
      expectation: FutureTargetExpectation = {
        destination,
        expectedPlanVersion: t.planVersion,
        activityId: w.id,
        expectedActivityVersion: w.version,
        expectedScheduledOn: w.on,
        timeZone: w.timeZone,
        previousLoad,
        appliedLoad,
        loadUnit: unit,
      };
    try {
      assertFutureTarget(t, expectation, now);
      candidates.push({ target: t, expectation });
    } catch {
      /* Invalid candidates do not authorize any fallback destination. */
    }
  }
  if (ambiguousActivity)
    throw new Failure('AUTOMATION_BLOCKED', ['DESTINATION_AMBIGUOUS']);
  if (candidates.length !== 1)
    throw new Failure('AUTOMATION_BLOCKED', [
      candidates.length ? 'DESTINATION_AMBIGUOUS' : 'DESTINATION_UNAVAILABLE',
    ]);
  return candidates[0];
}
async function processOne(
  db: PrismaService,
  cap: InternalProgressionCapability,
  grantId: string,
  recommendationId: string,
  expectedGrantVersion: number,
  read: AutomaticReader,
  actor?: Actor,
): Promise<AutomaticRunPublic> {
  assertInternalProgressionCapability(cap);
  return transaction(db, async (tx) => {
    const initial = await tx.progressionOperationalGrant.findUnique({
      where: { id: grantId },
      include: { athlete: { select: { userId: true } } },
    });
    if (!initial) throw new Failure('SOURCE_NOT_FOUND');
    const u = initial.athlete.userId;
    if (actor) {
      if (actor.userId !== u) throw new Failure('SOURCE_NOT_FOUND');
      await humanFences(tx, actor);
    } else {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${u}::uuid FOR SHARE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM athletes WHERE id=${initial.athleteId}::uuid FOR UPDATE NOWAIT`;
      if (!(await tx.user.count({ where: { id: u, status: 'ACTIVE' } })))
        throw new Failure('AUTHENTICATION_REQUIRED');
    }
    await tx.$queryRaw`SELECT id FROM progression_operational_grants WHERE id=${grantId}::uuid FOR UPDATE NOWAIT`;
    const g = await tx.progressionOperationalGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
    await tx.$queryRaw`SELECT id FROM progression_automation_consents WHERE id=${g.consentId}::uuid FOR UPDATE NOWAIT`;
    const c = await ownedConsent(tx, g.athleteId, g.consentId),
      snapshot = readConsentSnapshot(c.snapshot, c.contractKey),
      at = await consentNow(tx),
      raw = await tx.progressionRecommendation.findFirst({
        where: { id: recommendationId, athleteId: g.athleteId },
        include: { revalidationRequest: true },
      });
    if (!raw) throw new Failure('SOURCE_NOT_FOUND');
    const old = await tx.progressionAutomaticRun.findFirst({
      where: { grantId, recommendationId, result: 'APPLIED' },
    });
    if (old) return runPublic(old);
    const settings = await readConsentSettings(tx, g.athleteId),
      week = automaticWeek(
        at,
        snapshot.contract.validity.timeZone,
        snapshot.contract.limits.weekStartsOn,
      ),
      plans = await tx.trainingPlan.findMany({
        where: { id: { in: snapshot.destinations.map((d) => d.planId) } },
        select: { id: true, version: true },
      }),
      activities = await tx.scheduledActivity.findMany({
        where: { planDayId: { in: snapshot.destinations.map((d) => d.dayId) } },
        select: { id: true, version: true, status: true, scheduledOn: true },
      });
    const operationKey = operationalKey({
      grantId,
      expectedGrantVersion,
      actualGrantVersion: g.version,
      consentVersion: c.version,
      consentState: c.state,
      recommendationId,
      semanticKey: raw.semanticKey,
      cycleKey: raw.cycleKey,
      settings,
      plans,
      activities: activities.map((v) => ({
        ...v,
        scheduledOn: v.scheduledOn.toISOString().slice(0, 10),
      })),
      week: week.start,
    });
    const previous = await tx.progressionAutomaticRun.findUnique({
      where: { operationKey },
    });
    if (previous) return runPublic(previous);
    async function blocked(reasons: readonly string[]) {
      return runPublic(
        await tx.progressionAutomaticRun.create({
          data: {
            grantId,
            athleteId: g.athleteId,
            recommendationId,
            operationKey,
            result: 'BLOCKED',
            reasons: [
              ...new Set(reasons.length ? reasons : ['SOURCE_NOT_EVALUABLE']),
            ],
            cycleKey: raw!.cycleKey,
            previousLoad: raw!.previousLoad,
            appliedLoad: null,
            unit: raw!.loadUnit,
            audit: {
              schemaVersion: 'automatic-attempt-v1',
              principal: AUTOMATIC_PRINCIPAL,
              expectedGrantVersion,
              consentVersion: c.version,
              executionAuthorized: false,
            },
            recordedAt: at,
          },
        }),
      );
    }
    try {
      if (
        g.state !== 'ACTIVE' ||
        g.version !== expectedGrantVersion ||
        g.principalId !== AUTOMATIC_PRINCIPAL
      )
        throw new Failure('AUTOMATION_BLOCKED', ['GRANT_REVOKED_OR_CHANGED']);
      if (
        c.state !== 'ACCEPTED_INACTIVE' ||
        c.version !== g.consentVersion ||
        c.contractKey !== g.contractKey ||
        c.validFrom > at ||
        c.validUntil <= at
      )
        throw new Failure('AUTOMATION_BLOCKED', ['CONSENT_NOT_ACTIVE']);
      const e = await tx.progressionAutomationConsentEvent.findUnique({
        where: { id: g.acceptanceEventId },
      });
      if (
        !e ||
        e.action !== 'ACCEPT' ||
        e.consentId !== c.id ||
        e.version !== c.version ||
        e.contractKey !== c.contractKey
      )
        throw new Failure('AUTOMATION_BLOCKED', ['ACCEPTANCE_EVENT_INVALID']);
      if (
        raw.status !== 'PENDING' ||
        raw.reviewVersion !== null ||
        !raw.semanticKey ||
        !raw.cycleKey ||
        raw.cycleSlot !== raw.cycleKey ||
        !raw.snapshot ||
        !raw.revalidationRequest
      )
        throw new Failure('AUTOMATION_BLOCKED', [
          'MODERN_NEUTRAL_RECOMMENDATION_REQUIRED',
        ]);
      await fenceMutableSources(tx, g.athleteId);
      await fenceAllowlist(tx, snapshot);
      const capture =
        raw.snapshot as unknown as import('../models/progression/persisted-recommendation.model').RecommendationDraft['evidence'];
      const command = replayRequest(
        raw.revalidationRequest,
        raw.requestKey!,
        capture.source.tasks.map((t) => t.id),
      ).command;
      const state = await readState(
        tx,
        u,
        recommendationId,
        command,
        (t, cmd) => read(t, u, cmd),
        'APPLICATION',
      );
      await tx.$queryRaw`SELECT id FROM progression_recommendations WHERE id=${recommendationId}::uuid FOR UPDATE NOWAIT`;
      const [lock] = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${raw.cycleKey},0)) AS ok`;
      if (!lock.ok) throw new Failure('SOURCE_BUSY');
      const fresh = state.context
        ? deriveRecommendation(state.context, command)
        : null;
      if (
        !fresh ||
        !state.proposal.generation ||
        compareDrafts(state.proposal.generation.draft, fresh).obsolete
      )
        throw new Failure('AUTOMATION_BLOCKED', ['STALE_PROPOSAL']);
      if (fresh.decision !== 'INCREASE' || !fresh.increment)
        throw new Failure('AUTOMATION_BLOCKED', [
          'RECOMMENDATION_NOT_ELIGIBLE',
        ]);
      if (
        await tx.progressionApplication.count({
          where: {
            recommendation: {
              athleteId: g.athleteId,
              exerciseId: c.exerciseId,
            },
            cycleKey: null,
          },
        })
      )
        throw new Failure('AUTOMATION_BLOCKED', ['LEGACY_CYCLE_UNKNOWN']);
      if (
        state.cycleConflict ||
        (await tx.progressionApplication.count({
          where: { cycleKey: raw.cycleKey },
        }))
      )
        throw new Failure('AUTOMATION_BLOCKED', ['CYCLE_CONFLICT']);
      const i = fresh.increment;
      if (
        (i.unit !== 'KG' && i.unit !== 'LB') ||
        !i.currentLoad ||
        !i.proposedLoad
      )
        throw new Failure('AUTOMATION_BLOCKED', ['LOAD_NOT_EVALUABLE']);
      const chosen = await selection(
          tx,
          g.athleteId,
          c.exerciseId,
          snapshot,
          command,
          i.currentLoad,
          i.proposedLoad,
          i.unit,
          at,
        ),
        expected = chosen.expectation;
      const intended = fresh.evidence.destination;
      if (
        intended.prescriptionId !== expected.destination.prescriptionId ||
        intended.planId !== expected.destination.planId ||
        intended.planVersion !== expected.expectedPlanVersion
      )
        throw new Failure('AUTOMATION_BLOCKED', [
          'DESTINATION_VERSION_CHANGED',
        ]);
      const currentTarget = await target(
        tx,
        g.athleteId,
        { destination: expected.destination, command },
        true,
      );
      const decisive = await consentNow(tx);
      if (decisive >= c.validUntil || decisive < c.validFrom)
        throw new Failure('AUTOMATION_BLOCKED', ['CONSENT_EXPIRED']);
      const currentWeek = automaticWeek(
        decisive,
        snapshot.contract.validity.timeZone,
        snapshot.contract.limits.weekStartsOn,
      );
      const [counts] = await tx.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM progression_applications a JOIN progression_recommendations r ON r.id=a.recommendation_id WHERE r.athlete_id=${g.athleteId}::uuid AND r.exercise_id=${c.exerciseId}::uuid AND (a.effective_at AT TIME ZONE ${currentWeek.timeZone})::date>=${currentWeek.start}::date AND (a.effective_at AT TIME ZONE ${currentWeek.timeZone})::date<${currentWeek.endExclusive}::date`;
      const keys = snapshot.bindings.map((b) => {
        const resolved = resolveEffectiveSettings(
          settings,
          g.athleteId,
          c.exerciseId,
          b.planId,
          snapshot.contract.policy,
        );
        return {
          planId: b.planId,
          configurationKey:
            resolved.selected && resolved.status === 'VALID'
              ? settingsBindingKey(resolved.selected, snapshot.contract.policy)
              : '',
        };
      });
      const fit = evaluateAutomationConsent({
        consent: {
          id: c.id,
          athleteId: c.athleteId,
          version: c.version,
          state: 'ACCEPTED_INACTIVE',
          contractKey: c.contractKey,
          snapshot,
        },
        expectedVersion: g.consentVersion,
        now: decisive,
        recommendation: fresh,
        currentConfigurationKeys: keys,
        destination: {
          prescriptionId: expected.destination.prescriptionId,
          exerciseId: c.exerciseId,
          planId: expected.destination.planId,
          weekId: expected.destination.weekId,
          dayId: expected.destination.dayId,
          version: expected.expectedPlanVersion,
          state: currentTarget?.status ?? '',
          retired: currentTarget?.retired ?? true,
          protected: !!(
            currentTarget?.hasHistory || currentTarget?.hasSessions
          ),
          load: currentTarget?.load ?? null,
          unit: currentTarget?.loadUnit ?? null,
          scheduledOn: expected.expectedScheduledOn,
          timeZone: expected.timeZone,
        },
        cycle: {
          key: raw.cycleKey,
          alreadyConsumed: false,
          applicationsInWeek: counts.count,
          periodStart: currentWeek.start,
          periodEndExclusive: currentWeek.endExclusive,
          timeZone: currentWeek.timeZone,
        },
        competingConsentIds: (
          await tx.progressionAutomationConsent.findMany({
            where: {
              athleteId: g.athleteId,
              exerciseId: c.exerciseId,
              state: { not: 'REVOKED' },
              id: { not: c.id },
              validFrom: { lt: c.validUntil },
              validUntil: { gt: c.validFrom },
              snapshot: {
                path: ['contract', 'selector', 'prescriptionIds'],
                array_contains: expected.destination.prescriptionId,
              },
            },
            select: { id: true },
          })
        ).map((v) => v.id),
      });
      if (fit.policyEligibility !== 'ELIGIBLE_UNDER_POLICY')
        throw new Failure('AUTOMATION_BLOCKED', fit.reasons);
      const future = assertFutureTarget(currentTarget, expected, decisive),
        eventId = randomUUID(),
        intentId = automaticIntent(operationKey),
        audit = {
          schemaVersion: 'automatic-progression-application-v1',
          action: 'APPLY',
          fromStatus: 'PENDING',
          toStatus: 'APPLIED',
          authorization: {
            grantId: g.id,
            grantVersion: g.version,
            consentId: c.id,
            consentVersion: c.version,
            acceptedVersion: g.acceptedVersion,
            acceptanceEventId: e.id,
            contractKey: c.contractKey,
            principalId: AUTOMATIC_PRINCIPAL,
            executionEventId: eventId,
            semanticKey: raw.semanticKey,
            cycleKey: raw.cycleKey,
            dependencyKeys: fresh.dependencyKeys,
            configurationKey: keys,
            frequency: {
              ...currentWeek,
              applicationsBefore: counts.count,
              scope: 'ATHLETE_EXERCISE_ALL_ORIGINS_EFFECTIVE_AT',
            },
          },
          destination: {
            ...expected.destination,
            exerciseId: c.exerciseId,
            planVersionBefore: expected.expectedPlanVersion,
            planVersionAfter: expected.expectedPlanVersion + 1,
          },
          load: {
            previousLoad: i.currentLoad,
            appliedLoad: i.proposedLoad,
            unit: i.unit,
          },
          temporal: {
            activityId: future.witness.id,
            activityVersion: future.witness.version,
            scheduledOn: future.witness.on,
            timeZone: future.witness.timeZone,
            checkedAt: decisive.toISOString(),
            localOn: future.localOn,
            relatedActivityIds: currentTarget!.activities
              .map((v) => v.id)
              .sort(),
          },
        };
      if (actor) await activeActor(tx, actor.userId, actor.sessionId);
      const app = await commitAuthorizedProgressionApplication(
        tx,
        {
          athleteId: g.athleteId,
          exerciseId: c.exerciseId,
          ...expected.destination,
          version: expected.expectedPlanVersion,
          previousLoad: i.currentLoad,
          appliedLoad: i.proposedLoad,
          unit: i.unit,
        },
        {
          recommendationId,
          appliedLoad: i.proposedLoad,
          origin: 'AUTOMATIC',
          effectiveAt: decisive,
          athleteId: g.athleteId,
          actorUserId: null,
          reviewId: null,
          operationalGrantId: g.id,
          grantVersion: g.version,
          executorId: AUTOMATIC_PRINCIPAL,
          planExerciseId: expected.destination.prescriptionId,
          scheduledActivityId: expected.activityId,
          previousLoad: i.currentLoad,
          loadUnit: i.unit,
          intentId,
          requestKey: operationKey,
          cycleKey: raw.cycleKey,
          audit: audit as unknown as Prisma.InputJsonValue,
        },
        {
          status: 'PENDING',
          reviewVersion: null,
          semanticKey: raw.semanticKey,
          cycleKey: raw.cycleKey,
        },
      );
      return runPublic(
        await tx.progressionAutomaticRun.create({
          data: {
            id: eventId,
            grantId,
            athleteId: g.athleteId,
            recommendationId,
            operationKey,
            result: 'APPLIED',
            reasons: [],
            applicationId: app.id,
            previousLoad: i.currentLoad,
            appliedLoad: i.proposedLoad,
            unit: i.unit,
            cycleKey: raw.cycleKey,
            audit: audit as unknown as Prisma.InputJsonValue,
            recordedAt: decisive,
          },
        }),
      );
    } catch (e) {
      if (e instanceof Failure && e.code !== 'SOURCE_BUSY')
        return blocked(e.reasons.length ? e.reasons : [e.code]);
      if (
        e instanceof Error &&
        [
          'SOURCE_NOT_FOUND',
          'SNAPSHOT_INVALID',
          'INVALID_COMMAND',
          'INVALID_PERIOD',
          'APPLICATION_BLOCKED',
          'STALE_APPLICATION',
        ].includes(e.message)
      )
        return blocked('reasons' in e ? (e.reasons as string[]) : [e.message]);
      throw e;
    }
  });
}
export async function processOwnAutomatic(
  db: PrismaService,
  cap: InternalProgressionCapability,
  a: Actor,
  id: string,
  intentId: string,
  limit: number,
  read: AutomaticReader,
) {
  assertInternalProgressionCapability(cap);
  const requestKey = operationalKey({ action: 'CHECK', id, intentId });
  const prepared = await transaction(db, async (tx) => {
    const o = await humanFences(tx, a),
      prior = await tx.progressionOperationalEvent.findUnique({
        where: { athleteId_intentId: { athleteId: o.athleteId, intentId } },
      });
    if (prior) {
      if (prior.requestKey !== requestKey || prior.action !== 'CHECK')
        throw new Failure('INTENT_REUSED');
      return { receipt: eventReceipt(prior), batch: null };
    }
    await ownedConsent(tx, o.athleteId, id);
    const previous = await tx.progressionAutomaticBatch.findUnique({
      where: { athleteId_intentId: { athleteId: o.athleteId, intentId } },
    });
    if (previous) {
      if (previous.consentId !== id) throw new Failure('INTENT_REUSED');
      return { receipt: null, batch: previous };
    }
    const g = await tx.progressionOperationalGrant.findUnique({
      where: { consentId: id },
    });
    if (!g) throw new Failure('AUTOMATION_BLOCKED', ['GRANT_REQUIRED']);
    if (g.state !== 'ACTIVE') throw new Failure('GRANT_REVOKED');
    const c = await tx.progressionAutomationConsent.findUniqueOrThrow({
        where: { id },
      }),
      candidates = await candidatesPage(
        db,
        tx,
        g.id,
        o.athleteId,
        c.exerciseId,
        limit,
      );
    const batch = await tx.progressionAutomaticBatch.create({
      data: {
        athleteId: o.athleteId,
        consentId: id,
        grantId: g.id,
        grantVersion: g.version,
        actorUserId: a.userId,
        actorSessionId: a.sessionId,
        intentId,
        candidateIds: candidates.map((v) => v.id),
        createdAt: await consentNow(tx),
      },
    });
    return { receipt: null, batch };
  });
  if (prepared.receipt) return prepared.receipt;
  const b = prepared.batch!,
    results: AutomaticRunPublic[] = [];
  for (const r of b.candidateIds as string[])
    results.push(
      await processOne(db, cap, b.grantId, r, b.grantVersion, read, a),
    );
  return transaction(db, async (tx) => {
    await humanFences(tx, a);
    const prior = await tx.progressionOperationalEvent.findUnique({
      where: { athleteId_intentId: { athleteId: b.athleteId, intentId } },
    });
    if (prior) return eventReceipt(prior);
    const g = await tx.progressionOperationalGrant.findUniqueOrThrow({
      where: { id: b.grantId },
    });
    await tx.progressionAutomaticBatch.update({
      where: { id: b.id },
      data: { completedAt: await consentNow(tx) },
    });
    return recordCommand(tx, a, g, intentId, 'CHECK', requestKey, results);
  });
}
export async function processActiveAutomatic(
  db: PrismaService,
  cap: InternalProgressionCapability,
  limit: number,
  read: AutomaticReader,
) {
  assertInternalProgressionCapability(cap);
  const c = cursor(db),
    after = c.grant;
  const args = {
    where: { state: 'ACTIVE', ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: 'asc' as const },
    take: limit,
    include: { consent: { select: { exerciseId: true } } },
  };
  const grants = await db.progressionOperationalGrant.findMany(args);
  if (after && grants.length < limit)
    grants.push(
      ...(await db.progressionOperationalGrant.findMany({
        ...args,
        where: { state: 'ACTIVE', id: { lte: after } },
        take: limit - grants.length,
      })),
    );
  let attempted = 0;
  for (const g of grants) {
    c.grant = g.id;
    const candidates = await candidatesPage(
      db,
      db,
      g.id,
      g.athleteId,
      g.consent.exerciseId,
      limit - attempted,
    );
    for (const candidate of candidates) {
      try {
        await processOne(db, cap, g.id, candidate.id, g.version, read);
      } catch {
        /* One unavailable source does not stop independent candidates. */
      }
      attempted++;
    }
    if (attempted >= limit) break;
  }
  return attempted;
}
