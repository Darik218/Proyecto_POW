import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import {
  TRAINING_PLANS_REPOSITORY,
} from './training-plans.repository';
import type {
  NewPlan,
  NewPrescription,
  NewWeek,
  PlanDetail,
  PlanUpdate,
  PrescriptionUpdate,
  TrainingPlansRepository,
  WeekUpdate,
} from './training-plans.repository';
import { CreatePlanExerciseDto } from './dto/create-plan-exercise.dto';
import { CreatePlanWeekDto } from './dto/create-plan-week.dto';
import { CreateTrainingPlanDto } from './dto/create-training-plan.dto';
import { UpdatePlanExerciseDto } from './dto/update-plan-exercise.dto';
import { UpdatePlanWeekDto } from './dto/update-plan-week.dto';
import { UpdateTrainingPlanDto } from './dto/update-training-plan.dto';

@Injectable()
export class TrainingPlansService {
  constructor(
    @Inject(TRAINING_PLANS_REPOSITORY)
    private readonly repository: TrainingPlansRepository,
  ) {}

  async list(identity: AuthenticatedIdentity) {
    const athleteId = await this.athleteId(identity);
    return this.repository.list(athleteId);
  }

  async create(identity: AuthenticatedIdentity, dto: CreateTrainingPlanDto) {
    const athleteId = await this.athleteId(identity);
    const input: NewPlan = {
      name: dto.name,
      startsOn: new Date(`${dto.startsOn}T00:00:00.000Z`),
    };
    if (dto.endsOn !== undefined) {
      input.endsOn = dto.endsOn === null ? null : new Date(`${dto.endsOn}T00:00:00.000Z`);
    }
    this.assertDateRange(input.startsOn, input.endsOn ?? null);
    return this.repository.create(athleteId, input);
  }

  async get(identity: AuthenticatedIdentity, planId: string): Promise<PlanDetail> {
    const athleteId = await this.athleteId(identity);
    const plan = await this.repository.findById(athleteId, planId);
    if (!plan) throw new NotFoundException('Training plan not found.');
    return plan;
  }

  async update(identity: AuthenticatedIdentity, planId: string, dto: UpdateTrainingPlanDto) {
    if (dto.name === undefined && dto.startsOn === undefined && dto.endsOn === undefined) {
      throw new BadRequestException('At least one editable field is required.');
    }
    const athleteId = await this.athleteId(identity);
    const plan = await this.repository.findById(athleteId, planId);
    if (!plan) throw new NotFoundException('Training plan not found.');
    this.assertDraft(plan.status);

    const update: PlanUpdate = {};
    if (dto.name !== undefined) update.name = dto.name;
    if (dto.startsOn !== undefined) update.startsOn = new Date(`${dto.startsOn}T00:00:00.000Z`);
    if (dto.endsOn !== undefined) {
      update.endsOn = dto.endsOn === null ? null : new Date(`${dto.endsOn}T00:00:00.000Z`);
    }
    const startsOn = update.startsOn ?? plan.startsOn;
    const endsOn = update.endsOn !== undefined ? update.endsOn : plan.endsOn;
    this.assertDateRange(startsOn, endsOn);

    const updated = await this.repository.update(athleteId, planId, update);
    if (updated === 'historical') {
      throw new ConflictException('A training plan linked to training history cannot be modified.');
    }
    if (!updated) throw new ConflictException('Training plan is no longer editable.');
    return updated;
  }

  async createWeek(identity: AuthenticatedIdentity, planId: string, dto: CreatePlanWeekDto) {
    const athleteId = await this.athleteId(identity);
    await this.assertOwnedDraft(athleteId, planId);
    const input: NewWeek = { weekNumber: dto.weekNumber };
    if (dto.objective !== undefined) input.objective = dto.objective;
    try {
      const week = await this.repository.createWeek(athleteId, planId, input);
      if (!week) throw new ConflictException('Training plan is no longer editable.');
      return week;
    } catch (error) {
      this.throwIfUniqueConflict(error, 'A week with this number already exists in the plan.');
      throw error;
    }
  }

  async updateWeek(identity: AuthenticatedIdentity, planId: string, weekId: string, dto: UpdatePlanWeekDto) {
    if (dto.weekNumber === undefined && dto.objective === undefined) {
      throw new BadRequestException('At least one editable field is required.');
    }
    const athleteId = await this.athleteId(identity);
    await this.assertOwnedDraft(athleteId, planId);
    const update: WeekUpdate = {};
    if (dto.weekNumber !== undefined) update.weekNumber = dto.weekNumber;
    if (dto.objective !== undefined) update.objective = dto.objective;
    try {
      const week = await this.repository.updateWeek(athleteId, planId, weekId, update);
      if (week === 'historical') {
        throw new ConflictException('A week linked to training history cannot be modified.');
      }
      if (!week) throw new NotFoundException('Plan week not found.');
      return week;
    } catch (error) {
      this.throwIfUniqueConflict(error, 'A week with this number already exists in the plan.');
      throw error;
    }
  }

