"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineExtension = exports.JsonNullValueFilter = exports.NullsOrder = exports.QueryMode = exports.JsonNullValueInput = exports.NullableJsonNullValueInput = exports.SortOrder = exports.ExerciseAliasScalarFieldEnum = exports.PlanningOperationScalarFieldEnum = exports.ScheduledActivityScalarFieldEnum = exports.ProgressionApplicationScalarFieldEnum = exports.RecommendationEvidenceScalarFieldEnum = exports.ProgressionRecommendationScalarFieldEnum = exports.ProgressionSettingScalarFieldEnum = exports.SessionFeedbackScalarFieldEnum = exports.OneRmEstimateScalarFieldEnum = exports.SetRecordScalarFieldEnum = exports.WorkoutExerciseScalarFieldEnum = exports.WorkoutSessionScalarFieldEnum = exports.PlanExerciseScalarFieldEnum = exports.PlanDayScalarFieldEnum = exports.PlanWeekScalarFieldEnum = exports.TrainingPlanScalarFieldEnum = exports.ExerciseSecondaryMuscleGroupScalarFieldEnum = exports.ExerciseScalarFieldEnum = exports.MuscleGroupScalarFieldEnum = exports.BodyMeasurementScalarFieldEnum = exports.AuthSessionTokenScalarFieldEnum = exports.AuthSessionScalarFieldEnum = exports.AthleteScalarFieldEnum = exports.UserScalarFieldEnum = exports.TransactionIsolationLevel = exports.ModelName = exports.AnyNull = exports.JsonNull = exports.DbNull = exports.NullTypes = exports.prismaVersion = exports.getExtensionContext = exports.Decimal = exports.Sql = exports.raw = exports.join = exports.empty = exports.sql = exports.PrismaClientValidationError = exports.PrismaClientInitializationError = exports.PrismaClientRustPanicError = exports.PrismaClientUnknownRequestError = exports.PrismaClientKnownRequestError = void 0;
const runtime = __importStar(require("@prisma/client/runtime/client"));
exports.PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError;
exports.PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError;
exports.PrismaClientRustPanicError = runtime.PrismaClientRustPanicError;
exports.PrismaClientInitializationError = runtime.PrismaClientInitializationError;
exports.PrismaClientValidationError = runtime.PrismaClientValidationError;
exports.sql = runtime.sqltag;
exports.empty = runtime.empty;
exports.join = runtime.join;
exports.raw = runtime.raw;
exports.Sql = runtime.Sql;
exports.Decimal = runtime.Decimal;
exports.getExtensionContext = runtime.Extensions.getExtensionContext;
exports.prismaVersion = {
    client: "7.10.1",
    engine: "d1b3f377ca835d73fd50954a5e22128b9ebdd6b8"
};
exports.NullTypes = {
    DbNull: runtime.NullTypes.DbNull,
    JsonNull: runtime.NullTypes.JsonNull,
    AnyNull: runtime.NullTypes.AnyNull,
};
exports.DbNull = runtime.DbNull;
exports.JsonNull = runtime.JsonNull;
exports.AnyNull = runtime.AnyNull;
exports.ModelName = {
    User: 'User',
    Athlete: 'Athlete',
    AuthSession: 'AuthSession',
    AuthSessionToken: 'AuthSessionToken',
    BodyMeasurement: 'BodyMeasurement',
    MuscleGroup: 'MuscleGroup',
    Exercise: 'Exercise',
    ExerciseSecondaryMuscleGroup: 'ExerciseSecondaryMuscleGroup',
    TrainingPlan: 'TrainingPlan',
    PlanWeek: 'PlanWeek',
    PlanDay: 'PlanDay',
    PlanExercise: 'PlanExercise',
    WorkoutSession: 'WorkoutSession',
    WorkoutExercise: 'WorkoutExercise',
    SetRecord: 'SetRecord',
    OneRmEstimate: 'OneRmEstimate',
    SessionFeedback: 'SessionFeedback',
    ProgressionSetting: 'ProgressionSetting',
    ProgressionRecommendation: 'ProgressionRecommendation',
    RecommendationEvidence: 'RecommendationEvidence',
    ProgressionApplication: 'ProgressionApplication',
    ScheduledActivity: 'ScheduledActivity',
    PlanningOperation: 'PlanningOperation',
    ExerciseAlias: 'ExerciseAlias'
};
exports.TransactionIsolationLevel = runtime.makeStrictEnum({
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
});
exports.UserScalarFieldEnum = {
    id: 'id',
    email: 'email',
    passwordHash: 'passwordHash',
    status: 'status',
    role: 'role',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.AthleteScalarFieldEnum = {
    id: 'id',
    userId: 'userId',
    birthDate: 'birthDate',
    preferredUnit: 'preferredUnit',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.AuthSessionScalarFieldEnum = {
    id: 'id',
    userId: 'userId',
    tokenFamilyId: 'tokenFamilyId',
    refreshTokenHash: 'refreshTokenHash',
    createdAt: 'createdAt',
    expiresAt: 'expiresAt',
    absoluteExpiresAt: 'absoluteExpiresAt',
    lastUsedAt: 'lastUsedAt',
    generation: 'generation',
    revokedAt: 'revokedAt'
};
exports.AuthSessionTokenScalarFieldEnum = {
    id: 'id',
    sessionId: 'sessionId',
    tokenHash: 'tokenHash',
    generation: 'generation',
    createdAt: 'createdAt',
    consumedAt: 'consumedAt'
};
exports.BodyMeasurementScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    bodyWeight: 'bodyWeight',
    measuredAt: 'measuredAt',
    notes: 'notes'
};
exports.MuscleGroupScalarFieldEnum = {
    id: 'id',
    key: 'key',
    name: 'name',
    description: 'description',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ExerciseScalarFieldEnum = {
    searchName: 'searchName',
    searchDescription: 'searchDescription',
    featuredRank: 'featuredRank',
    id: 'id',
    catalogKey: 'catalogKey',
    origin: 'origin',
    ownerId: 'ownerId',
    name: 'name',
    primaryMuscleGroupId: 'primaryMuscleGroupId',
    equipment: 'equipment',
    equipmentType: 'equipmentType',
    machineType: 'machineType',
    resistanceType: 'resistanceType',
    movementType: 'movementType',
    movementPattern: 'movementPattern',
    grip: 'grip',
    gripWidth: 'gripWidth',
    bodyPosition: 'bodyPosition',
    laterality: 'laterality',
    movementPlane: 'movementPlane',
    difficulty: 'difficulty',
    oneRmSuitability: 'oneRmSuitability',
    description: 'description',
    instructions: 'instructions',
    isActive: 'isActive',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ExerciseSecondaryMuscleGroupScalarFieldEnum = {
    exerciseId: 'exerciseId',
    muscleGroupId: 'muscleGroupId'
};
exports.TrainingPlanScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    name: 'name',
    startsOn: 'startsOn',
    endsOn: 'endsOn',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    creationRequestHash: 'creationRequestHash',
    version: 'version'
};
exports.PlanWeekScalarFieldEnum = {
    id: 'id',
    trainingPlanId: 'trainingPlanId',
    weekNumber: 'weekNumber',
    objective: 'objective',
    startsOn: 'startsOn'
};
exports.PlanDayScalarFieldEnum = {
    id: 'id',
    planWeekId: 'planWeekId',
    name: 'name',
    position: 'position',
    weekday: 'weekday',
    retiredFromOn: 'retiredFromOn',
    retiredAt: 'retiredAt',
    isEditableOverride: 'isEditableOverride',
    sourceWorkoutSessionId: 'sourceWorkoutSessionId',
    creationRequestHash: 'creationRequestHash'
};
exports.PlanExerciseScalarFieldEnum = {
    id: 'id',
    planWeekId: 'planWeekId',
    exerciseId: 'exerciseId',
    position: 'position',
    targetSets: 'targetSets',
    targetReps: 'targetReps',
    targetRepsMin: 'targetRepsMin',
    targetRepsMax: 'targetRepsMax',
    targetLoadUnit: 'targetLoadUnit',
    planDayId: 'planDayId',
    targetRpe: 'targetRpe',
    targetLoad: 'targetLoad',
    notes: 'notes'
};
exports.WorkoutSessionScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    trainingPlanId: 'trainingPlanId',
    planWeekId: 'planWeekId',
    planDayId: 'planDayId',
    performedOn: 'performedOn',
    timeZone: 'timeZone',
    recordingMode: 'recordingMode',
    name: 'name',
    creationRequestHash: 'creationRequestHash',
    version: 'version',
    importOperations: 'importOperations',
    scheduledActivityId: 'scheduledActivityId',
    sourceSnapshot: 'sourceSnapshot',
    copiedFromSessionId: 'copiedFromSessionId',
    completedAt: 'completedAt',
    status: 'status',
    startedAt: 'startedAt',
    finishedAt: 'finishedAt',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.WorkoutExerciseScalarFieldEnum = {
    id: 'id',
    sessionId: 'sessionId',
    exerciseId: 'exerciseId',
    planExerciseId: 'planExerciseId',
    orderInSession: 'orderInSession',
    originalSnapshot: 'originalSnapshot',
    creationRequestHash: 'creationRequestHash',
    isOmitted: 'isOmitted',
    targetSets: 'targetSets',
    targetRepsMin: 'targetRepsMin',
    targetRepsMax: 'targetRepsMax',
    targetLoad: 'targetLoad',
    targetLoadUnit: 'targetLoadUnit',
    targetRpe: 'targetRpe',
    replacesWorkoutExerciseId: 'replacesWorkoutExerciseId',
    notes: 'notes'
};
exports.SetRecordScalarFieldEnum = {
    id: 'id',
    workoutExerciseId: 'workoutExerciseId',
    setNumber: 'setNumber',
    load: 'load',
    loadUnit: 'loadUnit',
    loadKg: 'loadKg',
    status: 'status',
    kind: 'kind',
    creationRequestHash: 'creationRequestHash',
    version: 'version',
    repetitions: 'repetitions',
    rpe: 'rpe',
    isCompleted: 'isCompleted',
    recordedAt: 'recordedAt',
    notes: 'notes'
};
exports.OneRmEstimateScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    exerciseId: 'exerciseId',
    sourceSetId: 'sourceSetId',
    inputLoad: 'inputLoad',
    inputReps: 'inputReps',
    estimatedOneRm: 'estimatedOneRm',
    formula: 'formula',
    algorithmVersion: 'algorithmVersion',
    calculatedAt: 'calculatedAt'
};
exports.SessionFeedbackScalarFieldEnum = {
    id: 'id',
    sessionId: 'sessionId',
    globalRpe: 'globalRpe',
    fatigueScore: 'fatigueScore',
    notes: 'notes',
    recordedAt: 'recordedAt'
};
exports.ProgressionSettingScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    exerciseId: 'exerciseId',
    trainingPlanId: 'trainingPlanId',
    minSuccessfulSessions: 'minSuccessfulSessions',
    targetRpeMin: 'targetRpeMin',
    targetRpeMax: 'targetRpeMax',
    incrementPercent: 'incrementPercent',
    incrementAbsolute: 'incrementAbsolute',
    maxIncrementPercent: 'maxIncrementPercent',
    maxLoad: 'maxLoad',
    autoApplyAuthorized: 'autoApplyAuthorized',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ProgressionRecommendationScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    exerciseId: 'exerciseId',
    planWeekId: 'planWeekId',
    planExerciseId: 'planExerciseId',
    previousLoad: 'previousLoad',
    recommendedLoad: 'recommendedLoad',
    justification: 'justification',
    status: 'status',
    algorithmVersion: 'algorithmVersion',
    effectiveSettings: 'effectiveSettings',
    createdAt: 'createdAt',
    expiresAt: 'expiresAt',
    reviewedAt: 'reviewedAt'
};
exports.RecommendationEvidenceScalarFieldEnum = {
    id: 'id',
    recommendationId: 'recommendationId',
    sessionId: 'sessionId',
    role: 'role',
    associatedAt: 'associatedAt'
};
exports.ProgressionApplicationScalarFieldEnum = {
    id: 'id',
    recommendationId: 'recommendationId',
    appliedLoad: 'appliedLoad',
    origin: 'origin',
    effectiveAt: 'effectiveAt'
};
exports.ScheduledActivityScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    planWeekId: 'planWeekId',
    planDayId: 'planDayId',
    originalPlanDayId: 'originalPlanDayId',
    originalOn: 'originalOn',
    scheduledOn: 'scheduledOn',
    timeZone: 'timeZone',
    title: 'title',
    status: 'status',
    version: 'version',
    creationRequestHash: 'creationRequestHash'
};
exports.PlanningOperationScalarFieldEnum = {
    id: 'id',
    athleteId: 'athleteId',
    planId: 'planId',
    requestHash: 'requestHash',
    result: 'result'
};
exports.ExerciseAliasScalarFieldEnum = {
    id: 'id',
    exerciseId: 'exerciseId',
    name: 'name',
    normalizedName: 'normalizedName'
};
exports.SortOrder = {
    asc: 'asc',
    desc: 'desc'
};
exports.NullableJsonNullValueInput = {
    DbNull: exports.DbNull,
    JsonNull: exports.JsonNull
};
exports.JsonNullValueInput = {
    JsonNull: exports.JsonNull
};
exports.QueryMode = {
    default: 'default',
    insensitive: 'insensitive'
};
exports.NullsOrder = {
    first: 'first',
    last: 'last'
};
exports.JsonNullValueFilter = {
    DbNull: exports.DbNull,
    JsonNull: exports.JsonNull,
    AnyNull: exports.AnyNull
};
exports.defineExtension = runtime.Extensions.defineExtension;
