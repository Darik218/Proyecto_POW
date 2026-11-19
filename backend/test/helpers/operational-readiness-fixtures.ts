import { context, command } from './recommendation-fixtures';
import { deriveRecommendation } from '../../src/progression/recommendation.service';
import { recommendationIdentity } from '../../src/domain/progression/recommendation-evidence.policy';
import { recommendationCycleKey } from '../../src/domain/progression/recommendation-persistence.policy';
import { settingsBindingKey } from '../../src/domain/progression/automation-consent.policy';
import type {
  ConsentContract,
  ConsentSnapshot,
  ConsentEvaluationInput,
  ConsentReceipt,
} from '../../src/models/progression/automation-consent.model';
import type { OperationalReadinessInput } from '../../src/models/progression/operational-readiness.model';
export const operationalId = (n: number) =>
  `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Mutable<T> = T extends Date
  ? Date
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
export function operationalFixture(): Mutable<OperationalReadinessInput> {
  const id = operationalId,
    h = context(),
    c = command(),
    owner = { athleteId: id(1), userId: id(2) },
    planId = id(4),
    weekId = id(5),
    dayId = id(6),
    prescriptionId = id(7);
  h.history.athleteId = owner.athleteId;
  h.history.userId = owner.userId;
  h.history.exerciseId = id(3);
  h.settings[0].athleteId = owner.athleteId;
  h.history.tasks = h.history.tasks.map((t) => ({
    ...t,
    athleteId: owner.athleteId,
    exerciseId: id(3),
  }));
  h.target = {
    kind: 'PRESCRIPTION',
    taskId: null,
    planId,
    weekId,
    dayId,
    prescriptionId,
    planVersion: 0,
    planStatus: 'DRAFT',
    retired: false,
    targets: h.history.tasks[1].adjustedTargets,
  };
  c.history.exerciseId = id(3);
  c.destination = {
    kind: 'PRESCRIPTION',
    planId,
    weekId,
    dayId,
    prescriptionId,
  };
  c.expectedPlanVersion = 0;
  c.policy = {
    ...c.policy!,
    baseline: 'DESTINATION_PRESCRIPTION',
    incrementMode: 'ABSOLUTE',
  };
  const draft = deriveRecommendation(h, c),
    binding = {
      planId,
      selected: h.settings[0],
      configurationKey: settingsBindingKey(h.settings[0], c.policy),
    };
  const contract: ConsentContract = {
    schemaVersion: 'automation-consent-contract-v1',
    exerciseId: id(3),
    trainingPlanId: planId,
    policy: c.policy,
    historyWindowDays: 28,
    limits: {
      unit: 'KG',
      loadMeaning: 'EXTERNAL_TOTAL',
      maximumAbsoluteIncrement: '2.5',
      maximumPercentIncrement: '5',
      maximumLoad: '200',
      maximumApplicationsPerWeek: 1,
      weekStartsOn: 1,
    },
    selector: {
      kind: 'EXACT_PRESCRIPTION_ALLOWLIST',
      prescriptionIds: [prescriptionId],
      futureOnly: true,
      planState: 'DRAFT',
      versionPolicy: 'READ_CURRENT_AND_CAS',
    },
    validity: {
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-02-01T00:00:00Z',
      timeZone: 'UTC',
    },
    termsVersion: 'test-only-terms-v1',
    provenance: {
      source: 'INTERNAL_CONFIGURATION_REQUEST',
      reference: 'fixture-only-not-an-operational-policy',
    },
  };
  const snapshot: ConsentSnapshot = {
    schemaVersion: 'automation-consent-snapshot-v1',
    athleteId: owner.athleteId,
    engine: {
      recommendation: draft.evidence.engineVersion,
      numeric: draft.evidence.increment!.numericPolicy.version,
    },
    contract,
    destinations: [
      {
        prescriptionId,
        exerciseId: id(3),
        planId,
        weekId,
        dayId,
        recordedPlanVersion: 0,
      },
    ],
    bindings: [binding],
    humanAcceptance: 'NOT_RECORDED',
    operationalAuthorization: 'NOT_AVAILABLE_IN_PROG_5C_A',
  };
  const key = recommendationIdentity(snapshot),
    acceptanceEvent: ConsentReceipt = {
      id: id(9),
      consentId: id(8),
      athleteId: owner.athleteId,
      actorUserId: owner.userId,
      action: 'ACCEPT',
      intentId: id(20),
      requestKey: 'a'.repeat(64),
      fromVersion: 1,
      version: 2,
      fromState: 'PENDING_CONFIRMATION',
      state: 'ACCEPTED_INACTIVE',
      contractKey: key,
      snapshot: structuredClone(snapshot),
      recordedAt: new Date('2026-01-12T10:00:00Z'),
      reason: null,
      acceptanceEvidence: {
        schemaVersion: 'recurring-consent-acceptance-v1',
        challengeId: id(21),
        actorSessionId: id(22),
        acceptedVersion: 1,
        contractKey: key,
        conditionsKey: 'b'.repeat(64),
        contextKey: 'c'.repeat(64),
        termsVersion: contract.termsVersion,
        presentationVersion: 'recurring-consent-presentation-v1',
        conditionsPresented: true,
        acknowledgments: {
          policy: true,
          limits: true,
          destinations: true,
          validity: true,
          revocation: true,
        },
        provenance: 'AUTHENTICATED_CONSENT_CONFIRMATION',
        acceptanceKey: 'd'.repeat(64),
      },
    };
  const evaluation: ConsentEvaluationInput = {
    consent: {
      id: id(8),
      athleteId: owner.athleteId,
      version: 2,
      state: 'ACCEPTED_INACTIVE',
      snapshot,
      contractKey: key,
    },
    expectedVersion: 2,
    now: new Date('2026-01-13T12:00:00Z'),
    recommendation: draft,
    currentConfigurationKeys: [
      { planId, configurationKey: binding.configurationKey },
    ],
    destination: {
      prescriptionId,
      exerciseId: id(3),
      planId,
      weekId,
      dayId,
      version: 0,
      state: 'DRAFT',
      retired: false,
      protected: false,
      load: '80',
      unit: 'KG',
      scheduledOn: '2026-01-14',
      timeZone: 'UTC',
    },
    cycle: {
      key: recommendationCycleKey(draft.evidence),
      alreadyConsumed: false,
      applicationsInWeek: 0,
      periodStart: '2026-01-12',
      periodEndExclusive: '2026-01-19',
      timeZone: 'UTC',
    },
    competingConsentIds: [],
  };
  return {
    schemaVersion: 'operational-readiness-input-v1',
    owner,
    evaluation,
    acceptanceEvent,
    expectedAcceptance: {
      consentId: id(8),
      acceptedVersion: 1,
      eventId: id(9),
      contractKey: key,
      acceptanceKey: 'd'.repeat(64),
    },
    principal: {
      schemaVersion: 'service-progression-principal-design-v1',
      kind: 'SERVICE_DESIGN_ONLY',
      principalId: 'proposed-executor',
      capabilityVersion: 'not-granted-draft-v1',
      beneficiaryAthleteId: owner.athleteId,
    },
    selection: {
      candidatePrescriptionIds: [prescriptionId],
      coverage: 'COMPLETE',
      cohort: 'ACCEPTED_EXPLICIT_SET_NO_EXPANSION',
    },
    cycleObservation: {
      recommendationId: id(10),
      semanticKey: draft.semanticKey,
      cycleKey: evaluation.cycle.key,
      cycleSlot: evaluation.cycle.key,
      status: 'PENDING',
      competingReservationIds: [],
      counterCoverage: 'COMPLETE_INTERNAL_INPUT',
    },
  } as unknown as Mutable<OperationalReadinessInput>;
}
