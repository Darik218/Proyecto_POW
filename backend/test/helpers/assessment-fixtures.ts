import { analyzePerformance } from '../../src/domain/progression/performance';
import type {
  CompliancePolicy,
  ComplianceRule,
} from '../../src/models/progression/prescription-assessment.model';
import type {
  PerformanceHistory,
  PerformanceSet,
  PerformanceTask,
  ValidatedPerformanceQuery,
} from '../../src/models/progression/performance-analysis.model';
export const task = (id = 'a', date = '2026-01-01'): PerformanceTask => ({
  id,
  athleteId: 'athlete',
  exerciseId: 'exercise',
  sessionId: 'session-' + id,
  sessionVersion: 2,
  sessionStatus: 'COMPLETED',
  orderInSession: 1,
  isOmitted: false,
  performedOn: date,
  timeZone: 'UTC',
  availableSets: 1,
  originalTargets: {
    targetSets: 1,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetLoad: '100',
    targetLoadUnit: 'KG',
    targetRpe: 8,
  },
  adjustedTargets: {
    targetSets: 1,
    targetRepsMin: 5,
    targetRepsMax: 6,
    targetLoad: '80',
    targetLoadUnit: 'KG',
    targetRpe: '8',
  },
});
export const set = (taskId = 'a'): PerformanceSet => ({
  id: 'set-' + taskId,
  workoutExerciseId: taskId,
  setNumber: 1,
  version: 1,
  status: 'COMPLETED',
  kind: 'WORK',
  isCompleted: true,
  load: '80',
  loadUnit: 'KG',
  loadKg: '80.000000',
  repetitions: 6,
  rpe: '7',
  recordedAt: '2026-02-01T00:00:00Z',
});
export function analysis(
  tasks = [task()],
  sets = [set()],
  truncated = false,
  comparisons?: ValidatedPerformanceQuery['comparisons'],
) {
  const h: PerformanceHistory = {
    athleteId: 'athlete',
    userId: 'user',
    exerciseId: 'exercise',
    exerciseIsActive: true,
    tasks,
    sets,
    estimates: [],
    truncated: { tasks: truncated, sets: false, estimates: false },
  };
  const q: ValidatedPerformanceQuery = {
    exerciseId: 'exercise',
    from: '2026-01-01',
    to: '2026-01-31',
    timeZone: 'UTC',
    limit: 100,
    contexts: tasks.map((t) => ({
      workoutExerciseId: t.id,
      loadMeaning: 'EXTERNAL_TOTAL',
      protocolKey: 'p',
      equipmentKey: 'e',
      source: 'OWNER_DECLARATION_FOR_ANALYSIS',
    })),
    comparisons:
      comparisons ??
      (tasks.length >= 2
        ? tasks.slice(0, -1).map((t) => ({
            previousTaskId: t.id,
            currentTaskId: tasks[tasks.length - 1].id,
          }))
        : []),
  };
  return analyzePerformance(h, q);
}
export const rule: ComplianceRule = {
  repetitions: 'MINIMUM',
  load: 'AT_LEAST_TARGET',
  rpe: 'DESCRIBE',
  coverage: 'ALL_REQUIRED',
};
export const policy = (ids = ['a']): CompliancePolicy => ({
  id: 'explicit-test',
  slots: ids.map((taskId) => ({
    taskId,
    original: [1],
    adjusted: [1],
    originalLoadMeaning: 'EXTERNAL_TOTAL',
    adjustedLoadMeaning: 'EXTERNAL_TOTAL',
  })),
  basic: rule,
});
