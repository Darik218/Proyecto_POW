import type {
  AcceptConsentCommand,
  ConsentAcceptanceEvidence,
} from './consent-acceptance.model';
import type {
  RecommendationPolicy,
  StoredProgressionSetting,
} from './recommendation-draft.model';
import type { RecommendationDraft } from './persisted-recommendation.model';
export const CONSENT_SCHEMA = 'automation-consent-contract-v1';
export type ConsentContract = Readonly<{
  schemaVersion: typeof CONSENT_SCHEMA;
  exerciseId: string;
  trainingPlanId: string | null;
  policy: RecommendationPolicy;
  historyWindowDays: number;
  limits: {
    unit: 'KG' | 'LB';
    loadMeaning: 'EXTERNAL_TOTAL';
    maximumAbsoluteIncrement: string;
    maximumPercentIncrement: string;
    maximumLoad: string;
    maximumApplicationsPerWeek: number;
    weekStartsOn: number;
  };
  selector: {
    kind: 'EXACT_PRESCRIPTION_ALLOWLIST';
    prescriptionIds: readonly string[];
    futureOnly: true;
    planState: 'DRAFT';
    versionPolicy: 'READ_CURRENT_AND_CAS';
  };
  validity: { startsAt: string; endsAt: string; timeZone: string };
  termsVersion: string;
  provenance: { source: 'INTERNAL_CONFIGURATION_REQUEST'; reference: string };
}>;
export type ConsentDestination = Readonly<{
  prescriptionId: string;
  exerciseId: string;
  planId: string;
  weekId: string;
  dayId: string;
  recordedPlanVersion: number;
}>;
export type ConsentBinding = Readonly<{
  planId: string;
  selected: StoredProgressionSetting;
  configurationKey: string;
}>;
export type ConsentSnapshot = Readonly<{
  schemaVersion: 'automation-consent-snapshot-v1';
  engine: { recommendation: string; numeric: string };
  athleteId: string;
  contract: ConsentContract;
  destinations: readonly ConsentDestination[];
  bindings: readonly ConsentBinding[];
  humanAcceptance: 'NOT_RECORDED';
  operationalAuthorization: 'NOT_AVAILABLE_IN_PROG_5C_A';
}>;
export type ConsentState =
  'PENDING_CONFIRMATION' | 'ACCEPTED_INACTIVE' | 'REVOKED';
