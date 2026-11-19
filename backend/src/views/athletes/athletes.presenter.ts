import type { Athlete } from '../../models/athletes/athlete.model';
import type { BodyMeasurement } from '../../models/athletes/body-measurement.model';

export class AthletesPresenter {
  profile(athlete: Athlete) {
    const fields = athlete.attributes;
    return {
      id: fields.id,
      birthDate: fields.birthDate,
      preferredUnit: fields.preferredUnit,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    };
  }

  measurement(measurement: BodyMeasurement) {
    const fields = measurement.attributes;
    return {
      id: fields.id,
      // Preserve the established JSON number contract; no arithmetic or unit conversion.
      bodyWeight: Number(fields.bodyWeight),
      measuredAt: fields.measuredAt,
      notes: fields.notes,
    };
  }

  measurements(measurements: BodyMeasurement[]) {
    return measurements.map((measurement) => this.measurement(measurement));
  }
}
