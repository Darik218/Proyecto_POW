import type { WorkoutStatus } from '../generated/prisma/client';
import { WorkoutRepositoryError } from './workout-sessions.repository';

export function requireInProgress(status: WorkoutStatus): void {
  if (status !== 'IN_PROGRESS')
    throw new WorkoutRepositoryError(
      'conflict',
      'Only sessions in progress can be modified.',
    );
}
export function sessionTransition(
  session: {
    status: WorkoutStatus;
    startedAt: Date | null;
    finishedAt: Date | null;
  },
  action: 'start' | 'complete',
  exerciseCount: number,
  now: Date,
  confirmWithoutResults = false,
): { status: WorkoutStatus; startedAt?: Date; finishedAt?: Date } | null {
  if (action === 'start') {
    if (
      session.status === 'IN_PROGRESS' &&
      session.startedAt &&
      !session.finishedAt
    )
      return null;
    if (
      session.status !== 'PLANNED' ||
      session.startedAt ||
      session.finishedAt
    ) {
      throw new WorkoutRepositoryError(
        'conflict',
        'This session cannot be started.',
      );
    }
    return { status: 'IN_PROGRESS', startedAt: now };
  }
  if (
    session.status === 'COMPLETED' &&
    session.startedAt &&
    session.finishedAt &&
    session.finishedAt >= session.startedAt
  )
    return null;
  requireInProgress(session.status);
  if (
    !session.startedAt ||
    session.finishedAt ||
    (exerciseCount === 0 && !confirmWithoutResults)
  ) {
    throw new WorkoutRepositoryError(
      'conflict',
      'A session needs a start time; completing without actual results requires explicit confirmation.',
    );
  }
  return {
    status: 'COMPLETED',
    finishedAt: new Date(Math.max(now.getTime(), session.startedAt.getTime())),
  };
}
