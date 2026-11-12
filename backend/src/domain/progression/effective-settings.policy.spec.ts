import { resolveEffectiveSettings } from './effective-settings.policy';
import {
  setting,
  recommendationPolicy,
} from '../../../test/helpers/recommendation-fixtures';
const resolve = (
  rows = [setting()],
  p:
    | ReturnType<typeof recommendationPolicy>
    | undefined = recommendationPolicy(),
  plan: string | null = null,
) => resolveEffectiveSettings(rows, 'athlete', 'exercise', plan, p);
describe('whole-row effective progression settings', () => {
  it('uses the athlete general row', () => {
    expect(resolve()).toMatchObject({
      status: 'VALID',
      scope: 'ATHLETE',
      mode: 'ABSOLUTE',
      selected: { id: 'setting' },
    });
  });
  it('prefers exercise over general without mixing fields', () => {
    expect(
      resolve([setting(), { ...setting('specific'), exerciseId: 'exercise' }])
        .selected?.id,
    ).toBe('specific');
  });
  it('prefers plan/exercise over both broader scopes', () => {
    expect(
      resolve(
        [
          setting(),
          { ...setting('e'), exerciseId: 'exercise' },
          { ...setting('p'), exerciseId: 'exercise', trainingPlanId: 'plan' },
        ],
        recommendationPolicy(),
        'plan',
      ),
    ).toMatchObject({ selected: { id: 'p' }, scope: 'EXERCISE_PLAN' });
  });
  it('does not fall back from an incomplete specific row', () => {
    const r = resolve([
      setting(),
      { ...setting('e'), exerciseId: 'exercise', incrementAbsolute: null },
    ]);
    expect(r.selected?.id).toBe('e');
    expect(r.reasons).toContain('INCREMENT_MODE_REQUIRED');
  });
  it('does not merge unit from preferredUnit or a lower setting', () => {
    const p = recommendationPolicy();
    const { settingLoadUnit: _unit, ...missing } = p;
    expect(resolve([setting()], missing).reasons).toContain(
      'SETTING_LOAD_UNIT_REQUIRED',
    );
  });
  it('does not select between absolute and percent implicitly', () => {
    expect(
      resolve([{ ...setting(), incrementPercent: '2' }]).reasons,
    ).toContain('AMBIGUOUS_INCREMENT_MODE');
  });
  it('accepts explicit selection when both modes exist', () => {
    expect(
      resolve([{ ...setting(), incrementPercent: '2' }], {
        ...recommendationPolicy(),
        incrementMode: 'PERCENT',
      }).mode,
    ).toBe('PERCENT');
  });
  it.each([null, '0', '-2', 'invalid'])(
    'requires a positive configured increment %s',
    (incrementAbsolute) => {
      expect(resolve([{ ...setting(), incrementAbsolute }]).status).toBe(
        'CONFIGURATION_REQUIRED',
      );
    },
  );
  it('rejects duplicate scope rather than selecting by row order', () => {
    expect(resolve([setting(), setting('another')]).reasons).toContain(
      'AMBIGUOUS_SETTING_SCOPE',
    );
  });
  it('does not infer a full policy from minSuccessfulSessions or auto authorization', () => {
    expect(
      resolveEffectiveSettings(
        [{ ...setting(), autoApplyAuthorized: true }],
        'athlete',
        'exercise',
        null,
        undefined,
      ).status,
    ).toBe('CONFIGURATION_REQUIRED');
  });
  it('requires count semantics to acknowledge the selected row minimum', () => {
    const p = recommendationPolicy();
    expect(
      resolve([setting()], {
        ...p,
        assessment: {
          ...p.assessment,
          count: { ...p.assessment.count!, minimumSessions: 3 },
        },
      }).reasons,
    ).toContain('MINIMUM_SETTING_MISMATCH');
  });
  it('does not accept missing readiness or infer it from basic compliance', () => {
    const p = recommendationPolicy();
    expect(
      resolve([setting()], {
        ...p,
        assessment: {
          ...p.assessment,
          compliance: { ...p.assessment.compliance!, readiness: undefined },
        },
      }).reasons,
    ).toContain('READINESS_POLICY_REQUIRED');
  });
  it('requires explicit provenance and grid', () => {
    expect(
      resolve([setting()], {
        ...recommendationPolicy(),
        grid: undefined,
      } as never).reasons,
    ).toContain('GRID_REQUIRED');
  });
  it('does not substitute an external RPE interval for the selected row silently', () => {
    const p = recommendationPolicy();
    expect(resolve([{ ...setting(), targetRpeMax: '7' }], p).reasons).toContain(
      'RPE_SETTING_MISMATCH',
    );
  });
  it('does not permit official 1RM decisions without their own approved policy', () => {
    expect(
      resolve([setting()], {
        ...recommendationPolicy(),
        oneRm: 'DECISION_CRITERION',
      }).reasons,
    ).toContain('ONE_RM_DECISION_POLICY_REQUIRED');
  });
  it('rejects contradictory row ranges and foreign ownership', () => {
    expect(resolve([{ ...setting(), targetRpeMin: '9' }]).status).toBe(
      'CONFIGURATION_REQUIRED',
    );
    expect(resolve([{ ...setting(), athleteId: 'other' }]).selected).toBeNull();
  });
});
