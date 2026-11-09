import type {
  WorkoutSession,
  WorkoutDetailAttributes,
  WorkoutSource,
  PlanReference,
  WeekReference,
  DayReference,
  WorkoutSuggestions,
  SavedWorkoutDay,
} from '../../models/workout-sessions/workout-session.model';
import type {
  WorkoutExerciseAttributes,
  WorkoutTargetAttributes,
  WorkoutTargets,
  ExerciseSnapshot,
  ExerciseIdentity,
  WorkoutPrescription,
} from '../../models/workout-sessions/workout-exercise.model';
import type { SetRecordAttributes } from '../../models/workout-sessions/set-record.model';

export class WorkoutSessionsPresenter {
  private plan(value: PlanReference | null) {
    return value == null ? value : { id: value.id, name: value.name };
  }
  private week(value: WeekReference | null) {
    return value == null
      ? value
      : { id: value.id, weekNumber: value.weekNumber };
  }
  private day(value: DayReference | null) {
    return value == null
      ? value
      : { id: value.id, name: value.name, weekday: value.weekday };
  }
  private identity(value: ExerciseIdentity) {
    return {
      id: value.id,
      name: value.name,
      equipment: value.equipment,
      muscleGroup: value.muscleGroup,
    };
  }
  private source(source: WorkoutSource | null) {
    if (source === null) return null;
    return {
      kind: source.kind,
      plan: this.plan(source.plan),
      week: this.week(source.week),
      day: this.day(source.day),
      session:
        source.session == null
          ? source.session
          : { id: source.session.id, name: source.session.name },
      ...(source.schedule === undefined
        ? {}
        : {
            schedule: {
              id: source.schedule.id,
              scheduledOn: source.schedule.scheduledOn,
              timeZone: source.schedule.timeZone,
            },
          }),
    };
  }
  private snapshotTargets(value: WorkoutTargets) {
    return {
      targetSets: value.targetSets,
      targetRepsMin: value.targetRepsMin,
      targetRepsMax: value.targetRepsMax,
      targetLoad: value.targetLoad,
      targetLoadUnit: value.targetLoadUnit,
      targetRpe: value.targetRpe,
    };
  }
  private original(snapshot: ExerciseSnapshot | null) {
    if (snapshot === null) return null;
    return {
      source: {
        kind: snapshot.source.kind,
        id: snapshot.source.id,
        ...(snapshot.source.plan === undefined
          ? {}
          : { plan: this.plan(snapshot.source.plan) }),
        ...(snapshot.source.week === undefined
          ? {}
          : { week: this.week(snapshot.source.week) }),
        ...(snapshot.source.day === undefined
          ? {}
          : { day: this.day(snapshot.source.day) }),
      },
      exercise: this.identity(snapshot.exercise),
      targets: this.snapshotTargets(snapshot.targets),
      position: snapshot.position,
      notes: snapshot.notes,
    };
  }
  private targets(value: WorkoutTargetAttributes) {
    return {
      targetSets: value.targetSets,
      targetRepsMin: value.targetRepsMin,
      targetRepsMax: value.targetRepsMax,
      targetLoad: value.targetLoad?.toString() ?? null,
      targetLoadUnit: value.targetLoadUnit,
      targetRpe: value.targetRpe === null ? null : Number(value.targetRpe),
    };
  }
  set(set: SetRecordAttributes) {
    return {
      id: set.id,
      setNumber: set.setNumber,
      load: set.load?.toString() ?? null,
      loadUnit: set.loadUnit,
      loadKg: set.loadKg?.toString() ?? null,
      repetitions: set.repetitions,
      rpe: set.rpe === null ? null : Number(set.rpe),
      kind: set.kind,
      status: set.status,
      isCompleted: set.isCompleted,
      notes: set.notes,
      recordedAt: set.recordedAt,
      version: set.version,
    };
  }
  private prescription(value: WorkoutPrescription | null) {
    if (value === null) return null;
    return {
      id: value.id,
      targetSets: value.targetSets,
      targetReps: value.targetReps,
      ...(value.targetRepsMin === undefined
        ? {}
        : { targetRepsMin: value.targetRepsMin }),
      ...(value.targetRepsMax === undefined
        ? {}
        : { targetRepsMax: value.targetRepsMax }),
      ...(value.targetLoadUnit === undefined
        ? {}
        : { targetLoadUnit: value.targetLoadUnit }),
      targetRpe: value.targetRpe === null ? null : Number(value.targetRpe),
      targetLoad: value.targetLoad === null ? null : Number(value.targetLoad),
      notes: value.notes,
    };
  }
  private exercise(exercise: WorkoutExerciseAttributes) {
    return {
      id: exercise.id,
      orderInSession: exercise.orderInSession,
      notes: exercise.notes,
      exercise: this.identity(exercise.exercise),
      prescription: this.prescription(exercise.prescription),
      ...(exercise.isOmitted === undefined
        ? {}
        : { isOmitted: exercise.isOmitted }),
      ...(exercise.replacesWorkoutExerciseId === undefined
        ? {}
        : { replacesWorkoutExerciseId: exercise.replacesWorkoutExerciseId }),
      ...(exercise.sets === undefined
        ? {}
        : { sets: exercise.sets.map((set) => this.set(set)) }),
      ...(exercise.original === undefined
        ? {}
        : { original: this.original(exercise.original) }),
      ...(exercise.targets === undefined
        ? {}
        : { targets: this.targets(exercise.targets) }),
    };
  }
  summary(session: WorkoutSession) {
    const value = session.attributes;
    return {
      id: value.id,
      status: value.status,
      startedAt: value.startedAt,
      finishedAt: value.finishedAt,
      notes: value.notes,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      trainingPlan: this.plan(value.trainingPlan),
      planWeek: this.week(value.planWeek),
      exerciseCount: value.exerciseCount,
      ...(value.scheduledActivityId === undefined
        ? {}
        : { scheduledActivityId: value.scheduledActivityId }),
      ...(value.planDay === undefined
        ? {}
        : { planDay: this.day(value.planDay) }),
      ...(value.performedOn === undefined
        ? {}
        : { performedOn: value.performedOn }),
      ...(value.timeZone === undefined ? {} : { timeZone: value.timeZone }),
      ...(value.recordingMode === undefined
        ? {}
        : { recordingMode: value.recordingMode }),
      ...(value.actualSetCount === undefined
        ? {}
        : { actualSetCount: value.actualSetCount }),
      ...(value.completedSetCount === undefined
        ? {}
        : { completedSetCount: value.completedSetCount }),
      ...(value.sourceSnapshot === undefined
        ? {}
        : { sourceSnapshot: this.source(value.sourceSnapshot) }),
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.version === undefined ? {} : { version: value.version }),
      ...(value.completedAt === undefined
        ? {}
        : { completedAt: value.completedAt }),
    };
  }
  detail(session: WorkoutSession<WorkoutDetailAttributes>) {
    return {
      ...this.summary(session),
      exercises: session.attributes.exercises.map((exercise) =>
        this.exercise(exercise),
      ),
    };
  }
  page(page: {
    items: WorkoutSession[];
    total: number;
    limit: number;
    offset: number;
  }) {
    return {
      items: page.items.map((session) => this.summary(session)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }
  suggestions(result: WorkoutSuggestions) {
    return {
      performedOn: result.performedOn,
      timeZone: result.timeZone,
      resolution: result.resolution,
      candidates: result.candidates.map((item) => ({
        trainingPlanId: item.trainingPlanId,
        planWeekId: item.planWeekId,
        planDayId: item.planDayId,
        planName: item.planName,
        weekNumber: item.weekNumber,
        name: item.name,
        ...(item.scheduledActivityId === undefined
          ? {}
          : { scheduledActivityId: item.scheduledActivityId }),
      })),
    };
  }
  savedDay(day: SavedWorkoutDay) {
    return {
      id: day.id,
      name: day.name,
      planWeekId: day.planWeekId,
      trainingPlanId: day.trainingPlanId,
    };
  }
}
