import { randomUUID } from 'node:crypto';
import {
  context,
  command,
} from '../../../test/helpers/recommendation-fixtures';
import { deriveRecommendation } from '../../progression/recommendation.service';
import {
  recommendationDependencyKeys,
  recommendationIdentity,
} from './recommendation-evidence.policy';
import { recommendationCycleKey } from './recommendation-persistence.policy';
import { settingsBindingKey } from './automation-consent.policy';
import { evaluateAutomationConsent } from './automation-eligibility.policy';
import type {
  ConsentEvaluationInput,
  ConsentContract,
  ConsentSnapshot,
} from '../../models/progression/automation-consent.model';
function fixture(): ConsentEvaluationInput {
  const exerciseId = randomUUID(),
    planId = randomUUID(),
    weekId = randomUUID(),
    dayId = randomUUID(),
    prescriptionId = randomUUID(),
    h = context(),
    c = command();
  h.history.exerciseId = exerciseId;
  h.history.tasks = h.history.tasks.map((t) => ({ ...t, exerciseId }));
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
  c.history.exerciseId = exerciseId;
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
    exerciseId,
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
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-02-01T00:00:00.000Z',
      timeZone: 'UTC',
    },
    termsVersion: 'test-v1',
    provenance: {
      source: 'INTERNAL_CONFIGURATION_REQUEST',
      reference: 'not-a-production-policy',
    },
  };
  const snapshot: ConsentSnapshot = {
    schemaVersion: 'automation-consent-snapshot-v1',
    engine: {
      recommendation: draft.evidence.engineVersion,
      numeric: draft.evidence.increment!.numericPolicy.version,
    },
    athleteId: 'athlete',
    contract,
    destinations: [
      {
        prescriptionId,
        exerciseId,
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
  return {
    consent: {
      id: randomUUID(),
      athleteId: 'athlete',
      version: 1,
      state: 'PENDING_CONFIRMATION',
      snapshot,
      contractKey: recommendationIdentity(snapshot),
    },
    expectedVersion: 1,
    now: new Date('2026-01-13T12:00:00Z'),
    recommendation: draft,
    currentConfigurationKeys: [
      { planId, configurationKey: binding.configurationKey },
    ],
    destination: {
      prescriptionId,
      exerciseId,
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
}
describe('PROG-5C-A pure contract fit is never execution authorization', () => {
  it('recognizes compatible evidence and keeps pending consent non-operational', () => {
    const i = fixture(),
      before = JSON.stringify(i),
      a = evaluateAutomationConsent(i);
    expect(i.recommendation.decision).toBe('INCREASE');
    expect(a).toMatchObject({
      policyEligibility: 'ELIGIBLE_UNDER_POLICY',
      lifecycle: 'CONSENT_PENDING_CONFIRMATION',
      executionAuthorized: false,
    });
    expect(evaluateAutomationConsent(i)).toEqual(a);
    expect(JSON.stringify(i)).toBe(before);
  });
  it.each(['revoked', 'expired', 'notYetValid'] as const)(
    'keeps lifecycle %s independent of mathematical fit',
    (kind) => {
      const i = fixture();
      const v =
        kind === 'revoked'
          ? { ...i, consent: { ...i.consent!, state: 'REVOKED' as const } }
          : {
              ...i,
              now: new Date(
                kind === 'expired'
                  ? '2026-02-01T00:00:00Z'
                  : '2025-12-31T00:00:00Z',
              ),
            };
      expect(evaluateAutomationConsent(v).lifecycle).toBe(
        kind === 'revoked'
          ? 'CONSENT_REVOKED'
          : kind === 'expired'
            ? 'CONSENT_EXPIRED'
            : 'CONSENT_NOT_YET_VALID',
      );
      expect(evaluateAutomationConsent(v).executionAuthorized).toBe(false);
    },
  );
  it.each([
    ['version', 'CONSENT_VERSION_CHANGED'],
    ['settings', 'CONFIGURATION_CHANGED'],
    ['foreign', 'SCOPE_MISMATCH'],
    ['differentExercise', 'SCOPE_MISMATCH'],
    ['differentTarget', 'DESTINATION_NOT_AUTHORIZED'],
    ['past', 'DESTINATION_NOT_FUTURE_EDITABLE'],
    ['protected', 'DESTINATION_NOT_FUTURE_EDITABLE'],
    ['targetVersion', 'DESTINATION_VERSION_CHANGED'],
    ['unit', 'UNIT_MISMATCH'],
    ['frequency', 'FREQUENCY_EXCEEDED'],
    ['cycle', 'CYCLE_CONFLICT'],
    ['wrongCycle', 'CYCLE_CONFLICT'],
    ['ambiguity', 'AMBIGUOUS_AUTOMATION_CONSENT'],
    ['baseline', 'LOAD_NOT_EVALUABLE'],
    ['wrongPeriod', 'FREQUENCY_PERIOD_MISMATCH'],
    ['incomplete', 'EVIDENCE_INSUFFICIENT'],
  ] as const)('explains %s without granting execution', (kind, reason) => {
    const i = structuredClone(fixture()) as any;
    if (kind === 'version') i.expectedVersion = 2;
    if (kind === 'settings') i.currentConfigurationKeys = [];
    if (kind === 'foreign') i.consent.athleteId = 'another';
    if (kind === 'differentExercise') i.destination.exerciseId = randomUUID();
    if (kind === 'differentTarget') i.destination.prescriptionId = randomUUID();
    if (kind === 'past') i.destination.scheduledOn = '2026-01-12';
    if (kind === 'protected') i.destination.protected = true;
    if (kind === 'targetVersion') i.destination.version = 2;
    if (kind === 'unit') i.destination.unit = 'LB';
    if (kind === 'frequency') i.cycle.applicationsInWeek = 1;
    if (kind === 'cycle') i.cycle.alreadyConsumed = true;
    if (kind === 'wrongCycle') i.cycle.key = 'a'.repeat(64);
    if (kind === 'ambiguity') i.competingConsentIds = [randomUUID()];
    if (kind === 'baseline') i.destination.load = '81';
    if (kind === 'wrongPeriod') {
      i.cycle.periodStart = '2026-01-19';
      i.cycle.periodEndExclusive = '2026-01-26';
    }
    if (kind === 'incomplete') i.recommendation.decision = 'INSUFFICIENT_DATA';
    expect(evaluateAutomationConsent(i)).toMatchObject({
      executionAuthorized: false,
      reasons: expect.arrayContaining([reason]),
    });
  });
  it.each(['absolute', 'percent', 'maximumLoad', 'policy'] as const)(
    'does not merge or widen a %s contract',
    (kind) => {
      const i = structuredClone(fixture()) as any;
      if (kind === 'absolute')
        i.consent.snapshot.contract.limits.maximumAbsoluteIncrement = '1';
      if (kind === 'percent')
        i.consent.snapshot.contract.limits.maximumPercentIncrement = '1';
      if (kind === 'maximumLoad')
        i.consent.snapshot.contract.limits.maximumLoad = '81';
      if (kind === 'policy') i.consent.snapshot.contract.policy.version = 'new';
      i.consent.contractKey = recommendationIdentity(i.consent.snapshot);
      const r = evaluateAutomationConsent(i);
      expect(r.reasons).toContain(
        kind === 'policy' ? 'POLICY_MISMATCH' : 'LIMIT_EXCEEDED',
      );
      expect(r.executionAuthorized).toBe(false);
    },
  );
  it.each(['settingIdentity', 'settingValues'] as const)(
    'rejects an internally consistent recommendation with unaccepted %s',
    (kind) => {
      const i = structuredClone(fixture()) as any;
      const cfg = i.recommendation.evidence.configuration;
      if (kind === 'settingIdentity') cfg.selected.id = 'unaccepted-setting';
      else cfg.selected.maxLoad = '190';
      i.recommendation.semanticKey = recommendationIdentity(
        i.recommendation.evidence,
      );
      i.recommendation.dependencyKeys = recommendationDependencyKeys(
        i.recommendation.evidence,
      );
      expect(evaluateAutomationConsent(i)).toMatchObject({
        policyEligibility: 'NOT_ELIGIBLE',
        reasons: expect.arrayContaining(['CONFIGURATION_CHANGED']),
        executionAuthorized: false,
      });
    },
  );
  it('rejects a top-level increment that differs from its hashed evidence', () => {
    const i = structuredClone(fixture()) as any;
    i.recommendation.increment = {
      ...i.recommendation.increment,
      proposedLoad: '81.000000',
    };
    expect(evaluateAutomationConsent(i).reasons).toContain(
      'RECOMMENDATION_IDENTITY_INVALID',
    );
  });
  it('does not silently adopt a new engine or numeric policy version', () => {
    const i = structuredClone(fixture()) as any;
    i.consent.snapshot.engine.numeric = 'future-numeric-v2';
    i.consent.contractKey = recommendationIdentity(i.consent.snapshot);
    expect(evaluateAutomationConsent(i).reasons).toContain(
      'POLICY_ENGINE_MISMATCH',
    );
  });
});

describe('recorded human acceptance remains non-operational', () => {
  it('reports inactive acceptance without authorizing execution', () => {
    const f = fixture();
    const accepted = {
      ...f,
      consent: { ...f.consent!, state: 'ACCEPTED_INACTIVE' as const },
    };
    const result = evaluateAutomationConsent(accepted);
    expect(result.lifecycle).toBe('CONSENT_ACCEPTED_INACTIVE');
    expect(result.executionAuthorized).toBe(false);
  });
});
