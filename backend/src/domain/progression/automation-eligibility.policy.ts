import type {
  ConsentEvaluation,
  ConsentEvaluationInput,
} from '../../models/progression/automation-consent.model';
import {
  normalizeConsentContract,
  consentLifecycle,
  settingsBindingKey,
} from './automation-consent.policy';
import {
  recommendationIdentity,
  recommendationDependencyKeys,
} from './recommendation-evidence.policy';
import { readDecimal } from './decimal';
import { validSportDate } from './performance-query.policy';
import { validateWeeklyPeriod } from './weekly-period.policy';
import {
  inspectGeneration,
  recommendationCycleKey,
} from './recommendation-persistence.policy';
import { assertPersistableDecimal } from './estimate-evidence.policy';
import { localDate } from '../../workout-sessions/workout-calendar.policy';
export function evaluateAutomationConsent(
  input: ConsentEvaluationInput,
): ConsentEvaluation {
  if (!input?.consent)
    return {
      policyEligibility: 'NOT_EVALUABLE',
      lifecycle: 'CONSENT_REQUIRED',
      reasons: ['CONSENT_REQUIRED'],
      executionAuthorized: false,
    };
  const reasons: string[] = [];
  let lifecycle: ConsentEvaluation['lifecycle'] =
    'CONSENT_PENDING_CONFIRMATION';
  try {
    const c = input.consent,
      s = c.snapshot,
      contract = normalizeConsentContract(s.contract),
      d = input.recommendation,
      t = input.destination,
      cycle = input.cycle;
    try {
      inspectGeneration(d.evidence, d.semanticKey, d.dependencyKeys);
    } catch {
      reasons.push('RECOMMENDATION_IDENTITY_INVALID');
    }
    if (
      recommendationIdentity(d.increment) !==
      recommendationIdentity(d.evidence.increment)
    )
      reasons.push('RECOMMENDATION_IDENTITY_INVALID');
    const bound = s.bindings.find((b) => b.planId === t.planId),
      selectedSetting = d.evidence.configuration.selected;
    if (
      !bound ||
      !selectedSetting ||
      selectedSetting.athleteId !== c.athleteId ||
      settingsBindingKey(selectedSetting, contract.policy) !==
        bound.configurationKey ||
      d.evidence.configuration.mode !== contract.policy.incrementMode
    )
      reasons.push('CONFIGURATION_CHANGED');
    if (
      s.engine?.recommendation !== d.evidence.engineVersion ||
      s.engine?.numeric !== d.evidence.increment?.numericPolicy.version
    )
      reasons.push('POLICY_ENGINE_MISMATCH');
    const state = consentLifecycle(c.state, contract, input.now);
    lifecycle =
      state === 'REVOKED'
        ? 'CONSENT_REVOKED'
        : state === 'EXPIRED'
          ? 'CONSENT_EXPIRED'
          : state === 'NOT_YET_VALID'
            ? 'CONSENT_NOT_YET_VALID'
            : state === 'ACCEPTED_INACTIVE'
              ? 'CONSENT_ACCEPTED_INACTIVE'
              : 'CONSENT_PENDING_CONFIRMATION';
    if (
      recommendationIdentity(s) !== c.contractKey ||
      s.humanAcceptance !== 'NOT_RECORDED' ||
      s.operationalAuthorization !== 'NOT_AVAILABLE_IN_PROG_5C_A'
    )
      reasons.push('CONSENT_SNAPSHOT_INVALID');
    if (c.version !== input.expectedVersion)
      reasons.push('CONSENT_VERSION_CHANGED');
    if (input.competingConsentIds.some((id) => id !== c.id))
      reasons.push('AMBIGUOUS_AUTOMATION_CONSENT');
    if (
      s.athleteId !== c.athleteId ||
      d.evidence.athleteId !== c.athleteId ||
      d.evidence.exerciseId !== contract.exerciseId ||
      t.exerciseId !== contract.exerciseId
    )
      reasons.push('SCOPE_MISMATCH');
    if (
      contract.trainingPlanId !== null &&
      t.planId !== contract.trainingPlanId
    )
      reasons.push('SCOPE_MISMATCH');
    const accepted = s.destinations.find(
      (x) => x.prescriptionId === t.prescriptionId,
    );
    if (
      !accepted ||
      !contract.selector.prescriptionIds.includes(t.prescriptionId) ||
      accepted.planId !== t.planId ||
      accepted.dayId !== t.dayId ||
      accepted.weekId !== t.weekId
    )
      reasons.push('DESTINATION_NOT_AUTHORIZED');
    if (
      t.state !== 'DRAFT' ||
      t.retired ||
      t.protected ||
      !validSportDate(t.scheduledOn) ||
      t.scheduledOn <= localDate(t.timeZone, input.now)
    )
      reasons.push('DESTINATION_NOT_FUTURE_EDITABLE');
    const intended = d.evidence.destination;
    if (
      intended.kind !== 'PRESCRIPTION' ||
      intended.prescriptionId !== t.prescriptionId ||
      intended.planId !== t.planId ||
      intended.weekId !== t.weekId ||
      intended.dayId !== t.dayId ||
      intended.planVersion !== t.version
    )
      reasons.push('DESTINATION_VERSION_CHANGED');
    if (
      recommendationIdentity(contract.policy) !==
      recommendationIdentity(d.evidence.configuration.policy)
    )
      reasons.push('POLICY_MISMATCH');
    if (
      s.bindings.some(
        (b) =>
          !input.currentConfigurationKeys.some(
            (k) =>
              k.planId === b.planId &&
              k.configurationKey === b.configurationKey,
          ),
      )
    )
      reasons.push('CONFIGURATION_CHANGED');
    if (
      d.semanticKey !== recommendationIdentity(d.evidence) ||
      recommendationIdentity(d.dependencyKeys) !==
        recommendationIdentity(recommendationDependencyKeys(d.evidence))
    )
      reasons.push('RECOMMENDATION_IDENTITY_INVALID');
    if (
      d.decision !== 'INCREASE' ||
      d.evidence.decision !== 'INCREASE' ||
      d.evidence.configuration.status !== 'VALID' ||
      !d.increment
    )
      reasons.push('EVIDENCE_INSUFFICIENT');
    const days =
      (Date.parse(d.evidence.historyWindow.to + 'T00:00:00Z') -
        Date.parse(d.evidence.historyWindow.from + 'T00:00:00Z')) /
        86400000 +
      1;
    if (!Number.isFinite(days) || days < 1 || days > contract.historyWindowDays)
      reasons.push('HISTORY_WINDOW_MISMATCH');
    validateWeeklyPeriod({
      start: cycle.periodStart,
      endExclusive: cycle.periodEndExclusive,
      cutoffOn: cycle.periodStart,
      timeZone: cycle.timeZone,
      weekStartsOn: contract.limits.weekStartsOn,
    });
    const on = localDate(contract.validity.timeZone, input.now);
    if (
      cycle.timeZone !== contract.validity.timeZone ||
      on < cycle.periodStart ||
      on >= cycle.periodEndExclusive
    )
      reasons.push('FREQUENCY_PERIOD_MISMATCH');
    if (
      !/^[0-9a-f]{64}$/.test(cycle.key) ||
      cycle.key !== recommendationCycleKey(d.evidence) ||
      cycle.alreadyConsumed
    )
      reasons.push('CYCLE_CONFLICT');
    if (typeof cycle.alreadyConsumed !== 'boolean')
      reasons.push('CYCLE_NOT_EVALUABLE');
    if (
      new Set(input.currentConfigurationKeys.map((k) => k.planId)).size !==
      input.currentConfigurationKeys.length
    )
      reasons.push('AMBIGUOUS_CONFIGURATION');
    if (
      !Number.isSafeInteger(cycle.applicationsInWeek) ||
      cycle.applicationsInWeek < 0
    )
      reasons.push('FREQUENCY_NOT_EVALUABLE');
    else if (
      cycle.applicationsInWeek >= contract.limits.maximumApplicationsPerWeek
    )
      reasons.push('FREQUENCY_EXCEEDED');
    const inc = d.increment,
      old = readDecimal(inc?.currentLoad),
      next = readDecimal(inc?.proposedLoad),
      actual = readDecimal(t.load),
      abs = readDecimal(contract.limits.maximumAbsoluteIncrement),
      pct = readDecimal(contract.limits.maximumPercentIncrement),
      max = readDecimal(contract.limits.maximumLoad);
    if (t.unit !== contract.limits.unit || inc?.unit !== contract.limits.unit)
      reasons.push('UNIT_MISMATCH');
    if (
      !old.ok ||
      !next.ok ||
      !actual.ok ||
      !abs.ok ||
      !pct.ok ||
      !max.ok ||
      old.value.lte(0) ||
      !actual.value.eq(old.value) ||
      !next.value.gt(old.value)
    )
      reasons.push('LOAD_NOT_EVALUABLE');
    else {
      const delta = next.value.minus(old.value);
      if (
        delta.gt(abs.value) ||
        delta.mul(100).gt(old.value.mul(pct.value)) ||
        next.value.gt(max.value)
      )
        reasons.push('LIMIT_EXCEEDED');
      assertPersistableDecimal(next.value.toFixed(), 8, 3);
    }
    return {
      policyEligibility: reasons.length
        ? 'NOT_ELIGIBLE'
        : 'ELIGIBLE_UNDER_POLICY',
      lifecycle,
      reasons: [...new Set([...reasons, lifecycle])].sort(),
      executionAuthorized: false,
    };
  } catch {
    return {
      policyEligibility: 'NOT_EVALUABLE',
      lifecycle,
      reasons: [
        ...new Set([...reasons, 'CONFIGURATION_REQUIRED', lifecycle]),
      ].sort(),
      executionAuthorized: false,
    };
  }
}
