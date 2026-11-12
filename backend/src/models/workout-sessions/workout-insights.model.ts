import type { SetRecordAttributes } from './set-record.model';
import type {
  CalculationResult,
  EligibilityResult,
} from '../progression/one-rm-calculation.model';

export type WorkoutReference = {
  sessionId: string;
  sessionLabel: string;
  performedOn: Date | null;
  sets: SetRecordAttributes[];
};
export type WorkoutInsight = {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  actualSets: SetRecordAttributes[];
  reference: WorkoutReference | null;
  loadMeaning: 'UNKNOWN' | 'EXTERNAL_TOTAL';
  loadMeaningSource: 'UNKNOWN' | 'REQUEST_DECLARATION';
  oneRm: Array<{
    setId: string;
    eligibility: EligibilityResult;
    calculation: CalculationResult | null;
  }>;
  orientation: {
    action: 'REPEAT_REFERENCE' | 'RECORD_BASELINE' | 'REVIEW_DATA';
    message: string;
  };
};
export type WorkoutInsights = {
  sessionId: string;
  status: 'COMPLETED';
  exercises: WorkoutInsight[];
};
