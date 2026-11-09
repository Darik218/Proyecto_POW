import type {
  EstimateDraft,
  EstimateSource,
  StoredOneRmEstimate,
} from '../models/progression/one-rm-estimate.model';
import type {
  PerformanceHistory,
  ValidatedPerformanceQuery,
} from '../models/progression/performance-analysis.model';

export const PROGRESSION_REPOSITORY = Symbol('PROGRESSION_REPOSITORY');
export interface ProgressionRepository {
  // The application prepares evidence from a locked, owned source. The callback
  // receives no Prisma client, queries, or persistence operations.
  fromOwnedSource(
    userId: string,
    setId: string,
    prepare: (source: EstimateSource) => readonly EstimateDraft[],
  ): Promise<StoredOneRmEstimate[]>;
  getOwned(userId: string, id: string): Promise<StoredOneRmEstimate | null>;
  readHistory(
    userId: string,
    query: ValidatedPerformanceQuery,
  ): Promise<PerformanceHistory>;
}
