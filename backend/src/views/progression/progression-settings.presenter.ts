import type {
  SettingRecord,
  SettingResolution,
  SettingReceipt,
  SettingImpact,
  SettingList,
} from '../../models/progression/progression-setting.model';
import {
  settingParameterIssues,
  settingParameters,
} from '../../domain/progression/progression-settings.policy';
export class ProgressionSettingsPresenter {
  record(r: SettingRecord) {
    return {
      id: r.id,
      scope: r.trainingPlanId
        ? ('EXERCISE_PLAN' as const)
        : r.exerciseId
          ? ('EXERCISE' as const)
          : ('ATHLETE' as const),
      exerciseId: r.exerciseId,
      trainingPlanId: r.trainingPlanId,
      exerciseName: r.exerciseName,
      planName: r.planName,
      parameters: settingParameters(r),
      revision: r.revision,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      historicalAutoApplyAuthorized: r.autoApplyAuthorized,
      parameterIssues: settingParameterIssues(r),
      loadUnitSource: 'EXPLICIT_POLICY_REQUIRED' as const,
      provenance: {
        parameters: 'PERSISTED_ROW' as const,
        originalEntryMethod: 'NOT_DETERMINED_BY_THIS_READ' as const,
        unit: 'NOT_STORED_IN_SETTING' as const,
      },
      parameterSources: Object.fromEntries(
        Object.keys(settingParameters(r)).map((key) => [
          key,
          { settingId: r.id, source: 'PERSISTED_ROW' as const },
        ]),
      ),
      executionAuthorized: false as const,
    };
  }
  resolution(r: SettingResolution) {
    return {
      context: {
        exerciseId: r.context.exerciseId,
        trainingPlanId: r.context.trainingPlanId,
      },
      scope: r.scope,
      selected: r.selected ? this.record(r.selected) : null,
      status: r.status,
      reasons: [...r.reasons],
      settingReasons: [...r.settingReasons],
      externalRequirements: [...r.externalRequirements],
      policyProvided: r.policyProvided,
      mode: r.mode,
      precedence: 'WHOLE_ROW_EXERCISE_PLAN_EXERCISE_ATHLETE' as const,
      executionAuthorized: false as const,
    };
  }
  list(v: SettingList) {
    return {
      items: v.items.map((r) => this.record(r)),
      page: v.page,
      limit: v.limit,
      total: v.total,
    };
  }
  receipt(r: SettingReceipt) {
    return {
      id: r.id,
      settingId: r.settingId,
      intentId: r.intentId,
      action: r.action,
      beforeRevision: r.beforeRevision,
      revision: r.revision,
      result: this.record(r.result),
      effective: r.effective ? this.resolution(r.effective) : null,
      recordedAt: r.recordedAt,
      executionAuthorized: false as const,
    };
  }
  impact(r: SettingImpact) {
    return {
      settingId: r.settingId,
      expectedRevision: r.expectedRevision,
      parametersChanged: r.parametersChanged,
      recommendationIds: [...r.recommendationIds],
      recommendationRevisionChanges: r.recommendationRevisionChanges,
      consents: r.consents.map((c) => ({
        id: c.id,
        state: c.state,
        compatibility: c.compatibility,
        challengeMayBeStale: c.challengeMayBeStale,
      })),
      coverage: r.coverage,
      warnings: [...r.warnings],
      executionAuthorized: false as const,
    };
  }
}
