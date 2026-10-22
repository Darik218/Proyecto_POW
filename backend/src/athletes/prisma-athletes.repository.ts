import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  AthleteProfile,
  AthletesRepository,
  BodyMeasurementRecord,
  NewMeasurement,
  ProfileUpdate,
} from './athletes.repository';

@Injectable()
export class PrismaAthletesRepository implements AthletesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findProfileByUserId(userId: string): Promise<AthleteProfile | null> {
    return this.prisma.athlete.findUnique({
      where: { userId },
      select: {
        id: true,
        birthDate: true,
        preferredUnit: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  updateProfile(
    userId: string,
    update: ProfileUpdate,
  ): Promise<AthleteProfile | null> {
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

  async findMeasurements(athleteId: string): Promise<BodyMeasurementRecord[]> {
    const measurements = await this.prisma.bodyMeasurement.findMany({
      where: { athleteId },
      orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
      select: { id: true, bodyWeight: true, measuredAt: true, notes: true },
    });
    return measurements.map((item) => ({
      ...item,
      bodyWeight: Number(item.bodyWeight),
    }));
  }

  async createMeasurement(input: NewMeasurement): Promise<BodyMeasurementRecord> {
    const measurement = await this.prisma.bodyMeasurement.create({
      data: {
        athleteId: input.athleteId,
        bodyWeight: input.bodyWeight,
        measuredAt: input.measuredAt,
        notes: input.notes,
      },
      select: { id: true, bodyWeight: true, measuredAt: true, notes: true },
    });
    return { ...measurement, bodyWeight: Number(measurement.bodyWeight) };
  }
}
