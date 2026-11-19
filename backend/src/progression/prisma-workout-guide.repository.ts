import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { activeActor, readState } from './recommendation-review.persistence';
import { RecommendationError } from '../models/progression/recommendation-draft.model';
import {
  PROGRESSION_REPOSITORY,
  type ProgressionRepository,
} from './progression.repository';
import type { WorkoutGuideRepository } from './workout-guide.repository';
import type {
  GuideExerciseSource,
  GuideCandidate,
  WorkoutGuideQuery,
  WorkoutGuideSnapshot,
  GuideComparisonSourceEvidence,
  GuidePlannedComparisonEvidence,
} from '../models/progression/workout-guide.model';
import type { RecordedTargets } from '../models/progression/performance-analysis.model';
import type { PersistedRecommendation } from '../models/progression/persisted-recommendation.model';
import {
  isGuideDayTrainable,
  originalGuideTargets,
} from '../domain/progression/workout-guide.policy';
import { mapped } from './recommendation.persistence';
import { replayRequest } from './revalidation-request.persistence';
import type {
  Destination,
  ValidatedRecommendationCommand,
} from '../models/progression/recommendation-draft.model';
import type {
  WorkoutGuidePreviewInput,
  WorkoutGuideRepetitionPreviewInput,
} from '../models/progression/workout-guide.model';
import {
  automaticRepetitionPreview,
  prepareRepetitionContext,
  repetitionPreview,
} from '../domain/progression/workout-repetition-preview.policy';
import { recommendationIdentity } from '../domain/progression/recommendation-evidence.policy';
import { validateRecommendationCommand } from '../domain/progression/recommendation-query.policy';
import { readConsentSettings } from './automation-consent.sources';
import {
  prepareGuideCalculationContext,
  buildGuidePreview,
} from '../domain/progression/workout-guide-preview.policy';
const date = (v: Date | null) => v?.toISOString().slice(0, 10) ?? null;
function targets(p: {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoad: Prisma.Decimal | null;
  targetLoadUnit: 'KG' | 'LB' | null;
  targetRpe: Prisma.Decimal | null;
  targetReps?: number | null;
}): RecordedTargets {
  return {
    targetSets: p.targetSets,
    targetRepsMin: p.targetRepsMin ?? p.targetReps ?? null,
    targetRepsMax: p.targetRepsMax ?? p.targetReps ?? null,
    targetLoad: p.targetLoad?.toFixed(3) ?? null,
    targetLoadUnit: p.targetLoadUnit,
    targetRpe: p.targetRpe?.toFixed(1) ?? null,
  };
}
const guideExerciseIdentity = {
  id: true,
  name: true,
  origin: true,
  catalogKey: true,
  equipment: true,
  equipmentType: true,
  machineType: true,
  resistanceType: true,
} as const;

function equipmentIdentity({
  name: _name,
  ...identity
}: Prisma.ExerciseGetPayload<{
  select: typeof guideExerciseIdentity;
}>): GuidePlannedComparisonEvidence['exercise'] {
  return identity;
}

function jsonObject(
  value: Prisma.JsonValue | undefined,
): Prisma.JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function capturedPlanExercise(
  snapshot: Prisma.JsonValue,
  expected: {
    planId: string | null;
    weekId: string | null;
    dayId: string | null;
    prescriptionId: string | null;
  },
) {
  const record = jsonObject(snapshot);
  const source = jsonObject(record?.source);
  const exercise = jsonObject(record?.exercise);
  return expected.planId &&
    expected.weekId &&
    expected.dayId &&
    expected.prescriptionId &&
    source?.kind === 'PLAN_DAY' &&
    source.id === expected.prescriptionId &&
    jsonObject(source.plan)?.id === expected.planId &&
    jsonObject(source.week)?.id === expected.weekId &&
    jsonObject(source.day)?.id === expected.dayId &&
    typeof exercise?.id === 'string' &&
    typeof exercise.equipment === 'string'
    ? {
        exerciseId: exercise.id,
        equipment: exercise.equipment,
        planId: expected.planId,
      }
    : null;
}

