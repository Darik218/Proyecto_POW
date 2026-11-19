import { Decimal } from '@prisma/client/runtime/client';

export const planAttributes = {
  id: '51000000-0000-4000-8000-000000000001',
  name: 'Plan MVC',
  startsOn: new Date('2027-01-04T00:00:00.000Z'),
  endsOn: null as Date | null,
  status: 'DRAFT' as const,
  version: 4,
  createdAt: new Date('2026-11-01T10:30:00.123Z'),
  updatedAt: new Date('2026-11-02T11:45:00.456Z'),
};
export const weekAttributes = {
  id: '52000000-0000-4000-8000-000000000001',
  weekNumber: 1,
  startsOn: null as Date | null,
  objective: null as string | null,
};
export const prescriptionAttributes = {
  id: '53000000-0000-4000-8000-000000000001',
  position: 1,
  targetSets: 3,
  targetReps: 8 as number | null,
  targetRepsMin: 8 as number | null,
  targetRepsMax: 8 as number | null,
  targetLoad: new Decimal('77.125') as Decimal | null,
  targetLoadUnit: null as 'KG' | 'LB' | null,
  targetRpe: new Decimal('7.5') as Decimal | null,
  notes: null as string | null,
  exercise: {
    id: '54000000-0000-4000-8000-000000000001',
    name: 'Press banca',
    muscleGroup: 'Pectorales',
    equipment: 'Barra',
    description: null as string | null,
  },
};
