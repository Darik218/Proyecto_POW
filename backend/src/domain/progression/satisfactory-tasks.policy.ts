import type {
  AssessmentStatus,
  CountPolicy,
  PerformanceAnalysis,
} from '../../models/progression/prescription-assessment.model';
import { AssessmentError } from '../../models/progression/prescription-assessment.model';
import { assessPrescriptions } from './prescription-assessment.policy';
import { sameTargets } from './effort-analysis.policy';
import { comparableTasks } from './comparability.policy';
import { validateAssessmentOptions } from './assessment-query.policy';
export function countSatisfactoryTasks(
  analysis: PerformanceAnalysis,
  assessments: ReturnType<typeof assessPrescriptions>,
  input: CountPolicy | undefined,
) {
  const policy = validateAssessmentOptions(input ? { count: input } : {}).count;
  const empty = (status: AssessmentStatus, reasons: string[]) => ({
    status,
    reasons,
    evaluatedTasks: 0,
    distinctSessions: 0,
    satisfactorySessions: 0,
    qualifyingCount: 0,
    countUnit: null as string | null,
    partialTasks: 0,
    notEvaluableTasks: 0,
    meetsMinimum: null as boolean | null,
    taskIds: [] as string[],
    excluded: [] as { taskId: string; reasons: string[] }[],
  });
  if (!policy)
    return empty('CONFIGURATION_REQUIRED', ['COUNT_POLICY_REQUIRED']);
  const anchor = analysis.tasks.find((t) => t.id === policy.anchorTaskId);
  if (!anchor) throw new AssessmentError('TASK_NOT_IN_SELECTION');
  const excluded: { taskId: string; reasons: string[] }[] = [];
  const selected = analysis.tasks.filter((t) => {
    const reasons: string[] = [];
    if (
      !t.performedOn ||
      t.performedOn < analysis.window.from ||
      t.performedOn > analysis.window.to ||
      t.timeZone !== analysis.window.timeZone
    )
      reasons.push('DATE_OUTSIDE_WINDOW_OR_UNKNOWN');
    if (t.id === anchor.id) {
      if (
        t.isOmitted ||
        t.sessionStatus !== 'COMPLETED' ||
        !t.context?.protocolKey ||
        !t.context.equipmentKey ||
        t.context.loadMeaning !== 'EXTERNAL_TOTAL'
      )
        reasons.push('ANCHOR_NOT_COMPARABLE');
    } else {
      const [a, b] =
        (t.performedOn ?? '') <= (anchor.performedOn ?? '')
          ? [t, anchor]
          : [anchor, t];
      reasons.push(
        ...comparableTasks(
          a,
          b,
          a.context,
          b.context,
          analysis.window.timeZone,
        ).filter((r) => r !== 'INTRADAY_ORDER_UNKNOWN'),
      );
    }
    if (!sameTargets(t, anchor, policy.basis))
      reasons.push('TARGETS_NOT_COMPARABLE');
    if (reasons.length)
      excluded.push({ taskId: t.id, reasons: [...new Set(reasons)] });
    return reasons.length === 0;
  });
  const groups = new Map<string, typeof selected>();
  for (const t of selected) {
    const group = groups.get(t.sessionId) ?? [];
    group.push(t);
    groups.set(t.sessionId, group);
  }
  const sessions = [...groups.values()]
    .map((tasks) => {
      const values = tasks.map(
        (t) =>
          assessments.tasks.find((a) => a.taskId === t.id)![
            policy.basis === 'ORIGINAL' ? 'original' : 'adjusted'
          ][policy.criterion === 'BASIC' ? 'basic' : 'readiness'].result,
      );
      const date = tasks[0].performedOn!;
      return {
        date,
        tasks,
        satisfied: values.every((v) => v === 'SATISFIED'),
        unknown: values.some(
          (v) =>
            v === 'NOT_EVALUABLE' ||
            v === 'CONFIGURATION_REQUIRED' ||
            (v === 'PARTIAL' &&
              tasks.some((t) =>
                assessments.tasks
                  .find((a) => a.taskId === t.id)!
                  [policy.basis === 'ORIGINAL' ? 'original' : 'adjusted'][
                    policy.criterion === 'BASIC' ? 'basic' : 'readiness'
                  ].reasons.includes('INSUFFICIENT_SLOT_EVIDENCE'),
              )),
        ),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (
    policy.mode === 'CONSECUTIVE' &&
    new Set(sessions.map((s) => s.date)).size !== sessions.length
  )
    return {
      ...empty('NOT_EVALUABLE', ['INTRADAY_ORDER_UNKNOWN']),
      evaluatedTasks: selected.length,
      distinctSessions: sessions.length,
      excluded,
    };
  const units =
    policy.sameDate === 'DISTINCT_SESSIONS'
      ? sessions
      : [...new Set(sessions.map((s) => s.date))].map((date) => {
          const day = sessions.filter((s) => s.date === date);
          return {
            date,
            satisfied: day.every((s) => s.satisfied),
            unknown: day.some((s) => s.unknown),
          };
        });
  let satisfactorySessions = 0,
    undecidable = false;
  if (policy.mode === 'ACCUMULATED') {
    satisfactorySessions = units.filter((s) => s.satisfied).length;
    undecidable = units.some((s) => s.unknown);
  } else
    for (const s of [...units].reverse()) {
      if (s.satisfied) satisfactorySessions++;
      else {
        undecidable = s.unknown;
        break;
      }
    }
  const truncated = Object.values(analysis.coverage.truncated).some(Boolean);
  const sequenceGaps = policy.mode === 'CONSECUTIVE' && excluded.length > 0;
  undecidable ||= sequenceGaps;
  const values = selected.map(
    (t) =>
      assessments.tasks.find((a) => a.taskId === t.id)![
        policy.basis === 'ORIGINAL' ? 'original' : 'adjusted'
      ][policy.criterion === 'BASIC' ? 'basic' : 'readiness'].result,
  );
  return {
    status:
      truncated || undecidable
        ? ('PARTIAL' as const)
        : sessions.length
          ? ('AVAILABLE' as const)
          : ('NOT_EVALUABLE' as const),
    reasons: [
      ...(truncated ? ['READ_LIMIT_REACHED'] : []),
      ...(undecidable ? ['INSUFFICIENT_TASK_EVIDENCE'] : []),
    ],
    evaluatedTasks: selected.length,
    distinctSessions: sessions.length,
    satisfactorySessions: sessions.filter((s) => s.satisfied).length,
    qualifyingCount: satisfactorySessions,
    countUnit:
      policy.sameDate === 'DISTINCT_DATES'
        ? 'SPORTING_DATES'
        : 'DISTINCT_SESSIONS',
    partialTasks: values.filter((v) => v === 'PARTIAL').length,
    notEvaluableTasks: values.filter(
      (v) => v === 'NOT_EVALUABLE' || v === 'CONFIGURATION_REQUIRED',
    ).length,
    meetsMinimum:
      truncated || sequenceGaps || !sessions.length
        ? null
        : satisfactorySessions >= policy.minimumSessions
          ? true
          : undecidable
            ? null
            : false,
    taskIds: selected.map((t) => t.id),
    excluded,
  };
}
