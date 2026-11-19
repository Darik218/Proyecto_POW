import { Prisma } from '../generated/prisma/client';
import type { ValidatedRecommendationCommand } from '../models/progression/recommendation-draft.model';
import { recommendationIdentity } from '../domain/progression/recommendation-evidence.policy';
import { recommendationRequestKey } from '../domain/progression/recommendation-persistence.policy';
import { validateRecommendationCommand } from '../domain/progression/recommendation-query.policy';
import { RecommendationPersistenceError } from '../models/progression/persisted-recommendation.model';
export const REVALIDATION_REQUEST_VERSION = 'manual-revalidation-request-v1';
const key = (command: ValidatedRecommendationCommand) =>
  recommendationIdentity({
    schemaVersion: REVALIDATION_REQUEST_VERSION,
    command,
  });
export async function recordRevalidationRequest(
  tx: Prisma.TransactionClient,
  recommendationId: string,
  requestKey: string,
  command: ValidatedRecommendationCommand,
  provenance: 'HTTP_SAVE_REQUEST' | 'MATCHING_REPLAY_REQUEST',
) {
  const existing = await tx.progressionRevalidationRequest.findUnique({
    where: { recommendationId },
  });
  if (existing) return;
  const [clock] = await tx.$queryRaw<
    { at: Date }[]
  >`SELECT date_trunc('milliseconds',clock_timestamp()) AS at`;
  await tx.progressionRevalidationRequest.create({
    data: {
      recommendationId,
      requestKey,
      commandKey: key(command),
      schemaVersion: REVALIDATION_REQUEST_VERSION,
      command: command as unknown as Prisma.InputJsonValue,
      provenance,
      recordedAt: clock.at,
    },
  });
}
export function replayRequest(
  row: Prisma.ProgressionRevalidationRequestGetPayload<object>,
  requestKey: string,
  taskIds: readonly string[],
) {
  const command = validateRecommendationCommand(
    row.command as unknown as ValidatedRecommendationCommand,
  );
  if (
    row.schemaVersion !== REVALIDATION_REQUEST_VERSION ||
    row.requestKey !== requestKey ||
    row.commandKey !== key(command) ||
    recommendationRequestKey(command, taskIds) !== requestKey
  )
    throw new RecommendationPersistenceError('SNAPSHOT_INVALID');
  return {
    schemaVersion:
      REVALIDATION_REQUEST_VERSION as 'manual-revalidation-request-v1',
    command,
    recordedAt: row.recordedAt,
    provenance: row.provenance as
      'HTTP_SAVE_REQUEST' | 'MATCHING_REPLAY_REQUEST',
  };
}
