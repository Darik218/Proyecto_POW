export const cid = (n) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export function consentFixture() {
  const p = {
    id: 'explicit-test-policy',
    version: 'v1',
    provenance: {
      source: 'EXPLICIT_INTERNAL_POLICY',
      reference: 'test-only-not-a-default',
    },
    basis: 'ADJUSTED',
    baseline: 'DESTINATION_PRESCRIPTION',
    cohort: { mode: 'EXPLICIT_TASK_SET', taskIds: [cid(2)] },
    assessment: {
      compliance: {
        id: 'test-compliance',
        slots: [
          {
            taskId: cid(2),
            original: [1],
            adjusted: [1],
            originalLoadMeaning: 'EXTERNAL_TOTAL',
            adjustedLoadMeaning: 'EXTERNAL_TOTAL',
          },
        ],
        basic: {
          repetitions: 'MINIMUM',
          load: 'AT_LEAST_TARGET',
          rpe: 'DESCRIBE',
          coverage: 'ALL_REQUIRED',
        },
        readiness: {
          repetitions: 'UPPER_BOUND',
          load: 'AT_LEAST_TARGET',
          rpe: { minimum: '6', maximum: '8' },
          coverage: 'ALL_REQUIRED',
        },
      },
      count: {
        id: 'count',
        basis: 'ADJUSTED',
        criterion: 'BASIC',
        mode: 'ACCUMULATED',
        sameDate: 'DISTINCT_SESSIONS',
        minimumSessions: 2,
        anchorTaskId: cid(2),
      },
    },
    settingRpeUse: 'REQUIRE_INTERVAL',
    review: 'NOT_REQUIRED_EXPLICIT',
    oneRm: 'DESCRIPTIVE_CONTEXT_ONLY',
    requireClosedWeek: true,
    knowledge: 'CURRENT_RECORDS_FOR_SPORTING_CUTOFF',
    loadMeaning: 'EXTERNAL_TOTAL',
    settingLoadUnit: 'KG',
    incrementMode: 'ABSOLUTE',
    grid: {
      unit: 'KG',
      step: '2.5',
      origin: '0',
      rounding: 'FLOOR',
      source: 'fixture-only',
    },
  }
  const contract = {
    schemaVersion: 'automation-consent-contract-v1',
    exerciseId: cid(1),
    trainingPlanId: cid(3),
    policy: p,
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
      prescriptionIds: [cid(4)],
      futureOnly: true,
      planState: 'DRAFT',
      versionPolicy: 'READ_CURRENT_AND_CAS',
    },
    validity: {
      startsAt: '2026-12-01T09:00:00-05:00',
      endsAt: '2027-01-01T09:00:00-05:00',
      timeZone: 'America/Bogota',
    },
    termsVersion: 'test-terms-v1',
    provenance: {
      source: 'INTERNAL_CONFIGURATION_REQUEST',
      reference: 'test-only-request',
    },
  }
  return {
    schemaVersion: 'automation-consent-snapshot-v1',
    engine: { recommendation: 'fixture', numeric: 'fixture' },
    contract,
    destinations: [
      {
        prescriptionId: cid(4),
        exerciseId: cid(1),
        planId: cid(3),
        weekId: cid(5),
        dayId: cid(6),
        recordedPlanVersion: 0,
      },
    ],
    bindings: [],
    humanAcceptance: 'NOT_RECORDED',
    operationalAuthorization: 'NOT_AVAILABLE_IN_PROG_5C_A',
  }
}
