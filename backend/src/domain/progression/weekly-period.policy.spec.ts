import { validateWeeklyPeriod } from './weekly-period.policy';
const week = {
  start: '2026-01-05',
  endExclusive: '2026-01-12',
  timeZone: 'America/Bogota',
  cutoffOn: '2026-01-11',
  weekStartsOn: 1,
};
describe('explicit sporting weeks', () => {
  it('maps the exclusive end to an inclusive sporting boundary', () => {
    expect(validateWeeklyPeriod(week)).toMatchObject({
      lastOn: '2026-01-11',
      closed: true,
    });
  });
  it('accepts seven civil dates across DST rather than assuming local elapsed hours', () => {
    expect(
      validateWeeklyPeriod({
        ...week,
        start: '2026-03-02',
        endExclusive: '2026-03-09',
        cutoffOn: '2026-03-08',
        timeZone: 'America/New_York',
      }).closed,
    ).toBe(true);
  });
  it('retains an explicit partial-week cutoff without reading a clock', () => {
    expect(
      validateWeeklyPeriod({ ...week, cutoffOn: '2026-01-07' }).closed,
    ).toBe(false);
  });
  it.each([
    { start: '2026-02-30' },
    { endExclusive: '2026-01-13' },
    { weekStartsOn: 2 },
    { cutoffOn: '2026-01-12' },
    { cutoffOn: '2026-01-04' },
    { timeZone: 'not/a-zone' },
  ])('rejects malformed/incoherent week %p', (change) => {
    expect(() => validateWeeklyPeriod({ ...week, ...change })).toThrow(
      'INVALID_PERIOD',
    );
  });
});
