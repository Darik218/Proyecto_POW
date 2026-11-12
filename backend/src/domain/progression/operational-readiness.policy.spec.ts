import {
  operationalFixture,
  operationalId,
} from '../../../test/helpers/operational-readiness-fixtures';
import { evaluateOperationalReadiness } from './operational-readiness.policy';
import { recommendationIdentity } from './recommendation-evidence.policy';
function evaluate(i = operationalFixture()) {
  const r = evaluateOperationalReadiness(i);
  expect(r.executionAuthorized).toBe(false);
  expect(r.operationalAuthorization).toBe('NOT_AVAILABLE_IN_B1');
  expect(r.blockers).toContain('OPERATIONAL_AUTHORIZATION_MISSING');
  return r;
}
describe('PROG-5C-B1 design-only operational preconditions', () => {
  it('keeps compatible mathematical rules, recorded acceptance and execution authority independent', () => {
    const i = operationalFixture(),
      r = evaluate(i);
    expect(r.policyEligibility).toBe('ELIGIBLE_UNDER_POLICY');
    expect(r.acceptance.status).toBe('BOUND_RECORDED_EVENT');
    expect(r.acceptance.acceptedVersion).toBe(1);
    expect(i.evaluation.consent!.version).toBe(2);
    expect(r.blockers).toEqual(
      expect.arrayContaining([
        'EXECUTOR_CAPABILITY_UNAVAILABLE',
        'FREQUENCY_POLICY_UNAPPROVED',
        'COHORT_SELECTOR_NOT_APPROVED',
        'TRANSACTIONAL_REVALIDATION_REQUIRED',
        'FULL_DESTINATION_REVALIDATION_REQUIRED',
      ]),
    );
    expect(r.designBinding?.state).toBe('NOT_GRANTED_IN_B1');
  });
  it('is deterministic and leaves all inputs and historical snapshots unchanged', () => {
    const i = operationalFixture(),
      before = JSON.stringify(i),
      a = evaluate(i);
    expect(evaluate(i)).toEqual(a);
    expect(JSON.stringify(i)).toBe(before);
    expect(i.evaluation.consent!.snapshot.humanAcceptance).toBe('NOT_RECORDED');
  });
  it.each(['PENDING_CONFIRMATION', 'REVOKED'] as const)(
    'never treats lifecycle %s as permission',
    (state) => {
      const i = operationalFixture();
      i.evaluation = {
        ...i.evaluation,
        consent: {
          ...i.evaluation.consent!,
          state,
          version: state === 'REVOKED' ? 3 : 1,
        },
        expectedVersion: state === 'REVOKED' ? 3 : 1,
      };
      const r = evaluate(i);
      expect(r.blockers).toContain(
        state === 'REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_NOT_ACCEPTED',
      );
    },
  );
  it('retains recorded historical acceptance after revocation while blocking further operation', () => {
    const i = operationalFixture();
    i.evaluation = {
      ...i.evaluation,
      consent: { ...i.evaluation.consent!, state: 'REVOKED', version: 3 },
      expectedVersion: 3,
    };
    expect(evaluate(i).acceptance.status).toBe('BOUND_RECORDED_EVENT');
    expect(evaluate(i).blockers).toContain('CONSENT_REVOKED');
  });
  it.each(['expired', 'future'] as const)(
    'checks half-open consent validity %s',
    (kind) => {
      const i = operationalFixture();
      i.evaluation = {
        ...i.evaluation,
        now: new Date(
          kind === 'expired'
            ? '2026-02-01T00:00:00Z'
            : '2025-12-31T23:59:59.999Z',
        ),
      };
      expect(evaluate(i).blockers).toContain(
        kind === 'expired' ? 'CONSENT_EXPIRED' : 'CONSENT_NOT_YET_VALID',
      );
    },
  );
  it.each([
    'missing',
    'wrongVersion',
    'wrongKey',
    'wrongActor',
    'wrongEvent',
    'badAcknowledgment',
    'futureEvent',
  ] as const)('rejects acceptance evidence %s', (kind) => {
    const i = operationalFixture();
    if (kind === 'missing') i.acceptanceEvent = null;
    else if (kind === 'wrongEvent')
      i.acceptanceEvent = { ...i.acceptanceEvent!, action: 'CREATE' };
    else if (kind === 'wrongActor')
      i.acceptanceEvent = {
        ...i.acceptanceEvent!,
        actorUserId: operationalId(100),
      };
    else if (kind === 'futureEvent')
      i.acceptanceEvent = {
        ...i.acceptanceEvent!,
        recordedAt: new Date('2027-01-01T00:00:00Z'),
      };
    else
      i.acceptanceEvent = {
        ...i.acceptanceEvent!,
        acceptanceEvidence: {
          ...i.acceptanceEvent!.acceptanceEvidence!,
          ...(kind === 'wrongVersion'
            ? { acceptedVersion: 2 }
            : kind === 'wrongKey'
              ? { contractKey: 'f'.repeat(64) }
              : {
                  acknowledgments: {
                    ...i.acceptanceEvent!.acceptanceEvidence!.acknowledgments,
                    limits: false as unknown as true,
                  },
                }),
        },
      };
    const r = evaluate(i);
    expect(r.acceptance.status).not.toBe('BOUND_RECORDED_EVENT');
    expect(r.blockers).toContain(
      kind === 'missing'
        ? 'ACCEPTANCE_EVENT_REQUIRED'
        : 'ACCEPTANCE_EVENT_INVALID',
    );
  });
  it('checks expected acceptance identity and aggregate version separately', () => {
    const i = operationalFixture();
    i.expectedAcceptance = { ...i.expectedAcceptance, acceptedVersion: 2 };
    expect(evaluate(i).blockers).toContain('ACCEPTANCE_EVENT_INVALID');
    const j = operationalFixture();
    j.evaluation = { ...j.evaluation, expectedVersion: 1 };
    expect(evaluate(j).blockers).toContain('CONSENT_VERSION_CHANGED');
  });
  it('requires matching owner instead of trusting a beneficiary or descriptor', () => {
    const i = operationalFixture();
    i.owner = { ...i.owner, athleteId: operationalId(90) };
    expect(evaluate(i).blockers).toContain('SCOPE_MISMATCH');
  });
  it.each([
    'configuration',
    'policy',
    'exercise',
    'plan',
    'allowlist',
    'unit',
    'limit',
    'load',
    'frequency',
    'cycle',
  ] as const)('reuses consent policy checks for %s', (kind) => {
    const i = operationalFixture();
    const q = i.evaluation;
    if (kind === 'configuration') q.currentConfigurationKeys = [];
    if (kind === 'policy')
      q.consent!.snapshot.contract.policy = {
        ...q.consent!.snapshot.contract.policy,
        version: 'changed',
      };
    if (kind === 'exercise')
      q.destination = { ...q.destination, exerciseId: operationalId(99) };
    if (kind === 'plan')
      q.destination = { ...q.destination, planId: operationalId(99) };
    if (kind === 'allowlist')
      q.destination = { ...q.destination, prescriptionId: operationalId(99) };
    if (kind === 'unit') q.destination = { ...q.destination, unit: 'LB' };
    if (kind === 'limit' || kind === 'load') {
      q.consent!.snapshot.contract.limits = {
        ...q.consent!.snapshot.contract.limits,
        ...(kind === 'limit'
          ? { maximumAbsoluteIncrement: '1' }
          : { maximumLoad: '81' }),
      };
      q.consent = {
        ...q.consent!,
        contractKey: recommendationIdentity(q.consent!.snapshot),
      };
    }
    if (kind === 'frequency') q.cycle = { ...q.cycle, applicationsInWeek: 1 };
    if (kind === 'cycle') q.cycle = { ...q.cycle, alreadyConsumed: true };
    const r = evaluate(i);
    expect(r.policyEligibility).not.toBe('ELIGIBLE_UNDER_POLICY');
  });
  it.each(['missing', 'wrongBeneficiary', 'human', 'enabled'] as const)(
    'cannot turn principal %s into a capability',
    (kind) => {
      const i = operationalFixture();
      if (kind === 'missing') i.principal = null;
      else if (kind === 'wrongBeneficiary')
        i.principal = {
          ...i.principal!,
          beneficiaryAthleteId: operationalId(88),
        };
      else if (kind === 'human')
        i.principal = { ...i.principal!, kind: 'HUMAN' as never };
      else i.principal = { ...i.principal!, enabled: true } as never;
      expect(evaluate(i).principal.status).toBe(
        kind === 'missing' ? 'MISSING' : 'INVALID',
      );
    },
  );
  it.each(['empty', 'multiple', 'duplicate', 'incomplete', 'outside'] as const)(
    'does not select a destination for %s candidates',
    (kind) => {
      const i = operationalFixture(),
        p = i.evaluation.destination.prescriptionId;
      i.selection = {
        ...i.selection,
        candidatePrescriptionIds:
          kind === 'empty'
            ? []
            : kind === 'multiple'
              ? [p, operationalId(99)]
              : kind === 'duplicate'
                ? [p, p]
                : kind === 'outside'
                  ? [operationalId(99)]
                  : [p],
        coverage: kind === 'incomplete' ? 'INCOMPLETE' : 'COMPLETE',
      };
      expect(evaluate(i).blockers).toContain(
        kind === 'empty'
          ? 'DESTINATION_UNAVAILABLE'
          : kind === 'multiple'
            ? 'DESTINATION_AMBIGUOUS'
            : kind === 'duplicate'
              ? 'DESTINATION_SELECTION_INVALID'
              : kind === 'outside'
                ? 'DESTINATION_NOT_AUTHORIZED'
                : 'DESTINATION_COVERAGE_INCOMPLETE',
      );
    },
  );
  it('does not authorize cohort expansion or reinterpret a history maximum as a selector', () => {
    const i = operationalFixture();
    i.selection = { ...i.selection, cohort: 'UNDEFINED' };
    expect(evaluate(i).blockers).toContain('COHORT_UNDEFINED');
    expect(evaluate(i).blockers).toContain('COHORT_SELECTOR_NOT_APPROVED');
  });
  it('does not call a subset complete evidence', () => {
    const i = operationalFixture();
    i.evaluation.recommendation.evidence.source.tasks =
      i.evaluation.recommendation.evidence.source.tasks.slice(0, 1);
    expect(evaluate(i).blockers).toContain('COHORT_COVERAGE_UNVERIFIED');
  });
  it.each(['competing', 'unreserved', 'legacy', 'counterUnknown'] as const)(
    'separates own cycle reservation from %s',
    (kind) => {
      const i = operationalFixture();
      if (kind === 'legacy') i.cycleObservation = null;
      else if (kind === 'competing')
        i.cycleObservation = {
          ...i.cycleObservation!,
          competingReservationIds: [operationalId(99)],
        };
      else if (kind === 'unreserved')
        i.cycleObservation = { ...i.cycleObservation!, cycleSlot: null };
      else
        i.cycleObservation = {
          ...i.cycleObservation!,
          counterCoverage: 'INCOMPLETE',
        };
      expect(evaluate(i).blockers).toContain(
        kind === 'legacy'
          ? 'CYCLE_NOT_EVALUABLE'
          : kind === 'competing'
            ? 'CYCLE_CONFLICT'
            : kind === 'unreserved'
              ? 'CYCLE_UNRESERVED'
              : 'FREQUENCY_NOT_EVALUABLE',
      );
    },
  );
  it('does not reuse manual APPROVE as automatic authorization', () => {
    const i = operationalFixture();
    i.cycleObservation = { ...i.cycleObservation!, status: 'APPROVED' };
    expect(evaluate(i).blockers).toContain(
      'AUTOMATIC_RECOMMENDATION_ROUTE_UNDEFINED',
    );
  });
  it('fails closed for malformed runtime input and unknown dates', () => {
    expect(
      evaluateOperationalReadiness(null as never).executionAuthorized,
    ).toBe(false);
    const i = operationalFixture();
    i.evaluation = { ...i.evaluation, now: new Date('invalid') };
    expect(evaluate(i).blockers).toContain('SOURCE_NOT_EVALUABLE');
  });
  it('does not project unaccepted changes from a corrupt current snapshot', () => {
    const i = operationalFixture();
    i.evaluation.consent!.snapshot.contract.limits.maximumLoad = '300';
    const r = evaluate(i);
    expect(r.acceptance.status).toBe('INVALID');
    expect(r.designBinding).toBeNull();
  });
  it('rejects a changed grid instead of silently rounding a proposal onto another one', () => {
    const i = operationalFixture();
    i.evaluation.consent!.snapshot.contract.policy.grid = {
      ...i.evaluation.consent!.snapshot.contract.policy.grid,
      unit: 'LB',
    };
    expect(evaluate(i).policyEligibility).not.toBe('ELIGIBLE_UNDER_POLICY');
  });
  it('never expands an accepted task set to future identifiers', () => {
    const i = operationalFixture();
    i.evaluation.recommendation.evidence.source.tasks[0].id =
      'unaccepted-future-task';
    expect(evaluate(i).blockers).toContain('COHORT_UNDEFINED');
  });
  it('rejects a version gap after terminal revocation', () => {
    const i = operationalFixture();
    i.evaluation = {
      ...i.evaluation,
      expectedVersion: 4,
      consent: { ...i.evaluation.consent!, state: 'REVOKED', version: 4 },
    };
    const r = evaluate(i);
    expect(r.acceptance.status).toBe('INVALID');
    expect(r.designBinding).toBeNull();
  });
  it('fails closed for an operational state that does not exist in the current contract', () => {
    const i = operationalFixture();
    i.evaluation.consent!.state = 'ACTIVE' as never;
    expect(evaluate(i).blockers).toContain('SOURCE_NOT_EVALUABLE');
  });
  it('does not bind an ACCEPT event to an impossible pending aggregate of the same version', () => {
    const i = operationalFixture();
    i.evaluation.consent!.state = 'PENDING_CONFIRMATION';
    const r = evaluate(i);
    expect(r.acceptance.status).toBe('INVALID');
    expect(r.designBinding).toBeNull();
  });
});
