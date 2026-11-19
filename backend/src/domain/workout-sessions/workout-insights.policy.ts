import { readDecimal } from '../progression/decimal';
import type { RecordedPerformanceComparison } from '../../models/workout-sessions/workout-insights.model';
import { calculateHistoricalOneRm } from '../progression/eligibility.policy';
import { interpretLoad } from '../progression/load';
import type { WorkoutDetail } from '../../workout-sessions/workout-sessions.repository';
import type {
  WorkoutInsights,
  WorkoutReference,
} from '../../models/workout-sessions/workout-insights.model';
import type { SetRecordAttributes } from '../../models/workout-sessions/set-record.model';

export function actualSets(
  sets: readonly SetRecordAttributes[],
): SetRecordAttributes[] {
  return sets.filter(
    (set) =>
      set.status === null ||
      ['COMPLETED', 'INCOMPLETE', 'FAILED'].includes(set.status),
  );
}
export function workoutReference(
  session: WorkoutDetail | null,
  exerciseId: string,
): WorkoutReference | null {
  if (!session) return null;
  const exercise = session.attributes.exercises.find(
    (item) =>
      item.exercise.id === exerciseId &&
      !item.isOmitted &&
      actualSets(item.sets ?? []).length > 0,
  );
  if (!exercise) return null;
  const sets = actualSets(exercise.sets ?? []);
  if (!sets.length) return null;
  return {
    sessionId: session.attributes.id,
    sessionLabel:
      session.attributes.name ||
      session.attributes.performedOn?.toISOString().slice(0, 10) ||
      'Sesión anterior',
    performedOn: session.attributes.performedOn ?? null,
    sets,
  };
}
/** A description of two recorded sets; never an estimate of physiological improvement. */
export function recordedPerformanceComparison(
  current: readonly SetRecordAttributes[],
  previous: readonly SetRecordAttributes[] | undefined,
): RecordedPerformanceComparison {
  const base = {
    basis: 'LAST_COMPLETED_WORK_SET' as const,
    repetitionsDelta: null,
  };
  if (!previous?.length)
    return {
      ...base,
      state: 'NO_REFERENCE',
      message:
        'No hay una sesión anterior comparable. Este registro es un punto de partida; todavía no se calcula una mejora porcentual.',
    };
  const last = (sets: readonly SetRecordAttributes[]) =>
    sets.reduce<SetRecordAttributes | undefined>(
      (chosen, set) =>
        set.kind === 'WORK' &&
        set.status === 'COMPLETED' &&
        set.isCompleted &&
        (!chosen || chosen.setNumber < set.setNumber)
          ? set
          : chosen,
      undefined,
    );
  const a = last(previous),
    b = last(current);
  const first = readDecimal(a?.load),
    second = readDecimal(b?.load);
  if (
    !a ||
    !b ||
    !a.loadUnit ||
    a.loadUnit !== b.loadUnit ||
    !first.ok ||
    !second.ok ||
    first.value.lte(0) ||
    second.value.lte(0) ||
    !Number.isSafeInteger(a.repetitions) ||
    !Number.isSafeInteger(b.repetitions) ||
    a.repetitions! <= 0 ||
    b.repetitions! <= 0
  )
    return {
      ...base,
      state: 'NOT_COMPARABLE',
      message:
        'Los registros no permiten comparar dos series de trabajo completadas con carga y unidad conocidas. Conservamos los resultados sin inferir una mejora.',
    };
  if (!first.value.eq(second.value))
    return {
      ...base,
      state: 'LOAD_CHANGED',
      message:
        'La carga registrada cambió. Compara también las repeticiones, las series y el esfuerzo; más carga por sí sola no demuestra una mejora de fuerza.',
    };
  const delta = b.repetitions! - a.repetitions!;
  return {
    ...base,
    state: 'SAME_LOAD',
    repetitionsDelta: delta,
    message:
      delta === 0
        ? 'Registraste las mismas repeticiones con la misma carga en la última serie de trabajo completada de cada sesión. Revisa también el esfuerzo y el resto de las series.'
        : `Registraste ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'repetición' : 'repeticiones'} ${delta > 0 ? 'más' : 'menos'} con la misma carga, comparando la última serie de trabajo completada de cada sesión. Esta diferencia no demuestra por sí sola un cambio de fuerza; considera el esfuerzo y las demás series.`,
  };
}
export function workoutInsights(
  session: WorkoutDetail,
  references: ReadonlyMap<string, WorkoutDetail>,
  externalTotalExerciseId?: string,
): WorkoutInsights {
  return {
    sessionId: session.attributes.id,
    status: 'COMPLETED',
    exercises: session.attributes.exercises
      .filter((item) => !item.isOmitted)
      .map((item) => {
        const sets = actualSets(item.sets ?? []);
        const declared = externalTotalExerciseId === item.id;
        const repeatable = sets.some(
          (set) =>
            set.kind === 'WORK' &&
            set.status === 'COMPLETED' &&
            set.isCompleted &&
            Number.isSafeInteger(set.repetitions) &&
            set.repetitions! > 0 &&
            interpretLoad(set.load?.toString(), set.loadUnit).ok,
        );
        const reference = workoutReference(
          references.get(item.exercise.id) ?? null,
          item.exercise.id,
        );
        return {
          observedComparison: recordedPerformanceComparison(
            sets,
            reference?.sets,
          ),
          workoutExerciseId: item.id,
          exerciseId: item.exercise.id,
          name: item.exercise.name,
          actualSets: sets,
          reference,
          loadMeaning: declared ? 'EXTERNAL_TOTAL' : 'UNKNOWN',
          loadMeaningSource: declared ? 'REQUEST_DECLARATION' : 'UNKNOWN',
          oneRm: sets.map((set) => ({
            setId: set.id,
            ...calculateHistoricalOneRm({
              load: set.load?.toString() ?? null,
              loadUnit: set.loadUnit,
              loadKg: set.loadKg?.toString() ?? null,
              repetitions: set.repetitions,
              rpe: set.rpe?.toString() ?? null,
              kind: set.kind,
              status: set.status,
              isCompleted: set.isCompleted,
              sessionStatus: session.attributes.status,
              isOmitted: item.isOmitted ?? null,
              oneRmSuitability: item.oneRmSuitability ?? null,
              loadMeaning: declared ? 'EXTERNAL_TOTAL' : 'UNKNOWN',
              provenance: {
                sessionId: session.attributes.id,
                workoutExerciseId: item.id,
                exerciseId: item.exercise.id,
                setId: set.id,
              },
            }),
          })),
          orientation: repeatable
            ? {
                action: 'REPEAT_REFERENCE',
                message:
                  'Usa tus series completadas como referencia para la próxima sesión. Repite esa carga y esas repeticiones si te sientes en condiciones.',
              }
            : sets.length
              ? {
                  action: 'REVIEW_DATA',
                  message:
                    'Revisa la carga, la unidad y las series completadas antes de elegir una referencia para la próxima sesión.',
                }
              : {
                  action: 'RECORD_BASELINE',
                  message:
                    'Registra una serie de trabajo completada para tener tu primera referencia.',
                },
        };
      }),
  };
}
