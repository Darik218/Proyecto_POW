import { Decimal } from '@prisma/client/runtime/client';

export const workoutAttributes = {
  id: '71000000-0000-4000-8000-000000000001',
  status: 'IN_PROGRESS' as const,
  startedAt: new Date('2026-01-01T10:00:00.123Z'),
  finishedAt: null as Date | null,
  createdAt: new Date('2026-01-01T09:00:00.456Z'),
  updatedAt: new Date('2026-01-01T10:00:00.123Z'),
  notes: null as string | null,
  trainingPlan: null,
  planWeek: null,
  exerciseCount: 1,
  version: 3,
  name: 'Entrenamiento MVC4',
  sourceSnapshot: {
    kind: 'FREE' as const,
    plan: null,
    week: null,
    day: null,
    session: null,
  },
};
export const exerciseIdentity = {
  id: '72000000-0000-4000-8000-000000000001',
  name: 'Press histórico',
  equipment: 'Barra',
  muscleGroup: 'Pectorales',
};
export const snapshotTargets = {
  targetSets: 3,
  targetRepsMin: 6,
  targetRepsMax: 8,
  targetLoad: '80',
  targetLoadUnit: 'KG' as const,
  targetRpe: 7.5,
};
export const originalSnapshot = {
  source: { kind: 'FREE' as const, id: null },
  exercise: { ...exerciseIdentity },
  targets: snapshotTargets,
  position: 1,
  notes: null as string | null,
};
export const setAttributes = {
  id: '74000000-0000-4000-8000-000000000001',
  setNumber: 1,
  load: new Decimal('75.125') as Decimal | null,
  loadKg: new Decimal('75.125') as Decimal | null,
  loadUnit: 'KG' as 'KG' | 'LB' | null,
  repetitions: 7 as number | null,
  rpe: new Decimal('9.5') as Decimal | null,
  kind: 'WORK' as const,
  status: 'INCOMPLETE' as const,
  isCompleted: false,
  notes: '' as string | null,
  recordedAt: new Date('2026-01-01T10:15:00.789Z'),
  version: 1,
};
export const workoutExerciseAttributes = {
  id: '73000000-0000-4000-8000-000000000001',
  orderInSession: 1,
  notes: null as string | null,
  isOmitted: false,
  replacesWorkoutExerciseId: null,
  exercise: exerciseIdentity,
  original: originalSnapshot,
  targets: {
    ...snapshotTargets,
    targetLoad: new Decimal('77.125') as Decimal | null,
    targetRpe: new Decimal('8.5') as Decimal | null,
  },
  sets: [setAttributes],
  prescription: null,
};
