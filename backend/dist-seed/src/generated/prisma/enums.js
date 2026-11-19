"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduledActivityStatus = exports.OneRmSuitability = exports.ExerciseDifficulty = exports.ExerciseMovementPlane = exports.ExerciseLaterality = exports.ExerciseBodyPosition = exports.ExerciseGripWidth = exports.ExerciseGrip = exports.ExerciseMovementPattern = exports.ExerciseMovementType = exports.ExerciseResistanceType = exports.ExerciseMachineType = exports.ExerciseEquipmentType = exports.ExerciseOrigin = exports.ApplicationOrigin = exports.RecommendationStatus = exports.EvidenceRole = exports.OneRmFormula = exports.WorkoutStatus = exports.WorkoutSetKind = exports.WorkoutSetStatus = exports.PlanStatus = exports.MeasurementUnit = exports.UserRole = exports.AccountStatus = void 0;
exports.AccountStatus = {
    ACTIVE: 'ACTIVE',
    SUSPENDED: 'SUSPENDED',
    CLOSED: 'CLOSED'
};
exports.UserRole = {
    ATHLETE: 'ATHLETE',
    ADMIN: 'ADMIN'
};
exports.MeasurementUnit = {
    KG: 'KG',
    LB: 'LB'
};
exports.PlanStatus = {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED',
    ARCHIVED: 'ARCHIVED'
};
exports.WorkoutSetStatus = {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    INCOMPLETE: 'INCOMPLETE',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED'
};
exports.WorkoutSetKind = {
    WARMUP: 'WARMUP',
    WORK: 'WORK'
};
exports.WorkoutStatus = {
    PLANNED: 'PLANNED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
};
exports.OneRmFormula = {
    EPLEY: 'EPLEY',
    BRZYCKI: 'BRZYCKI'
};
exports.EvidenceRole = {
    SATISFACTORY: 'SATISFACTORY',
    UNSATISFACTORY: 'UNSATISFACTORY',
    CONTEXT: 'CONTEXT'
};
exports.RecommendationStatus = {
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    APPLIED: 'APPLIED',
    BLOCKED: 'BLOCKED',
    EXPIRED: 'EXPIRED'
};
exports.ApplicationOrigin = {
    MANUAL: 'MANUAL',
    AUTOMATIC: 'AUTOMATIC'
};
exports.ExerciseOrigin = {
    GLOBAL: 'GLOBAL',
    PERSONAL: 'PERSONAL'
};
exports.ExerciseEquipmentType = {
    BARBELL: 'BARBELL',
    EZ_BAR: 'EZ_BAR',
    DUMBBELL: 'DUMBBELL',
    MACHINE: 'MACHINE',
    SMITH_MACHINE: 'SMITH_MACHINE',
    CABLE: 'CABLE',
    BODYWEIGHT: 'BODYWEIGHT',
    KETTLEBELL: 'KETTLEBELL',
    RESISTANCE_BAND: 'RESISTANCE_BAND',
    MEDICINE_BALL: 'MEDICINE_BALL',
    RINGS: 'RINGS',
    LANDMINE: 'LANDMINE',
    OTHER: 'OTHER'
};
exports.ExerciseMachineType = {
    SELECTORIZED: 'SELECTORIZED',
    PLATE_LOADED: 'PLATE_LOADED',
    CONVERGING: 'CONVERGING',
    SMITH: 'SMITH',
    CABLE: 'CABLE',
    LEVER: 'LEVER',
    HACK_SQUAT: 'HACK_SQUAT',
    LEG_PRESS: 'LEG_PRESS',
    OTHER: 'OTHER'
};
exports.ExerciseResistanceType = {
    FREE_WEIGHT: 'FREE_WEIGHT',
    BODYWEIGHT: 'BODYWEIGHT',
    WEIGHT_STACK: 'WEIGHT_STACK',
    PLATE_LOADED: 'PLATE_LOADED',
    CABLE: 'CABLE',
    ELASTIC: 'ELASTIC',
    MEDICINE_BALL: 'MEDICINE_BALL',
    ISOMETRIC: 'ISOMETRIC',
    OTHER: 'OTHER'
};
exports.ExerciseMovementType = {
    COMPOUND: 'COMPOUND',
    ISOLATION: 'ISOLATION',
    OLYMPIC: 'OLYMPIC',
    PLYOMETRIC: 'PLYOMETRIC',
    ISOMETRIC: 'ISOMETRIC',
    CARRY: 'CARRY',
    MOBILITY: 'MOBILITY'
};
exports.ExerciseMovementPattern = {
    SQUAT: 'SQUAT',
    HIP_HINGE: 'HIP_HINGE',
    LUNGE: 'LUNGE',
    HORIZONTAL_PUSH: 'HORIZONTAL_PUSH',
    VERTICAL_PUSH: 'VERTICAL_PUSH',
    HORIZONTAL_PULL: 'HORIZONTAL_PULL',
    VERTICAL_PULL: 'VERTICAL_PULL',
    ELBOW_FLEXION: 'ELBOW_FLEXION',
    ELBOW_EXTENSION: 'ELBOW_EXTENSION',
    SHOULDER_ABDUCTION: 'SHOULDER_ABDUCTION',
    SHOULDER_ROTATION: 'SHOULDER_ROTATION',
    HIP_EXTENSION: 'HIP_EXTENSION',
    HIP_ABDUCTION: 'HIP_ABDUCTION',
    HIP_ADDUCTION: 'HIP_ADDUCTION',
    KNEE_EXTENSION: 'KNEE_EXTENSION',
    KNEE_FLEXION: 'KNEE_FLEXION',
    CALF_RAISE: 'CALF_RAISE',
    TRUNK_FLEXION: 'TRUNK_FLEXION',
    TRUNK_EXTENSION: 'TRUNK_EXTENSION',
    ROTATION: 'ROTATION',
    ANTI_ROTATION: 'ANTI_ROTATION',
    CARRY: 'CARRY',
    OLYMPIC_LIFT: 'OLYMPIC_LIFT',
    JUMP: 'JUMP',
    OTHER: 'OTHER'
};
exports.ExerciseGrip = {
    PRONATED: 'PRONATED',
    SUPINATED: 'SUPINATED',
    NEUTRAL: 'NEUTRAL',
    MIXED: 'MIXED',
    HOOK: 'HOOK',
    STRAPPED: 'STRAPPED',
    NONE: 'NONE',
    VARIABLE: 'VARIABLE'
};
exports.ExerciseGripWidth = {
    NARROW: 'NARROW',
    SHOULDER_WIDTH: 'SHOULDER_WIDTH',
    WIDE: 'WIDE',
    VARIABLE: 'VARIABLE',
    NOT_APPLICABLE: 'NOT_APPLICABLE'
};
exports.ExerciseBodyPosition = {
    STANDING: 'STANDING',
    SEATED: 'SEATED',
    SUPINE: 'SUPINE',
    PRONE: 'PRONE',
    SIDE_LYING: 'SIDE_LYING',
    KNEELING: 'KNEELING',
    HALF_KNEELING: 'HALF_KNEELING',
    HANGING: 'HANGING',
    QUADRUPED: 'QUADRUPED',
    OTHER: 'OTHER'
};
exports.ExerciseLaterality = {
    UNILATERAL: 'UNILATERAL',
    BILATERAL: 'BILATERAL',
    ALTERNATING: 'ALTERNATING',
    NOT_APPLICABLE: 'NOT_APPLICABLE'
};
exports.ExerciseMovementPlane = {
    SAGITTAL: 'SAGITTAL',
    FRONTAL: 'FRONTAL',
    TRANSVERSE: 'TRANSVERSE',
    MULTIPLANAR: 'MULTIPLANAR'
};
exports.ExerciseDifficulty = {
    BEGINNER: 'BEGINNER',
    INTERMEDIATE: 'INTERMEDIATE',
    ADVANCED: 'ADVANCED'
};
exports.OneRmSuitability = {
    SUITABLE: 'SUITABLE',
    NOT_SUITABLE: 'NOT_SUITABLE',
    UNDETERMINED: 'UNDETERMINED'
};
exports.ScheduledActivityStatus = {
    PLANNED: 'PLANNED',
    RESCHEDULED: 'RESCHEDULED',
    OMITTED: 'OMITTED',
    WITHDRAWN: 'WITHDRAWN',
    REST: 'REST'
};
