import {
  automaticWeek,
  automaticIntent,
  operationalKey,
} from './automatic-progression.policy';
describe('automatic execution civil week and deterministic identity', () => {
  it.each([
    ['2026-03-08T06:59:00Z', 'America/New_York', 1, '2026-03-02', '2026-03-09'],
    ['2026-03-08T07:01:00Z', 'America/New_York', 1, '2026-03-02', '2026-03-09'],
    ['2026-11-01T06:01:00Z', 'America/New_York', 7, '2026-11-01', '2026-11-08'],
    ['2026-11-09T01:00:00Z', 'America/Bogota', 1, '2026-11-02', '2026-11-09'],
    ['2026-11-09T05:00:00Z', 'America/Bogota', 1, '2026-11-09', '2026-11-16'],
  ])(
    'uses civil boundaries for %s %s',
    (date, zone, iso, start, endExclusive) => {
      expect(automaticWeek(new Date(date), zone, iso as number)).toEqual({
        start,
        endExclusive,
        timeZone: zone,
      });
    },
  );
  it.each([0, 8, 1.5])('rejects invalid ISO start %s', (n) =>
    expect(() => automaticWeek(new Date('2026-11-01Z'), 'UTC', n)).toThrow(),
  );
  it('rejects invalid dates and zones', () => {
    expect(() => automaticWeek(new Date('invalid'), 'UTC', 1)).toThrow();
    expect(() =>
      automaticWeek(new Date('2026-11-01Z'), 'invalid', 1),
    ).toThrow();
  });
  it('retains semantic identity and distinguishes scopes', () => {
    const a = operationalKey({ grant: 'a', version: 1 });
    expect(a).toBe(operationalKey({ version: 1, grant: 'a' }));
    expect(a).not.toBe(operationalKey({ grant: 'a', version: 2 }));
    expect(automaticIntent(a)).toBe(automaticIntent(a));
    expect(automaticIntent(a)).toMatch(/^[a-f0-9-]{36}$/);
  });
});
