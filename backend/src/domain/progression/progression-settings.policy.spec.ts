import { randomUUID } from 'node:crypto';
import {
  normalizeSettingParameters,
  settingOperation,
  settingScope,
} from './progression-settings.policy';
const params = () => ({
  minSuccessfulSessions: 3,
  targetRpeMin: '6',
  targetRpeMax: '8',
  incrementPercent: null,
  incrementAbsolute: '2.5',
  maxIncrementPercent: '5',
  maxLoad: null,
});
describe('SETTINGS-1 complete parameters, never a training policy', () => {
  it('normalizes exact decimals without rounding and preserves null', () => {
    expect(normalizeSettingParameters(params())).toEqual({
      ...params(),
      targetRpeMin: '6.0',
      targetRpeMax: '8.0',
      incrementAbsolute: '2.500',
      maxIncrementPercent: '5.000',
    });
  });
  it('requires all keys and rejects preference as writable authority', () => {
    const { maxLoad: _maxLoad, ...missing } = params();
    expect(() => normalizeSettingParameters(missing)).toThrow(
      'INVALID_SETTING',
    );
    expect(() =>
      normalizeSettingParameters({ ...params(), autoApplyAuthorized: true }),
    ).toThrow('INVALID_SETTING');
  });
  it.each([
    { targetRpeMin: '6.01' },
    { targetRpeMax: '11' },
    { targetRpeMin: '9' },
    { incrementAbsolute: '2.5001' },
    { incrementAbsolute: '0' },
    { incrementPercent: '6' },
    { maxLoad: '100000' },
    { incrementAbsolute: 2.5 },
    { incrementAbsolute: 'NaN' },
    { incrementAbsolute: null },
    { minSuccessfulSessions: 0 },
  ])('rejects invalid complete representation %p', (change) =>
    expect(() =>
      normalizeSettingParameters({ ...params(), ...change }),
    ).toThrow('INVALID_SETTING'),
  );
  it('permits cap zero for absolute and both explicit increments without choosing mode', () => {
    expect(
      normalizeSettingParameters({ ...params(), maxIncrementPercent: '0' })
        .maxIncrementPercent,
    ).toBe('0.000');
    expect(
      normalizeSettingParameters({ ...params(), incrementPercent: '1' })
        .incrementPercent,
    ).toBe('1.000');
  });
  it('permits only the real three scopes', () => {
    expect(settingScope({ exerciseId: null, trainingPlanId: null })).toEqual({
      exerciseId: null,
      trainingPlanId: null,
    });
    expect(() =>
      settingScope({ exerciseId: null, trainingPlanId: randomUUID() }),
    ).toThrow('INVALID_SETTING');
  });
  it('binds values and revision in operation identity', () => {
    const x = {
      intentId: randomUUID(),
      parameters: params(),
      scope: { exerciseId: null, trainingPlanId: null },
    };
    const a = settingOperation('CREATE', x);
    expect(settingOperation('CREATE', structuredClone(x)).requestKey).toBe(
      a.requestKey,
    );
    expect(
      settingOperation('CREATE', {
        ...x,
        parameters: { ...params(), maxLoad: '100' },
      }).requestKey,
    ).not.toBe(a.requestKey);
    expect(() =>
      settingOperation('REPLACE', {
        intentId: randomUUID(),
        settingId: randomUUID(),
        expectedRevision: 'a'.repeat(64),
        parameters: params(),
        confirmImpact: false,
      }),
    ).toThrow('INVALID_SETTING');
  });
});
