import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import type {
  AssessmentQuery,
  AssessmentOptions,
  PerformanceAnalysis,
} from '../models/progression/prescription-assessment.model';
import { AssessmentError } from '../models/progression/prescription-assessment.model';
import {
  assessPrescriptions,
  validateAssessmentOptions,
} from '../domain/progression/prescription-assessment.policy';
import {
  analyzeEffort,
  persistentSignals,
} from '../domain/progression/effort-analysis.policy';
import { countSatisfactoryTasks } from '../domain/progression/satisfactory-tasks.policy';
import { PerformanceService } from './performance.service';
export function assessHistory(
  performance: PerformanceAnalysis,
  options: AssessmentOptions,
) {
  const assessment = assessPrescriptions(performance, options);
  const signals = analyzeEffort(performance, assessment, options.signal);
  return {
    ...assessment,
    signals,
    signalStatus: !options.signal
      ? 'CONFIGURATION_REQUIRED'
      : !signals.length
        ? 'NOT_EVALUABLE'
        : signals.every((s) => s.status === 'AVAILABLE')
          ? 'AVAILABLE'
          : 'PARTIAL',
    strictComparisons: performance.comparisons.map(
      ({ estimates: _estimates, ...comparison }) => comparison,
    ),
    satisfactoryTasks: countSatisfactoryTasks(
      performance,
      assessment,
      options.count,
    ),
    temporalSignals: persistentSignals(
      signals,
      performance,
      options.persistence,
    ),
    interpretation: 'DESCRIPTIVE_ONLY_NOT_A_FATIGUE_DIAGNOSIS',
  };
}
@Injectable()
export class AssessmentService {
  constructor(private readonly performance: PerformanceService) {}
  async assessMyExercise(
    identity: AuthenticatedIdentity,
    input: AssessmentQuery,
  ) {
    if (!input || typeof input !== 'object')
      throw new AssessmentError('INVALID_POLICY');
    // Validate and detach caller policy before any asynchronous read.
    const policy = validateAssessmentOptions(input.policy);
    const result = await this.performance.analyzeMyExercise(
      identity,
      input.history,
    );
    return assessHistory(result, policy);
  }
}
