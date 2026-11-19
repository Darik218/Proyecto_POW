import type { PerformanceHistory } from '../progression/performance-analysis.model';
import type {
  ExerciseResistanceType,
  OneRmSuitability,
} from '../../generated/prisma/client';
export type ProgressPeriod = '7' | '30' | '90' | 'all';
export type ProgressWindow = {
  period: ProgressPeriod;
  from: string | null;
  to: string;
  timeZone?: string;
};
export type ProgressExercise = {
  id: string;
  name: string;
  resistanceType: ExerciseResistanceType | null;
  oneRmSuitability: OneRmSuitability;
};
export type ProgressRead = {
  plans?: Array<{ id: string; name: string; status: string }>;
  selectedPlanId?: string | null;
  nextSession?: {
    activityId: string;
    planId: string;
    planWeekId: string;
    planDayId: string;
    performedOn: string;
    timeZone: string;
    title: string;
  } | null;
  planDays?: Array<{
    id: string;
    name: string;
    planName: string;
    planId?: string;
    weekId?: string;
    weekNumber?: number;
  }>;
  selectedPlanDayId?: string | null;
  sessions: Array<{ id: string; performedOn: string }>;
  exercises: ProgressExercise[];
  selectedExerciseId: string | null;
  undatedSessions: number;
  history: PerformanceHistory | null;
  truncated: {
    sessions: boolean;
    exercises: boolean;
    tasks: boolean;
    sets: boolean;
    estimates: boolean;
  };
};
export const PROGRESS_LIMITS = Object.freeze({
  sessions: 500,
  exercises: 200,
  tasks: 100,
  sets: 1000,
  estimates: 2000,
});
