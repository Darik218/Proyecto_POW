export type PendingOperational = {
  accountId: string;
  sessionContext: string;
  intentId: string;
  consentId: string | null;
  action: "ACTIVATE" | "REVOKE" | "CHECK";
  createdAt: number;
};
const key = "pulso:pending-operational:v1",
  ttl = 30 * 60000;
export function forgetOperationalIntent(storage: Storage | undefined) {
  try {
    storage?.removeItem(key);
  } catch {
    /* Optional storage. */
  }
}
export function rememberOperationalIntent(
  storage: Storage | undefined,
  v: PendingOperational,
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
    );
  } catch {
    /* Never fall back to credential or payload storage. */
  }
}
export function recoverOperationalIntent(
  storage: Storage | undefined,
  accountId: string,
  sessionContext: string,
  now: number,
): PendingOperational | null {
  try {
    const v = JSON.parse(
      storage?.getItem(key) ?? "null",
    ) as PendingOperational | null;
    if (
      v &&
      Object.keys(v).length === 6 &&
      v.accountId === accountId &&
      v.sessionContext === sessionContext &&
      ["ACTIVATE", "REVOKE", "CHECK"].includes(v.action) &&
      typeof v.intentId === "string" &&
      /^[a-f0-9-]{36}$/i.test(v.intentId) &&
      (v.consentId === null || typeof v.consentId === "string") &&
      Number.isFinite(v.createdAt) &&
      now >= v.createdAt &&
      now - v.createdAt < ttl
    )
      return v;
  } catch {
    /* Corrupt cache has no authority. */
  }
  forgetOperationalIntent(storage);
  return null;
}
