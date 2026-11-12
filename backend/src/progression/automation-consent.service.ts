import {
  acceptanceCommand,
  acceptanceContext,
} from '../domain/progression/consent-acceptance.policy';
import type { AcceptConsentCommand } from '../models/progression/consent-acceptance.model';
import type {
  ConsentListQuery,
  ConsentCandidateQuery,
  ConsentContract,
} from '../models/progression/automation-consent.model';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { PROGRESSION_REPOSITORY } from './progression.repository';
import type { ProgressionRepository } from './progression.repository';
import type {
  RequestConsentCommand,
  ReviseConsentCommand,
  RevokeConsentCommand,
} from '../models/progression/automation-consent.model';
import { AutomationConsentError } from '../models/progression/automation-consent.model';
import {
  normalizeConsentContract,
  consentRequest,
  consentUuid,
} from '../domain/progression/automation-consent.policy';
@Injectable()
export class AutomationConsentService {
  constructor(
    @Inject(PROGRESSION_REPOSITORY)
    private readonly repository: ProgressionRepository,
  ) {}
  private identity(identity: AuthenticatedIdentity) {
    if (
      !consentUuid(identity?.account?.id) ||
      !consentUuid(identity?.sessionId)
    )
      throw new AutomationConsentError('AUTHENTICATION_REQUIRED');
    return {
      userId: identity.account.id.toLowerCase(),
      sessionId: identity.sessionId.toLowerCase(),
    };
  }
  private page(q: { page: number; limit: number }) {
    if (
      !Number.isSafeInteger(q.page) ||
      q.page < 1 ||
      !Number.isSafeInteger(q.limit) ||
      q.limit < 1 ||
      q.limit > 100
    )
      throw new AutomationConsentError('INVALID_CONSENT_COMMAND');
  }
  async challengeMyAutomationConsent(
    identity: AuthenticatedIdentity,
    id: string,
    expectedVersion: number,
  ) {
    const a = this.identity(identity);
    if (
      !consentUuid(id) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      expectedVersion >= 2147483647
    )
      throw new AutomationConsentError('INVALID_CONSENT_COMMAND');
    return this.repository.issueAutomationConsentAcceptance(
      a.userId,
      a.sessionId,
      id.toLowerCase(),
      expectedVersion,
    );
  }
  async acceptMyAutomationConsent(
    identity: AuthenticatedIdentity,
    input: AcceptConsentCommand,
  ) {
    const a = this.identity(identity),
      operation = acceptanceCommand(input);
    if (input.contextKey !== acceptanceContext(a.userId, a.sessionId))
      throw new AutomationConsentError('ACCEPTANCE_CHALLENGE_INVALID');
    return this.repository.mutateAutomationConsent(
      a.userId,
      a.sessionId,
      operation,
    );
  }
  async listMyAutomationConsents(
    identity: AuthenticatedIdentity,
    q: ConsentListQuery,
  ) {
    const a = this.identity(identity);
    this.page(q);
    if (
      q.state &&
      !['PENDING_CONFIRMATION', 'ACCEPTED_INACTIVE', 'REVOKED'].includes(
        q.state,
      )
    )
      throw new AutomationConsentError('INVALID_CONSENT_COMMAND');
    return this.repository.listAutomationConsents(a.userId, a.sessionId, q);
  }
  async candidatesForMyConsent(
    identity: AuthenticatedIdentity,
    q: ConsentCandidateQuery,
  ) {
    const a = this.identity(identity);
    this.page(q);
    if (
      !consentUuid(q.exerciseId) ||
      (q.trainingPlanId && !consentUuid(q.trainingPlanId)) ||
      !['KG', 'LB'].includes(q.unit)
    )
      throw new AutomationConsentError('INVALID_CONSENT_COMMAND');
    return this.repository.automationConsentCandidates(
      a.userId,
      a.sessionId,
      q,
    );
  }
  async previewMyAutomationConsent(
    identity: AuthenticatedIdentity,
    c: ConsentContract,
  ) {
    const a = this.identity(identity),
      contract = normalizeConsentContract(c);
    return this.repository.previewAutomationConsent(
      a.userId,
      a.sessionId,
      contract,
    );
  }
  async getMyConsentOperation(identity: AuthenticatedIdentity, id: string) {
    const a = this.identity(identity);
    if (!consentUuid(id))
      throw new AutomationConsentError('INVALID_CONSENT_COMMAND');
    return this.repository.automationConsentReceipt(
      a.userId,
      a.sessionId,
      id.toLowerCase(),
    );
  }
  async requestMyAutomationConsent(
    identity: AuthenticatedIdentity,
    input: RequestConsentCommand,
  ) {
    const a = this.identity(identity),
      op = consentRequest('CREATE', input);
    return this.repository.mutateAutomationConsent(a.userId, a.sessionId, op);
  }
  async reviseMyAutomationConsent(
    identity: AuthenticatedIdentity,
    input: ReviseConsentCommand,
  ) {
    const a = this.identity(identity),
      op = consentRequest('REVISE', input);
    return this.repository.mutateAutomationConsent(a.userId, a.sessionId, op);
  }
  async revokeMyAutomationConsent(
    identity: AuthenticatedIdentity,
    input: RevokeConsentCommand,
  ) {
    const a = this.identity(identity),
      op = consentRequest('REVOKE', input);
    return this.repository.mutateAutomationConsent(a.userId, a.sessionId, op);
  }
  async inspectMyAutomationConsent(
    identity: AuthenticatedIdentity,
    id: string,
  ) {
    const a = this.identity(identity);
    if (!consentUuid(id))
      throw new AutomationConsentError('INVALID_CONSENT_COMMAND');
    return this.repository.inspectAutomationConsent(
      a.userId,
      a.sessionId,
      id.toLowerCase(),
    );
  }
}
