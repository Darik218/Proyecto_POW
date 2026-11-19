import {
  command,
  context,
} from '../../../test/helpers/recommendation-fixtures';
import {
  prepareGuideCalculationContext,
  buildGuidePreview,
} from './workout-guide-preview.policy';
import type {
  WorkoutGuideSnapshot,
  WorkoutGuidePreviewInput,
} from '../../models/progression/workout-guide.model';
import { deriveRecommendation } from '../../progression/recommendation.service';
function fixture() {
  const h = context(),
    c = command();
  h.target = {
    ...h.target,
    kind: 'PRESCRIPTION',
    taskId: null,
    prescriptionId: 'p',
    planId: 'plan',
    weekId: 'week',
    dayId: 'day',
    planVersion: 1,
    targets: { ...h.history.tasks[1].adjustedTargets },
  };
  h.history.tasks = h.history.tasks.map((t) => ({ ...t, planExerciseId: 'p' }));
  const source = {
    kind: 'PLAN_DAY',
    id: 'day',
    performedOn: '2026-01-14',
    timeZone: 'UTC',
  } as WorkoutGuideSnapshot['source'];
  const prepared = prepareGuideCalculationContext(h, source, '2026-01-14');
  const input: WorkoutGuidePreviewInput = {
    source: { planDayId: 'day' },
    exerciseId: 'exercise',
    contextKey: prepared.contextKey!,
    gridStep: '2.5',
    incrementMode: 'ABSOLUTE',
    declaration: {
      sameVariant: true,
      sameEquipment: true,
      externalTotal: true,
    },
    policyContract: 'session-readiness-preview-v1',
  };
  return { h, c, source, prepared, input };
}
describe('voluntary session readiness preview contract', () => {
  it('builds the declared existing-engine contract using actual settings and work positions', () => {
    const f = fixture(),
      command = buildGuidePreview(f.h, f.source, f.prepared, f.input);
    expect(command.policy).toMatchObject({
      cohort: { mode: 'SAME_PRESCRIPTION' },
      assessment: {
        count: {
          mode: 'CONSECUTIVE',
          sameDate: 'DISTINCT_DATES',
          minimumSessions: 2,
          anchorTaskId: 'b',
        },
      },
      review: 'NOT_REQUIRED_EXPLICIT',
      requireClosedWeek: false,
    });
    expect(deriveRecommendation(f.h, command)).toMatchObject({
      decision: 'INCREASE',
      increment: { proposedLoad: '82.500000' },
    });
  });
  it('uses the existing BASIC compliance count for an explicit no-RPE load policy while readiness remains unchanged', () => {
    const f = fixture();
    f.h.history.sets.forEach((s) => (s.rpe = null));
    const prepared = prepareGuideCalculationContext(
      f.h,
      f.source,
      '2026-01-14',
    );
    const input = {
      ...f.input,
      contextKey: prepared.contextKey!,
      policyContract: 'session-load-compliance-preview-v1' as const,
    };
    const command = buildGuidePreview(f.h, f.source, prepared, input);
    expect(command.policy).toMatchObject({
      id: 'session-load-compliance-preview',
      version: 'session-load-compliance-preview-v1',
      assessment: { count: { criterion: 'BASIC' } },
      settingRpeUse: 'CONTEXT_ONLY_EXPLICIT',
    });
    expect(deriveRecommendation(f.h, command)).toMatchObject({
      decision: 'INCREASE',
      increment: { proposedLoad: '82.500000' },
    });
    const readiness = buildGuidePreview(f.h, f.source, prepared, {
      ...f.input,
      contextKey: prepared.contextKey!,
    });
    expect(deriveRecommendation(f.h, readiness).decision).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it('does not bypass upper-bound targets or the configured successful-session minimum without RPE', () => {
    const f = fixture();
    f.h.history.sets.forEach((s) => (s.rpe = null));
    f.h.history.sets[1].repetitions = 5;
    const prepared = prepareGuideCalculationContext(
      f.h,
      f.source,
      '2026-01-14',
    );
    const command = buildGuidePreview(f.h, f.source, prepared, {
      ...f.input,
      contextKey: prepared.contextKey!,
      policyContract: 'session-load-compliance-preview-v1',
    });
    expect(deriveRecommendation(f.h, command).decision).not.toBe('INCREASE');
    f.h.history.sets[1].repetitions = 6;
    f.h.history.tasks.shift();
    f.h.history.sets.shift();
    const one = prepareGuideCalculationContext(f.h, f.source, '2026-01-14');
    expect(
      deriveRecommendation(
        f.h,
        buildGuidePreview(f.h, f.source, one, {
          ...f.input,
          contextKey: one.contextKey!,
          policyContract: 'session-load-compliance-preview-v1',
        }),
      ),
    ).toMatchObject({ decision: 'MAINTAIN', reasons: ['MINIMUM_NOT_REACHED'] });
  });
  it('binds the voluntary declaration to current records and does not invent missing consent', () => {
    const f = fixture();
    expect(() =>
      buildGuidePreview(f.h, f.source, f.prepared, {
        ...f.input,
        contextKey: 'stale',
      }),
    ).toThrow();
    expect(() =>
      buildGuidePreview(f.h, f.source, f.prepared, {
        ...f.input,
        declaration: { ...f.input.declaration, externalTotal: false } as never,
      }),
    ).toThrow();
    expect(
      prepareGuideCalculationContext(
        { ...f.h, settings: [] },
        f.source,
        '2026-01-14',
      ),
    ).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining(['SETTING_REQUIRED']),
    });
    const previous = f.prepared.contextKey;
    f.h.history.sets[0].version = 2;
    expect(
      prepareGuideCalculationContext(f.h, f.source, '2026-01-14').contextKey,
    ).not.toBe(previous);
    f.h.settings[0].incrementAbsolute = '5';
    expect(
      prepareGuideCalculationContext(f.h, f.source, '2026-01-14').contextKey,
    ).not.toBe(previous);
  });
  it('can evaluate one completed session in its civil week without assuming missing earlier history', () => {
    const f = fixture();
    f.h.history.tasks.shift();
    f.h.history.sets.shift();
    const prepared = prepareGuideCalculationContext(
      f.h,
      f.source,
      '2026-01-14',
    );
    const command = buildGuidePreview(f.h, f.source, prepared, {
      ...f.input,
      contextKey: prepared.contextKey!,
    });
    expect(deriveRecommendation(f.h, command)).toMatchObject({
      decision: 'MAINTAIN',
      reasons: ['MINIMUM_NOT_REACHED'],
    });
  });
  it('binds the displayed session target and withholds preview when it diverges from its prescription', () => {
    const f = fixture();
    const displayed = { ...f.h.target.targets!, targetLoad: '75' };
    const prepared = prepareGuideCalculationContext(
      f.h,
      f.source,
      '2026-01-14',
      displayed,
    );
    expect(prepared).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining(['DESTINATION_TARGETS_CHANGED']),
    });
    expect(prepared.contextKey).not.toBe(f.prepared.contextKey);
  });
});
