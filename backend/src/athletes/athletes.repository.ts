import type { MeasurementUnit } from '../generated/prisma/client';
import type { Athlete } from '../models/athletes/athlete.model';
import type { BodyMeasurement } from '../models/athletes/body-measurement.model';

export const ATHLETES_REPOSITORY = Symbol('ATHLETES_REPOSITORY');

export type ProfileUpdate = {
  birthDate?: Date | null;
  preferredUnit?: MeasurementUnit;
};

export type NewMeasurement = {
  athleteId: string;
  bodyWeight: number;
  measuredAt: Date;
  notes?: string;
};

export interface AthletesRepository {
  findProfileByUserId(userId: string): Promise<Athlete | null>;
  updateProfile(userId: string, update: ProfileUpdate): Promise<Athlete | null>;
  findMeasurements(athleteId: string): Promise<BodyMeasurement[]>;
  createMeasurement(input: NewMeasurement): Promise<BodyMeasurement>;
}
