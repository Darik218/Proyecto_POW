import { Decimal } from '@prisma/client/runtime/client';
import { Athlete } from './athlete.model';
import { BodyMeasurement } from './body-measurement.model';
import {
  profileAttributes,
  measurementAttributes,
  athleteId,
} from '../../../test/fixtures/athlete.fixture';

describe('Athlete and body measurement domain projections', () => {
  it('preserves the identity consumed by workout ownership resolution, nullable birth date and preferred units', () => {
    const profile = new Athlete(profileAttributes);
    expect(profile.id).toBe(athleteId);
    expect(profile.attributes.birthDate).toBeNull();
    expect(profile.attributes.preferredUnit).toBe('KG');
    const birthDate = new Date('1995-06-15T00:00:00.000Z');
    const lb = new Athlete({
      ...profileAttributes,
      birthDate,
      preferredUnit: 'LB',
    });
    expect(lb.attributes.birthDate).toBe(birthDate);
    expect(lb.attributes.preferredUnit).toBe('LB');
    expect(lb.attributes.createdAt).toBe(profileAttributes.createdAt);
  });
  it.each(['0.001', '72.125', '9999.999'])(
    'retains decimal %s and its measurement timestamp without conversion or inferred units',
    (weight) => {
      const decimal = new Decimal(weight);
      const measurement = new BodyMeasurement({
        ...measurementAttributes,
        bodyWeight: decimal,
      });
      expect(measurement.attributes.bodyWeight).toBe(decimal);
      expect(measurement.attributes.bodyWeight.toString()).toBe(weight);
      expect(measurement.attributes.measuredAt).toBe(
        measurementAttributes.measuredAt,
      );
      expect(measurement.attributes.notes).toBeNull();
    },
  );
});
