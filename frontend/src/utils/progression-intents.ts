export type PendingProgression = {
  accountId: string
  sessionContext: string
  kind: 'SAVE' | 'REVIEW' | 'APPLY'
  recommendationId: string | null
  intentId: string | null
  semanticKey: string | null
  createdAt: number
}
const key = 'pulso:pending-manual-progression:v1',
  ttl = 30 * 60 * 1000
export function forgetProgressionIntent(storage: Storage | undefined) {
  try {
    storage?.removeItem(key)
  } catch {
    /* Storage is optional; the in-memory intention remains authoritative. */
  }
}
export function rememberProgressionIntent(
  storage: Storage | undefined,
  value: PendingProgression,
) {
  try {
    storage?.setItem(
      key,
      JSON.stringify({
        accountId: value.accountId,
        sessionContext: value.sessionContext,
        kind: value.kind,
        recommendationId: value.recommendationId,
        intentId: value.intentId,
        semanticKey: value.semanticKey,
        createdAt: value.createdAt,
      }),
    )
  } catch {
    /* No credential or payload fallback to persistent storage. */
  }
}
export function recoverProgressionIntent(
  storage: Storage | undefined,
  accountId: string,
  sessionContext: string,
  now: number,
): PendingProgression | null {
  try {
    const v = JSON.parse(
      storage?.getItem(key) ?? 'null',
    ) as PendingProgression | null
    if (
      v &&
      v.accountId === accountId &&
      v.sessionContext === sessionContext &&
      ['SAVE', 'REVIEW', 'APPLY'].includes(v.kind) &&
      typeof v.createdAt === 'number' &&
      now >= v.createdAt &&
      now - v.createdAt < ttl &&
      [v.recommendationId, v.intentId, v.semanticKey].every(
        (x) => x === null || typeof x === 'string',
      ) &&
      Object.keys(v).length === 7
    )
      return v
  } catch {
    /* Invalid cache is not authority. */
  }
  forgetProgressionIntent(storage)
  return null
}
