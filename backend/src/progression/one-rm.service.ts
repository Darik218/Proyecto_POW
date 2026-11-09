import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { prepareEstimates } from '../domain/progression/estimate-evidence.policy';
import type { EstimateCommand } from '../models/progression/one-rm-estimate.model';
import { PROGRESSION_REPOSITORY } from './progression.repository';
import type { ProgressionRepository } from './progression.repository';

@Injectable()
export class OneRmService {
  constructor(
    @Inject(PROGRESSION_REPOSITORY)
    private readonly repository: ProgressionRepository,
  ) {}

  estimateFromSet(identity: AuthenticatedIdentity, input: EstimateCommand) {
    return this.repository.fromOwnedSource(
      identity.account.id,
      input.sourceSetId,
      (source) => prepareEstimates(source, input),
    );
  }
  getMyEstimate(identity: AuthenticatedIdentity, id: string) {
    return this.repository.getOwned(identity.account.id, id);
  }
}
