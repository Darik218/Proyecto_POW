import type {
  GuideExerciseSource,
  GuidePreparation,
  GuidePreparationBlocker,
  GuideSuggestion,
  WorkoutGuideSnapshot,
} from '../../models/progression/workout-guide.model';
import { readDecimal } from './decimal';
import {
  guidePreviewPeriodReasons,
  referenceGuidance,
} from './workout-guide.policy';

function category(code: string): GuidePreparationBlocker['category'] {
  if (/DATE|TIME_ZONE|CUTOFF|PERIOD|SAME_DAY|INTRADAY/.test(code))
    return 'temporal';
  if (
    /DECLARATION|TARGETS_DIFFER|SUBSTITUTION|OWNERSHIP|LOAD_DIFFERS|LOAD_MEANING|UNIT_MISMATCH|PRESCRIPTION_HISTORY/.test(
      code,
    )
  )
    return 'comparability';
  if (
    /SETTING|INCREMENT_REQUIRED|BASELINE_REQUIRED|UNIT_REQUIRED|TARGET_.*UNKNOWN|TARGET_RANGE|TARGET_RPE/.test(
      code,
    )
  )
    return 'configuration';
  if (/POLICY|PROVENANCE/.test(code)) return 'policy';
  if (/DECIMAL|REPRESENTABLE|ROUND|MAX_LOAD|GRID/.test(code)) return 'math';
  if (/DESTINATION|UNAVAILABLE|MISMATCH|READ_LIMIT|WORKOUT_CONTEXT/.test(code))
    return 'integration';
  return 'evidence';
}
const reviewCodes = new Set([
  'REFERENCE_OUTSIDE_PREVIEW_PERIOD',
  'TIME_ZONE_MISMATCH',
  'HISTORY_REPETITIONS_INCONSISTENT',
  'HISTORICAL_TARGETS_DIFFER',
  'RECORDED_LOAD_DIFFERS',
  'RECORDED_EFFORT_ABOVE_TARGET',
  'RECORDED_EFFORT_INVALID',
  'INTRADAY_ORDER_UNKNOWN',
  'DUPLICATE_SESSION_REFERENCE',
  'SUBSTITUTION_NOT_COMPARABLE',
  'SOURCE_OWNERSHIP_MISMATCH',
  'WORK_SET_NOT_COMPLETED',
  'WORK_SLOT_MAPPING_INCOMPLETE',
  'SET_KIND_UNKNOWN',
  'DUPLICATE_SET_REFERENCE',
  'REPETITIONS_OUTSIDE_PRESCRIBED_RANGE',
  'SESSION_NOT_COMPLETED',
  'INCOMPLETE_WORKOUT_CONTEXT',
  'DESTINATION_UNAVAILABLE',
  'DESTINATION_TARGETS_CHANGED',
  'EXERCISE_OMITTED',
  'DATE_UNKNOWN',
  'SAME_DAY_NOT_ORDERED',
  'PARTIAL_SESSION_REFERENCE',
  'LOAD_UNIT_UNKNOWN',
  'READ_LIMIT_REACHED',
]);

/** A reversible preparation draft preserves where its values came from. Only
 * the explicitly evaluated existing policies may call a target calculated. */
