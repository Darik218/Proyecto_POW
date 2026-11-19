import {
  assertFutureTarget,
  validateApplicationCommand,
} from './recommendation-application.policy';
import type {
  ApplicationTarget,
  ApplyRecommendationCommand,
} from '../../models/progression/recommendation-application.model';
const target = (): ApplicationTarget => ({
  planId: 'p',
  weekId: 'w',
  dayId: 'd',
  prescriptionId: 'e',
  exerciseId: 'exercise',
  planVersion: 1,
  status: 'DRAFT',
  retired: false,
  hasHistory: false,
  hasSessions: false,
  load: '80',
  loadUnit: 'KG',
  startsOn: null,
  endsOn: null,
  truncated: false,
  activities: [
    {
      id: 'activity',
      version: 0,
      on: '2026-11-11',
      timeZone: 'America/Bogota',
      status: 'PLANNED',
      hasWorkouts: false,
    },
  ],
});
const input = () =>
  ({
    destination: { planId: 'p', weekId: 'w', dayId: 'd', prescriptionId: 'e' },
    expectedPlanVersion: 1,
    activityId: 'activity',
    expectedActivityVersion: 0,
    expectedScheduledOn: '2026-11-11',
    timeZone: 'America/Bogota',
    previousLoad: '80',
    appliedLoad: '82.500000',
    loadUnit: 'KG',
  }) as ApplyRecommendationCommand;
describe('PROG-5B future exact destination policy', () => {
  it('accepts an explicit future activity without deriving dates from week order', () => {
    expect(
      assertFutureTarget(target(), input(), new Date('2026-11-11T02:00:00Z'))
        .localOn,
    ).toBe('2026-11-10');
  });
  it('uses the persisted zone and treats the same civil day as not proven future', () => {
    expect(() =>
      assertFutureTarget(target(), input(), new Date('2026-11-11T06:00:00Z')),
    ).toThrow('APPLICATION_BLOCKED');
  });
  it('does not fabricate a future date when no activity exists', () => {
    expect(() =>
      assertFutureTarget(
        { ...target(), activities: [] },
        input(),
        new Date('2026-11-10'),
      ),
    ).toThrow('APPLICATION_BLOCKED');
  });
  it.each(['ACTIVE', 'ARCHIVED', 'COMPLETED'])(
    'rejects a %s plan',
    (status) => {
      expect(() =>
        assertFutureTarget(
          { ...target(), status },
          input(),
          new Date('2026-11-10'),
        ),
      ).toThrow('APPLICATION_BLOCKED');
    },
  );
  it.each(['retired', 'hasHistory', 'hasSessions', 'truncated'] as const)(
    'blocks %s without changing targets',
    (key) => {
      expect(() =>
        assertFutureTarget(
          { ...target(), [key]: true },
          input(),
          new Date('2026-11-10'),
        ),
      ).toThrow('APPLICATION_BLOCKED');
    },
  );
  it.each(['80.000001', '100000.000000', '0', '-1'])(
    'never rounds an incompatible applied load %s',
    (appliedLoad) => {
      expect(() =>
        assertFutureTarget(
          target(),
          { ...input(), appliedLoad },
          new Date('2026-11-10'),
        ),
      ).toThrow('APPLICATION_BLOCKED');
    },
  );
  it.each(['82.500000', '80.125000'])(
    'preserves exactly representable %s',
    (appliedLoad) => {
      expect(
        assertFutureTarget(
          target(),
          { ...input(), appliedLoad },
          new Date('2026-11-10'),
        ).localOn,
      ).toBe('2026-11-09');
    },
  );
  it('rejects a changed baseline/unit/version instead of recalculating authorization', () => {
    for (const change of [
      { load: '81' },
      { loadUnit: 'LB' },
      { planVersion: 2 },
    ])
      expect(() =>
        assertFutureTarget(
          { ...target(), ...change },
          input(),
          new Date('2026-11-10'),
        ),
      ).toThrow();
  });
  it('rejects another affected activity that has become past', () => {
    const t = target();
    expect(() =>
      assertFutureTarget(
        {
          ...t,
          activities: [
            ...t.activities,
            { ...t.activities[0], id: 'other', on: '2026-11-01' },
          ],
        },
        input(),
        new Date('2026-11-10'),
      ),
    ).toThrow('APPLICATION_BLOCKED');
  });
  it('requires an explicit validated command, not a client snapshot or APPLY-like unknown action', () => {
    for (const v of [null, {}, { action: 'AUTOMATIC' }])
      expect(() => validateApplicationCommand(v)).toThrow(
        'INVALID_APPLICATION_COMMAND',
      );
  });
});
