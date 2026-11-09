import { Decimal } from '@prisma/client/runtime/client';

export const athleteUserId = '31000000-0000-4000-8000-000000000001';
export const otherAthleteUserId = '31000000-0000-4000-8000-000000000002';
export const athleteId = '21000000-0000-4000-8000-000000000001';
export const otherAthleteId = '21000000-0000-4000-8000-000000000002';
export const profileAttributes = {
  id: athleteId,
  birthDate: null as Date | null,
  preferredUnit: 'KG' as const,
  createdAt: new Date('2026-01-01T00:00:00.123Z'),
  updatedAt: new Date('2026-01-02T00:00:00.456Z'),
};
export const measurementAttributes = {
  id: '41000000-0000-4000-8000-000000000001',
  bodyWeight: new Decimal('72.125'),
  measuredAt: new Date('2026-02-01T04:30:00.789Z'),
  notes: null as string | null,
};
