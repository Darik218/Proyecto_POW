import type {
  PerformanceReason,
  PerformanceTask,
  TaskContext,
} from '../../models/progression/performance-analysis.model';
export function comparableTasks(
  previous: PerformanceTask,
  current: PerformanceTask,
  a: TaskContext | null,
  b: TaskContext | null,
  timeZone: string,
): PerformanceReason[] {
  const reasons: PerformanceReason[] = [];
  if (previous.athleteId !== current.athleteId)
    reasons.push('ATHLETE_MISMATCH');
  if (previous.exerciseId !== current.exerciseId)
    reasons.push('EXERCISE_MISMATCH');
  if (
    previous.sessionStatus !== 'COMPLETED' ||
    current.sessionStatus !== 'COMPLETED'
  )
    reasons.push('SESSION_NOT_COMPLETED');
  if (previous.isOmitted || current.isOmitted) reasons.push('EXERCISE_OMITTED');
  if (!previous.performedOn || !current.performedOn)
    reasons.push('DATE_UNKNOWN');
  else if (previous.performedOn === current.performedOn)
    reasons.push('INTRADAY_ORDER_UNKNOWN');
  else if (previous.performedOn > current.performedOn)
    reasons.push('REVERSED_DATE_ORDER');
  if (previous.timeZone !== timeZone || current.timeZone !== timeZone)
    reasons.push('TIME_ZONE_MISMATCH');
  if (!a?.protocolKey || !b?.protocolKey || a.protocolKey !== b.protocolKey)
    reasons.push('PROTOCOL_NOT_COMPARABLE');
  if (!a?.equipmentKey || !b?.equipmentKey || a.equipmentKey !== b.equipmentKey)
    reasons.push('EQUIPMENT_NOT_COMPARABLE');
  if (!a || !b || a.loadMeaning === 'UNKNOWN' || b.loadMeaning === 'UNKNOWN')
    reasons.push('LOAD_MEANING_UNKNOWN');
  else if (
    a.loadMeaning !== 'EXTERNAL_TOTAL' ||
    b.loadMeaning !== 'EXTERNAL_TOTAL'
  )
    reasons.push('LOAD_MEANING_CONFLICT');
  return reasons;
}
