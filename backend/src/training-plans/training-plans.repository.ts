import type { TrainingPlan, PlanAttributes, PlanDetailAttributes, PlanWeekAttributes, PlanPrescription } from '../models/training-plans/training-plan.model';

export const TRAINING_PLANS_REPOSITORY = Symbol('TRAINING_PLANS_REPOSITORY');

export type NewPlan = { name: string; startsOn: Date | null; endsOn?: Date | null };
export type PlanUpdate = Partial<NewPlan>;
export type NewWeek = { weekNumber: number; startsOn?: Date | null; objective?: string | null };
export type WeekUpdate = Partial<NewWeek>;
export type NewPrescription = {
  exerciseId: string;
  position: number;
  targetSets: number;
  targetReps: number;
  targetRpe?: number | null;
  targetLoad?: number | null;
  notes?: string | null;
};
export type PrescriptionUpdate = Partial<Omit<NewPrescription, 'exerciseId'>>;

export type PlanWeekSummary = PlanWeekAttributes;
export type PlanSummary = TrainingPlan<PlanAttributes>;
export type PlanDetail = TrainingPlan<PlanDetailAttributes>;

export interface TrainingPlansRepository {
  findAthleteId(userId: string): Promise<string | null>;
  list(athleteId: string): Promise<PlanSummary[]>;
  findById(athleteId: string, planId: string): Promise<PlanDetail | null>;
  create(athleteId: string, input: NewPlan): Promise<PlanSummary>;
  update(athleteId: string, planId: string, input: PlanUpdate): Promise<PlanSummary | null | 'historical'>;
  createWeek(athleteId: string, planId: string, input: NewWeek): Promise<PlanWeekSummary | null>;
  updateWeek(athleteId: string, planId: string, weekId: string, input: WeekUpdate): Promise<PlanWeekSummary | null | 'historical'>;
  createPrescription(athleteId: string, planId: string, weekId: string, input: NewPrescription): Promise<PlanPrescription | null>;
  updatePrescription(athleteId: string, planId: string, weekId: string, prescriptionId: string, input: PrescriptionUpdate): Promise<PlanPrescription | null | 'historical'>;
  removePrescription(athleteId: string, planId: string, weekId: string, prescriptionId: string): Promise<'removed' | 'missing' | 'historical'>;
}