@Injectable()
export class PrismaWorkoutGuideRepository implements WorkoutGuideRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROGRESSION_REPOSITORY)
    private readonly progression: ProgressionRepository,
  ) {}
  async read(
    userId: string,
    authSessionId: string,
    query: WorkoutGuideQuery,
    preview?: WorkoutGuidePreviewInput | WorkoutGuideRepetitionPreviewInput,
  ): Promise<WorkoutGuideSnapshot> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        const actor = await activeActor(tx, userId, authSessionId);
        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
        let source: WorkoutGuideSnapshot['source'];
        let occurrenceVersion: number | null = null;
        const sourceEvidence = new Map<string, GuideComparisonSourceEvidence>();
        const equipment = new Map<
          string,
          GuidePlannedComparisonEvidence['exercise']
        >();
        const capturedDestinations = new Map<
          string,
          ReturnType<typeof capturedPlanExercise>
        >();
        let status: WorkoutGuideSnapshot['status'] = 'TRAINABLE';
        let exercises: GuideExerciseSource[] = [];
        if (query.sessionId) {
          const session = await tx.workoutSession.findFirst({
            where: { id: query.sessionId, athleteId: actor.athleteId },
            include: {
              scheduledActivity: { select: { version: true } },
              exercises: {
                include: { exercise: { select: guideExerciseIdentity } },
                orderBy: { orderInSession: 'asc' },
              },
            },
          });
          if (!session) throw new RecommendationError('SOURCE_NOT_FOUND');
          // The session version also changes for recording a current series or
          // editing notes. Those operations do not change historical comparison
          // evidence. Sporting coordinates, targets and substitutions are bound
          // separately, while a scheduled occurrence retains its own revision.
          occurrenceVersion = session.scheduledActivity?.version ?? null;
          for (const p of session.exercises) {
            const snapshot = p.originalSnapshot;
            equipment.set(p.id, equipmentIdentity(p.exercise));
            capturedDestinations.set(
              p.id,
              capturedPlanExercise(snapshot, {
                planId: session.trainingPlanId,
                weekId: session.planWeekId,
                dayId: session.planDayId,
                prescriptionId: p.planExerciseId,
              }),
            );
            const originalExercise =
              snapshot &&
              typeof snapshot === 'object' &&
              !Array.isArray(snapshot)
                ? snapshot.exercise
                : null;
            sourceEvidence.set(p.id, {
              occurrenceVersion,
              originalExerciseId:
                originalExercise &&
                typeof originalExercise === 'object' &&
                !Array.isArray(originalExercise) &&
                typeof originalExercise.id === 'string'
                  ? originalExercise.id
                  : null,
              replacesWorkoutExerciseId: p.replacesWorkoutExerciseId,
              isOmitted: p.isOmitted,
            });
          }
          source = {
            kind: 'SESSION',
            id: session.id,
            sessionId: session.id,
            activityId: session.scheduledActivityId,
            planDayId: session.planDayId,
            trainingPlanId: session.trainingPlanId,
            planWeekId: session.planWeekId,
            performedOn: date(session.performedOn),
            timeZone: session.timeZone,
            status: session.status,
            title: session.name,
          };
          if (session.status === 'CANCELLED') status = 'UNAVAILABLE';
          exercises = session.exercises.map((p) => ({
            id: p.id,
            exerciseId: p.exerciseId,
            name: p.exercise.name,
            position: p.orderInSession,
            prescriptionId: p.planExerciseId,
            isOmitted: p.isOmitted,
            target: targets(p),
            originalTarget: originalGuideTargets(p.originalSnapshot),
            history: [],
            historyTruncated: false,
            candidates: [],
          }));
        } else {
          let planDayId = query.planDayId;
          let activity = null as Awaited<
            ReturnType<typeof tx.scheduledActivity.findFirst>
          >;
          if (query.activityId) {
            activity = await tx.scheduledActivity.findFirst({
              where: { id: query.activityId, athleteId: actor.athleteId },
            });
            if (!activity) throw new RecommendationError('SOURCE_NOT_FOUND');
            occurrenceVersion = activity.version;
            planDayId = activity.planDayId ?? undefined;
            status =
              activity.status === 'REST'
                ? 'REST'
                : activity.status === 'OMITTED'
                  ? 'OMITTED'
                  : activity.status === 'WITHDRAWN'
                    ? 'UNAVAILABLE'
                    : 'TRAINABLE';
          }
          const day = planDayId
            ? await tx.planDay.findFirst({
                where: {
                  id: planDayId,
                  planWeek: { trainingPlan: { athleteId: actor.athleteId } },
                },
                include: {
                  planWeek: {
                    select: {
                      trainingPlanId: true,
                      trainingPlan: { select: { status: true } },
                    },
                  },
                  exercises: {
                    include: { exercise: { select: guideExerciseIdentity } },
                    orderBy: { position: 'asc' },
                  },
                },
              })
            : null;
          if (planDayId && !day)
            throw new RecommendationError('SOURCE_NOT_FOUND');
          const performedOn = activity
            ? date(activity.scheduledOn)!
            : query.performedOn!;
          const dayTrainable =
            day &&
            isGuideDayTrainable(
              {
                retiredAt: day.retiredAt,
                retiredFromOn: day.retiredFromOn,
                planStatus: day.planWeek.trainingPlan.status,
              },
              performedOn,
            );
          if (status === 'TRAINABLE' && !dayTrainable) status = 'UNAVAILABLE';
          source = {
            kind: activity ? 'ACTIVITY' : 'PLAN_DAY',
            id: activity?.id ?? day!.id,
            activityId: activity?.id ?? null,
            sessionId: null,
            planDayId: day?.id ?? null,
            trainingPlanId: day?.planWeek.trainingPlanId ?? null,
            planWeekId: day?.planWeekId ?? activity?.planWeekId ?? null,
            performedOn: activity
              ? date(activity.scheduledOn)
              : query.performedOn!,
            timeZone: activity?.timeZone ?? query.timeZone!,
            status:
              activity?.status ??
              (dayTrainable
                ? day!.planWeek.trainingPlan.status
                : 'UNAVAILABLE'),
            title: activity?.title ?? day?.name ?? null,
          };
          if (day && status === 'TRAINABLE') {
            day.exercises.forEach((p) =>
              equipment.set(p.id, equipmentIdentity(p.exercise)),
            );
            exercises = day.exercises.map((p) => ({
              id: p.id,
              exerciseId: p.exerciseId,
              name: p.exercise.name,
              position: p.position,
              prescriptionId: p.id,
              isOmitted: false,
              target: targets(p),
              originalTarget: null,
              history: [],
              historyTruncated: false,
              candidates: [],
            }));
          }
        }
        const today = source.timeZone
          ? new Intl.DateTimeFormat('en-CA', {
              timeZone: source.timeZone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(clock.now)
          : clock.now.toISOString().slice(0, 10);
        // A future calendar slot cannot acquire a reference from a future sporting date.
        const cutoff =
          source.performedOn && source.performedOn < today
            ? source.performedOn
            : today;
        if (
          preview &&
          !exercises.some((e) => e.exerciseId === preview.exerciseId)
        )
          throw new RecommendationError('SOURCE_NOT_FOUND');
        for (const exercise of exercises) {
          const history = await tx.workoutExercise.findMany({
            where: {
              exerciseId: exercise.exerciseId,
              isOmitted: false,
              session: {
                athleteId: actor.athleteId,
                id: source.sessionId ? { not: source.sessionId } : undefined,
                status: { in: ['IN_PROGRESS', 'COMPLETED'] },
                OR: [
                  { performedOn: { lte: new Date(cutoff + 'T00:00:00Z') } },
                  { performedOn: null },
                ],
              },
              sets: {
                some: {
                  OR: [
                    { status: { in: ['COMPLETED', 'INCOMPLETE', 'FAILED'] } },
                    { status: null, isCompleted: true },
                    {
                      status: null,
                      OR: [
                        { load: { not: null } },
                        { repetitions: { not: null } },
                      ],
                    },
                  ],
                },
              },
            },
            orderBy: [
              { session: { performedOn: { sort: 'desc', nulls: 'last' } } },
              { id: 'asc' },
            ],
            take: 101,
            include: {
              session: {
                select: {
                  id: true,
                  status: true,
                  performedOn: true,
                  timeZone: true,
                  trainingPlanId: true,
                  planWeekId: true,
                  planDayId: true,
                },
              },
              sets: {
                orderBy: { setNumber: 'asc' },
                take: 100,
                where: {
                  OR: [
                    { status: { in: ['COMPLETED', 'INCOMPLETE', 'FAILED'] } },
                    { status: null, isCompleted: true },
                    {
                      status: null,
                      OR: [
                        { load: { not: null } },
                        { repetitions: { not: null } },
                      ],
                    },
                  ],
                },
              },
            },
          });
          exercise.historyTruncated =
            history.length > 100 || history.some((t) => t.sets.length >= 100);
          exercise.history = history.slice(0, 100).map((t) => ({
            taskId: t.id,
            sessionId: t.session.id,
            sessionStatus: t.session.status,
            performedOn: date(t.session.performedOn),
            timeZone: t.session.timeZone,
            trainingPlanId: t.session.trainingPlanId,
            planDayId: t.session.planDayId,
            planExerciseId: t.planExerciseId,
            sets: t.sets.map((s) => ({
              setNumber: s.setNumber,
              load: s.load?.toFixed(3) ?? null,
              loadUnit: s.loadUnit,
              repetitions: s.repetitions,
              rpe: s.rpe?.toFixed(1) ?? null,
              status: s.status,
              kind: s.kind,
              isCompleted: s.isCompleted,
            })),
          }));
          const rows = exercise.prescriptionId
            ? await tx.progressionRecommendation.findMany({
                where: {
                  athleteId: actor.athleteId,
                  exerciseId: exercise.exerciseId,
                  // Neutral proposals retain their authoritative destination in the evidence snapshot.
                  OR: [
                    { planExerciseId: exercise.prescriptionId },
                    {
                      snapshot: {
                        path: ['destination', 'prescriptionId'],
                        equals: exercise.prescriptionId,
                      },
                    },
                  ],
                  status: { in: ['PENDING', 'APPROVED'] },
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                take: 3,
                include: { evidence: true },
              })
            : [];
          for (const row of rows) {
            let proposal: PersistedRecommendation;
            try {
              proposal = mapped(row);
            } catch {
              proposal = {
                id: row.id,
                athleteId: row.athleteId,
                exerciseId: row.exerciseId,
                status: row.status,
                reviewVersion: row.reviewVersion,
                createdAt: row.createdAt,
                reviewedAt: row.reviewedAt,
                expiresAt: row.expiresAt,
                previousLoad: row.previousLoad?.toFixed(6) ?? null,
                recommendedLoad: row.recommendedLoad.toFixed(6),
                loadUnit: row.loadUnit,
                previousLoadKg: row.previousLoadKg?.toFixed(6) ?? null,
                recommendedLoadKg: row.recommendedLoadKg?.toFixed(6) ?? null,
                generation: null,
                evidence: [],
                generationAuthorization: 'LEGACY_UNKNOWN',
              };
            }
            let candidate: GuideCandidate = {
              proposal,
              command: null,
              context: null,
              review: null,
            };
            try {
              const request =
                await tx.progressionRevalidationRequest.findUnique({
                  where: { recommendationId: row.id },
                });
              if (request && proposal.generation) {
                const replay = replayRequest(
                  request,
                  proposal.generation.requestKey,
                  proposal.generation.draft.evidence.source.tasks.map(
                    (t) => t.id,
                  ),
                );
                const review = await readState(
                  tx,
                  userId,
                  row.id,
                  replay.command,
                  (reader, command) =>
                    this.progression.readRecommendationContext(
                      userId,
                      command.history,
                      command.destination,
                      reader,
                    ),
                  false,
                );
                candidate = {
                  proposal,
                  command: replay.command,
                  context: review.context,
                  review,
                };
              }
            } catch {
              /* Keep an explicit review link when replay cannot be verified. */
            }
            exercise.candidates.push(candidate);
          }
          exercise.calculations = [];
          const settings = await readConsentSettings(tx, actor.athleteId);
          exercise.configurationReasons = settings.length
            ? ['POLICY_PROVENANCE_REQUIRED']
            : ['SETTING_REQUIRED', 'POLICY_PROVENANCE_REQUIRED'];
          const destination: Destination | null =
            exercise.prescriptionId &&
            source.trainingPlanId &&
            source.planWeekId &&
            source.planDayId
              ? {
                  kind: 'PRESCRIPTION',
                  planId: source.trainingPlanId,
                  weekId: source.planWeekId,
                  dayId: source.planDayId,
                  prescriptionId: exercise.prescriptionId,
                }
              : null;
          if (!destination) continue;
          const eligibleDates = exercise.history.flatMap((t) =>
            t.performedOn &&
            source.performedOn &&
            t.performedOn < source.performedOn
              ? [t.performedOn]
              : [],
          );
          const end = new Date((source.performedOn ?? cutoff) + 'T00:00:00Z');
          end.setUTCDate(end.getUTCDate() - 1);
          const to =
            end.toISOString().slice(0, 10) < cutoff
              ? end.toISOString().slice(0, 10)
              : cutoff;
          const from = eligibleDates.length ? [...eligibleDates].sort()[0] : to;
          const analysis = await this.progression.readRecommendationContext(
            userId,
            {
              exerciseId: exercise.exerciseId,
              from,
              to,
              timeZone: source.timeZone ?? 'UTC',
              limit: 100,
              contexts: [],
              comparisons: [],
            },
            destination,
            tx,
          );
          const identity = equipment.get(exercise.id);
          const captured = capturedDestinations.get(exercise.id);
          const plannedEvidence: GuidePlannedComparisonEvidence | undefined =
            identity
              ? {
                  exercise: identity,
                  destinationCaptured:
                    source.kind !== 'SESSION' ||
                    (captured?.exerciseId === identity.id &&
                      captured.equipment === identity.equipment),
                  tasks: history.slice(0, 100).flatMap((task) => {
                    const capture = capturedPlanExercise(
                      task.originalSnapshot,
                      {
                        planId: task.session.trainingPlanId,
                        weekId: task.session.planWeekId,
                        dayId: task.session.planDayId,
                        prescriptionId: task.planExerciseId,
                      },
                    );
                    return capture ? [{ taskId: task.id, ...capture }] : [];
                  }),
                }
              : undefined;
          const provenance = {
            ...(sourceEvidence.get(exercise.id) ?? {
              occurrenceVersion,
              originalExerciseId: exercise.exerciseId,
              replacesWorkoutExerciseId: null,
              isOmitted: exercise.isOmitted,
            }),
            ...(identity
              ? { equipmentKey: recommendationIdentity(identity) }
              : {}),
          };
          exercise.repetitionContext = prepareRepetitionContext(
            analysis,
            source,
            cutoff,
            exercise.target,
            provenance,
          );
          exercise.progressiveContext = prepareRepetitionContext(
            analysis,
            source,
            cutoff,
            exercise.target,
            provenance,
            'session-repetition-preview-v2',
            plannedEvidence,
          );
          if (
            status !== 'TRAINABLE' ||
            exercise.isOmitted ||
            exercise.historyTruncated ||
            exercise.history.some(
              (t) =>
                t.performedOn === null || t.performedOn === source.performedOn,
            )
          ) {
            exercise.repetitionContext.ready = false;
            exercise.repetitionContext.reasons.push(
              'INCOMPLETE_WORKOUT_CONTEXT',
            );
            exercise.progressiveContext.ready = false;
            exercise.progressiveContext.comparability = {
              state: 'NOT_COMPARABLE',
              source: null,
            };
            exercise.progressiveContext.reasons.push(
              'INCOMPLETE_WORKOUT_CONTEXT',
            );
          }
          if (
            preview?.exerciseId === exercise.exerciseId &&
            (preview.policyContract === 'session-repetition-preview-v1' ||
              preview.policyContract === 'session-repetition-preview-v2')
          ) {
            exercise.repetitionSuggestion = repetitionPreview(
              analysis,
              source,
              preview.policyContract === 'session-repetition-preview-v2'
                ? exercise.progressiveContext
                : exercise.repetitionContext,
              preview,
            );
            if (
              exercise.repetitionSuggestion.origin === 'CALCULATED' &&
              exercise.progressiveContext.comparability?.state ===
                'CONFIRMATION_REQUIRED' &&
              preview.policyContract === 'session-repetition-preview-v2'
            )
              exercise.progressiveContext.comparability = {
                state: 'USER_CONFIRMED',
                source: 'REQUEST_DECLARATION',
              };
            continue;
          }
          const automatic = automaticRepetitionPreview(
            analysis,
            source,
            exercise.progressiveContext,
          );
          if (automatic) exercise.repetitionSuggestion = automatic;
          exercise.calculationContext = prepareGuideCalculationContext(
            analysis,
            source,
            cutoff,
            exercise.target,
            provenance,
          );
          exercise.configurationReasons = [
            ...new Set([
              ...exercise.calculationContext.reasons,
              'POLICY_PROVENANCE_REQUIRED',
            ]),
          ];
          if (
            preview?.exerciseId === exercise.exerciseId &&
            'gridStep' in preview
          ) {
            const command = validateRecommendationCommand(
              buildGuidePreview(
                analysis,
                source,
                exercise.calculationContext,
                preview,
              ),
            );
            const context = await this.progression.readRecommendationContext(
              userId,
              command.history,
              command.destination,
              tx,
            );
            exercise.calculations.push({
              command,
              context,
              source: 'EXPLICIT_PREVIEW',
              sourceId: null,
            });
            continue;
          }
          // Reuse only integrity-checked owner declarations. A recipe is analytical evidence,
          // never permission to save a recommendation or mutate its new destination.
          const recipes = await tx.progressionRecommendation.findMany({
            where: {
              athleteId: actor.athleteId,
              exerciseId: exercise.exerciseId,
              status: { in: ['PENDING', 'APPROVED'] },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            take: 10,
            include: { evidence: true },
          });
          for (const row of recipes) {
            try {
              const saved = mapped(row),
                request = await tx.progressionRevalidationRequest.findUnique({
                  where: { recommendationId: row.id },
                });
              if (!saved.generation || !request) continue;
              const replay = replayRequest(
                request,
                saved.generation.requestKey,
                saved.generation.draft.evidence.source.tasks.map((t) => t.id),
              );
              const command: ValidatedRecommendationCommand = {
                ...replay.command,
                destination,
                expectedPlanVersion: analysis.target.planVersion ?? undefined,
              };
              const context = await this.progression.readRecommendationContext(
                userId,
                command.history,
                destination,
                tx,
              );
              exercise.calculations.push({
                command,
                context,
                source: 'VERIFIED_REPLAY',
                sourceId: row.id,
              });
            } catch {
              /* Unverified declarations remain unavailable for fresh guidance. */
            }
          }
        }
        return {
          source,
          status,
          now: clock.now,
          historyCutoffOn: cutoff,
          exercises,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
}