  async listWeekExercises(identity: AuthenticatedIdentity, planId: string, weekId: string) {
    const plan = await this.get(identity, planId);
    const week = plan.weeks.find((item) => item.id === weekId);
    if (!week) throw new NotFoundException('Plan week not found.');
    return week.exercises;
  }

  async getWeekExercise(identity: AuthenticatedIdentity, planId: string, weekId: string, prescriptionId: string) {
    const exercises = await this.listWeekExercises(identity, planId, weekId);
    const prescription = exercises.find((item) => item.id === prescriptionId);
    if (!prescription) throw new NotFoundException('Plan exercise not found.');
    return prescription;
  }

  async createWeekExercise(identity: AuthenticatedIdentity, planId: string, weekId: string, dto: CreatePlanExerciseDto) {
    const athleteId = await this.athleteId(identity);
    const plan = await this.assertOwnedDraft(athleteId, planId);
    if (!plan.weeks.some((week) => week.id === weekId)) {
      throw new NotFoundException('Plan week not found.');
    }
    const input: NewPrescription = {
      exerciseId: dto.exerciseId,
      position: dto.position,
      targetSets: dto.targetSets,
      targetReps: dto.targetReps,
    };
    if (dto.targetRpe !== undefined) input.targetRpe = dto.targetRpe;
    if (dto.targetLoad !== undefined) input.targetLoad = dto.targetLoad;
    if (dto.notes !== undefined) input.notes = dto.notes;
    try {
      const exercise = await this.repository.createPrescription(athleteId, planId, weekId, input);
      if (!exercise) {
        throw new NotFoundException('Plan week or active catalog exercise not found.');
      }
      return exercise;
    } catch (error) {
      this.throwIfUniqueConflict(error, 'A prescription already exists at this position in the week.');
      throw error;
    }
  }

  async updateWeekExercise(identity: AuthenticatedIdentity, planId: string, weekId: string, prescriptionId: string, dto: UpdatePlanExerciseDto) {
    if (
      dto.position === undefined &&
      dto.targetSets === undefined &&
      dto.targetReps === undefined &&
      dto.targetRpe === undefined &&
      dto.targetLoad === undefined &&
      dto.notes === undefined
    ) {
      throw new BadRequestException('At least one editable field is required.');
    }
    const athleteId = await this.athleteId(identity);
    await this.assertOwnedDraft(athleteId, planId);
    const update: PrescriptionUpdate = {};
    if (dto.position !== undefined) update.position = dto.position;
    if (dto.targetSets !== undefined) update.targetSets = dto.targetSets;
    if (dto.targetReps !== undefined) update.targetReps = dto.targetReps;
    if (dto.targetRpe !== undefined) update.targetRpe = dto.targetRpe;
    if (dto.targetLoad !== undefined) update.targetLoad = dto.targetLoad;
    if (dto.notes !== undefined) update.notes = dto.notes;
    try {
      const exercise = await this.repository.updatePrescription(athleteId, planId, weekId, prescriptionId, update);
      if (exercise === 'historical') {
        throw new ConflictException('A prescription linked to training history cannot be modified.');
      }
      if (!exercise) throw new NotFoundException('Plan exercise not found.');
      return exercise;
    } catch (error) {
      this.throwIfUniqueConflict(error, 'A prescription already exists at this position in the week.');
      throw error;
    }
  }

  async removeWeekExercise(identity: AuthenticatedIdentity, planId: string, weekId: string, prescriptionId: string) {
    const athleteId = await this.athleteId(identity);
    await this.assertOwnedDraft(athleteId, planId);
    const outcome = await this.repository.removePrescription(athleteId, planId, weekId, prescriptionId);
    if (outcome === 'historical') {
      throw new ConflictException('A prescription linked to training history cannot be removed.');
    }
    if (outcome === 'missing') throw new NotFoundException('Plan exercise not found.');
    return { deleted: true };
  }

  private async athleteId(identity: AuthenticatedIdentity): Promise<string> {
    const athleteId = await this.repository.findAthleteId(identity.account.id);
    if (!athleteId) throw new NotFoundException('Athlete profile not found.');
    return athleteId;
  }

  private async assertOwnedDraft(athleteId: string, planId: string): Promise<PlanDetail> {
    const plan = await this.repository.findById(athleteId, planId);
    if (!plan) throw new NotFoundException('Training plan not found.');
    this.assertDraft(plan.status);
    return plan;
  }

  private assertDraft(status: PlanDetail['status']): void {
    if (status !== 'DRAFT') {
      throw new ConflictException('Only draft training plans can be modified.');
    }
  }

  private assertDateRange(startsOn: Date, endsOn: Date | null): void {
    if (endsOn && endsOn < startsOn) {
      throw new BadRequestException('endsOn must be on or after startsOn.');
    }
  }

  private throwIfUniqueConflict(error: unknown, message: string): void {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      throw new ConflictException(message);
    }
  }
}
