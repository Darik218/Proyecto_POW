import type {
  RecommendationCommand,
  RecommendationContext,
  ValidatedRecommendationCommand,
} from './recommendation-draft.model';
import type { deriveRecommendation } from '../../progression/recommendation.service';
import type {
  RecommendationStatus,
  EvidenceRole,
  MeasurementUnit,
} from '../../generated/prisma/client';
export type RecommendationDraft = ReturnType<typeof deriveRecommendation>;
export type DependencyKeys = RecommendationDraft['dependencyKeys'];
export type SaveProposalCommand = Readonly<{
  command: RecommendationCommand;
  expectedSemanticKey: string;
  expectedDependencyKeys: DependencyKeys;
}>;
export type RecommendationInsert = Readonly<{
  athleteId: string;
  exerciseId: string;
  previousLoad: string;
  recommendedLoad: string;
  loadUnit: MeasurementUnit;
  previousLoadKg: string;
  recommendedLoadKg: string;
  semanticKey: string;
  cycleKey: string;
  cycleSlot: string;
  requestKey: string;
  algorithmVersion: string;
  proposalKind: 'NEUTRAL_INTERNAL';
  snapshot: RecommendationDraft['evidence'];
  dependencyKeys: DependencyKeys;
  effectiveSettings: RecommendationDraft['evidence']['configuration'];
  sessionIds: readonly string[];
}>;
export type PersistedRecommendation = Readonly<{
  id: string;
  athleteId: string;
  exerciseId: string;
  status: RecommendationStatus;
  reviewVersion: number | null;
  createdAt: Date;
  reviewedAt: Date | null;
  expiresAt: Date | null;
  previousLoad: string | null;
  recommendedLoad: string;
  loadUnit: MeasurementUnit | null;
  previousLoadKg: string | null;
  recommendedLoadKg: string | null;
  generation: Readonly<{
    kind: 'NEUTRAL_INTERNAL';
    semanticKey: string;
    cycleKey: string;
    cycleSlot: string | null;
    requestKey: string;
    draft: RecommendationDraft;
  }> | null;
  evidence: readonly {
    sessionId: string;
    role: EvidenceRole;
    associatedAt: Date;
  }[];
  generationAuthorization: 'NOT_GRANTED' | 'LEGACY_UNKNOWN';
}>;
export type RecommendationPersistenceCode =
  | 'INVALID_PERSISTENCE_COMMAND'
  | 'NOT_PERSISTIBLE'
  | 'SNAPSHOT_INVALID'
  | 'IDENTITY_CONFLICT'
  | 'REQUEST_MISMATCH'
  | 'STALE_PROPOSAL'
  | 'CYCLE_CONFLICT'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_BUSY'
  | 'DECIMAL_NOT_PERSISTABLE';
export class RecommendationPersistenceError extends Error {
  constructor(
    readonly code: RecommendationPersistenceCode,
    readonly changedDependencies: readonly string[] = [],
  ) {
    super(code);
  }
}
export type PersistProposalOperation = Readonly<{
  recordContext?: true;
  command: ValidatedRecommendationCommand;
  expectedSemanticKey: string;
  expectedDependencyKeys: DependencyKeys;
  prepare: (source: RecommendationContext) => RecommendationInsert;
}>;
