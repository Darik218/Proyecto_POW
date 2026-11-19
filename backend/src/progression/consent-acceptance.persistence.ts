import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  AcceptConsentCommand,
  ConsentAcceptanceChallenge,
  ConsentAcceptanceEvidence,
} from '../models/progression/consent-acceptance.model';
import { AutomationConsentError as Failure } from '../models/progression/automation-consent.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import { activeActor } from './recommendation-review.persistence';
import { retryable } from './recommendation.persistence';
import {
  acceptanceContext,
  ACCEPTANCE_PRESENTATION,
} from '../domain/progression/consent-acceptance.policy';
import { changedConsentConditions } from '../domain/progression/automation-consent.policy';
import {
  buildConsentSnapshot,
  ownedConsent,
  readConsentSnapshot,
  consentNow,
} from './automation-consent.sources';
type Tx = Prisma.TransactionClient;
type Row = Prisma.ProgressionAutomationConsentGetPayload<object>;
async function dependencies(tx: Tx, id: string) {
  const [v] = await tx.$queryRaw<
    { dependencies: Prisma.JsonObject; key: string }[]
  >`SELECT automation_acceptance_dependencies(c) AS dependencies,automation_acceptance_conditions_key(c.contract_key,automation_acceptance_dependencies(c)) AS key FROM progression_automation_consents c WHERE c.id=${id}::uuid`;
  return v;
}
async function currentConditions(tx: Tx, userId: string, c: Row) {
  const s = readConsentSnapshot(c.snapshot, c.contractKey);
  const current = await buildConsentSnapshot(
    tx,
    c.athleteId,
    userId,
    s.contract,
    true,
  );
  if (changedConsentConditions(s, current).length)
    throw new Failure('ACCEPTANCE_CHALLENGE_INVALID', [
      'CONDITIONS_CHANGED_REVISE_REQUEST',
    ]);
  return s;
}
export async function issueConsentAcceptanceChallenge(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  id: string,
  expectedVersion: number,
): Promise<ConsentAcceptanceChallenge> {
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
          let c = await ownedConsent(tx, actor.athleteId, id);
          await tx.$queryRaw`SELECT id FROM progression_automation_consents WHERE id=${id}::uuid FOR UPDATE NOWAIT`;
          c = await ownedConsent(tx, actor.athleteId, id);
          if (c.state === 'REVOKED') throw new Failure('CONSENT_REVOKED');
          if (c.state !== 'PENDING_CONFIRMATION')
            throw new Failure('CONSENT_ALREADY_ACCEPTED');
          if (c.version !== expectedVersion) throw new Failure('STALE_CONSENT');
          const snapshot = await currentConditions(tx, userId, c),
            d = await dependencies(tx, id),
            at = await consentNow(tx);
          if (at >= c.validUntil) throw new Failure('CONSENT_EXPIRED');
          await activeActor(tx, userId, sessionId);
          const h = await tx.progressionConsentAcceptanceChallenge.create({
            data: {
              consentId: id,
              athleteId: actor.athleteId,
              actorUserId: userId,
              actorSessionId: sessionId,
              version: c.version,
              contractKey: c.contractKey,
              conditionsKey: d.key,
              contextKey: acceptanceContext(userId, sessionId),
              termsVersion: snapshot.contract.termsVersion,
              presentationVersion: ACCEPTANCE_PRESENTATION,
              dependencies: d.dependencies,
              issuedAt: at,
              expiresAt: new Date(
                Math.min(at.getTime() + 600000, c.validUntil.getTime()),
              ),
            },
          });
          return {
            id: h.id,
            consentId: id,
            version: h.version,
            state: 'PENDING_CONFIRMATION',
            contractKey: h.contractKey,
            conditionsKey: h.conditionsKey,
            contextKey: h.contextKey,
            termsVersion: h.termsVersion,
            presentationVersion: ACCEPTANCE_PRESENTATION,
            snapshot,
            issuedAt: h.issuedAt,
            expiresAt: h.expiresAt,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15000,
        },
      );
    } catch (e) {
      if (e instanceof RecommendationReviewError)
        throw new Failure('AUTHENTICATION_REQUIRED');
      if (!retryable(e)) throw e;
      if (attempt === 4) throw new Failure('SOURCE_BUSY');
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
    }
  }
  throw new Failure('SOURCE_BUSY');
}
export async function validateConsentAcceptance(
  tx: Tx,
  userId: string,
  sessionId: string,
  c: Row,
  input: AcceptConsentCommand,
): Promise<ConsentAcceptanceEvidence> {
  const h = await tx.progressionConsentAcceptanceChallenge.findFirst({
    where: {
      id: input.challengeId,
      consentId: c.id,
      athleteId: c.athleteId,
      actorUserId: userId,
      actorSessionId: sessionId,
    },
  });
  if (
    !h ||
    input.contextKey !== acceptanceContext(userId, sessionId) ||
    h.version !== c.version ||
    h.contractKey !== c.contractKey ||
    h.contractKey !== input.contractKey ||
    h.conditionsKey !== input.conditionsKey ||
    h.contextKey !== input.contextKey ||
    h.termsVersion !== input.termsVersion ||
    h.presentationVersion !== input.presentationVersion
  )
    throw new Failure('ACCEPTANCE_CHALLENGE_INVALID');
  await currentConditions(tx, userId, c);
  const d = await dependencies(tx, c.id),
    at = await consentNow(tx);
  if (d.key !== h.conditionsKey)
    throw new Failure('ACCEPTANCE_CHALLENGE_INVALID', [
      'CURRENT_DEPENDENCIES_CHANGED',
    ]);
  if (at >= c.validUntil) throw new Failure('CONSENT_EXPIRED');
  if (at >= h.expiresAt)
    throw new Failure('ACCEPTANCE_CHALLENGE_INVALID', ['CHALLENGE_EXPIRED']);
  await activeActor(tx, userId, sessionId);
  const evidence = {
    schemaVersion: 'recurring-consent-acceptance-v1' as const,
    challengeId: h.id,
    actorSessionId: sessionId,
    acceptedVersion: c.version,
    contractKey: c.contractKey,
    conditionsKey: h.conditionsKey,
    contextKey: h.contextKey,
    termsVersion: h.termsVersion,
    presentationVersion: ACCEPTANCE_PRESENTATION,
    conditionsPresented: true as const,
    acknowledgments: input.acknowledgments,
    provenance: 'AUTHENTICATED_CONSENT_CONFIRMATION' as const,
  };
  const [key] = await tx.$queryRaw<
    { key: string }[]
  >`SELECT automation_acceptance_evidence_key(${JSON.stringify(evidence)}::jsonb) AS key`;
  return { ...evidence, acceptanceKey: key.key };
}
