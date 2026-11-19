import type {
  OperationalReadinessInput,
  OperationalReadiness,
  OperationalReadinessBlocker,
  OperationalAuthorizationDesign,
  ServiceProgressionPrincipalDesign,
} from '../../models/progression/operational-readiness.model';
import { OPERATIONAL_READINESS_VERSION } from '../../models/progression/operational-readiness.model';
import { evaluateAutomationConsent } from './automation-eligibility.policy';
import { consentUuid } from './automation-consent.policy';
import {
  ACCEPTANCE_ACKNOWLEDGMENTS,
  ACCEPTANCE_PRESENTATION,
} from './consent-acceptance.policy';
import { recommendationIdentity } from './recommendation-evidence.policy';
const sha = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const finiteDate = (v: unknown): v is Date =>
  v instanceof Date && Number.isFinite(v.getTime());
const text = (v: unknown) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 160;
function principalStatus(
  p: ServiceProgressionPrincipalDesign | null,
  athleteId: string,
): OperationalReadiness['principal']['status'] {
  if (!p) return 'MISSING';
  const keys = [
    'schemaVersion',
    'kind',
    'principalId',
    'capabilityVersion',
    'beneficiaryAthleteId',
  ];
  return p.schemaVersion === 'service-progression-principal-design-v1' &&
    p.kind === 'SERVICE_DESIGN_ONLY' &&
    text(p.principalId) &&
    text(p.capabilityVersion) &&
    p.beneficiaryAthleteId === athleteId &&
    Object.keys(p).length === keys.length &&
    Object.keys(p).every((k) => keys.includes(k))
    ? 'DESIGN_ONLY'
    : 'INVALID';
}
/** Checks links only. PostgreSQL's existing evidence fingerprint/immutable ledger is the authority.
 * A caller-supplied object or valid digest format does not attest a persisted human interaction. */
