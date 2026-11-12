import { AutomationConsentPresenter } from './automation-consent.presenter';
import {
  recommendationPolicy,
  setting,
} from '../../../test/helpers/recommendation-fixtures';
import type { ConsentSnapshot } from '../../models/progression/automation-consent.model';
const snapshot = (): ConsentSnapshot => ({
  schemaVersion: 'automation-consent-snapshot-v1',
  athleteId: 'private-owner',
  engine: { recommendation: 'v1', numeric: 'n1' },
  contract: {
    schemaVersion: 'automation-consent-contract-v1',
    exerciseId: 'exercise',
    trainingPlanId: 'p',
    policy: recommendationPolicy(),
    historyWindowDays: 28,
    limits: {
      unit: 'KG',
      loadMeaning: 'EXTERNAL_TOTAL',
      maximumAbsoluteIncrement: '2.5',
      maximumPercentIncrement: '5',
      maximumLoad: '200.000001',
      maximumApplicationsPerWeek: 1,
      weekStartsOn: 1,
    },
    selector: {
      kind: 'EXACT_PRESCRIPTION_ALLOWLIST',
      prescriptionIds: ['p'],
      futureOnly: true,
      planState: 'DRAFT',
      versionPolicy: 'READ_CURRENT_AND_CAS',
    },
    validity: {
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2027-01-01T00:00:00Z',
      timeZone: 'UTC',
    },
    termsVersion: 'test-only',
    provenance: {
      source: 'INTERNAL_CONFIGURATION_REQUEST',
      reference: 'explicit-test-only',
    },
  },
  destinations: [],
  bindings: [
    { planId: 'p', selected: setting(), configurationKey: 'private-hash' },
  ],
  humanAcceptance: 'NOT_RECORDED',
  operationalAuthorization: 'NOT_AVAILABLE_IN_PROG_5C_A',
});
describe('PROG-6B public pending consent conditions', () => {
  it('exposes exact terms while excluding owner, actor and internal settings keys', () => {
    const value = snapshot();
    const r = new AutomationConsentPresenter().snapshot(value);
    expect(r.contract).toEqual(value.contract);
    expect(r.humanAcceptance).toBe('NOT_RECORDED');
    expect(JSON.stringify(r)).not.toMatch(
      /athleteId|actorUserId|autoApplyAuthorized|configurationKey|requestKey/,
    );
  });
  it('never presents a pending request as acceptance or execution permission', () => {
    const r = new AutomationConsentPresenter().snapshot(snapshot());
    expect(r.operationalAuthorization).toBe('NOT_AVAILABLE_IN_PROG_5C_A');
  });
  it('does not publish arbitrary fields added to internal contracts', () => {
    const value = snapshot();
    (value.contract as unknown as Record<string, unknown>).privateMetadata =
      'not-public';
    expect(
      JSON.stringify(new AutomationConsentPresenter().snapshot(value)),
    ).not.toContain('not-public');
  });
});
