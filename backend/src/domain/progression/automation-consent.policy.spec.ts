import { randomUUID } from 'node:crypto';
import {
  normalizeConsentContract,
  consentRequest,
  settingsBindingKey,
  consentLifecycle,
  consentChallenge,
} from './automation-consent.policy';
import { evaluateAutomationConsent } from './automation-eligibility.policy';
import {
  recommendationPolicy,
  setting as fixtureSetting,
} from '../../../test/helpers/recommendation-fixtures';
import type { ConsentContract } from '../../models/progression/automation-consent.model';
const exerciseId = randomUUID(),
  planId = randomUUID(),
  prescriptionId = randomUUID();
function contract(): ConsentContract {
  return {
    schemaVersion: 'automation-consent-contract-v1',
    exerciseId,
    trainingPlanId: planId,
    policy: {
      ...recommendationPolicy(),
      baseline: 'DESTINATION_PRESCRIPTION',
      incrementMode: 'ABSOLUTE',
    },
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
      startsAt: '2026-11-01T00:00:00Z',
      endsAt: '2027-01-01T00:00:00Z',
      timeZone: 'America/Bogota',
    },
    termsVersion: 'terms-v1',
    provenance: {
      source: 'INTERNAL_CONFIGURATION_REQUEST',
      reference: 'unit-fixture-not-human-consent',
    },
  };
}
describe('PROG-5C-A bounded consent contract', () => {
  it('normalizes decimals and UTC instants without granting human acceptance', () => {
    const c = normalizeConsentContract(contract());
    expect(c.limits.maximumAbsoluteIncrement).toBe('2.5');
    expect(c.validity.startsAt).toBe('2026-11-01T00:00:00.000Z');
    expect(c).not.toHaveProperty('active');
  });
  it.each([
    'missingExercise',
    'missingLimits',
    'missingUnit',
    'unknownMeaning',
    'unlimitedPlan',
    'emptyTargets',
    'zero',
    'negative',
    'tooPrecise',
    'invalidZone',
    'invalidDate',
    'noOffset',
    'reversedPeriod',
    'wrongPolicy',
    'unknownFields',
    'autoFlag',
  ] as const)('rejects %s', (kind) => {
    const c = structuredClone(contract()) as any;
    if (kind === 'missingExercise') c.exerciseId = null;
    if (kind === 'missingLimits') delete c.limits;
    if (kind === 'missingUnit') delete c.limits.unit;
    if (kind === 'unknownMeaning') c.limits.loadMeaning = 'UNKNOWN';
    if (kind === 'unlimitedPlan') delete c.trainingPlanId;
    if (kind === 'emptyTargets') c.selector.prescriptionIds = [];
    if (kind === 'zero') c.limits.maximumLoad = '0';
    if (kind === 'negative') c.limits.maximumAbsoluteIncrement = '-1';
    if (kind === 'tooPrecise') c.limits.maximumLoad = '80.0000001';
    if (kind === 'invalidZone') c.validity.timeZone = 'Not/AZone';
    if (kind === 'invalidDate') c.validity.endsAt = '2026-02-30T00:00:00Z';
    if (kind === 'noOffset') c.validity.startsAt = '2026-11-01';
    if (kind === 'reversedPeriod') c.validity.endsAt = c.validity.startsAt;
    if (kind === 'wrongPolicy') c.policy.oneRm = 'DECISION_CRITERION';
    if (kind === 'unknownFields') c.state = 'ACTIVE';
    if (kind === 'autoFlag') c.autoApplyAuthorized = true;
    expect(() => normalizeConsentContract(c)).toThrow();
  });
  it('null plan explicitly means only the enumerated prescriptions, never all plans', () => {
    expect(
      normalizeConsentContract({ ...contract(), trainingPlanId: null }).selector
        .kind,
    ).toBe('EXACT_PRESCRIPTION_ALLOWLIST');
  });
  it('same properties and equivalent decimals have the same request key', () => {
    const id = randomUUID(),
      c = contract(),
      a = consentRequest('CREATE', { intentId: id, contract: c }),
      b = consentRequest('CREATE', {
        contract: { ...c, limits: { ...c.limits, maximumLoad: '200.000000' } },
        intentId: id,
      });
    expect(a.requestKey).toBe(b.requestKey);
  });
  it('changed limits, versions or periods change identity', () => {
    const id = randomUUID(),
      c = contract(),
      a = consentRequest('CREATE', { intentId: id, contract: c }).requestKey;
    for (const change of [
      { termsVersion: 'terms-v2' },
      { limits: { ...c.limits, maximumLoad: '210' } },
      { validity: { ...c.validity, endsAt: '2027-02-01T00:00:00Z' } },
    ])
      expect(
        consentRequest('CREATE', {
          intentId: id,
          contract: { ...c, ...change },
        }).requestKey,
      ).not.toBe(a);
  });
  it('uses half-open validity and never turns pending into ACTIVE', () => {
    const c = normalizeConsentContract(contract());
    expect(
      consentLifecycle(
        'PENDING_CONFIRMATION',
        c,
        new Date(c.validity.startsAt),
      ),
    ).toBe('PENDING_CONFIRMATION');
    expect(
      consentLifecycle('PENDING_CONFIRMATION', c, new Date(c.validity.endsAt)),
    ).toBe('EXPIRED');
    expect(consentLifecycle('REVOKED', c, new Date(c.validity.startsAt))).toBe(
      'REVOKED',
    );
  });
  it('a future acceptance challenge is explicitly unaccepted', () => {
    expect(consentChallenge('id', 1, 'a'.repeat(64), contract())).toMatchObject(
      { scope: 'RECURRING_BOUNDED', humanAcceptance: 'NOT_RECORDED' },
    );
  });
  it('preference and informational revision changes do not grant consent or change decisory binding', () => {
    const s = fixtureSetting();
    expect(settingsBindingKey(s, contract().policy)).toBe(
      settingsBindingKey(
        {
          ...s,
          autoApplyAuthorized: !s.autoApplyAuthorized,
          updatedAt: '2099-01-01',
        },
        contract().policy,
      ),
    );
    expect(
      settingsBindingKey({ ...s, incrementAbsolute: '5' }, contract().policy),
    ).not.toBe(settingsBindingKey(s, contract().policy));
  });
  it('an absent consent cannot be replaced by an autoApplyAuthorized preference', () => {
    expect(evaluateAutomationConsent({ consent: null } as any)).toMatchObject({
      lifecycle: 'CONSENT_REQUIRED',
      executionAuthorized: false,
    });
  });
  it('rejects unsupported grid rounding', () => {
    const c = structuredClone(contract()) as any;
    c.policy.grid.rounding = 'CEILING';
    expect(() => normalizeConsentContract(c)).toThrow();
  });

  it('normalizes UUID case before canonicalization', () => {
    const c = contract(),
      id = randomUUID();
    expect(
      consentRequest('CREATE', { intentId: id, contract: c }).requestKey,
    ).toBe(
      consentRequest('CREATE', {
        intentId: id.toUpperCase(),
        contract: {
          ...c,
          exerciseId: c.exerciseId.toUpperCase(),
          trainingPlanId: c.trainingPlanId!.toUpperCase(),
          selector: {
            ...c.selector,
            prescriptionIds: [prescriptionId.toUpperCase()],
          },
        },
      }).requestKey,
    );
  });
});
