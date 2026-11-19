import { validateRecommendationCommand } from './recommendation-query.policy';
import { command } from '../../../test/helpers/recommendation-fixtures';
const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function valid() {
  const c = command();
  c.history = {
    ...c.history,
    exerciseId: id(1),
    contexts: c.history.contexts!.map((v, i) => ({
      ...v,
      workoutExerciseId: id(i + 10),
    })),
    comparisons: [{ previousTaskId: id(10), currentTaskId: id(11) }],
  };
  c.destination = { kind: 'WORKOUT_TASK', taskId: id(11) };
  return c;
}
describe('weekly recommendation input boundary', () => {
  it('detaches nested policy before the asynchronous read', () => {
    const c = valid(),
      v = validateRecommendationCommand(c);
    c.policy!.grid.step = '100';
    expect(v.policy?.grid.step).toBe('2.5');
  });
  it('deduplicates identical comparison requests without doubling references', () => {
    const c = valid();
    c.history.comparisons!.push({ ...c.history.comparisons![0] });
    expect(validateRecommendationCommand(c).history.comparisons).toHaveLength(
      1,
    );
  });
  it.each([
    null,
    { ...valid(), destination: { kind: 'WORKOUT_TASK', taskId: 'not-uuid' } },
  ])('rejects an invalid request or resource id', (c) => {
    expect(() => validateRecommendationCommand(c as never)).toThrow(
      'INVALID_COMMAND',
    );
  });
  it('rejects a history window that bypasses the stated cutoff', () => {
    const c = valid();
    c.history.to = '2026-01-12';
    expect(() => validateRecommendationCommand(c)).toThrow('INVALID_PERIOD');
  });
  it('does not retain caller fields unrelated to the policy', () => {
    const c = valid();
    const altered = {
      ...c,
      policy: {
        ...c.policy!,
        privateExtra: 'must-not-copy',
        grid: { ...c.policy!.grid, irrelevant: 'must-not-copy' },
      },
    };
    expect(
      JSON.stringify(validateRecommendationCommand(altered)),
    ).not.toContain('must-not-copy');
  });
});
