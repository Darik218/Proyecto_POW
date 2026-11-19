import { validateWeeklyPeriod } from './weekly-period.policy';
import { validSportDate } from './performance-query.policy';
import { resolveEffectiveSettings } from './effective-settings.policy';
import type { RecommendationCommand } from '../../models/progression/recommendation-draft.model';
import type {
  DependencyKeys,
  RecommendationDraft,
  RecommendationInsert,
} from '../../models/progression/persisted-recommendation.model';
import { RecommendationPersistenceError as Failure } from '../../models/progression/persisted-recommendation.model';
import {
  recommendationDependencyKeys,
  recommendationIdentity,
} from './recommendation-evidence.policy';
import {
  compareDrafts,
  RECOMMENDATION_ENGINE_VERSION,
} from './recommendation.policy';
import { calculateIncrement } from './load-increment.policy';
import { assertPersistableDecimal } from './estimate-evidence.policy';
const keys = ['configuration', 'destination', 'evidence', 'period'] as const;
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validateSaveExpectation(value: unknown): {
  expectedSemanticKey: string;
  expectedDependencyKeys: DependencyKeys;
} {
  if (
    !object(value) ||
    !sha(value.expectedSemanticKey) ||
    !object(value.expectedDependencyKeys) ||
    Object.keys(value.expectedDependencyKeys).sort().join(',') !==
      keys.join(',') ||
    !keys.every((k) =>
      sha((value.expectedDependencyKeys as Record<string, unknown>)[k]),
    )
  )
    throw new Failure('INVALID_PERSISTENCE_COMMAND');
  return {
    expectedSemanticKey: value.expectedSemanticKey,
    expectedDependencyKeys: structuredClone(
      value.expectedDependencyKeys,
    ) as DependencyKeys,
  };
}
export function recommendationRequestKey(
  command: RecommendationCommand,
  taskIds: readonly string[],
): string {
  const selected = new Set(taskIds);
  const effective = {
    ...command,
    history: {
      ...command.history,
      contexts: command.history.contexts?.filter((c) =>
        selected.has(c.workoutExerciseId),
      ),
      comparisons: command.history.comparisons?.filter(
        (c) => selected.has(c.previousTaskId) && selected.has(c.currentTaskId),
      ),
    },
  };
  return recommendationIdentity({
    schemaVersion: 'neutral-recommendation-request-v1',
    command: JSON.parse(JSON.stringify(effective)),
  });
}
export function recommendationCycleKey(
  snapshot: RecommendationDraft['evidence'],
): string {
  const target = snapshot.destination;
  return recommendationIdentity({
    schemaVersion: 'weekly-recommendation-cycle-v1',
    athleteId: snapshot.athleteId,
    exerciseId: snapshot.exerciseId,
    period: {
      start: snapshot.period.start,
      endExclusive: snapshot.period.endExclusive,
    },
    // Scope remains stable across setting revisions; a prescribed task resolves to its template.
    destination: target.prescriptionId
      ? {
          planId: target.planId,
          weekId: target.weekId,
          dayId: target.dayId,
          prescriptionId: target.prescriptionId,
        }
      : { taskId: target.taskId },
  });
}
/** Inspect an internally generated, JSON-roundtripped capture, never client evidence. */
export function inspectGeneration(
  snapshot: unknown,
  semanticKey: string,
  dependencyKeys: unknown,
): RecommendationDraft {
  try {
    const expected = validateSaveExpectation({
      expectedSemanticKey: semanticKey,
      expectedDependencyKeys: dependencyKeys,
    });
    if (
      !object(snapshot) ||
      snapshot.schemaVersion !== 'recommendation-evidence-v1' ||
      snapshot.engineVersion !== RECOMMENDATION_ENGINE_VERSION ||
      snapshot.decision !== 'INCREASE' ||
      typeof snapshot.athleteId !== 'string' ||
      typeof snapshot.exerciseId !== 'string' ||
      !object(snapshot.period) ||
      !object(snapshot.historyWindow) ||
      !object(snapshot.destination) ||
      !object(snapshot.source) ||
      !Array.isArray(snapshot.source.tasks) ||
      !snapshot.source.tasks.length ||
      !Array.isArray(snapshot.source.sets) ||
      !object(snapshot.assessment) ||
      !object(snapshot.oneRm) ||
      !object(snapshot.coverage) ||
      !Array.isArray(snapshot.excludedTasks) ||
      !Array.isArray(snapshot.reasons) ||
      !object(snapshot.configuration) ||
      !object(snapshot.increment)
    )
      throw new Failure('SNAPSHOT_INVALID');
    const e = snapshot as unknown as RecommendationDraft['evidence'],
      c = e.configuration,
      i = e.increment;
    if (
      c.status !== 'VALID' ||
      !c.selected ||
      !c.policy ||
      !c.mode ||
      c.policy.provenance.source !== 'EXPLICIT_INTERNAL_POLICY' ||
      !c.policy.id ||
      !c.policy.version ||
      !c.policy.provenance.reference ||
      !i ||
      i.status !== 'INCREASE' ||
      e.source.tasks.some(
        (t) =>
          t.athleteId !== e.athleteId ||
          t.exerciseId !== e.exerciseId ||
          t.sessionStatus !== 'COMPLETED',
      ) ||
      e.source.sets.some(
        (s) => !e.source.tasks.some((t) => t.id === s.workoutExerciseId),
      ) ||
      recommendationIdentity(e) !== semanticKey ||
      recommendationIdentity(recommendationDependencyKeys(e)) !==
        recommendationIdentity(expected.expectedDependencyKeys)
    )
      throw new Failure('SNAPSHOT_INVALID');
    const period = validateWeeklyPeriod(e.period),
      target = e.destination;
    const id = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
    if (
      period.lastOn !== e.period.lastOn ||
      period.closed !== e.period.closed ||
      !validSportDate(e.historyWindow.from) ||
      !validSportDate(e.historyWindow.to) ||
      e.historyWindow.from > e.period.start ||
      e.historyWindow.to !== e.period.cutoffOn ||
      e.historyWindow.timeZone !== e.period.timeZone ||
      !['PRESCRIPTION', 'WORKOUT_TASK'].includes(target.kind) ||
      typeof target.retired !== 'boolean' ||
      target.retired ||
      (target.kind === 'WORKOUT_TASK' && !id(target.taskId)) ||
      (target.kind === 'PRESCRIPTION' &&
        (![target.planId, target.weekId, target.prescriptionId].every(id) ||
          !target.targets)) ||
      e.source.tasks.some(
        (t) =>
          !id(t.id) ||
          !id(t.sessionId) ||
          !Number.isSafeInteger(t.sessionVersion) ||
          typeof t.performedOn !== 'string' ||
          !validSportDate(t.performedOn) ||
          typeof t.isOmitted !== 'boolean',
      ) ||
      e.source.sets.some(
        (s) =>
          !id(s.id) ||
          !id(s.workoutExerciseId) ||
          !Number.isSafeInteger(s.version) ||
          !Number.isSafeInteger(s.setNumber),
      ) ||
      new Set(e.source.tasks.map((t) => t.id)).size !== e.source.tasks.length ||
      new Set(e.source.sets.map((s) => s.id)).size !== e.source.sets.length ||
      recommendationIdentity(
        resolveEffectiveSettings(
          [c.selected],
          e.athleteId,
          e.exerciseId,
          target.planId,
          c.policy,
        ),
      ) !== recommendationIdentity(c)
    )
      throw new Failure('SNAPSHOT_INVALID');
    const reproduced = calculateIncrement({
      current: i.currentLoad,
      unit: i.unit,
      meaning: c.policy.loadMeaning,
      mode: c.mode,
      absolute: c.selected.incrementAbsolute,
      percent: c.selected.incrementPercent,
      maximumPercent: c.selected.maxIncrementPercent,
      maximumLoad: c.selected.maxLoad,
      grid: c.policy.grid,
    });
    if (recommendationIdentity(reproduced) !== recommendationIdentity(i))
      throw new Failure('SNAPSHOT_INVALID');
    return {
      decision: e.decision,
      reasons: e.reasons,
      increment: i,
      evidence: e,
      semanticKey,
      dependencyKeys: expected.expectedDependencyKeys,
      applicationAuthorization: 'NOT_GRANTED',
    };
  } catch (error) {
    if (error instanceof Failure && error.code === 'SNAPSHOT_INVALID')
      throw error;
    throw new Failure('SNAPSHOT_INVALID');
  }
}
export function prepareRecommendationInsert(
  draft: RecommendationDraft,
  command: RecommendationCommand,
  expectation: unknown,
): RecommendationInsert {
  const expected = validateSaveExpectation(expectation),
    freshness = compareDrafts(
      {
        semanticKey: expected.expectedSemanticKey,
        dependencyKeys: expected.expectedDependencyKeys,
      },
      draft,
    );
  if (freshness.obsolete || freshness.changed.length)
    throw new Failure('STALE_PROPOSAL', freshness.changed);
  if (
    draft.decision !== 'INCREASE' ||
    draft.applicationAuthorization !== 'NOT_GRANTED'
  )
    throw new Failure('NOT_PERSISTIBLE');
  const checked = inspectGeneration(
      draft.evidence,
      draft.semanticKey,
      draft.dependencyKeys,
    ),
    i = checked.increment!;
  if (recommendationIdentity(i) !== recommendationIdentity(draft.increment))
    throw new Failure('SNAPSHOT_INVALID');
  try {
    for (const v of [
      i.currentLoad,
      i.proposedLoad,
      i.currentLoadKg,
      i.proposedLoadKg,
    ]) {
      if (typeof v !== 'string') throw new Error();
      assertPersistableDecimal(v, 24, 6);
    }
  } catch {
    throw new Failure('DECIMAL_NOT_PERSISTABLE');
  }
  if (i.unit !== 'KG' && i.unit !== 'LB') throw new Failure('SNAPSHOT_INVALID');
  const cycleKey = recommendationCycleKey(checked.evidence);
  return {
    athleteId: checked.evidence.athleteId,
    exerciseId: checked.evidence.exerciseId,
    previousLoad: i.currentLoad!,
    recommendedLoad: i.proposedLoad!,
    loadUnit: i.unit,
    previousLoadKg: i.currentLoadKg!,
    recommendedLoadKg: i.proposedLoadKg!,
    semanticKey: draft.semanticKey,
    cycleKey,
    cycleSlot: cycleKey,
    requestKey: recommendationRequestKey(
      command,
      checked.evidence.source.tasks.map((t) => t.id),
    ),
    algorithmVersion: checked.evidence.engineVersion,
    proposalKind: 'NEUTRAL_INTERNAL',
    snapshot: structuredClone(checked.evidence),
    dependencyKeys: checked.dependencyKeys,
    effectiveSettings: checked.evidence.configuration,
    sessionIds: [
      ...new Set(checked.evidence.source.tasks.map((t) => t.sessionId)),
    ].sort(),
  };
}
