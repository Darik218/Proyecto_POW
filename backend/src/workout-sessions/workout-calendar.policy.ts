import { createHash } from 'node:crypto';
import { WorkoutRepositoryError } from './workout-sessions.repository';
export function localDate(timeZone: string, now = new Date()): string {
  try {
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) throw new Error('Invalid IANA time zone');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) =>
      parts.find((value) => value.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    throw new WorkoutRepositoryError(
      'invalid',
      'Provide a valid IANA time zone.',
    );
  }
}
export function creationHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function requireVersion(actual: number, expected: number) {
  if (actual !== expected)
    throw new WorkoutRepositoryError(
      'conflict',
      'This session changed. Reload it before applying another edit.',
    );
}
export function requireEditable(status: string) {
  if (status !== 'PLANNED' && status !== 'IN_PROGRESS')
    throw new WorkoutRepositoryError(
      'conflict',
      'Only planned or in-progress sessions can be modified.',
    );
}
