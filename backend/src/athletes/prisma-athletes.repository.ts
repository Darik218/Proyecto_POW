import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Athlete } from '../models/athletes/athlete.model';
import { BodyMeasurement } from '../models/athletes/body-measurement.model';
import type {
  AthletesRepository,
  NewMeasurement,
  ProfileUpdate,
} from './athletes.repository';

@Injectable()
export class PrismaAthletesRepository implements AthletesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfileByUserId(userId: string): Promise<Athlete | null> {
    const profile = await this.prisma.athlete.findUnique({
      where: { userId },
      select: {
        id: true,
        birthDate: true,
        preferredUnit: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return profile ? new Athlete(profile) : null;
  }

  updateProfile(
    userId: string,
    update: ProfileUpdate,
  ): Promise<Athlete | null> {
    return this.prisma.athlete
      .update({
        where: { userId },
        data: update,
        select: {
          id: true,
          birthDate: true,
          preferredUnit: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      .then((profile) => new Athlete(profile))
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2025'
        ) {
          return null;
        }
        throw error;
      });
  }

  async findMeasurements(athleteId: string): Promise<BodyMeasurement[]> {
    const measurements = await this.prisma.bodyMeasurement.findMany({
      where: { athleteId },
      orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
      select: { id: true, bodyWeight: true, measuredAt: true, notes: true },
    });
    return measurements.map((item) => new BodyMeasurement(item));
  }

  async createMeasurement(input: NewMeasurement): Promise<BodyMeasurement> {
    const measurement = await this.prisma.bodyMeasurement.create({
      data: {
        athleteId: input.athleteId,
        bodyWeight: input.bodyWeight,
        measuredAt: input.measuredAt,
        notes: input.notes,
      },
      select: { id: true, bodyWeight: true, measuredAt: true, notes: true },
    });
    return new BodyMeasurement(measurement);
  }
}
