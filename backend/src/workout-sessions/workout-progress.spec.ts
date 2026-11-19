import {
  prepareEstimates,
  evidenceIdentity,
} from '../domain/progression/estimate-evidence.policy';
import type { EvidenceValue } from '../models/progression/one-rm-estimate.model';
import {
  describeProgress,
  progressWindow,
} from '../domain/workout-sessions/workout-progress.policy';
import type { ProgressRead } from '../models/workout-sessions/workout-progress.model';
const base = (): ProgressRead => ({
  sessions: [
    { id: 's1', performedOn: '2026-11-10' },
    { id: 's2', performedOn: '2026-11-17' },
  ],
  exercises: [
    {
      id: 'e1',
      name: 'Press',
      resistanceType: 'WEIGHT_STACK',
      oneRmSuitability: 'NOT_SUITABLE',
    },
  ],
  selectedExerciseId: 'e1',
  undatedSessions: 1,
  truncated: {
    sessions: false,
    exercises: false,
    tasks: false,
    sets: false,
    estimates: false,
  },
  history: {
    athleteId: 'a',
    userId: 'u',
    exerciseId: 'e1',
    exerciseIsActive: true,
    tasks: ['2026-11-10', '2026-11-17'].map((performedOn, i) => ({
      id: 't' + i,
      athleteId: 'a',
      exerciseId: 'e1',
      sessionId: 's' + (i + 1),
      sessionVersion: 0,
      sessionStatus: 'COMPLETED',
      orderInSession: 1,
      isOmitted: false,
      performedOn,
      timeZone: 'America/Bogota',
      availableSets: 1,
      originalTargets: null,
      adjustedTargets: {
        targetSets: null,
        targetRepsMin: null,
        targetRepsMax: null,
        targetLoad: null,
        targetLoadUnit: null,
        targetRpe: null,
      },
    })),
    sets: [8, 10].map((repetitions, i) => ({
      id: 'set' + i,
      workoutExerciseId: 't' + i,
      setNumber: 1,
      version: 0,
      status: 'COMPLETED',
      kind: 'WORK',
      isCompleted: true,
      load: '60.000',
      loadUnit: 'KG',
      loadKg: '60.000000',
      repetitions,
      rpe: null,
      recordedAt: '2026-11-17T12:00:00.000Z',
    })),
    estimates: [],
    truncated: { tasks: false, sets: false, estimates: false },
  },
});
describe('Real recorded progress', () => {
  it('uses inclusive training-date windows without inventing all-history start dates', () => {
    expect(progressWindow('7', new Date('2026-11-17T18:00:00Z'))).toEqual({
      period: '7',
      timeZone: 'UTC',
      from: '2026-11-11',
      to: '2026-11-17',
    });
    expect(
      progressWindow('all', new Date('2026-11-17T18:00:00Z')).from,
    ).toBeNull();
  });
  it('anchors date windows to the requested local civil day across midnight without changing recorded dates', () => {
    const now = new Date('2026-11-18T01:00:00Z');
    expect(progressWindow('7', now, 'America/Bogota')).toEqual({
      period: '7',
      from: '2026-11-11',
      to: '2026-11-17',
      timeZone: 'America/Bogota',
    });
    expect(progressWindow('7', now, 'UTC')).toEqual({
      period: '7',
      from: '2026-11-12',
      to: '2026-11-18',
      timeZone: 'UTC',
    });
    const value = describeProgress(
      base(),
      progressWindow('30', now, 'America/Bogota'),
    );
    expect(value.timeZone).toBe('America/Bogota');
    expect(value.series[0].points[0].performedOn).toBe('2026-11-10');
    for (const zone of ['', 'Not/AZone', '+05:00'])
      expect(() => progressWindow('7', now, zone)).toThrow();
  });
  it('counts real completed sessions by Monday and compares recorded nominal reps without requiring effort or eligible 1RM', () => {
    const value = describeProgress(
      base(),
      progressWindow('30', new Date('2026-11-17T18:00:00Z')),
    );
    expect(value.frequency).toEqual([
      { week: '2026-11-09', sessions: 1 },
      { week: '2026-11-16', sessions: 1 },
    ]);
    expect(value.series[0]).toMatchObject({
      load: '60',
      unit: 'KG',
      comparison: { state: 'COMPARED', repetitionsDelta: 2 },
      points: [{ repetitions: 8 }, { repetitions: 10 }],
    });
    expect(value.estimates).toEqual([]);
    expect(value.volume.status).toBe('UNAVAILABLE');
  });
  it('presents one session as a baseline, preserves missing units and excludes incomplete/warmup sets from charts', () => {
    const read = base();
    read.history = {
      ...read.history!,
      sets: [
        read.history!.sets[0],
        { ...read.history!.sets[1], status: 'INCOMPLETE' },
        { ...read.history!.sets[1], id: 'warmup', kind: 'WARMUP' },
      ],
    };
    const value = describeProgress(
      read,
      progressWindow('all', new Date('2026-11-17')),
    );
    expect(value.series[0].comparison).toEqual({
      state: 'BASELINE',
      repetitionsDelta: null,
    });
    read.history = {
      ...read.history!,
      sets: [{ ...read.history!.sets[0], loadUnit: null }],
    };
    expect(
      describeProgress(read, progressWindow('all', new Date('2026-11-17')))
        .series,
    ).toEqual([]);
  });
  it('preserves intraday observations but withholds comparison when their order is unknown', () => {
    const read = base(),
      history = read.history!;
    read.history = {
      ...history,
      tasks: [
        ...history.tasks,
        { ...history.tasks[1], id: 't2', sessionId: 's3' },
      ],
      sets: [
        ...history.sets,
        {
          ...history.sets[1],
          id: 'set2',
          workoutExerciseId: 't2',
          repetitions: 11,
        },
      ],
    };
    const value = describeProgress(
      read,
      progressWindow('all', new Date('2026-11-17')),
    );
    expect(value.series[0].points).toHaveLength(3);
    expect(value.series[0].comparison).toEqual({
      state: 'AMBIGUOUS',
      repetitionsDelta: null,
    });
    expect(value.series[0].bestRepetitions).toBe(11);
    read.history = {
      ...read.history,
      tasks: read.history!.tasks.map((t) => ({
        ...t,
        sessionId: 'same-session',
      })),
    };
    expect(
      describeProgress(read, progressWindow('all', new Date('2026-11-17')))
        .series[0].points,
    ).toHaveLength(3);
  });
  it('keeps the best observed repetitions across every completed set even when the chart uses the last work set', () => {
    const read = base(),
      history = read.history!;
    read.history = {
      ...history,
      sets: [
        { ...history.sets[0], setNumber: 2 },
        history.sets[1],
        {
          ...history.sets[0],
          id: 'earlier-set',
          setNumber: 1,
          repetitions: 12,
        },
      ],
    };
    const value = describeProgress(
      read,
      progressWindow('all', new Date('2026-11-17')),
    );
    expect(value.series[0].points[0].repetitions).toBe(8);
    expect(value.series[0].bestRepetitions).toBe(12);
  });
  it('preserves all compatibility versions from verified persisted estimates instead of collapsing same-formula history', () => {
    const read = base();
    read.exercises[0].oneRmSuitability = 'SUITABLE';
    const history = read.history!;
    const estimates = history.tasks.map((task, index) => {
      const set = history.sets[index];
      const [draft] = prepareEstimates(
        {
          userId: history.userId,
          athleteId: history.athleteId,
          exerciseId: history.exerciseId,
          sessionId: task.sessionId,
          workoutExerciseId: task.id,
          sourceSetId: set.id,
          sourceSetVersion: set.version,
          sessionVersion: task.sessionVersion,
          sessionStatus: task.sessionStatus,
          status: set.status,
          kind: set.kind,
          isCompleted: set.isCompleted,
          isOmitted: task.isOmitted,
          load: set.load,
          loadUnit: set.loadUnit,
          loadKg: set.loadKg,
          repetitions: set.repetitions,
          rpe: set.rpe,
          oneRmSuitability: 'SUITABLE',
          recordedAt: set.recordedAt,
          performedOn: task.performedOn,
          timeZone: task.timeZone,
        },
        {
          sourceSetId: set.id,
          expectedSetVersion: set.version,
          formulas: ['EPLEY'],
          interpretation: {
            meaning: 'EXTERNAL_TOTAL',
            source: 'OWNER_DECLARATION_AFTER_RECORDING',
          },
        },
      );
      const snapshot = {
        ...draft.snapshot,
        calculationVersion: index ? 'calculation-v2' : draft.algorithmVersion,
        eligibilityVersion: index ? 'eligibility-v2' : draft.eligibilityVersion,
        numericPolicy: {
          ...(draft.snapshot.numericPolicy as Record<string, EvidenceValue>),
          precision: index ? 96 : 128,
        },
      };
      return {
        ...draft,
        id: 'estimate' + index,
        result: draft.estimatedOneRm,
        calculatedAt: '2026-11-17T12:00:00.000Z',
        algorithmVersion: snapshot.calculationVersion,
        eligibilityVersion: snapshot.eligibilityVersion,
        snapshot,
        calculationKey: evidenceIdentity(snapshot),
      };
    });
    read.history = { ...history, estimates };
    const value = describeProgress(
      read,
      progressWindow('all', new Date('2026-11-17')),
    );
    expect(value.estimates).toHaveLength(2);
    expect(value.estimates[0]).toMatchObject({
      algorithmVersion: 'prog-1a-literal-v1',
      eligibilityVersion: 'prog-1a-series-v1',
      numericPolicyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(value.estimates[1]).toMatchObject({
      algorithmVersion: 'calculation-v2',
      eligibilityVersion: 'eligibility-v2',
      numericPolicyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(value.estimates[0].numericPolicyKey).not.toBe(
      value.estimates[1].numericPolicyKey,
    );
  });
  it('supports bodyweight repetitions but does not invent duration or turn bodyweight into external load', () => {
    const read = base();
    read.exercises[0].resistanceType = 'BODYWEIGHT';
    read.history = {
      ...read.history!,
      sets: read.history!.sets.map((s) => ({
        ...s,
        load: null,
        loadUnit: null,
        loadKg: null,
      })),
    };
    const value = describeProgress(
      read,
      progressWindow('all', new Date('2026-11-17')),
    );
    expect(value.series[0]).toMatchObject({
      load: null,
      unit: null,
      kind: 'BODYWEIGHT_REPETITIONS',
      comparison: { repetitionsDelta: 2 },
    });
    expect(value.duration.status).toBe('UNSUPPORTED');
    expect(value.volume.status).toBe('UNAVAILABLE');
  });
});
