import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import type { PerformanceQuery } from '../models/progression/performance-analysis.model';
import { validatePerformanceQuery } from '../domain/progression/performance-query.policy';
import { analyzePerformance } from '../domain/progression/performance';
import { PROGRESSION_REPOSITORY } from './progression.repository';
import type { ProgressionRepository } from './progression.repository';

@Injectable()
export class PerformanceService {
  constructor(
    @Inject(PROGRESSION_REPOSITORY)
    private readonly repository: ProgressionRepository,
  ) {}
  async analyzeMyExercise(
    identity: AuthenticatedIdentity,
    input: PerformanceQuery,
  ) {
    const query = validatePerformanceQuery(input);
    const history = await this.repository.readHistory(
      identity.account.id,
      query,
    );
    return analyzePerformance(history, query);
  }
}