function acceptanceBound(i: OperationalReadinessInput): boolean {
  const c = i.evaluation.consent,
    e = i.acceptanceEvent,
    a = e?.acceptanceEvidence,
    x = i.expectedAcceptance;
  if (
    !c ||
    !e ||
    !a ||
    !x ||
    !['ACCEPTED_INACTIVE', 'REVOKED'].includes(c.state)
  )
    return false;
  return (
    e.action === 'ACCEPT' &&
    e.consentId === c.id &&
    e.athleteId === c.athleteId &&
    e.actorUserId === i.owner.userId &&
    e.fromState === 'PENDING_CONFIRMATION' &&
    e.state === 'ACCEPTED_INACTIVE' &&
    Number.isSafeInteger(e.fromVersion) &&
    e.fromVersion! >= 1 &&
    e.version === e.fromVersion! + 1 &&
    a.acceptedVersion === e.fromVersion &&
    (c.state === 'REVOKED'
      ? e.version + 1 === c.version
      : e.version === c.version) &&
    x.consentId === c.id &&
    x.acceptedVersion === a.acceptedVersion &&
    x.eventId === e.id &&
    x.contractKey === c.contractKey &&
    x.acceptanceKey === a.acceptanceKey &&
    e.contractKey === c.contractKey &&
    a.contractKey === c.contractKey &&
    recommendationIdentity(e.snapshot) === c.contractKey &&
    recommendationIdentity(c.snapshot) === c.contractKey &&
    finiteDate(e.recordedAt) &&
    e.recordedAt.getTime() <= i.evaluation.now.getTime() &&
    [e.id, e.actorUserId, e.intentId, a.challengeId, a.actorSessionId].every(
      consentUuid,
    ) &&
    [e.requestKey, a.acceptanceKey, a.conditionsKey, a.contextKey].every(sha) &&
    a.schemaVersion === 'recurring-consent-acceptance-v1' &&
    a.presentationVersion === ACCEPTANCE_PRESENTATION &&
    a.provenance === 'AUTHENTICATED_CONSENT_CONFIRMATION' &&
    a.termsVersion === c.snapshot.contract.termsVersion &&
    a.conditionsPresented === true &&
    e.reason === null &&
    !!a.acknowledgments &&
    Object.keys(a.acknowledgments).length ===
      ACCEPTANCE_ACKNOWLEDGMENTS.length &&
    ACCEPTANCE_ACKNOWLEDGMENTS.every((k) => a.acknowledgments[k] === true)
  );
}
export function evaluateOperationalReadiness(
  i: OperationalReadinessInput,
): OperationalReadiness {
  const blockers = new Set<OperationalReadinessBlocker>([
    'OPERATIONAL_AUTHORIZATION_MISSING',
    'EXECUTOR_CAPABILITY_UNAVAILABLE',
    'COHORT_SELECTOR_NOT_APPROVED',
    'FREQUENCY_POLICY_UNAPPROVED',
    'TRANSACTIONAL_REVALIDATION_REQUIRED',
    'FULL_DESTINATION_REVALIDATION_REQUIRED',
    'AUTOMATIC_RECOMMENDATION_ROUTE_UNDEFINED',
  ]);
  let policyEvaluation: OperationalReadiness['policyEvaluation'] = {
    policyEligibility: 'NOT_EVALUABLE',
    lifecycle: 'CONSENT_REQUIRED',
    reasons: ['SOURCE_NOT_EVALUABLE'],
    executionAuthorized: false,
  };
  let acceptance: OperationalReadiness['acceptance'] = {
      status: 'MISSING',
      eventId: null,
      acceptedVersion: null,
      integrity: 'REQUIRES_TRUSTED_PERSISTENCE_SOURCE',
    },
    principal: OperationalReadiness['principal'] = { status: 'MISSING' },
    designBinding: OperationalAuthorizationDesign | null = null,
    evaluatedAt: string | null = null;
  try {
    if (
      !i ||
      i.schemaVersion !== 'operational-readiness-input-v1' ||
      !i.evaluation ||
      !finiteDate(i.evaluation.now) ||
      !consentUuid(i.owner?.athleteId) ||
      !consentUuid(i.owner?.userId)
    )
      throw Error();
    evaluatedAt = i.evaluation.now.toISOString();
    policyEvaluation = evaluateAutomationConsent(i.evaluation);
    if (policyEvaluation.policyEligibility !== 'ELIGIBLE_UNDER_POLICY')
      blockers.add('RULES_NOT_SATISFIED');
    const c = i.evaluation.consent;
    if (
      c &&
      (!['PENDING_CONFIRMATION', 'ACCEPTED_INACTIVE', 'REVOKED'].includes(
        c.state,
      ) ||
        !Number.isSafeInteger(c.version) ||
        c.version < 1)
    )
      throw Error();
    if (!c) blockers.add('CONSENT_REQUIRED');
    else {
      if (
        c.athleteId !== i.owner.athleteId ||
        c.snapshot.athleteId !== i.owner.athleteId ||
        i.evaluation.recommendation.evidence.athleteId !== i.owner.athleteId
      )
        blockers.add('SCOPE_MISMATCH');
      if (c.version !== i.evaluation.expectedVersion)
        blockers.add('CONSENT_VERSION_CHANGED');
      if (c.state === 'PENDING_CONFIRMATION')
        blockers.add('CONSENT_NOT_ACCEPTED');
      if (c.state === 'REVOKED') blockers.add('CONSENT_REVOKED');
      if (policyEvaluation.lifecycle === 'CONSENT_EXPIRED')
        blockers.add('CONSENT_EXPIRED');
      if (policyEvaluation.lifecycle === 'CONSENT_NOT_YET_VALID')
        blockers.add('CONSENT_NOT_YET_VALID');
      const bound = acceptanceBound(i);
      acceptance = {
        status: bound
          ? 'BOUND_RECORDED_EVENT'
          : i.acceptanceEvent
            ? 'INVALID'
            : 'MISSING',
        eventId: bound ? i.acceptanceEvent!.id : null,
        acceptedVersion: bound
          ? i.acceptanceEvent!.acceptanceEvidence!.acceptedVersion
          : null,
        integrity: 'REQUIRES_TRUSTED_PERSISTENCE_SOURCE',
      };
      if (!bound)
        blockers.add(
          i.acceptanceEvent
            ? 'ACCEPTANCE_EVENT_INVALID'
            : 'ACCEPTANCE_EVENT_REQUIRED',
        );
    }
    principal = { status: principalStatus(i.principal, i.owner.athleteId) };
    if (principal.status !== 'DESIGN_ONLY')
      blockers.add(
        principal.status === 'MISSING'
          ? 'PRINCIPAL_DESCRIPTOR_REQUIRED'
          : 'PRINCIPAL_DESCRIPTOR_INVALID',
      );
    const selection = i.selection,
      ids = selection?.candidatePrescriptionIds;
    if (
      !Array.isArray(ids) ||
      ids.length > 1000 ||
      ids.some((x) => !consentUuid(x)) ||
      new Set(ids).size !== ids.length
    )
      blockers.add('DESTINATION_SELECTION_INVALID');
    else if (ids.length === 0) blockers.add('DESTINATION_UNAVAILABLE');
    else if (ids.length > 1) blockers.add('DESTINATION_AMBIGUOUS');
    else if (ids[0] !== i.evaluation.destination.prescriptionId)
      blockers.add('DESTINATION_NOT_AUTHORIZED');
    if (selection?.coverage !== 'COMPLETE')
      blockers.add('DESTINATION_COVERAGE_INCOMPLETE');
    const cohort = c?.snapshot.contract.policy.cohort;
    if (
      selection?.cohort !== 'ACCEPTED_EXPLICIT_SET_NO_EXPANSION' ||
      cohort?.mode !== 'EXPLICIT_TASK_SET'
    )
      blockers.add('COHORT_UNDEFINED');
    else {
      const source = i.evaluation.recommendation.evidence.source.tasks.map(
          (t) => t.id,
        ),
        accepted = cohort.taskIds;
      if (source.some((id) => !accepted.includes(id)))
        blockers.add('COHORT_UNDEFINED');
      if (
        !source.length ||
        new Set(source).size !== source.length ||
        new Set(source).size !== new Set(accepted).size ||
        accepted.some((id) => !source.includes(id))
      )
        blockers.add('COHORT_COVERAGE_UNVERIFIED');
    }
    const observed = i.cycleObservation,
      d = i.evaluation.recommendation;
    if (!observed) blockers.add('CYCLE_NOT_EVALUABLE');
    else {
      if (
        !consentUuid(observed.recommendationId) ||
        observed.semanticKey !== d.semanticKey ||
        observed.cycleKey !== i.evaluation.cycle.key ||
        !Array.isArray(observed.competingReservationIds) ||
        observed.competingReservationIds.some(
          (id) => id !== observed.recommendationId,
        ) ||
        (observed.cycleSlot !== null &&
          observed.cycleSlot !== observed.cycleKey)
      )
        blockers.add('CYCLE_CONFLICT');
      if (observed.cycleSlot === null) blockers.add('CYCLE_UNRESERVED');
      if (observed.counterCoverage !== 'COMPLETE_INTERNAL_INPUT')
        blockers.add('FREQUENCY_NOT_EVALUABLE');
      if (
        ['REJECTED', 'APPLIED', 'BLOCKED', 'EXPIRED'].includes(observed.status)
      )
        blockers.add('RECOMMENDATION_NOT_AVAILABLE');
      if (
        ![
          'PENDING',
          'APPROVED',
          'REJECTED',
          'APPLIED',
          'BLOCKED',
          'EXPIRED',
        ].includes(observed.status)
      )
        blockers.add('SOURCE_NOT_EVALUABLE');
    }
    // A projection for reviewing bindings, never a persisted or usable authorization.
    if (
      c &&
      acceptance.status === 'BOUND_RECORDED_EVENT' &&
      principal.status === 'DESIGN_ONLY' &&
      !blockers.has('SCOPE_MISMATCH')
    ) {
      const a = i.acceptanceEvent!.acceptanceEvidence!,
        s = c.snapshot;
      designBinding = {
        schemaVersion: 'progression-operational-authorization-design-v1',
        state: 'NOT_GRANTED_IN_B1',
        beneficiaryAthleteId: c.athleteId,
        consent: {
          id: c.id,
          currentState: c.state,
          aggregateVersion: c.version,
          acceptanceEventVersion: i.acceptanceEvent!.version,
          acceptedVersion: a.acceptedVersion,
          acceptanceEventId: i.acceptanceEvent!.id,
          contractKey: c.contractKey,
          acceptanceKey: a.acceptanceKey,
          conditionsKey: a.conditionsKey,
        },
        engine: structuredClone(s.engine),
        policy: {
          id: s.contract.policy.id,
          version: s.contract.policy.version,
          key: recommendationIdentity(s.contract.policy),
        },
        scope: {
          exerciseId: s.contract.exerciseId,
          trainingPlanId: s.contract.trainingPlanId,
          prescriptionIds: [...s.contract.selector.prescriptionIds],
        },
        configurationBindings: s.bindings.map((b) => ({
          planId: b.planId,
          configurationKey: b.configurationKey,
        })),
        limits: structuredClone(s.contract.limits),
        validity: structuredClone(s.contract.validity),
        historyWindowDays: s.contract.historyWindowDays,
        principal: structuredClone(i.principal!),
        termsVersion: s.contract.termsVersion,
        frequencyPolicy: 'NOT_APPROVED',
        cohortSelector: 'NOT_APPROVED',
        issuer: 'NOT_DEFINED',
        provenance: 'DESIGN_PROJECTION_ONLY',
        executionAuthorized: false,
      };
    }
  } catch {
    blockers.add('SOURCE_NOT_EVALUABLE');
    designBinding = null;
  }
  return {
    schemaVersion: OPERATIONAL_READINESS_VERSION,
    purpose: 'INTERNAL_DESIGN_EVALUATION_ONLY',
    evaluatedAt,
    policyEligibility: policyEvaluation.policyEligibility,
    policyEvaluation,
    acceptance,
    principal,
    blockers: [...blockers].sort(),
    operationalAuthorization: 'NOT_AVAILABLE_IN_B1',
    executionAuthorized: false,
    designBinding,
  };
}
