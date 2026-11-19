import type {
  ProgressRead,
  ProgressPeriod,
  ProgressWindow,
} from '../../models/workout-sessions/workout-progress.model';
import { PROGRESS_LIMITS } from '../../models/workout-sessions/workout-progress.model';
import { readDecimal } from '../progression/decimal';
import { historicalEstimateEvidence } from '../progression/performance-estimates.policy';
export function progressWindow(
  period: ProgressPeriod,
  now: Date,
  timeZone = 'UTC',
): ProgressWindow {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone))
    throw new RangeError('Provide a valid IANA time zone.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;
  const end = new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00Z`,
  );
  return {
    period,
    timeZone,
    to: end.toISOString().slice(0, 10),
    from:
      period === 'all'
        ? null
        : new Date(end.getTime() - (Number(period) - 1) * 86400000)
            .toISOString()
            .slice(0, 10),
  };
}
export function describeProgress(read: ProgressRead, window: ProgressWindow) {
  const weeks = new Map<string, number>();
  for (const session of read.sessions) {
    const date = new Date(session.performedOn + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const week = date.toISOString().slice(0, 10);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
  }
  const selected =
    read.exercises.find((e) => e.id === read.selectedExerciseId) ?? null;
  type Point = {
    sessionId: string;
    performedOn: string;
    setId: string;
    setNumber: number;
    repetitions: number;
  };
  const groups = new Map<
    string,
    {
      kind: 'RECORDED_LOAD_REPETITIONS' | 'BODYWEIGHT_REPETITIONS';
      load: string | null;
      unit: 'KG' | 'LB' | null;
      points: Map<string, Point>;
      bestRepetitions: number;
    }
  >();
  for (const set of read.history?.sets ?? []) {
    const task = read.history!.tasks.find(
      (t) => t.id === set.workoutExerciseId,
    );
    if (
      !task ||
      task.isOmitted ||
      task.sessionStatus !== 'COMPLETED' ||
      !task.performedOn ||
      set.kind !== 'WORK' ||
      set.status !== 'COMPLETED' ||
      !set.isCompleted ||
      !Number.isSafeInteger(set.repetitions) ||
      set.repetitions! < 1
    )
      continue;
    const parsed = readDecimal(set.load);
    const bodyweight =
      selected?.resistanceType === 'BODYWEIGHT' &&
      (set.load === null || (parsed.ok && parsed.value.eq(0)));
    if (!bodyweight && (!parsed.ok || parsed.value.lt(0) || !set.loadUnit))
      continue;
    const load = bodyweight ? null : parsed.ok ? parsed.value.toString() : null,
      unit = bodyweight ? null : set.loadUnit;
    const key = JSON.stringify([bodyweight, load, unit]);
    if (!groups.has(key))
      groups.set(key, {
        kind: bodyweight
          ? 'BODYWEIGHT_REPETITIONS'
          : 'RECORDED_LOAD_REPETITIONS',
        load,
        unit,
        points: new Map(),
        bestRepetitions: set.repetitions!,
      });
    const group = groups.get(key)!,
      previous = group.points.get(task.id);
    group.bestRepetitions = Math.max(group.bestRepetitions, set.repetitions!);
    // Last completed work set per exercise occurrence and recorded load.
    // Keep repeated occurrences in one session; their order across dates is not inferred.
    if (
      !previous ||
      set.setNumber > previous.setNumber ||
      (set.setNumber === previous.setNumber && set.id > previous.setId)
    )
      group.points.set(task.id, {
        sessionId: task.sessionId,
        performedOn: task.performedOn,
        setId: set.id,
        setNumber: set.setNumber,
        repetitions: set.repetitions!,
      });
  }
  const series = [...groups.values()]
    .map((group) => {
      const points = [...group.points.values()].sort(
        (a, b) =>
          a.performedOn.localeCompare(b.performedOn) ||
          a.sessionId.localeCompare(b.sessionId),
      );
      const last = points.at(-1),
        prior = last
          ? [...points].reverse().find((p) => p.performedOn < last.performedOn)
          : undefined;
      const ambiguous =
        !!last &&
        (points.filter((p) => p.performedOn === last.performedOn).length > 1 ||
          (!!prior &&
            points.filter((p) => p.performedOn === prior.performedOn).length >
              1));
      return {
        kind: group.kind,
        load: group.load,
        unit: group.unit,
        points,
        bestRepetitions: group.bestRepetitions,
        comparison: ambiguous
          ? { state: 'AMBIGUOUS' as const, repetitionsDelta: null }
          : prior && last
            ? {
                state: 'COMPARED' as const,
                repetitionsDelta: last.repetitions - prior.repetitions,
              }
            : { state: 'BASELINE' as const, repetitionsDelta: null },
      };
    })
    .sort(
      (a, b) =>
        b.points.length - a.points.length ||
        String(a.unit).localeCompare(String(b.unit)) ||
        String(a.load).localeCompare(String(b.load)),
    );
  const evidence =
    read.history && selected?.oneRmSuitability === 'SUITABLE'
      ? historicalEstimateEvidence(read.history).points
      : [];
  return {
    period: window.period,
    plans: read.plans ?? [],
    selectedPlanId: read.selectedPlanId ?? null,
    nextSession: read.nextSession ?? null,
    selectedPlanDayId: read.selectedPlanDayId ?? null,
    planDays: read.planDays ?? [],
    timeZone: window.timeZone ?? 'UTC',
    from: window.from,
    to: window.to,
    selectedExerciseId: read.selectedExerciseId,
    exercises: read.exercises,
    completedSessions: read.sessions.length,
    frequency: [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, sessions]) => ({ week, sessions })),
    series,
    estimates: evidence.map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      setId: p.sourceSetId,
      performedOn: p.performedOn,
      formula: p.formula,
      value: p.resultKg,
      unit: 'KG' as const,
      algorithmVersion: p.algorithmVersion,
      eligibilityVersion: p.eligibilityVersion,
      numericPolicyKey: p.numericPolicyKey,
      warnings: p.warnings,
    })),
    volume: {
      status: 'UNAVAILABLE' as const,
      message:
        'No sumamos volumen sin una interpretación verificada de todas las cargas. Las cargas nominales no representan necesariamente carga externa total.',
    },
    duration: {
      status: 'UNSUPPORTED' as const,
      message:
        'El registro actual no guarda duración por serie; no se muestra una evolución de tiempo.',
    },
    metadata: {
      dateBasis: 'PERFORMED_ON' as const,
      weekStartsOn: 'MONDAY' as const,
      undatedSessions: read.undatedSessions,
      truncated: read.truncated,
      limits: PROGRESS_LIMITS,
      observedFrom: read.sessions.map((s) => s.performedOn).sort()[0] ?? null,
      observedTo:
        read.sessions
          .map((s) => s.performedOn)
          .sort()
          .at(-1) ?? null,
    },
  };
}
