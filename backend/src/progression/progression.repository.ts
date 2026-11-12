import type * as Automatic from '../models/progression/automatic-progression.model';
import type { InternalProgressionCapability } from './internal-progression-principal';
import type {
  ApplyOperation,
  ApplicationReceipt,
} from '../models/progression/recommendation-application.model';
import type {
  ReviewOperation,
  ReviewInspection,
  ReviewEvent,
  ReviewState,
} from '../models/progression/recommendation-review.model';
import type { ValidatedRecommendationCommand } from '../models/progression/recommendation-draft.model';
import type {
  PersistProposalOperation,
  PersistedRecommendation,
} from '../models/progression/persisted-recommendation.model';
import type {
  Destination,
  RecommendationContext,
} from '../models/progression/recommendation-draft.model';
import type {
  EstimateDraft,
  EstimateSource,
  StoredOneRmEstimate,
} from '../models/progression/one-rm-estimate.model';
import type {
  PerformanceHistory,
  ValidatedPerformanceQuery,
} from '../models/progression/performance-analysis.model';

export const PROGRESSION_REPOSITORY = Symbol('PROGRESSION_REPOSITORY');
export interface ProgressionRepository {
  operationalStatus(
    a: { userId: string; sessionId: string },
    id: string,
  ): Promise<Automatic.OperationalStatus>;
  mutateOperationalGrant(
    a: { userId: string; sessionId: string },
    id: string,
    action: 'ACTIVATE' | 'REVOKE',
    input:
      Automatic.ActivateOperationalInput | Automatic.RevokeOperationalInput,
  ): Promise<Automatic.OperationalCommandReceipt>;
  operationalOperation(
    a: { userId: string; sessionId: string },
    id: string,
  ): Promise<Automatic.OperationalCommandReceipt>;
  automaticHistory(
    a: { userId: string; sessionId: string },
    id: string,
    page: number,
    limit: number,
  ): Promise<{
    items: Automatic.AutomaticRunPublic[];
    page: number;
    limit: number;
    total: number;
  }>;
  automaticReceipt(
    a: { userId: string; sessionId: string },
    id: string,
  ): Promise<{ consentId: string; run: Automatic.AutomaticRunPublic }>;
  processOwnAutomatic(
    cap: InternalProgressionCapability,
    a: { userId: string; sessionId: string },
    id: string,
    intent: string,
    limit: number,
  ): Promise<Automatic.OperationalCommandReceipt>;
  processActiveAutomatic(
    cap: InternalProgressionCapability,
    limit: number,
  ): Promise<number>;

  listProgressionSettings(
    u: string,
    s: string,
    q: { page: number; limit: number },
  ): Promise<
    import('../models/progression/progression-setting.model').SettingList
  >;
  getProgressionSetting(
    u: string,
    s: string,
    id: string,
  ): Promise<
    import('../models/progression/progression-setting.model').SettingRecord
  >;
  effectiveProgressionSetting(
    u: string,
    s: string,
    c: import('../models/progression/progression-setting.model').SettingContext,
  ): Promise<
    import('../models/progression/progression-setting.model').SettingResolution
  >;
  mutateProgressionSetting(
    u: string,
    s: string,
    op: import('../models/progression/progression-setting.model').SettingOperation,
  ): Promise<
    import('../models/progression/progression-setting.model').SettingReceipt
  >;
  getSettingMutation(
    u: string,
    s: string,
    id: string,
  ): Promise<
    import('../models/progression/progression-setting.model').SettingReceipt
  >;
  progressionSettingImpact(
    u: string,
    s: string,
    id: string,
    revision: string,
    p: import('../models/progression/progression-setting.model').SettingParameters,
  ): Promise<
    import('../models/progression/progression-setting.model').SettingImpact
  >;

  issueAutomationConsentAcceptance(
    userId: string,
    sessionId: string,
    id: string,
    expectedVersion: number,
  ): Promise<
    import('../models/progression/consent-acceptance.model').ConsentAcceptanceChallenge
  >;

  listAutomationConsents(
    userId: string,
    sessionId: string,
    query: import('../models/progression/automation-consent.model').ConsentListQuery,
  ): Promise<
    import('../models/progression/automation-consent.model').ConsentListResult
  >;
  automationConsentCandidates(
    userId: string,
    sessionId: string,
    query: import('../models/progression/automation-consent.model').ConsentCandidateQuery,
  ): Promise<
    import('../models/progression/automation-consent.model').ConsentCandidates
  >;
  previewAutomationConsent(
    userId: string,
    sessionId: string,
    contract: import('../models/progression/automation-consent.model').ConsentContract,
  ): Promise<
    import('../models/progression/automation-consent.model').ConsentPreview
  >;
  automationConsentReceipt(
    userId: string,
    sessionId: string,
    intentId: string,
  ): Promise<
    import('../models/progression/automation-consent.model').ConsentReceipt
  >;

  listRecommendations(
    userId: string,
    sessionId: string,
    query: import('../models/progression/progression-http.model').RecommendationListQuery,
  ): Promise<
    import('../models/progression/progression-http.model').RecommendationListResult
  >;
  getRevalidationRequest(
    userId: string,
    sessionId: string,
    id: string,
  ): Promise<
    | import('../models/progression/progression-http.model').RevalidationRecipe
    | null
  >;
  getApplicationReceipt(
    userId: string,
    sessionId: string,
    id: string,
  ): Promise<
    | import('../models/progression/recommendation-application.model').ApplicationReceipt
    | null
  >;
  inspectApplication(
    userId: string,
    sessionId: string,
    id: string,
    operation: import('../models/progression/progression-http.model').ApplicationReadinessOperation,
  ): Promise<
    import('../models/progression/progression-http.model').ApplicationReadiness
  >;
  mutateAutomationConsent(
    userId: string,
    sessionId: string,
    operation: import('../models/progression/automation-consent.model').ConsentOperation,
  ): Promise<
    import('../models/progression/automation-consent.model').ConsentReceipt
  >;
  inspectAutomationConsent(
    userId: string,
    sessionId: string,
    id: string,
  ): Promise<
    import('../models/progression/automation-consent.model').ConsentInspection
  >;
  applyRecommendation(
    userId: string,
    sessionId: string,
    operation: ApplyOperation,
  ): Promise<ApplicationReceipt>;
  inspectRecommendation(
    userId: string,
    sessionId: string,
    id: string,
    command: ValidatedRecommendationCommand | undefined,
    inspect: (state: ReviewState) => ReviewInspection,
  ): Promise<ReviewInspection>;
  reviewRecommendation(
    userId: string,
    sessionId: string,
    operation: ReviewOperation,
  ): Promise<ReviewEvent>;
  persistRecommendation(
    userId: string,
    operation: PersistProposalOperation,
  ): Promise<PersistedRecommendation>;
  getOwnedRecommendation(
    userId: string,
    id: string,
  ): Promise<PersistedRecommendation | null>;
  // The application prepares evidence from a locked, owned source. The callback
  // receives no Prisma client, queries, or persistence operations.
  fromOwnedSource(
    userId: string,
    setId: string,
    prepare: (source: EstimateSource) => readonly EstimateDraft[],
  ): Promise<StoredOneRmEstimate[]>;
  getOwned(userId: string, id: string): Promise<StoredOneRmEstimate | null>;
  readRecommendationContext(
    userId: string,
    query: ValidatedPerformanceQuery,
    destination: Destination,
  ): Promise<RecommendationContext>;
  readHistory(
    userId: string,
    query: ValidatedPerformanceQuery,
  ): Promise<PerformanceHistory>;
}
