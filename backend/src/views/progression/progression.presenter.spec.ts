import { ProgressionPresenter } from './progression.presenter';
import { deriveRecommendation } from '../../progression/recommendation.service';
import {
  context,
  command,
} from '../../../test/helpers/recommendation-fixtures';
const view = new ProgressionPresenter();
describe('PROG-6A public manual progression representation', () => {
  it('preserves native decimal strings and separates targets from actual sets', () => {
    const draft = deriveRecommendation(context(), command()),
      r = view.preview(draft);
    expect(r.increment).toMatchObject({
      currentLoad: '80',
      proposedLoad: '82.500000',
      unit: 'KG',
    });
    expect(r.evidence.tasks[0]).toMatchObject({
      original: { targetLoad: '100' },
      adjusted: { targetLoad: '80' },
    });
    expect(r.evidence.sets[0].load).toBe('80');
    expect(r).toMatchObject({ applicationAuthorization: 'NOT_GRANTED' });
  });
  it('omits internal owner and persistence keys and arbitrary original snapshot properties', () => {
    const draft = deriveRecommendation(context(), command());
    (
      draft.evidence.source.tasks[0].originalTargets as Record<string, unknown>
    ).privateNote = 'must-not-leak';
    const text = JSON.stringify(view.preview(draft));
    for (const key of [
      'athleteId',
      'userId',
      'actorUserId',
      'payloadKey',
      'requestKey',
      'must-not-leak',
      'passwordHash',
      'refreshToken',
    ])
      expect(text).not.toContain(key);
  });
  it('does not convert a preview into an approved or applied result', () => {
    const r = view.preview(deriveRecommendation(context(), command()));
    expect(r.kind).toBe('PREVIEW');
    expect(r).not.toHaveProperty('accepted');
    expect(r).not.toHaveProperty('applied');
  });
  it('normalizes explicit cohort exclusions into stable public reason arrays', () => {
    const input = command();
    input.policy!.cohort = { mode: 'EXPLICIT_TASK_SET', taskIds: ['b'] };
    const result = view.preview(deriveRecommendation(context(), input));
    expect(result.evidence.excludedTasks).toEqual([
      { taskId: 'a', reasons: ['OUTSIDE_EXPLICIT_COHORT'] },
    ]);
  });
});
