import type { Prisma } from '../generated/prisma/client';
import { applyExactPrescriptionLoad } from '../training-plans/progression-prescription.persistence';
import { RecommendationApplicationError as Failure } from '../models/progression/recommendation-application.model';
// Explicit existing columns keep the manual contract usable by predecessor migration fixtures.
export const applicationReceiptSelect = {
  id: true,
  recommendationId: true,
  athleteId: true,
  actorUserId: true,
  reviewId: true,
  planExerciseId: true,
  scheduledActivityId: true,
  previousLoad: true,
  appliedLoad: true,
  loadUnit: true,
  intentId: true,
  requestKey: true,
  cycleKey: true,
  audit: true,
  origin: true,
  effectiveAt: true,
} as const satisfies Prisma.ProgressionApplicationSelect;
export type ApplicationReceiptRow = Prisma.ProgressionApplicationGetPayload<{
  select: typeof applicationReceiptSelect;
}>;
/** Called only after the distinct manual/operational authorizer under source fences. */
export async function commitAuthorizedProgressionApplication(
  tx: Prisma.TransactionClient,
  destination: Parameters<typeof applyExactPrescriptionLoad>[1],
  data: Prisma.ProgressionApplicationUncheckedCreateInput,
  expected: {
    status: 'APPROVED' | 'PENDING';
    reviewVersion: number | null;
    semanticKey: string;
    cycleKey: string;
  },
) {
  await applyExactPrescriptionLoad(tx, destination);
  const row = await tx.progressionApplication.create({
    data,
    select: applicationReceiptSelect,
  });
  const changed = await tx.progressionRecommendation.updateMany({
    where: {
      id: data.recommendationId,
      athleteId: destination.athleteId,
      status: expected.status,
      reviewVersion: expected.reviewVersion,
      semanticKey: expected.semanticKey,
      cycleKey: expected.cycleKey,
      cycleSlot: expected.cycleKey,
    },
    data: { status: 'APPLIED' },
  });
  if (changed.count !== 1)
    throw new Failure('STALE_APPLICATION', ['APPROVAL_OR_CYCLE_CHANGED']);
  return row;
}
