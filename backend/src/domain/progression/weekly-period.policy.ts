import type { WeeklyPeriod } from '../../models/progression/recommendation-draft.model';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
import { validSportDate } from './performance-query.policy';
export function validateWeeklyPeriod(input: WeeklyPeriod) {
  const invalid = (): never => {
    throw new RecommendationError('INVALID_PERIOD');
  };
  if (
    !input ||
    !validSportDate(input.start) ||
    !validSportDate(input.endExclusive) ||
    !validSportDate(input.cutoffOn) ||
    !Number.isSafeInteger(input.weekStartsOn) ||
    input.weekStartsOn < 1 ||
    input.weekStartsOn > 7 ||
    typeof input.timeZone !== 'string' ||
    input.timeZone.length > 100
  )
    invalid();
  // UTC is only a representation of the civil date, not the athlete's timezone.
  const start = new Date(input.start + 'T00:00:00Z');
  const weekday = start.getUTCDay() || 7;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  if (
    end.toISOString().slice(0, 10) !== input.endExclusive ||
    weekday !== input.weekStartsOn ||
    input.cutoffOn < input.start ||
    input.cutoffOn >= input.endExclusive
  )
    invalid();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(0);
  } catch {
    invalid();
  }
  const last = new Date(end);
  last.setUTCDate(last.getUTCDate() - 1);
  return {
    ...input,
    lastOn: last.toISOString().slice(0, 10),
    closed: input.cutoffOn === last.toISOString().slice(0, 10),
  };
}