export function prepareExerciseGuidance(
  exercise: GuideExerciseSource,
  snapshot: WorkoutGuideSnapshot,
  reference: ReturnType<typeof referenceGuidance>,
  suggestion: GuideSuggestion,
): GuidePreparation {
  const progressive = exercise.progressiveContext;
  const calculated =
    ['CALCULATED', 'PERSISTED_PROPOSAL'].includes(suggestion.origin) &&
    suggestion.load !== null;
  const codes = new Set<string>([
    ...(!calculated ? (progressive?.reasons ?? []) : []),
    ...reference.guidance.reasons.filter((code) =>
      [
        'DATE_UNKNOWN',
        'SAME_DAY_NOT_ORDERED',
        'INTRADAY_ORDER_UNKNOWN',
        'PARTIAL_SESSION_REFERENCE',
        'LOAD_UNIT_UNKNOWN',
        'READ_LIMIT_REACHED',
      ].includes(code),
    ),
    ...guidePreviewPeriodReasons(snapshot.source, reference.lastReference),
  ]);
  if (calculated) suggestion.reasons.forEach((code) => codes.add(code));
  if (exercise.isOmitted || snapshot.status !== 'TRAINABLE')
    codes.add('EXERCISE_OMITTED');
  if (progressive?.ready && !calculated)
    codes.add('COMPARABILITY_DECLARATION_REQUIRED');
  if (!progressive && !calculated) {
    (exercise.configurationReasons ?? []).forEach((code) => codes.add(code));
    if (!reference.lastReference) codes.add('NO_ELIGIBLE_HISTORY');
  }
  // A load-policy blocker is not a blocker for eligible repetition practice.
  // The independent calculationContext retains all load prerequisites.
  if (!progressive && !calculated)
    (exercise.calculationContext?.reasons ?? []).forEach((code) =>
      codes.add(code),
    );
  const mustReview =
    suggestion.action === 'REVIEW_REQUIRED' ||
    [...codes].some((code) => reviewCodes.has(code));
  let draft: GuidePreparation['draft'] = null;
  if (!mustReview) {
    if (calculated)
      draft = {
        origin: suggestion.origin as 'CALCULATED' | 'PERSISTED_PROPOSAL',
        load: suggestion.load,
        unit: suggestion.unit,
        reps: suggestion.reps,
        sets: suggestion.sets,
        executionAuthorized: false,
      };
    else {
      const target = exercise.target;
      draft = {
        origin: 'PLAN_TARGET',
        load: target.targetLoad,
        unit: target.targetLoadUnit,
        reps: target.targetRepsMin ?? target.targetRepsMax,
        sets: target.targetSets,
        executionAuthorized: false,
      };
      const prior = reference.lastReference?.sessions;
      const sets =
        prior?.length === 1 && prior[0].sessionStatus === 'COMPLETED'
          ? prior[0].sets.filter((set) => set.kind === 'WORK')
          : [];
      const first = sets[0];
      const knownLoad = readDecimal(first?.load);
      if (
        target.targetLoad === null &&
        target.targetLoadUnit === null &&
        first &&
        knownLoad.ok &&
        knownLoad.value.gt(0) &&
        (first.loadUnit === 'KG' || first.loadUnit === 'LB') &&
        sets.length === target.targetSets &&
        sets.every((set) => {
          const load = readDecimal(set.load);
          return (
            set.status === 'COMPLETED' &&
            set.isCompleted &&
            load.ok &&
            load.value.eq(knownLoad.value) &&
            set.loadUnit === first.loadUnit &&
            set.repetitions === first.repetitions
          );
        })
      ) {
        draft = {
          ...draft,
          origin: 'HISTORICAL_REFERENCE',
          load: first.load,
          unit: first.loadUnit,
          reps: first.repetitions,
        };
      }
    }
  }
  const loadAttempted =
    suggestion.policyVersion !== null &&
    !suggestion.policyVersion.startsWith('session-repetition-preview-');
  const loadFailed = loadAttempted && !calculated;
  const loadReasons = [
    ...new Set([
      ...(exercise.calculationContext?.reasons ?? []),
      ...(loadFailed ? suggestion.reasons : []),
    ]),
  ];
  const blockers = (reasons: readonly string[]) =>
    reasons.map((code) => ({ category: category(code), code }));
  return {
    diagnostics: {
      repetition: progressive
        ? { ready: progressive.ready, reasons: blockers(progressive.reasons) }
        : null,
      load:
        exercise.calculationContext || loadAttempted
          ? {
              ready:
                (loadAttempted && calculated) ||
                (!!exercise.calculationContext?.ready && !loadFailed),
              reasons: blockers(loadReasons),
            }
          : null,
    },
    stage: mustReview
      ? 'REVIEW_REQUIRED'
      : calculated
        ? suggestion.policyVersion?.startsWith('session-repetition-preview-')
          ? 'REPETITION_DRAFT'
          : 'LOAD_DRAFT'
        : progressive?.ready
          ? 'REPETITION_READY'
          : reference.lastReference
            ? 'PLAN_WITH_REFERENCE'
            : 'PLAN_ONLY',
    plan: exercise.target,
    before: reference.lastReference,
    draft,
    why: [...codes],
    blockers: [...codes]
      .filter((code) => !calculated || !suggestion.reasons.includes(code))
      .map((code) => ({ category: category(code), code })),
    executionAuthorized: false,
  };
}
