export const AUTOMATIC_PRINCIPAL =
  'PULSO_INTERNAL_PROGRESSION_WORKER_V1' as const;
export const OPERATIONAL_TERMS = 'saved-recommendations-activation-v1' as const;
export type GrantPublic = Readonly<{
  id: string;
  consentId: string;
  state: 'ACTIVE' | 'REVOKED';
  version: number;
  activatedAt: string;
  revokedAt: string | null;
}>;
export type AutomaticRunPublic = Readonly<{
  id: string;
  grantId: string;
  recommendationId: string;
  result: 'APPLIED' | 'BLOCKED';
  reasons: readonly string[];
  applicationId: string | null;
  previousLoad: string | null;
  appliedLoad: string | null;
  unit: 'KG' | 'LB' | null;
  recordedAt: string;
  cycleKey: string | null;
}>;
export type OperationalStatus = Readonly<{
  consentId: string;
  consentVersion: number;
  contractKey: string;
  acceptanceEventId: string | null;
  activationTermsVersion: typeof OPERATIONAL_TERMS;
  conditionsKey: string;
  grant: GrantPublic | null;
  effectiveState:
    | 'INACTIVE'
    | 'ACTIVE'
    | 'REVOKED'
    | 'CONSENT_NOT_ACCEPTED'
    | 'EXPIRED'
    | 'NOT_YET_VALID'
    | 'CONFIGURATION_CHANGED'
    | 'UNAVAILABLE';
  executionAuthorized: boolean;
  reasons: readonly string[];
  principal: typeof AUTOMATIC_PRINCIPAL;
}>;
export type OperationalCommandReceipt = Readonly<{
  eventId: string;
  intentId: string;
  action: 'ACTIVATE' | 'REVOKE' | 'CHECK';
  consentId: string;
  grant: GrantPublic | null;
  results: readonly AutomaticRunPublic[];
  recordedAt: string;
}>;
export type ActivateOperationalInput = Readonly<{
  intentId: string;
  expectedConsentVersion: number;
  expectedContractKey: string;
  acceptanceEventId: string;
  activationTermsVersion: typeof OPERATIONAL_TERMS;
  conditionsKey: string;
  confirmActivation: true;
}>;
export type RevokeOperationalInput = Readonly<{
  intentId: string;
  grantId: string;
  expectedGrantVersion: number;
  confirmRevocation: true;
}>;
export class AutomaticProgressionError extends Error {
  constructor(
    readonly code:
      | 'AUTOMATION_BLOCKED'
      | 'STALE_GRANT'
      | 'GRANT_REVOKED'
      | 'AUTHENTICATION_REQUIRED'
      | 'SOURCE_NOT_FOUND'
      | 'INTENT_REUSED'
      | 'SOURCE_BUSY'
      | 'INVALID_OPERATIONAL_COMMAND',
    readonly reasons: readonly string[] = [],
  ) {
    super(code);
  }
}
