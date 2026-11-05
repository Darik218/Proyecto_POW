import type { MeasurementUnit } from '../generated/prisma/client';

export const ATHLETES_REPOSITORY = Symbol('ATHLETES_REPOSITORY');

export type AthleteProfile = {
  id: string;
  birthDate: Date | null;
  preferredUnit: MeasurementUnit;
  createdAt: Date;
  updatedAt: Date;
};

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

export type BodyMeasurementRecord = {
  id: string;
  bodyWeight: number;
  measuredAt: Date;
  notes: string | null;
};

export interface AthletesRepository {
  findProfileByUserId(userId: string): Promise<AthleteProfile | null>;
  updateProfile(userId: string, update: ProfileUpdate): Promise<AthleteProfile | null>;
  findMeasurements(athleteId: string): Promise<BodyMeasurementRecord[]>;
  createMeasurement(input: NewMeasurement): Promise<BodyMeasurementRecord>;
}
