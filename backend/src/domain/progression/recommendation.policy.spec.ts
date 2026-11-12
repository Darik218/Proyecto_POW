import { recommendationIdentity } from './recommendation-evidence.policy';
import { compareDrafts } from './recommendation.policy';
import { deriveRecommendation } from '../../progression/recommendation.service';
import {
  context,
  command,
} from '../../../test/helpers/recommendation-fixtures';
const result = () => deriveRecommendation(context(), command());
describe('PROG-4A explainable weekly decisions', () => {
  it('combines explicit policy and complete evidence to propose example A', () => {
    expect(result()).toMatchObject({
      decision: 'INCREASE',
      increment: { proposedLoad: '82.500000' },
      applicationAuthorization: 'NOT_GRANTED',
      evidence: { schemaVersion: 'recommendation-evidence-v1' },
    });
  });
  it('does not persist or mutate sources while calculating', () => {
    const h = context(),
      c = command(),
      before = JSON.stringify({ h, c });
    deriveRecommendation(h, c);
    expect(JSON.stringify({ h, c })).toBe(before);
  });
  it('does not invent policy from an existing setting', () => {
    expect(
      deriveRecommendation(context(), { ...command(), policy: undefined })
        .decision,
    ).toBe('CONFIGURATION_REQUIRED');
  });
  it('does not invent settings from an external policy', () => {
    expect(
      deriveRecommendation({ ...context(), settings: [] }, command()).decision,
    ).toBe('CONFIGURATION_REQUIRED');
  });
  it('does not treat a truncated cohort as sufficient', () => {
    const h = context();
    h.history.truncated.tasks = true;
    expect(deriveRecommendation(h, command())).toMatchObject({
      decision: 'INSUFFICIENT_DATA',
      reasons: expect.arrayContaining(['READ_LIMIT_REACHED']),
    });
  });
  it('does not accept true count from partial evidence as approval', () => {
    const h = context();
    h.history.tasks[0] = { ...h.history.tasks[0], availableSets: 2 };
    expect(deriveRecommendation(h, command()).decision).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it('returns maintain when an accredited minimum is not reached', () => {
    const h = context(),
      c = command();
    h.settings = [{ ...h.settings[0], minSuccessfulSessions: 3 }];
    c.policy!.assessment.count = {
      ...c.policy!.assessment.count!,
      minimumSessions: 3,
    };
    expect(deriveRecommendation(h, c).decision).toBe('MAINTAIN');
  });
  it('does not accredit readiness from basic compliance', () => {
    const h = context();
    h.history.sets[1] = { ...h.history.sets[1], repetitions: 5 };
    expect(deriveRecommendation(h, command()).decision).toBe('MAINTAIN');
  });
  it('keeps unknown readiness different from an accredited failure', () => {
    const h = context();
    h.history.sets[1] = { ...h.history.sets[1], rpe: null };
    expect(deriveRecommendation(h, command()).decision).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it('keeps original and adjusted results independent', () => {
    const c = command();
    c.policy = {
      ...c.policy!,
      basis: 'ORIGINAL',
      baseline: 'ANCHOR_ORIGINAL',
      assessment: {
        ...c.policy!.assessment,
        count: { ...c.policy!.assessment.count!, basis: 'ORIGINAL' },
      },
    };
    expect(deriveRecommendation(context(), c).decision).toBe('MAINTAIN');
    expect(result().decision).toBe('INCREASE');
  });
  it('does not turn required but absent signals into no signal', () => {
    const c = command();
    c.policy = { ...c.policy!, review: 'ANY_SIGNAL' };
    expect(deriveRecommendation(context(), c).decision).toBe(
      'CONFIGURATION_REQUIRED',
    );
  });
  it('uses an existing PROG-3 signal to require review without reducing a load', () => {
    const h = context(),
      c = command();
    h.history.sets = [
      { ...h.history.sets[0], repetitions: 10, rpe: '7' },
      { ...h.history.sets[1], repetitions: 8, rpe: '9' },
    ];
    c.policy!.assessment.signal = {
      id: 'review',
      basis: 'ADJUSTED',
      rpeComparison: 'MATCHED_LOAD_DESCRIPTIVE',
      referenceSize: 1,
      rpeThreshold: '1',
      performanceThresholdPercent: '10',
      minimumRpeCoveragePercent: '100',
    };
    c.policy = { ...c.policy!, review: 'ANY_SIGNAL' };
    expect(deriveRecommendation(h, c)).toMatchObject({
      decision: 'REVIEW_REQUIRED',
      increment: null,
    });
  });
  it('strict RPE with changed reps is insufficient, not recovery', () => {
    const h = context(),
      c = command();
    h.history.sets[0] = { ...h.history.sets[0], repetitions: 10 };
    c.policy!.assessment.signal = {
      id: 's',
      basis: 'ADJUSTED',
      rpeComparison: 'STRICT_PROG2',
      referenceSize: 1,
      rpeThreshold: '1',
      performanceThresholdPercent: '10',
      minimumRpeCoveragePercent: '100',
    };
    c.policy = { ...c.policy!, review: 'ANY_SIGNAL' };
    expect(deriveRecommendation(h, c).decision).toBe('INSUFFICIENT_DATA');
  });
  it('does not manufacture order for consecutive sessions on one sporting date', () => {
    const h = context(),
      c = command();
    h.history.tasks[1] = {
      ...h.history.tasks[1],
      performedOn: h.history.tasks[0].performedOn,
    };
    c.policy!.assessment.count = {
      ...c.policy!.assessment.count!,
      mode: 'CONSECUTIVE',
    };
    expect(deriveRecommendation(h, c).decision).toBe('INSUFFICIENT_DATA');
  });
  it('supports explicitly accumulated distinct sessions on one date', () => {
    const h = context();
    h.history.tasks[1] = {
      ...h.history.tasks[1],
      performedOn: h.history.tasks[0].performedOn,
    };
    expect(deriveRecommendation(h, command()).decision).toBe('INCREASE');
  });
  it('does not place unrecorded dates using recordedAt', () => {
    const h = context();
    h.history.tasks[0] = { ...h.history.tasks[0], performedOn: null };
    expect(deriveRecommendation(h, command()).decision).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it('requires an anchor performed in the stated week', () => {
    const h = context();
    h.history.tasks[1] = { ...h.history.tasks[1], performedOn: '2026-01-04' };
    expect(deriveRecommendation(h, command()).reasons).toContain(
      'ANCHOR_OUTSIDE_WEEK',
    );
  });
  it('does not include evidence beyond explicit sporting cutoff', () => {
    const h = context();
    h.history.tasks[1] = { ...h.history.tasks[1], performedOn: '2026-01-12' };
    expect(deriveRecommendation(h, command()).decision).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it('can analyze retrospective records without pretending to recreate historical database state', () => {
    const r = result();
    expect(r.evidence.knowledge).toBe('CURRENT_RECORDS_FOR_SPORTING_CUTOFF');
    expect(
      r.evidence.assessment?.tasks[0].observedSets[0].record.recordedAt,
    ).toBe('2026-02-01T00:00:00Z');
  });
  it('does not mix protocols or equipment', () => {
    const c = command();
    c.history.contexts = [
      { ...c.history.contexts![0], protocolKey: 'different' },
      c.history.contexts![1],
    ];
    expect(deriveRecommendation(context(), c).decision).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it('requires an explicit cohort rather than all occurrences of the exercise', () => {
    const c = command();
    c.policy = { ...c.policy!, cohort: undefined } as never;
    expect(deriveRecommendation(context(), c).decision).toBe(
      'CONFIGURATION_REQUIRED',
    );
  });
  it('does not mix distinct prescriptions under SAME_PRESCRIPTION', () => {
    const c = command(),
      h = context();
    c.policy = { ...c.policy!, cohort: { mode: 'SAME_PRESCRIPTION' } };
    expect(deriveRecommendation(h, c).reasons).toContain(
      'PRESCRIPTION_COHORT_REQUIRES_DESTINATION',
    );
  });
  it('does not use descriptive 1RM as official evidence to override missing readiness', () => {
    const c = command();
    c.policy = { ...c.policy!, oneRm: 'DECISION_CRITERION' };
    expect(deriveRecommendation(context(), c).decision).toBe(
      'CONFIGURATION_REQUIRED',
    );
  });
  it('absent estimates are explicit context and not manufactured results', () => {
    expect(result().evidence.oneRm).toMatchObject({
      use: 'DESCRIPTIVE_CONTEXT_ONLY',
      groups: [],
      excluded: [],
    });
  });
  it('treats changed plan revision as a review condition', () => {
    const h = context();
    h.target = { ...h.target, planVersion: 2 };
    expect(
      deriveRecommendation(h, { ...command(), expectedPlanVersion: 1 }).reasons,
    ).toContain('DESTINATION_VERSION_CHANGED');
  });
  it('does not apply autoApplyAuthorized', () => {
    const h = context();
    h.settings = [{ ...h.settings[0], autoApplyAuthorized: true }];
    expect(deriveRecommendation(h, command()).applicationAuthorization).toBe(
      'NOT_GRANTED',
    );
  });
  it('produces the same semantic identity for reordering unordered inputs', () => {
    const h = context(),
      c = command(),
      a = deriveRecommendation(h, c);
    h.history.tasks = [...h.history.tasks].reverse();
    h.history.sets = [...h.history.sets].reverse();
    c.history.contexts = [...c.history.contexts!].reverse();
    c.policy!.assessment.compliance = {
      ...c.policy!.assessment.compliance!,
      slots: [...c.policy!.assessment.compliance!.slots].reverse(),
    };
    expect(deriveRecommendation(h, c).semanticKey).toBe(a.semanticKey);
  });
  it('normalizes equivalent decimal lexemes without normalizing identifiers', () => {
    const h = context(),
      c = command(),
      a = deriveRecommendation(h, c);
    h.settings = [{ ...h.settings[0], incrementAbsolute: '2.500' }];
    h.history.sets = h.history.sets.map((s) => ({ ...s, load: '80.000' }));
    c.policy = { ...c.policy!, grid: { ...c.policy!.grid, step: '2.5000' } };
    expect(deriveRecommendation(h, c).semanticKey).toBe(a.semanticKey);
  });
  it('changes identity for changed source versions or policy', () => {
    const a = result(),
      h = context();
    h.history.sets[0] = { ...h.history.sets[0], version: 2 };
    const b = deriveRecommendation(h, command());
    expect(b.semanticKey).not.toBe(a.semanticKey);
    expect(compareDrafts(a, b).obsolete).toBe(true);
  });
  it('keeps zero and absence distinct in semantic evidence', () => {
    const h = context(),
      a = result();
    h.history.sets[0] = { ...h.history.sets[0], rpe: '0' };
    expect(deriveRecommendation(h, command()).semanticKey).not.toBe(
      a.semanticKey,
    );
  });
  it('allows an explicitly consecutive valid sequence without comparing the anchor to itself', () => {
    const c = command();
    c.policy!.assessment.count = {
      ...c.policy!.assessment.count!,
      mode: 'CONSECUTIVE',
    };
    expect(deriveRecommendation(context(), c).decision).toBe('INCREASE');
  });
  it('round-trips the actual evidence through JSON without changing semantic identity', () => {
    const r = result();
    expect(recommendationIdentity(JSON.parse(JSON.stringify(r.evidence)))).toBe(
      r.semanticKey,
    );
  });
  it('does not infer readiness of original loads from adjusted achievements', () => {
    const c = command();
    c.policy = { ...c.policy!, baseline: 'ANCHOR_ORIGINAL' };
    expect(deriveRecommendation(context(), c).decision).toBe(
      'CONFIGURATION_REQUIRED',
    );
  });
  it('does not increment a live destination that has diverged from the evaluated target', () => {
    const c = command(),
      h = context();
    h.target = {
      ...h.target,
      kind: 'PRESCRIPTION',
      prescriptionId: 'p',
      planId: 'plan',
      weekId: 'w',
      dayId: 'd',
      planVersion: 1,
      targets: { ...h.history.tasks[1].adjustedTargets, targetLoad: '100' },
    };
    c.policy = { ...c.policy!, baseline: 'DESTINATION_PRESCRIPTION' };
    expect(deriveRecommendation(h, c).reasons).toContain(
      'DESTINATION_TARGETS_DIVERGE',
    );
  });
  it('requires a mandatory review observation of the actual anchor', () => {
    const h = context(),
      c = command();
    h.history.tasks.push({
      ...h.history.tasks[1],
      id: 'c',
      sessionId: 'session-c',
      performedOn: '2026-01-07',
    });
    h.history.sets.push({
      ...h.history.sets[1],
      id: 'set-c',
      workoutExerciseId: 'c',
    });
    c.destination = { kind: 'WORKOUT_TASK', taskId: 'c' };
    h.target = { ...h.target, taskId: 'c' };
    c.policy!.cohort = { mode: 'EXPLICIT_TASK_SET', taskIds: ['a', 'b', 'c'] };
    c.policy!.assessment.count = {
      ...c.policy!.assessment.count!,
      anchorTaskId: 'c',
    };
    c.policy!.assessment.compliance!.slots.push({
      ...c.policy!.assessment.compliance!.slots[1],
      taskId: 'c',
    });
    c.history.contexts!.push({
      ...c.history.contexts![1],
      workoutExerciseId: 'c',
    });
    c.policy!.assessment.signal = {
      id: 's',
      basis: 'ADJUSTED',
      rpeComparison: 'STRICT_PROG2',
      referenceSize: 1,
      rpeThreshold: '1',
      performanceThresholdPercent: '10',
      minimumRpeCoveragePercent: '100',
    };
    c.policy = { ...c.policy!, review: 'ANY_SIGNAL' };
    expect(deriveRecommendation(h, c).decision).toBe('INSUFFICIENT_DATA');
  });
  it('canonicalizes the order of explicitly mapped positions', () => {
    const h = context(),
      c = command();
    h.history.tasks = h.history.tasks.map((t) => ({
      ...t,
      availableSets: 2,
      adjustedTargets: { ...t.adjustedTargets, targetSets: 2 },
    }));
    h.history.sets = h.history.sets.flatMap((s) => [
      s,
      { ...s, id: s.id + '-2', setNumber: 2 },
    ]);
    c.policy!.assessment.compliance!.slots =
      c.policy!.assessment.compliance!.slots.map((s) => ({
        ...s,
        adjusted: [1, 2],
      }));
    const a = deriveRecommendation(h, c);
    c.policy!.assessment.compliance!.slots =
      c.policy!.assessment.compliance!.slots.map((s) => ({
        ...s,
        adjusted: [2, 1],
      }));
    expect(deriveRecommendation(h, c).semanticKey).toBe(a.semanticKey);
  });
  it('known partial basic compliance is maintenance, not missing evidence', () => {
    const h = context(),
      c = command();
    h.history.tasks = h.history.tasks.map((t) => ({
      ...t,
      availableSets: 2,
      adjustedTargets: { ...t.adjustedTargets, targetSets: 2 },
    }));
    h.history.sets = h.history.sets.flatMap((s) => [
      s,
      { ...s, id: s.id + '-2', setNumber: 2, repetitions: 3 },
    ]);
    c.policy!.assessment.compliance!.slots =
      c.policy!.assessment.compliance!.slots.map((s) => ({
        ...s,
        adjusted: [1, 2],
      }));
    expect(deriveRecommendation(h, c).decision).toBe('MAINTAIN');
  });
  it('known partial readiness is maintenance when basic and minimum succeeded', () => {
    const h = context(),
      c = command();
    h.history.tasks = h.history.tasks.map((t) => ({
      ...t,
      availableSets: 2,
      adjustedTargets: { ...t.adjustedTargets, targetSets: 2 },
    }));
    h.history.sets = h.history.sets.flatMap((s) => [
      s,
      { ...s, id: s.id + '-2', setNumber: 2, repetitions: 5 },
    ]);
    c.policy!.assessment.compliance!.slots =
      c.policy!.assessment.compliance!.slots.map((s) => ({
        ...s,
        adjusted: [1, 2],
      }));
    expect(deriveRecommendation(h, c).decision).toBe('MAINTAIN');
  });

  it('can explicitly require a temporal review with complete, non-signalling anchor evidence', () => {
    const c = command();
    c.policy!.assessment.signal = {
      id: 's',
      basis: 'ADJUSTED',
      rpeComparison: 'STRICT_PROG2',
      referenceSize: 1,
      rpeThreshold: '1',
      performanceThresholdPercent: '10',
      minimumRpeCoveragePercent: '100',
    };
    c.policy!.assessment.persistence = { id: 'p', k: 1, m: 1 };
    c.policy = { ...c.policy!, review: 'TEMPORAL_SIGNAL' };
    expect(deriveRecommendation(context(), c).decision).toBe('INCREASE');
  });
  it('does not silently treat a partial sporting week as closed', () => {
    const c = command();
    c.period = { ...c.period, cutoffOn: '2026-01-07' };
    c.history.to = '2026-01-07';
    expect(deriveRecommendation(context(), c).reasons).toContain(
      'WEEK_NOT_CLOSED',
    );
    c.policy = { ...c.policy!, requireClosedWeek: false };
    expect(deriveRecommendation(context(), c).decision).toBe('INCREASE');
  });
});
