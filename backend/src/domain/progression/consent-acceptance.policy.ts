import { createHash } from 'node:crypto';
import { AutomationConsentError } from '../../models/progression/automation-consent.model';
import type { ConsentOperation } from '../../models/progression/automation-consent.model';
import type { AcceptConsentCommand } from '../../models/progression/consent-acceptance.model';
import { consentUuid } from './automation-consent.policy';
import { recommendationIdentity } from './recommendation-evidence.policy';
export const ACCEPTANCE_PRESENTATION =
  'recurring-consent-presentation-v1' as const;
export const ACCEPTANCE_ACKNOWLEDGMENTS = [
  'policy',
  'limits',
  'destinations',
  'validity',
  'revocation',
] as const;
export function acceptanceContext(userId: string, sessionId: string) {
  return createHash('sha256')
    .update(['consent-acceptance-context-v1', userId, sessionId].join('\n'))
    .digest('hex');
}
export function acceptanceCommand(value: unknown): ConsentOperation {
  const fail = () => {
    throw new AutomationConsentError('INVALID_CONSENT_COMMAND');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const v = value as Record<string, unknown>;
  const keys = [
    'consentId',
    'intentId',
    'challengeId',
    'expectedVersion',
    'expectedState',
    'contractKey',
    'conditionsKey',
    'contextKey',
    'termsVersion',
    'presentationVersion',
    'conditionsPresented',
    'acknowledgments',
  ];
  if (
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some((k) => !keys.includes(k)) ||
    !['consentId', 'intentId', 'challengeId'].every((k) => consentUuid(v[k])) ||
    !Number.isSafeInteger(v.expectedVersion) ||
    (v.expectedVersion as number) < 1 ||
    (v.expectedVersion as number) >= 2147483647 ||
    v.expectedState !== 'PENDING_CONFIRMATION' ||
    !['contractKey', 'conditionsKey', 'contextKey'].every(
      (k) => typeof v[k] === 'string' && /^[0-9a-f]{64}$/.test(v[k] as string),
    ) ||
    v.presentationVersion !== ACCEPTANCE_PRESENTATION ||
    typeof v.termsVersion !== 'string' ||
    !v.termsVersion.length ||
    v.termsVersion.length > 160 ||
    v.conditionsPresented !== true
  )
    return fail();
  const a = v.acknowledgments;
  if (
    !a ||
    typeof a !== 'object' ||
    Array.isArray(a) ||
    Object.keys(a).length !== 5 ||
    ACCEPTANCE_ACKNOWLEDGMENTS.some(
      (k) => (a as Record<string, unknown>)[k] !== true,
    )
  )
    return fail();
  const input = {
    ...v,
    consentId: (v.consentId as string).toLowerCase(),
    intentId: (v.intentId as string).toLowerCase(),
    challengeId: (v.challengeId as string).toLowerCase(),
  } as unknown as AcceptConsentCommand;
  return {
    action: 'ACCEPT',
    intentId: input.intentId,
    consentId: input.consentId,
    expectedVersion: input.expectedVersion,
    acceptance: input,
    requestKey: recommendationIdentity({
      schemaVersion: 'recurring-consent-acceptance-command-v1',
      ...input,
    }),
  };
}
