import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import {
  ATHLETES_REPOSITORY,
} from './athletes.repository';
import type {
  AthletesRepository,
  BodyMeasurementRecord,
  NewMeasurement,
  ProfileUpdate,
} from './athletes.repository';
import { CreateMeasurementDto } from './dto/create-measurement.dto';
import { UpdateAthleteDto } from './dto/update-athlete.dto';

@Injectable()
export class AthletesService {
  constructor(
    @Inject(ATHLETES_REPOSITORY)
    private readonly repository: AthletesRepository,
  ) {}

  async getMyProfile(identity: AuthenticatedIdentity) {
    const profile = await this.repository.findProfileByUserId(identity.account.id);
    if (!profile) throw new NotFoundException('Athlete profile not found.');
    return profile;
  }

  async updateMyProfile(identity: AuthenticatedIdentity, dto: UpdateAthleteDto) {
    const update: ProfileUpdate = {};
    if (dto.birthDate !== undefined) {
      update.birthDate = dto.birthDate === null ? null : new Date(dto.birthDate);
    }
    if (dto.preferredUnit !== undefined) update.preferredUnit = dto.preferredUnit;
    if (Object.keys(update).length === 0) {
      throw new BadRequestException('At least one editable field is required.');
    }
    const profile = await this.repository.updateProfile(identity.account.id, update);
    if (!profile) throw new NotFoundException('Athlete profile not found.');
    return profile;
  }

  async getMyMeasurements(
    identity: AuthenticatedIdentity,
  ): Promise<BodyMeasurementRecord[]> {
    const profile = await this.getMyProfile(identity);
    return this.repository.findMeasurements(profile.id);
  }

  async addMyMeasurement(
    identity: AuthenticatedIdentity,
    dto: CreateMeasurementDto,
  ): Promise<BodyMeasurementRecord> {
    const profile = await this.getMyProfile(identity);
    const input: NewMeasurement = {
      athleteId: profile.id,
      bodyWeight: dto.bodyWeight,
      measuredAt: new Date(dto.measuredAt),
    };
    if (dto.notes !== undefined) input.notes = dto.notes;
    return this.repository.createMeasurement(input);
  }
}
