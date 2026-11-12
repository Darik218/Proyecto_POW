import type { ConsentContract } from '../types/automation-consent'
import type { ProgressionPolicy } from '../types/progression'
export function policyFormValues(
  p: ProgressionPolicy | undefined,
): Record<string, string> {
  if (!p) return {}
  const b = p.assessment.compliance?.basic,
    r = p.assessment.compliance?.readiness,
    s = p.assessment.signal
  return {
    id: p.id,
    version: p.version,
    reference: p.provenance.reference,
    basis: p.basis,
    basicReps: b?.repetitions ?? '',
    basicLoad: b?.load ?? '',
    readinessReps: r?.repetitions ?? '',
    readinessLoad: r?.load ?? '',
    rpeMin: typeof r?.rpe === 'object' ? r.rpe.minimum : '',
    rpeMax: typeof r?.rpe === 'object' ? r.rpe.maximum : '',
    criterion: p.assessment.count?.criterion ?? '',
    mode: p.assessment.count?.mode ?? '',
    sameDate: p.assessment.count?.sameDate ?? '',
    settingRpeUse: p.settingRpeUse,
    review: p.review,
    incrementMode: p.incrementMode ?? '',
    unit: p.grid.unit,
    step: p.grid.step,
    origin: p.grid.origin,
    gridSource: p.grid.source,
    closed: String(p.requireClosedWeek),
    rpeComparison: s?.rpeComparison ?? '',
    referenceSize: s ? String(s.referenceSize) : '',
    rpeThreshold: s?.rpeThreshold ?? '',
    performanceThresholdPercent: s?.performanceThresholdPercent ?? '',
    minimumRpeCoveragePercent: s?.minimumRpeCoveragePercent ?? '',
    k: p.assessment.persistence ? String(p.assessment.persistence.k) : '',
    m: p.assessment.persistence ? String(p.assessment.persistence.m) : '',
  }
}
export function contractFields(c: ConsentContract | undefined) {
  return c
    ? {
        scope: c.trainingPlanId === null ? 'EXACT_IDS' : 'PLAN',
        exerciseId: c.exerciseId,
        planId: c.trainingPlanId ?? '',
        unit: c.limits.unit,
        startsAt: c.validity.startsAt,
        endsAt: c.validity.endsAt,
        timeZone: c.validity.timeZone,
        termsVersion: c.termsVersion,
        reference: c.provenance.reference,
        historyWindowDays: String(c.historyWindowDays),
        maximumAbsoluteIncrement: c.limits.maximumAbsoluteIncrement,
        maximumPercentIncrement: c.limits.maximumPercentIncrement,
        maximumLoad: c.limits.maximumLoad,
        maximumApplicationsPerWeek: String(c.limits.maximumApplicationsPerWeek),
        weekStartsOn: String(c.limits.weekStartsOn),
      }
    : {
        scope: '',
        exerciseId: '',
        planId: '',
        unit: '',
        startsAt: '',
        endsAt: '',
        timeZone: '',
        termsVersion: '',
        reference: '',
        historyWindowDays: '',
        maximumAbsoluteIncrement: '',
        maximumPercentIncrement: '',
        maximumLoad: '',
        maximumApplicationsPerWeek: '',
        weekStartsOn: '',
      }
}
