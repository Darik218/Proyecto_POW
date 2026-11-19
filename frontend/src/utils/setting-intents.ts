export type PendingSetting = {
  accountId: string
  sessionContext: string
  intentId: string
  settingId: string | null
  action: 'CREATE' | 'REPLACE'
  createdAt: number
}
const key = 'pulso:pending-setting:v1'
export function forgetSettingIntent(s: Storage | undefined) {
  try {
    s?.removeItem(key)
  } catch {}
}
export function rememberSettingIntent(
  s: Storage | undefined,
  v: PendingSetting,
) {
  try {
    s?.setItem(
      key,
      JSON.stringify({
        accountId: v.accountId,
        sessionContext: v.sessionContext,
        intentId: v.intentId,
        settingId: v.settingId,
        action: v.action,
        createdAt: v.createdAt,
      }),
    )
  } catch {}
}
export function recoverSettingIntent(
  s: Storage | undefined,
  accountId: string,
  sessionContext: string,
  now: number,
): PendingSetting | null {
  try {
    const v = JSON.parse(s?.getItem(key) ?? 'null') as PendingSetting | null
    if (
      v &&
      Object.keys(v).length === 6 &&
      v.accountId === accountId &&
      v.sessionContext === sessionContext &&
      ['CREATE', 'REPLACE'].includes(v.action) &&
      /^[a-f0-9-]{36}$/i.test(v.intentId) &&
      (v.settingId === null || /^[a-f0-9-]{36}$/i.test(v.settingId)) &&
      Number.isFinite(v.createdAt) &&
      v.createdAt <= now &&
      now - v.createdAt < 30 * 60000
    )
      return v
  } catch {}
  forgetSettingIntent(s)
  return null
}
