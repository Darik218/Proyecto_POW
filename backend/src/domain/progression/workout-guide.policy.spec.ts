import { describe, expect, it } from '@jest/globals';
import {
  referenceGuidance,
  validateWorkoutGuideQuery,
  assessGuideProposal,
  isGuideDayTrainable,
  originalGuideTargets,
} from './workout-guide.policy';
import {
  context,
  command,
} from '../../../test/helpers/recommendation-fixtures';
import { deriveRecommendation } from '../../progression/recommendation.service';
import type { PersistedRecommendation } from '../../models/progression/persisted-recommendation.model';
import type { GuideHistoryTask } from '../../models/progression/workout-guide.model';
const task = (
  id: string,
  performedOn: string | null,
  unit: 'KG' | 'LB' | null = 'KG',
): GuideHistoryTask => ({
  sessionId: id,
  taskId: id,
  performedOn,
  timeZone: 'America/Bogota',
  sets: [
    {
      setNumber: 1,
      load: '80.000',
      loadUnit: unit,
      repetitions: 8,
      rpe: null,
      status: 'COMPLETED',
      kind: 'WORK',
      isCompleted: true,
    },
  ],
});
describe('read-only daily guidance policy', () => {
  it('preserves the numeric original RPE snapshot independently from current targets', () => {
    expect(originalGuideTargets({ targets: { targetRpe: 8 } })?.targetRpe).toBe(
      '8',
    );
    expect(
      originalGuideTargets({ targets: { targetRpe: 7.5 } })?.targetRpe,
    ).toBe('7.5');
    expect(
      originalGuideTargets({ targets: { targetRpe: '8.0' } })?.targetRpe,
    ).toBe('8.0');
    for (const targetRpe of [NaN, Infinity, -1, 11, null])
      expect(
        originalGuideTargets({ targets: { targetRpe } })?.targetRpe,
      ).toBeNull();
  });

  it('honors a day retirement sporting cutoff and available plan states', () => {
    const day = {
      retiredAt: new Date('2026-01-10'),
      retiredFromOn: new Date('2026-01-20'),
      planStatus: 'ACTIVE',
    };
    expect(isGuideDayTrainable(day, '2026-01-19')).toBe(true);
    expect(isGuideDayTrainable(day, '2026-01-20')).toBe(false);
    expect(
      isGuideDayTrainable(
        { ...day, retiredAt: null, planStatus: 'ARCHIVED' },
        '2026-01-19',
      ),
    ).toBe(false);
  });

  it('requires exactly one route source and real date/zone for direct days', () => {
    expect(() => validateWorkoutGuideQuery({})).toThrow();
    expect(() =>
      validateWorkoutGuideQuery({
        planDayId: '00000000-0000-4000-8000-000000000001',
        performedOn: '2026-02-30',
        timeZone: 'America/Bogota',
      }),
    ).toThrow();
    expect(() =>
      validateWorkoutGuideQuery({
        sessionId: '00000000-0000-4000-8000-000000000001',
        activityId: '00000000-0000-4000-8000-000000000002',
      }),
    ).toThrow();
  });
  it('distinguishes first actual baseline from undated insufficient history', () => {
    expect(referenceGuidance([], '2026-02-01', false).guidance.state).toBe(
      'FIRST_BASELINE',
    );
    expect(
      referenceGuidance([task('a', null)], '2026-02-01', false).guidance.state,
    ).toBe('INSUFFICIENT_DATA');
  });
  it('groups all last-date sessions without guessing chronology or converting unknown units', () => {
    const result = referenceGuidance(
      [
        task('a', '2026-01-01', null),
        task('b', '2026-01-01', 'LB'),
        task('same', '2026-02-01'),
      ],
      '2026-02-01',
      false,
    );
    expect(result.lastReference?.sessions.map((s) => s.sessionId)).toEqual([
      'a',
      'b',
    ]);
    expect(result.lastReference?.sessions[0].sets[0].loadUnit).toBeNull();
    expect(result.lastReference?.gapDays).toBe(31);
    expect(result.guidance.reasons).toEqual(
      expect.arrayContaining([
        'INTRADAY_ORDER_UNKNOWN',
        'LOAD_UNIT_UNKNOWN',
        'SAME_DAY_NOT_ORDERED',
      ]),
    );
  });
  it('does not treat a task proposal as an exact daily prescription proposal', () => {
    const c = command(),
      ctx = context(),
      draft = deriveRecommendation(ctx, c);
    const proposal = {
      id: 'p',
      status: 'PENDING',
      expiresAt: null,
      loadUnit: 'KG',
      recommendedLoad: draft.increment!.proposedLoad,
      generation: { draft },
    } as unknown as PersistedRecommendation;
    expect(
      assessGuideProposal({
        proposal,
        command: c,
        current: draft,
        target: {
          targetSets: 1,
          targetRepsMin: 8,
          targetRepsMax: 8,
          targetLoad: '80',
          targetLoadUnit: 'KG',
          targetRpe: null,
        },
        prescriptionId: ctx.target.prescriptionId,
        latestDate: '2026-01-09',
        now: new Date('2026-01-12'),
        performedOn: '2026-01-13',
      }).status,
    ).toBe('REQUIRES_REVIEW');
  });
  it('reuses the exact engine draft and withholds stale, expired or incompatible loads', () => {
    const c = command(),
      ctx = context();
    c.destination = {
      kind: 'PRESCRIPTION',
      planId: 'plan',
      weekId: 'week',
      dayId: 'day',
      prescriptionId: 'p',
    };
    ctx.target = {
      ...ctx.target,
      kind: 'PRESCRIPTION',
      taskId: null,
      planId: 'plan',
      weekId: 'week',
      dayId: 'day',
      prescriptionId: 'p',
      planVersion: 1,
      planStatus: 'DRAFT',
      targets: { ...ctx.history.tasks[1].adjustedTargets },
    };
    const draft = deriveRecommendation(ctx, c);
    expect(draft.decision).toBe('INCREASE');
    const proposal = {
      id: 'p',
      status: 'PENDING',
      expiresAt: null,
      loadUnit: 'KG',
      recommendedLoad: draft.increment!.proposedLoad,
      generation: { draft },
    } as unknown as PersistedRecommendation;
    const input = {
      proposal,
      command: c,
      current: draft,
      target: ctx.target.targets!,
      prescriptionId: 'p',
      latestDate: '2026-01-06',
      now: new Date('2026-01-12'),
      performedOn: '2026-01-13',
    };
    expect(assessGuideProposal(input)).toMatchObject({
      status: 'CURRENT',
      recommendedLoad: '82.500000',
    });
    const changed = deriveRecommendation({ ...ctx, settings: [] }, c);
    expect(assessGuideProposal({ ...input, current: changed })).toMatchObject({
      status: 'REQUIRES_REVIEW',
      recommendedLoad: null,
    });
    expect(
      assessGuideProposal({
        ...input,
        target: { ...input.target, targetLoadUnit: 'LB' },
      }).reasons,
    ).toContain('TARGET_UNIT_MISMATCH');
    expect(
      assessGuideProposal({
        ...input,
        proposal: { ...proposal, expiresAt: new Date('2026-01-11') },
      }).reasons,
    ).toContain('PROPOSAL_EXPIRED');
    expect(
      assessGuideProposal({ ...input, latestDate: '2026-01-12' }).reasons,
    ).toContain('NEWER_REFERENCE_OUTSIDE_PROPOSAL');
    expect(
      assessGuideProposal({
        ...input,
        proposal: { ...proposal, recommendedLoad: '82.500001' },
      }).reasons,
    ).toContain('DESTINATION_DECIMAL_INCOMPATIBLE');
  });
});
