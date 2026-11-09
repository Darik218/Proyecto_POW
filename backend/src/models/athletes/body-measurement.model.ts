import type { Decimal } from '@prisma/client/runtime/client';

export type BodyMeasurementAttributes = {
  id: string;
  bodyWeight: Decimal;
  measuredAt: Date;
  notes: string | null;
};

// Decimal is retained until the public numeric representation is prepared.
// Existing measurements have no per-record unit; do not infer it from profile preferences.
export class BodyMeasurement {
  constructor(readonly attributes: Readonly<BodyMeasurementAttributes>) {}
}
