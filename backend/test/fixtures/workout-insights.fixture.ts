import { Decimal } from '@prisma/client/runtime/client';
import { WorkoutSession } from '../../src/models/workout-sessions/workout-session.model';
import type { WorkoutDetailAttributes } from '../../src/models/workout-sessions/workout-session.model';

const now = new Date('2026-11-12T12:00:00Z');
export function insightFixture(): WorkoutSession<WorkoutDetailAttributes> {
  return new WorkoutSession({
    id: '10000000-0000-4000-8000-000000000001',
    status: 'COMPLETED',
    performedOn: now,
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
    trainingPlan: null,
    planWeek: null,
    notes: null,
    exerciseCount: 1,
    exercises: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        orderInSession: 1,
        notes: null,
        prescription: null,
        isOmitted: false,
        oneRmSuitability: 'SUITABLE',
        exercise: {
          id: '30000000-0000-4000-8000-000000000001',
          name: 'Press',
          equipment: 'Barra',
          muscleGroup: 'Pecho',
        },
        sets: [
          {
            id: '40000000-0000-4000-8000-000000000001',
            setNumber: 1,
            load: new Decimal('60'),
            loadUnit: 'KG',
            loadKg: new Decimal('60'),
            repetitions: 8,
            rpe: new Decimal('8'),
            kind: 'WORK',
            status: 'COMPLETED',
            isCompleted: true,
            notes: null,
            recordedAt: now,
            version: 0,
          },
        ],
      },
    ],
  });
}
