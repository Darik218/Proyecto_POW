import { Decimal } from '@prisma/client/runtime/client';
import { Athlete } from '../../models/athletes/athlete.model';
import { BodyMeasurement } from '../../models/athletes/body-measurement.model';
import { AthletesPresenter } from './athletes.presenter';
import {
  profileAttributes,
  measurementAttributes,
} from '../../../test/fixtures/athlete.fixture';

const presenter = new AthletesPresenter();
describe('Athletes public JSON view', () => {
  it('preserves the five profile fields, birth date nullability and ISO serialization', () => {
    expect(
      JSON.parse(
        JSON.stringify(presenter.profile(new Athlete(profileAttributes))),
      ),
    ).toEqual({
      id: '21000000-0000-4000-8000-000000000001',
      birthDate: null,
      preferredUnit: 'KG',
      createdAt: '2026-01-01T00:00:00.123Z',
      updatedAt: '2026-01-02T00:00:00.456Z',
    });
    expect(
      presenter.profile(
        new Athlete({
          ...profileAttributes,
          birthDate: new Date('1995-06-15T00:00:00.000Z'),
          preferredUnit: 'LB',
        }),
      ),
    ).toMatchObject({
      birthDate: new Date('1995-06-15T00:00:00.000Z'),
      preferredUnit: 'LB',
    });
  });
  it.each([
    ['0.001', 0.001],
    ['72.125', 72.125],
    ['9999.999', 9999.999],
  ] as const)(
    'keeps decimal %s until the public numeric boundary',
    (raw, number) => {
      const model = new BodyMeasurement({
        ...measurementAttributes,
        bodyWeight: new Decimal(raw),
      });
      expect(JSON.parse(JSON.stringify(presenter.measurement(model)))).toEqual({
        id: '41000000-0000-4000-8000-000000000001',
        bodyWeight: number,
        measuredAt: '2026-02-01T04:30:00.789Z',
        notes: null,
      });
      expect(model.attributes.bodyWeight.toString()).toBe(raw);
      expect(model.attributes.bodyWeight).toBeInstanceOf(Decimal);
    },
  );
  it('allowlists profile and measurement fields even if internal/authentication data is present', () => {
    const internal = {
      userId: 'internal-user',
      athleteId: 'internal-athlete',
      sessionId: 'internal-session',
      passwordHash: 'internal-hash',
      accessToken: 'internal-token',
      user: { email: 'internal-email' },
    };
    const profile = presenter.profile(
      new Athlete({ ...profileAttributes, ...internal }),
    );
    const measurement = presenter.measurement(
      new BodyMeasurement({ ...measurementAttributes, ...internal }),
    );
    expect(Object.keys(profile).sort()).toEqual([
      'birthDate',
      'createdAt',
      'id',
      'preferredUnit',
      'updatedAt',
    ]);
    expect(Object.keys(measurement).sort()).toEqual([
      'bodyWeight',
      'id',
      'measuredAt',
      'notes',
    ]);
    expect(JSON.stringify({ profile, measurement })).not.toContain('internal-');
  });
  it('keeps history order, notes and empty arrays without synthesizing entries', () => {
    const recent = new BodyMeasurement({
      ...measurementAttributes,
      id: 'recent',
      notes: 'Registro reciente',
    });
    const old = new BodyMeasurement({
      ...measurementAttributes,
      id: 'older',
      measuredAt: new Date('2026-01-01Z'),
      notes: '',
    });
    expect(
      presenter.measurements([recent, old]).map((row) => [row.id, row.notes]),
    ).toEqual([
      ['recent', 'Registro reciente'],
      ['older', ''],
    ]);
    expect(presenter.measurements([])).toEqual([]);
  });
});
