import type { Decimal } from '@prisma/client/runtime/client';
import type {
  MeasurementUnit,
  WorkoutSetKind,
  WorkoutSetStatus,
} from '../../generated/prisma/client';

export type SetRecordAttributes = {
  id: string;
  setNumber: number;
  load: Decimal | null;
  loadUnit: MeasurementUnit | null;
  loadKg: Decimal | null;
  repetitions: number | null;
  rpe: Decimal | null;
  kind: WorkoutSetKind | null;
  status: WorkoutSetStatus | null;
  isCompleted: boolean;
  notes: string | null;
  recordedAt: Date;
  version: number;
};