export type ConsentAction = 'CREATE' | 'REVISE' | 'ACCEPT' | 'REVOKE';
export type RequestConsentCommand = Readonly<{
  intentId: string;
  contract: ConsentContract;
}>;
export type ReviseConsentCommand = Readonly<{
  intentId: string;
  consentId: string;
  expectedVersion: number;
  contract: ConsentContract;
}>;
export type RevokeConsentCommand = Readonly<{
  intentId: string;
  consentId: string;
  expectedVersion: number;
  reason: 'OWNER_REQUEST';
}>;
export type ConsentOperation = Readonly<{
  action: ConsentAction;
  intentId: string;
  consentId?: string;
  expectedVersion?: number;
  contract?: ConsentContract;
  reason?: 'OWNER_REQUEST';
  requestKey: string;
  acceptance?: AcceptConsentCommand;
}>;
export type ConsentReceipt = Readonly<{
  id: string;
  consentId: string;
  athleteId: string;
  actorUserId: string;
  action: ConsentAction;
  intentId: string;
  requestKey: string;
  fromVersion: number | null;
  version: number;
  fromState: ConsentState | null;
  state: ConsentState;
  contractKey: string;
  snapshot: ConsentSnapshot;
  recordedAt: Date;
  reason: string | null;
  acceptanceEvidence?: ConsentAcceptanceEvidence | null;
}>;
export type ConsentInspection = Readonly<{
  id: string;
  athleteId: string;
  exerciseId: string;
  trainingPlanId: string | null;
  state: ConsentState;
  version: number;
  contractKey: string;
  snapshot: ConsentSnapshot;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  events: readonly ConsentReceipt[];
  effectiveState: ConsentState | 'EXPIRED' | 'NOT_YET_VALID';
  currentConfiguration: 'MATCH' | 'CHANGED' | 'UNAVAILABLE';
  currentSnapshot?: ConsentSnapshot | null;
  inspectedAt: Date;
  executionAuthorized: false;
  acceptanceChallenge: FutureConsentAcceptance;
}>;
// Describes what PROG-6 must show and bind; it is not a recorded acceptance.
export type FutureConsentAcceptance = Readonly<{
  schemaVersion: 'recurring-consent-acceptance-v1';
  scope: 'RECURRING_BOUNDED';
  consentId: string;
  version: number;
  contractKey: string;
  termsVersion: string;
  humanAcceptance: 'NOT_RECORDED';
}>;
export type ConsentEvaluationInput = Readonly<{
  consent: Pick<
    ConsentInspection,
    'id' | 'athleteId' | 'version' | 'state' | 'contractKey' | 'snapshot'
  > | null;
  expectedVersion: number;
  now: Date;
  recommendation: RecommendationDraft;
  currentConfigurationKeys: readonly {
    planId: string;
    configurationKey: string;
  }[];
  destination: {
    prescriptionId: string;
    exerciseId: string;
    planId: string;
    weekId: string;
    dayId: string;
    version: number;
    state: string;
    retired: boolean;
    protected: boolean;
    load: string | null;
    unit: string | null;
    scheduledOn: string;
    timeZone: string;
  };
  cycle: {
    key: string;
    alreadyConsumed: boolean;
    applicationsInWeek: number;
    periodStart: string;
    periodEndExclusive: string;
    timeZone: string;
  };
  competingConsentIds: readonly string[];
}>;
export type ConsentEvaluation = Readonly<{
  policyEligibility: 'ELIGIBLE_UNDER_POLICY' | 'NOT_ELIGIBLE' | 'NOT_EVALUABLE';
  lifecycle:
    | 'CONSENT_REQUIRED'
    | 'CONSENT_PENDING_CONFIRMATION'
    | 'CONSENT_ACCEPTED_INACTIVE'
    | 'CONSENT_REVOKED'
    | 'CONSENT_EXPIRED'
    | 'CONSENT_NOT_YET_VALID';
  reasons: readonly string[];
  executionAuthorized: false;
}>;
export class AutomationConsentError extends Error {
  constructor(
    readonly code:
      | 'INVALID_CONSENT_COMMAND'
      | 'CONSENT_CONFIGURATION_REQUIRED'
      | 'AUTHENTICATION_REQUIRED'
      | 'SOURCE_NOT_FOUND'
      | 'STALE_CONSENT'
      | 'CONSENT_REVOKED'
      | 'CONSENT_EXPIRED'
      | 'AMBIGUOUS_AUTOMATION_CONSENT'
      | 'INTENT_REUSED'
      | 'SOURCE_BUSY'
      | 'CONSENT_CORRUPT'
      | 'ACCEPTANCE_CHALLENGE_INVALID'
      | 'CONSENT_ALREADY_ACCEPTED',
    readonly reasons: readonly string[] = [],
  ) {
    super(code);
  }
}

export type ConsentListQuery = Readonly<{
  page: number;
  limit: number;
  state?: ConsentState;
}>;
export type ConsentCandidateQuery = Readonly<{
  exerciseId: string;
  trainingPlanId?: string;
  unit: 'KG' | 'LB';
  page: number;
  limit: number;
}>;
export type ConsentCandidate = Readonly<{
  prescriptionId: string;
  exerciseId: string;
  planId: string;
  planName: string;
  weekId: string;
  weekNumber: number;
  dayId: string;
  dayName: string;
  recordedPlanVersion: number;
  load: string;
  unit: 'KG' | 'LB';
}>;
export type ConsentCandidates = Readonly<{
  items: readonly ConsentCandidate[];
  hasMore: boolean;
  page: number;
  settings: readonly {
    planId: string;
    status: string;
    scope: string | null;
    reasons: readonly string[];
    selected: StoredProgressionSetting | null;
  }[];
  tasks: readonly {
    id: string;
    performedOn: string | null;
    sessionId: string;
  }[];
  tasksTruncated: boolean;
}>;
export type ConsentListResult = Readonly<{
  items: readonly {
    id: string;
    exerciseId: string;
    exerciseName: string;
    trainingPlanId: string | null;
    planName: string | null;
    state: ConsentState;
    version: number;
    startsAt: Date;
    endsAt: Date;
    updatedAt: Date;
  }[];
  page: number;
  limit: number;
  total: number;
}>;
export type ConsentPreview = Readonly<{
  snapshot: ConsentSnapshot;
  inspectedAt: Date;
  executionAuthorized: false;
}>;
