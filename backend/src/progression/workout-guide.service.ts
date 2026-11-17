import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import {
  WORKOUT_GUIDE_REPOSITORY,
  type WorkoutGuideRepository,
} from './workout-guide.repository';
import type {
  WorkoutGuideQuery,
  WorkoutGuidePreviewInput,
  WorkoutGuideRepetitionPreviewInput,
} from '../models/progression/workout-guide.model';
import {
  assessGuideProposal,
  referenceGuidance,
  validateWorkoutGuideQuery,
  guideCalculationReasons,
  guideSuggestion,
  guidePreviewPeriodReasons,
} from '../domain/progression/workout-guide.policy';
import { inspectReview } from '../domain/progression/recommendation-review.policy';
import { deriveRecommendation } from './recommendation.service';
@Injectable()
export class WorkoutGuideService {
  constructor(
    @Inject(WORKOUT_GUIDE_REPOSITORY)
    private readonly repository: WorkoutGuideRepository,
  ) {}
  async forMyWorkout(
    identity: AuthenticatedIdentity,
    input: WorkoutGuideQuery,
    explicit?: WorkoutGuidePreviewInput | WorkoutGuideRepetitionPreviewInput,
  ) {
    const query = validateWorkoutGuideQuery(input),
      snapshot = await this.repository.read(
        identity.account.id,
        identity.sessionId,
        query,
        explicit,
      );
    return {
      schemaVersion: 'workout-guide-v1' as const,
      source: snapshot.source,
      status: snapshot.status,
      historyCutoffOn: snapshot.historyCutoffOn,
      executionAuthorized: false as const,
      exercises: snapshot.exercises.map((exercise) => {
        const reference = referenceGuidance(
          exercise.history,
          snapshot.source.performedOn,
          exercise.historyTruncated,
        );
        const proposals = exercise.candidates.map((candidate) => {
          let current = null;
          try {
            if (candidate.context && candidate.command)
              current = deriveRecommendation(
                candidate.context,
                candidate.command,
              );
          } catch {
            /* Review remains explicit when evidence cannot be evaluated. */
          }
          const proposal = assessGuideProposal({
            proposal: candidate.proposal,
            command: candidate.command,
            current,
            target: exercise.target,
            prescriptionId: exercise.prescriptionId,
            latestDate: reference.lastReference?.performedOn ?? null,
            performedOn: snapshot.source.performedOn,
            now: snapshot.now,
          });
          if (
            candidate.command &&
            (candidate.command.history.to > snapshot.historyCutoffOn ||
              candidate.command.period.cutoffOn > snapshot.historyCutoffOn)
          ) {
            proposal.status = 'REQUIRES_REVIEW';
            proposal.recommendedLoad = null;
            proposal.reasons.push('FUTURE_CUTOFF_UNVERIFIED');
          }
          const inspection = candidate.review
            ? inspectReview(candidate.review, current)
            : null;
          if (
            !inspection ||
            inspection.validity.state !== 'CURRENT' ||
            inspection.cycle.conflict ||
            !inspection.cycle.reserved
          ) {
            proposal.status = 'REQUIRES_REVIEW';
            proposal.recommendedLoad = null;
            proposal.reasons.push(
              inspection?.validity.state ?? 'REVALIDATION_UNAVAILABLE',
            );
            if (inspection?.cycle.conflict)
              proposal.reasons.push('CYCLE_CONFLICT');
            if (inspection && !inspection.cycle.reserved)
              proposal.reasons.push('CYCLE_UNRESERVED');
          }
          if (
            exercise.isOmitted ||
            exercise.historyTruncated ||
            exercise.history.some(
              (t) =>
                t.performedOn === null ||
                t.performedOn === snapshot.source.performedOn,
            )
          ) {
            proposal.status = 'REQUIRES_REVIEW';
            proposal.recommendedLoad = null;
            proposal.reasons.push(
              exercise.isOmitted ? 'EXERCISE_OMITTED' : 'INCOMPLETE_HISTORY',
            );
          }
          return proposal;
        });
        const proposal =
          proposals.find((p) => p.status === 'CURRENT') ?? proposals[0] ?? null;
        let suggestion = guideSuggestion(
          reference.lastReference
            ? 'HISTORICAL_REFERENCE'
            : 'INSUFFICIENT_DATA',
          exercise.history.length
            ? 'CONFIGURATION_REQUIRED'
            : 'INSUFFICIENT_DATA',
          exercise.configurationReasons ?? ['POLICY_PROVENANCE_REQUIRED'],
          exercise.target,
        );
        for (const calculation of exercise.calculations ?? []) {
          const blocked = guideCalculationReasons(
            exercise,
            calculation,
            snapshot,
          );
          if (blocked.length) {
            suggestion = guideSuggestion(
              reference.lastReference
                ? 'HISTORICAL_REFERENCE'
                : 'INSUFFICIENT_DATA',
              'INSUFFICIENT_DATA',
              blocked,
              exercise.target,
            );
            continue;
          }
          try {
            const draft = deriveRecommendation(
              calculation.context,
              calculation.command,
            );
            suggestion = guideSuggestion(
              'CALCULATED',
              draft.decision,
              [...draft.reasons, ...reference.guidance.reasons],
              exercise.target,
              draft.decision === 'INCREASE'
                ? (draft.increment?.proposedLoad ?? null)
                : draft.decision === 'MAINTAIN'
                  ? exercise.target.targetLoad
                  : null,
              calculation.command.policy?.version ?? null,
            );
            // The most recent applicable declaration wins; invalid earlier recipes may be skipped.
            break;
          } catch {
            suggestion = guideSuggestion(
              'INSUFFICIENT_DATA',
              'INSUFFICIENT_DATA',
              ['DECLARED_EVIDENCE_UNAVAILABLE'],
              exercise.target,
            );
          }
        }
        if (
          proposal?.status === 'CURRENT' &&
          explicit?.exerciseId !== exercise.exerciseId
        )
          suggestion = guideSuggestion(
            'PERSISTED_PROPOSAL',
            'INCREASE',
            [...proposal.reasons, ...reference.guidance.reasons],
            exercise.target,
            proposal.recommendedLoad,
            exercise.candidates.find((c) => c.proposal.id === proposal.id)
              ?.command?.policy?.version ?? null,
          );
        if (
          explicit?.policyContract === 'session-repetition-preview-v1' &&
          explicit.exerciseId === exercise.exerciseId &&
          exercise.repetitionSuggestion
        )
          suggestion = exercise.repetitionSuggestion;
        const periodReasons = guidePreviewPeriodReasons(
          snapshot.source,
          reference.lastReference,
        );
        if (periodReasons.length) {
          suggestion = guideSuggestion(
            'HISTORICAL_REFERENCE',
            'REVIEW_REQUIRED',
            [...suggestion.reasons, ...periodReasons],
            exercise.target,
            null,
            suggestion.policyVersion,
          );
          suggestion.reason = periodReasons.includes(
            'REFERENCE_OUTSIDE_PREVIEW_PERIOD',
          )
            ? 'La referencia queda fuera del alcance de esta orientación semanal: semana del objetivo o inmediatamente anterior, de lunes a domingo. Revisa y recalibra la carga antes de entrenar; el tiempo transcurrido no determina una pérdida de fuerza.'
            : 'La referencia y el objetivo no comparten una zona horaria deportiva verificable. Revisa el contexto antes de elegir la carga.';
        }
        return {
          id: exercise.id,
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          position: exercise.position,
          isOmitted: exercise.isOmitted,
          target: exercise.target,
          originalTarget: exercise.originalTarget,
          ...reference,
          proposal,
          guidanceSuggested: suggestion,
          calculationContext: exercise.calculationContext ?? null,
          repetitionContext: exercise.repetitionContext ?? null,
        };
      }),
    };
  }
}
