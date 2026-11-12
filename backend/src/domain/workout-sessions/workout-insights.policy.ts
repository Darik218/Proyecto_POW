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
        return {
          workoutExerciseId: item.id,
          exerciseId: item.exercise.id,
          name: item.exercise.name,
          actualSets: sets,
          reference: workoutReference(
            references.get(item.exercise.id) ?? null,
            item.exercise.id,
          ),
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
