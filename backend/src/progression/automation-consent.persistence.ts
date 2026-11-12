import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  ConsentOperation,
  ConsentContract,
  ConsentReceipt,
  ConsentSnapshot,
  ConsentInspection,
} from '../models/progression/automation-consent.model';
import { AutomationConsentError as Failure } from '../models/progression/automation-consent.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import { activeActor } from './recommendation-review.persistence';
import { retryable } from './recommendation.persistence';
import {
  consentLifecycle,
  consentChallenge,
} from '../domain/progression/automation-consent.policy';
import { recommendationIdentity } from '../domain/progression/recommendation-evidence.policy';
import { validateConsentAcceptance } from './consent-acceptance.persistence';
import {
  ownedConsent,
  readConsentSnapshot,
  buildConsentSnapshot,
  consentNow,
  consentReceipt,
} from './automation-consent.sources';
export {
  consentTargetInclude,
  configurableConsentTarget,
  readConsentSettings,
  buildConsentSnapshot,
  consentReceipt,
} from './automation-consent.sources';
type Tx = Prisma.TransactionClient;
type Row = Prisma.ProgressionAutomationConsentGetPayload<object>;
async function noOverlap(
  tx: Tx,
  athleteId: string,
  contract: ConsentContract,
  id?: string,
) {
  const overlaps = await tx.$queryRaw<
    { id: string }[]
  >`SELECT c.id FROM progression_automation_consents c WHERE c.athlete_id=${athleteId}::uuid AND c.exercise_id=${contract.exerciseId}::uuid AND c.state IN ('PENDING_CONFIRMATION','ACCEPTED_INACTIVE') AND (${id ?? null}::uuid IS NULL OR c.id<>${id ?? null}::uuid) AND tstzrange(c.valid_from,c.valid_until,'[)') && tstzrange(${contract.validity.startsAt}::timestamptz,${contract.validity.endsAt}::timestamptz,'[)') AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.snapshot->'contract'->'selector'->'prescriptionIds') p WHERE p.value=ANY(${[...contract.selector.prescriptionIds]}::text[])) LIMIT 1`;
  if (overlaps.length) throw new Failure('AMBIGUOUS_AUTOMATION_CONSENT');
}
export async function mutateAutomationConsent(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  operation: ConsentOperation,
): Promise<ConsentReceipt> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          const actor = await activeActor(tx, userId, sessionId);
          await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id=${sessionId}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM athletes WHERE id=${actor.athleteId}::uuid FOR UPDATE NOWAIT`;
          await activeActor(tx, userId, sessionId);
          const prior = await tx.progressionAutomationConsentEvent.findUnique({
            where: {
              athleteId_intentId: {
                athleteId: actor.athleteId,
                intentId: operation.intentId,
              },
            },
          });
          if (prior) {
            if (
              prior.actorUserId !== userId ||
              prior.requestKey !== operation.requestKey
            )
              throw new Failure('INTENT_REUSED');
            return consentReceipt(prior);
          }
          let current: Row | null = null;
          if (operation.action !== 'CREATE') {
            current = await ownedConsent(
              tx,
              actor.athleteId,
              operation.consentId!,
            );
            await tx.$queryRaw`SELECT id FROM progression_automation_consents WHERE id=${current.id}::uuid FOR UPDATE NOWAIT`;
            current = await ownedConsent(tx, actor.athleteId, current.id);
            if (current.state === 'REVOKED')
              throw new Failure('CONSENT_REVOKED');
            if (
              current.state === 'ACCEPTED_INACTIVE' &&
              operation.action !== 'REVOKE'
            )
              throw new Failure('CONSENT_ALREADY_ACCEPTED');
            if (current.version !== operation.expectedVersion)
              throw new Failure('STALE_CONSENT');
          }
          const at = await consentNow(tx),
            contract = operation.contract;
          let capture: ConsentSnapshot;
          let acceptanceEvidence: ConsentReceipt['acceptanceEvidence'] = null;
          if (operation.action === 'ACCEPT') {
            acceptanceEvidence = await validateConsentAcceptance(
              tx,
              userId,
              sessionId,
              current!,
              operation.acceptance!,
            );
          }
          if (operation.action === 'REVOKE' || operation.action === 'ACCEPT')
            capture = readConsentSnapshot(
              current!.snapshot,
              current!.contractKey,
            );
          else {
            if (!contract) throw new Failure('CONSENT_CONFIGURATION_REQUIRED');
            if (
              current &&
              (current.exerciseId !== contract.exerciseId ||
                current.trainingPlanId !== contract.trainingPlanId)
            )
              throw new Failure('CONSENT_CONFIGURATION_REQUIRED', [
                'NEW_SCOPE_REQUIRES_NEW_REQUEST',
              ]);
            if (new Date(contract.validity.endsAt) <= at)
              throw new Failure('CONSENT_EXPIRED');
            capture = await buildConsentSnapshot(
              tx,
              actor.athleteId,
              userId,
              contract,
              true,
            );
            await noOverlap(tx, actor.athleteId, contract, current?.id);
          }
          await activeActor(tx, userId, sessionId);
          const recordedAt = await consentNow(tx),
            version = (current?.version ?? 0) + 1,
            state =
              operation.action === 'REVOKE'
                ? 'REVOKED'
                : operation.action === 'ACCEPT'
                  ? 'ACCEPTED_INACTIVE'
                  : 'PENDING_CONFIRMATION',
            contractKey = recommendationIdentity(capture),
            c = capture.contract;
          const data = {
            state,
            version,
            contractKey,
            snapshot: capture as unknown as Prisma.InputJsonValue,
            validFrom: new Date(c.validity.startsAt),
            validUntil: new Date(c.validity.endsAt),
            updatedAt: recordedAt,
            revokedAt: state === 'REVOKED' ? recordedAt : null,
          };
          let id: string;
          if (!current) {
            const row = await tx.progressionAutomationConsent.create({
              data: {
                ...data,
                athleteId: actor.athleteId,
                actorUserId: userId,
                exerciseId: c.exerciseId,
                trainingPlanId: c.trainingPlanId,
                createdAt: recordedAt,
              },
            });
            id = row.id;
          } else {
            id = current.id;
            const changed = await tx.progressionAutomationConsent.updateMany({
              where: {
                id,
                athleteId: actor.athleteId,
                state: current.state,
                version: operation.expectedVersion,
              },
              data,
            });
            if (changed.count !== 1) throw new Failure('STALE_CONSENT');
          }
          return consentReceipt(
            await tx.progressionAutomationConsentEvent.create({
              data: {
                consentId: id,
                athleteId: actor.athleteId,
                actorUserId: userId,
                action: operation.action,
                intentId: operation.intentId,
                requestKey: operation.requestKey,
                fromVersion: current?.version ?? null,
                version,
                fromState: current?.state ?? null,
                state,
                contractKey,
                snapshot: data.snapshot,
                recordedAt,
                reason: operation.reason ?? null,
                acceptanceChallengeId:
                  operation.acceptance?.challengeId ?? null,
                acceptanceEvidence: acceptanceEvidence
                  ? (acceptanceEvidence as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              },
            }),
          );
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (error instanceof RecommendationReviewError)
        throw new Failure('AUTHENTICATION_REQUIRED');
      if (!retryable(error)) throw error;
      if (attempt === 4) throw new Failure('SOURCE_BUSY');
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
    }
  }
  throw new Failure('SOURCE_BUSY');
}
export async function inspectAutomationConsent(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  id: string,
): Promise<ConsentInspection> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        const actor = await activeActor(tx, userId, sessionId),
          row = await ownedConsent(tx, actor.athleteId, id),
          s = readConsentSnapshot(row.snapshot, row.contractKey),
          at = await consentNow(tx);
        let currentSnapshot: ConsentSnapshot | null = null;
        let currentConfiguration: ConsentInspection['currentConfiguration'] =
          'UNAVAILABLE';
        try {
          const current = await buildConsentSnapshot(
            tx,
            actor.athleteId,
            userId,
            s.contract,
            false,
          );
          currentSnapshot = current;
          currentConfiguration =
            recommendationIdentity(s.engine) ===
              recommendationIdentity(current.engine) &&
            s.bindings.length === current.bindings.length &&
            s.bindings.every((b) =>
              current.bindings.some(
                (k) =>
                  k.planId === b.planId &&
                  k.configurationKey === b.configurationKey,
              ),
            )
              ? 'MATCH'
              : 'CHANGED';
        } catch (error) {
          if (!(error instanceof Failure)) throw error;
        }
        const events = await tx.progressionAutomationConsentEvent.findMany({
          where: { consentId: id, athleteId: actor.athleteId },
          orderBy: { version: 'asc' },
        });
        if (
          events.length !== row.version ||
          events.at(-1)?.contractKey !== row.contractKey
        )
          throw new Failure('CONSENT_CORRUPT');
        return {
          id: row.id,
          athleteId: row.athleteId,
          exerciseId: row.exerciseId,
          trainingPlanId: row.trainingPlanId,
          state: row.state as ConsentInspection['state'],
          version: row.version,
          contractKey: row.contractKey,
          snapshot: s,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          revokedAt: row.revokedAt,
          events: events.map(consentReceipt),
          effectiveState: consentLifecycle(
            row.state as ConsentInspection['state'],
            s.contract,
            at,
          ),
          currentConfiguration,
          currentSnapshot,
          inspectedAt: at,
          executionAuthorized: false,
          acceptanceChallenge: consentChallenge(
            id,
            row.version,
            row.contractKey,
            s.contract,
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof RecommendationReviewError)
      throw new Failure('AUTHENTICATION_REQUIRED');
    throw error;
  }
}
