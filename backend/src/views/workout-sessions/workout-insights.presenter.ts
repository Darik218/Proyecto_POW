import type {
  WorkoutInsights,
  WorkoutReference,
} from '../../models/workout-sessions/workout-insights.model';
import type { SetRecordAttributes } from '../../models/workout-sessions/set-record.model';

export class WorkoutInsightsPresenter {
  private set(set: SetRecordAttributes) {
    return {
      id: set.id,
      setNumber: set.setNumber,
      load: set.load?.toString() ?? null,
      loadUnit: set.loadUnit,
      repetitions: set.repetitions,
      rpe: set.rpe === null ? null : Number(set.rpe),
      kind: set.kind,
      status: set.status,
      isCompleted: set.isCompleted,
    };
  }
  reference(reference: WorkoutReference | null) {
    return reference === null
      ? null
      : {
          sessionId: reference.sessionId,
          sessionLabel: reference.sessionLabel,
          performedOn:
            reference.performedOn?.toISOString().slice(0, 10) ?? null,
          sets: reference.sets.map((set) => this.set(set)),
        };
  }
  exerciseReference(result: {
    exerciseId: string;
    reference: WorkoutReference | null;
  }) {
    return {
      exerciseId: result.exerciseId,
      reference: this.reference(result.reference),
    };
  }
  insights(value: WorkoutInsights) {
    return {
      sessionId: value.sessionId,
      status: value.status,
      exercises: value.exercises.map((item) => ({
        workoutExerciseId: item.workoutExerciseId,
        exerciseId: item.exerciseId,
        name: item.name,
        actualSets: item.actualSets.map((set) => this.set(set)),
        reference: this.reference(item.reference),
        loadMeaning: item.loadMeaning,
        loadMeaningSource: item.loadMeaningSource,
        oneRm: item.oneRm.map((result) => ({
          setId: result.setId,
          eligibility: {
            policyVersion: result.eligibility.policyVersion,
            status: result.eligibility.status,
            mathematicallyUsable: result.eligibility.mathematicallyUsable,
            descriptiveEligible: result.eligibility.descriptiveEligible,
            officialEvidence: result.eligibility.officialEvidence,
            reasons: [...result.eligibility.reasons],
            warnings: [...result.eligibility.warnings],
          },
          calculation: result.calculation?.ok
            ? {
                ok: true,
                policyVersion: result.calculation.policyVersion,
                load: {
                  originalLoad: result.calculation.load.originalLoad,
                  originalUnit: result.calculation.load.originalUnit,
                  loadKg: result.calculation.load.loadKg,
                },
                repetitions: result.calculation.repetitions,
                estimates: result.calculation.estimates.map((estimate) => ({
                  formula: estimate.formula,
                  estimatedOneRm: estimate.estimatedOneRm,
                  unit: estimate.unit,
                  warnings: [...estimate.warnings],
                })),
                warnings: [...result.calculation.warnings],
              }
            : null,
        })),
        orientation: {
          action: item.orientation.action,
          message: item.orientation.message,
        },
      })),
    };
  }
}
