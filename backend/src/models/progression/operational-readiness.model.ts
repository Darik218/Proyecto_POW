import type {
  ConsentContract,
  ConsentEvaluation,
  ConsentEvaluationInput,
  ConsentReceipt,
  ConsentState,
} from './automation-consent.model';
export const OPERATIONAL_READINESS_VERSION =
  'operational-readiness-design-v1' as const;
/** Descriptive input only: neither an authenticated principal nor a capability. */
export type ServiceProgressionPrincipalDesign = Readonly<{
  schemaVersion: 'service-progression-principal-design-v1';
  kind: 'SERVICE_DESIGN_ONLY';
  principalId: string;
  capabilityVersion: string;
  beneficiaryAthleteId: string;
}>;
/** All observations must be loaded by an authorized, coherent repository reader.
 * No HTTP/client input is authoritative. B1 checks structural consistency only:
 * candidate coverage and recommendationId -> semanticKey/cycleSlot relationships
 * still require persistence verification; COMPLETE_INTERNAL_INPUT is not attestation.
 */
export type OperationalReadinessInput = Readonly<{
  schemaVersion: 'operational-readiness-input-v1';
  owner: { athleteId: string; userId: string };
  evaluation: ConsentEvaluationInput;
  acceptanceEvent: ConsentReceipt | null;
  expectedAcceptance: {
    consentId: string;
    acceptedVersion: number;
    eventId: string;
    contractKey: string;
    acceptanceKey: string;
  };
  principal: ServiceProgressionPrincipalDesign | null;
  selection: {
    candidatePrescriptionIds: readonly string[];
    coverage: 'COMPLETE' | 'INCOMPLETE';
    cohort: 'ACCEPTED_EXPLICIT_SET_NO_EXPANSION' | 'UNDEFINED';
  };
  cycleObservation: {
    recommendationId: string;
    semanticKey: string;
    cycleKey: string;
    cycleSlot: string | null;
    status:
      'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'BLOCKED' | 'EXPIRED';
    competingReservationIds: readonly string[];
    counterCoverage: 'COMPLETE_INTERNAL_INPUT' | 'INCOMPLETE';
  } | null;
}>;
export type OperationalReadinessBlocker =
  | 'OPERATIONAL_AUTHORIZATION_MISSING'
  | 'EXECUTOR_CAPABILITY_UNAVAILABLE'
  | 'COHORT_SELECTOR_NOT_APPROVED'
  | 'FREQUENCY_POLICY_UNAPPROVED'
  | 'TRANSACTIONAL_REVALIDATION_REQUIRED'
  | 'FULL_DESTINATION_REVALIDATION_REQUIRED'
  | 'AUTOMATIC_RECOMMENDATION_ROUTE_UNDEFINED'
  | 'RULES_NOT_SATISFIED'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_NOT_ACCEPTED'
  | 'CONSENT_REVOKED'
  | 'CONSENT_EXPIRED'
  | 'CONSENT_NOT_YET_VALID'
  | 'CONSENT_VERSION_CHANGED'
  | 'ACCEPTANCE_EVENT_REQUIRED'
  | 'ACCEPTANCE_EVENT_INVALID'
  | 'SCOPE_MISMATCH'
  | 'PRINCIPAL_DESCRIPTOR_REQUIRED'
  | 'PRINCIPAL_DESCRIPTOR_INVALID'
  | 'DESTINATION_UNAVAILABLE'
  | 'DESTINATION_AMBIGUOUS'
  | 'DESTINATION_SELECTION_INVALID'
  | 'DESTINATION_COVERAGE_INCOMPLETE'
  | 'DESTINATION_NOT_AUTHORIZED'
  | 'COHORT_UNDEFINED'
  | 'COHORT_COVERAGE_UNVERIFIED'
  | 'CYCLE_NOT_EVALUABLE'
  | 'CYCLE_CONFLICT'
  | 'CYCLE_UNRESERVED'
  | 'FREQUENCY_NOT_EVALUABLE'
  | 'RECOMMENDATION_NOT_AVAILABLE'
  | 'SOURCE_NOT_EVALUABLE';
/** A design projection of conditions, never a grant, token, database row or receipt. */
export type OperationalAuthorizationDesign = Readonly<{
  schemaVersion: 'progression-operational-authorization-design-v1';
  state: 'NOT_GRANTED_IN_B1';
  beneficiaryAthleteId: string;
  consent: {
    id: string;
    currentState: ConsentState;
    aggregateVersion: number;
    acceptanceEventVersion: number;
    acceptedVersion: number;
    acceptanceEventId: string;
    contractKey: string;
    acceptanceKey: string;
    conditionsKey: string;
  };
  engine: { recommendation: string; numeric: string };
  policy: { id: string; version: string; key: string };
  scope: {
    exerciseId: string;
    trainingPlanId: string | null;
    prescriptionIds: readonly string[];
  };
  configurationBindings: readonly {
    planId: string;
    configurationKey: string;
  }[];
  limits: ConsentContract['limits'];
  validity: ConsentContract['validity'];
  historyWindowDays: number;
  principal: ServiceProgressionPrincipalDesign;
  termsVersion: string;
  frequencyPolicy: 'NOT_APPROVED';
  cohortSelector: 'NOT_APPROVED';
  issuer: 'NOT_DEFINED';
  provenance: 'DESIGN_PROJECTION_ONLY';
  executionAuthorized: false;
}>;
export type OperationalReadiness = Readonly<{
  schemaVersion: typeof OPERATIONAL_READINESS_VERSION;
  purpose: 'INTERNAL_DESIGN_EVALUATION_ONLY';
  evaluatedAt: string | null;
  policyEligibility: ConsentEvaluation['policyEligibility'];
  policyEvaluation: ConsentEvaluation;
  acceptance: {
    status: 'MISSING' | 'INVALID' | 'BOUND_RECORDED_EVENT';
    eventId: string | null;
    acceptedVersion: number | null;
    integrity: 'REQUIRES_TRUSTED_PERSISTENCE_SOURCE';
  };
  principal: { status: 'MISSING' | 'INVALID' | 'DESIGN_ONLY' };
  blockers: readonly OperationalReadinessBlocker[];
  operationalAuthorization: 'NOT_AVAILABLE_IN_B1';
  executionAuthorized: false;
  designBinding: OperationalAuthorizationDesign | null;
}>;
