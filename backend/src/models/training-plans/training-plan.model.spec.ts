import { TrainingPlan } from './training-plan.model';
import {
  planAttributes,
  prescriptionAttributes,
} from '../../../test/fixtures/planning.fixture';
describe('Training plan domain state', () => {
  it('retains the existing draft editability rule without adding state transitions', () => {
    expect(new TrainingPlan(planAttributes).isDraft).toBe(true);
    for (const status of ['ACTIVE', 'ARCHIVED', 'COMPLETED'] as const)
      expect(new TrainingPlan({ ...planAttributes, status }).isDraft).toBe(
        false,
      );
  });
  it('preserves date and unknown-unit semantics without converting prescription decimals', () => {
    const model = new TrainingPlan({
      ...planAttributes,
      weeks: [
        {
          id: 'week',
          weekNumber: 1,
          objective: null,
          exercises: [prescriptionAttributes],
        },
      ],
    });
    expect(model.attributes.startsOn).toBe(planAttributes.startsOn);
    expect(
      model.attributes.weeks[0]!.exercises[0]!.targetLoad?.toString(),
    ).toBe('77.125');
    expect(model.attributes.weeks[0]!.exercises[0]!.targetLoadUnit).toBeNull();
  });
});
