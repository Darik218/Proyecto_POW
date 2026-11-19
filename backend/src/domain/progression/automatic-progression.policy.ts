import { createHash } from 'node:crypto';
import { localDate } from '../../workout-sessions/workout-calendar.policy';
import { recommendationIdentity } from './recommendation-evidence.policy';
/** Civil week, never an assumed 168-hour instant interval (DST safe). */
export function automaticWeek(
  at: Date,
  timeZone: string,
  weekStartsOn: number,
) {
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isInteger(weekStartsOn) ||
    weekStartsOn < 1 ||
    weekStartsOn > 7
  )
    throw Error('Invalid execution week');
  const day = localDate(timeZone, at),
    d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(
    d.getUTCDate() - (((d.getUTCDay() || 7) - weekStartsOn + 7) % 7),
  );
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 7);
  return { start, endExclusive: d.toISOString().slice(0, 10), timeZone };
}
export function automaticIntent(key: string) {
  const h = createHash('sha256')
    .update('automatic-intent-v1\n' + key)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const operationalKey = (value: unknown) =>
  recommendationIdentity({ schemaVersion: 'operational-command-v1', value });
