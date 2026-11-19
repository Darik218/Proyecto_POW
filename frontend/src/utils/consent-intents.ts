export type PendingConsent = {
  accountId: string
  sessionContext: string
  intentId: string
  consentId: string | null
  action: 'CREATE' | 'REVISE' | 'ACCEPT' | 'REVOKE'
  createdAt: number
}
const key = 'pulso:pending-consent:v1',
  ttl = 30 * 60000
export function forgetConsentIntent(storage: Storage | undefined) {
  try {
    storage?.removeItem(key)
  } catch {
    /* Optional storage. */
  }
}
export function rememberConsentIntent(
  storage: Storage | undefined,
  v: PendingConsent,
) {
  try {
    storage?.setItem(
      key,
      JSON.stringify({
        accountId: v.accountId,
        sessionContext: v.sessionContext,
        intentId: v.intentId,
        consentId: v.consentId,
        action: v.action,
        createdAt: v.createdAt,
      }),
    )
  } catch {
    /* Never fall back to credential or payload storage. */
  }
}
export function recoverConsentIntent(
  storage: Storage | undefined,
  accountId: string,
  sessionContext: string,
  now: number,
): PendingConsent | null {
  try {
    const v = JSON.parse(
      storage?.getItem(key) ?? 'null',
    ) as PendingConsent | null
    if (
      v &&
      Object.keys(v).length === 6 &&
      v.accountId === accountId &&
      v.sessionContext === sessionContext &&
      ['CREATE', 'REVISE', 'ACCEPT', 'REVOKE'].includes(v.action) &&
      typeof v.intentId === 'string' &&
      /^[a-f0-9-]{36}$/i.test(v.intentId) &&
      (v.consentId === null || typeof v.consentId === 'string') &&
      Number.isFinite(v.createdAt) &&
      now >= v.createdAt &&
      now - v.createdAt < ttl
    )
      return v
  } catch {
    /* Corrupt cache has no authority. */
  }
  forgetConsentIntent(storage)
  return null
}
