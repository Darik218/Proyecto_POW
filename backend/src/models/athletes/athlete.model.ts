import type { MeasurementUnit } from '../../generated/prisma/client';

// Profile projection resolved by authenticated user, without the User/authentication graph.
export type AthleteAttributes = {
  id: string;
  birthDate: Date | null;
  preferredUnit: MeasurementUnit;
  createdAt: Date;
  updatedAt: Date;
};

export class Athlete {
  constructor(readonly attributes: Readonly<AthleteAttributes>) {}

  // Application consumers use this identity to scope athlete-owned resources.
  get id(): string {
    return this.attributes.id;
  }
}
