import { defineStore } from 'pinia'
import { ref, shallowRef, watch, onScopeDispose } from 'vue'
import { useAuthStore } from './auth.store'
import {
  progressionSettingsService as service,
  settingError,
} from '../services/progression-settings.service'
import {
  rememberSettingIntent,
  recoverSettingIntent,
  forgetSettingIntent,
  type PendingSetting,
} from '../utils/setting-intents'
import type {
  SettingList,
  SettingRecord,
  SettingResolution,
  SettingReceipt,
  SettingImpact,
  SettingParameters,
  SettingScope,
  SettingCreate,
  SettingReplace,
  SettingContext,
} from '../types/progression-settings'
const storage = () => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
type Operation =
  | { action: 'CREATE'; input: SettingCreate }
  | { action: 'REPLACE'; id: string; input: SettingReplace }
export const useProgressionSettingsStore = defineStore(
  'progression-settings',
  () => {
    const auth = useAuthStore(),
      list = shallowRef<SettingList | null>(null),
      detail = shallowRef<SettingRecord | null>(null),
      resolution = shallowRef<SettingResolution | null>(null),
      receipt = shallowRef<SettingReceipt | null>(null),
      impact = shallowRef<SettingImpact | null>(null),
      pending = shallowRef<PendingSetting | null>(null),
      error = shallowRef<ReturnType<typeof settingError> | null>(null),
      busy = ref(false),
      notice = ref(''),
      canReconfirm = ref(false)
    let sequence = 0,
      owner = 0,
      stamp = '',
      lastContext: SettingContext | null = null,
      memory: Operation | null = null,
      timer: ReturnType<typeof setTimeout> | undefined
    const context = () =>
      `${auth.user?.id ?? ''}:${auth.getSessionContextId() ?? ''}:${auth.getSessionGeneration()}`
    function drop() {
      memory = null
      pending.value = null
      canReconfirm.value = false
      clearTimeout(timer)
      forgetSettingIntent(storage())
    }
    function retention() {
      clearTimeout(timer)
      if (pending.value) {
        timer = setTimeout(
          () => {
            drop()
            notice.value =
              'Caducaron los identificadores locales. Consulta tus configuraciones; esto no cancela ninguna operación del servidor.'
          },
          Math.max(0, 30 * 60000 - (Date.now() - pending.value.createdAt)),
        )
        ;(timer as unknown as { unref?: () => void }).unref?.()
      }
    }
    function clear() {
      lastContext = null
      sequence++
      list.value = null
      detail.value = null
      resolution.value = null
      receipt.value = null
      impact.value = null
      error.value = null
      notice.value = ''
      busy.value = false
      drop()
    }
    watch(
      () => [auth.user?.id, auth.status, auth.accessToken],
      () => {
        const next = context()
        if (stamp === next) return
        sequence++
        stamp = next
        lastContext = null
        memory = null
        list.value = null
        detail.value = null
        resolution.value = null
        receipt.value = null
        impact.value = null
        error.value = null
        notice.value = ''
        busy.value = false
        canReconfirm.value = false
        const a = auth.user?.id,
          s = auth.getSessionContextId()
        pending.value =
          a && s ? recoverSettingIntent(storage(), a, s, Date.now()) : null
        if (!a || !s) forgetSettingIntent(storage())
        retention()
      },
      { immediate: true, flush: 'sync' },
    )
    onScopeDispose(() => clearTimeout(timer))
    async function read<T>(fn: () => Promise<T>, accept: (v: T) => void) {
      const n = ++sequence,
        s = context()
      owner = n
      busy.value = true
      error.value = null
      try {
        const v = await fn()
        if (n === sequence && s === context()) accept(v)
        return n === sequence && s === context() ? v : undefined
      } catch (e) {
        if (n === sequence && s === context()) error.value = settingError(e)
        return undefined
      } finally {
        if (owner === n && s === context()) busy.value = false
      }
    }
    function invalidateImpact() {
      sequence++
      impact.value = null
      error.value = null
    }
    async function refreshCurrent(id: string, n: number, s: string) {
      const current = await service.get(id)
      if (n !== sequence || s !== context()) return false
      detail.value = current
      impact.value = null
      resolution.value = null
      // A receipt describes the original commit. Never present its resolution as current.
      const c =
        lastContext ??
        (current.exerciseId
          ? {
              exerciseId: current.exerciseId,
              trainingPlanId: current.trainingPlanId,
            }
          : null)
      if (c) {
        const effective = await service.effective(c)
        if (n !== sequence || s !== context()) return false
        resolution.value = effective
      }
      return true
    }
    async function send() {
      if (!memory || busy.value) return
      const op = structuredClone(memory),
        n = ++sequence,
        s = context()
      owner = n
      busy.value = true
      error.value = null
      let committed = false
      try {
        const r =
          op.action === 'CREATE'
            ? await service.create(op.input)
            : await service.replace(op.id, op.input)
        if (n !== sequence || s !== context()) return
        committed = true
        receipt.value = r
        if (pending.value) {
          pending.value = { ...pending.value, settingId: r.settingId }
          rememberSettingIntent(storage(), pending.value)
        }
        resolution.value = null
        if (!(await refreshCurrent(r.settingId, n, s))) return
        notice.value =
          'Configuración guardada. Las recomendaciones deben revalidarse; no se aplicó ningún incremento.'
        drop()
      } catch (e) {
        if (n === sequence && s === context()) {
          error.value = settingError(e)
          if (committed || error.value.code === 'INVALID_RESPONSE')
            error.value = {
              ...error.value,
              uncertain: true,
              message: committed
                ? 'La escritura fue confirmada; falta leer la fila vigente. Conservamos recibo e intención.'
                : error.value.message,
            }
          if (!error.value.uncertain) drop()
        }
      } finally {
        if (owner === n && s === context()) busy.value = false
      }
    }
    function mark(op: Operation) {
      const accountId = auth.user?.id,
        sessionContext = auth.getSessionContextId()
      if (!accountId || !sessionContext) return false
      memory = op
      pending.value = {
        accountId,
        sessionContext,
        intentId: op.input.intentId,
        settingId: op.action === 'CREATE' ? null : op.id,
        action: op.action,
        createdAt: Date.now(),
      }
      rememberSettingIntent(storage(), pending.value)
      retention()
      return true
    }
    async function create(scope: SettingScope, parameters: SettingParameters) {
      if (busy.value || pending.value) return
      if (
        mark({
          action: 'CREATE',
          input: {
            intentId: crypto.randomUUID(),
            scope: structuredClone(scope),
            parameters: structuredClone(parameters),
          },
        })
      )
        await send()
    }
    async function replace(parameters: SettingParameters, confirmed: boolean) {
      const r = detail.value
      if (
        !confirmed ||
        !r ||
        busy.value ||
        pending.value ||
        !impact.value ||
        impact.value.expectedRevision !== r.revision
      )
        return
      if (
        mark({
          action: 'REPLACE',
          id: r.id,
          input: {
            intentId: crypto.randomUUID(),
            expectedRevision: r.revision,
            parameters: structuredClone(parameters),
            confirmImpact: true,
          },
        })
      )
        await send()
    }
    async function recover() {
      const p = pending.value
      if (!p || busy.value) return
      const n = ++sequence,
        s = context()
      owner = n
      busy.value = true
      error.value = null
      canReconfirm.value = false
      let confirmed = false
      try {
        let r: SettingReceipt | null = null
        try {
          r = await service.operation(p.intentId)
        } catch (e) {
          if (settingError(e).code !== 'SOURCE_NOT_FOUND') throw e
        }
        if (n !== sequence || s !== context()) return
        if (r) {
          confirmed = true
          receipt.value = r
          resolution.value = null
          pending.value = { ...p, settingId: r.settingId }
          rememberSettingIntent(storage(), pending.value)
          if (!(await refreshCurrent(r.settingId, n, s))) return
          notice.value =
            'Intención confirmada. Se muestra la fila actual; el recibo histórico no reemplaza ediciones posteriores.'
          drop()
        } else {
          if (p.settingId) {
            const current = await service.get(p.settingId)
            if (n !== sequence || s !== context()) return
            detail.value = current
          }
          canReconfirm.value = true
          notice.value =
            'No se confirmó esta intención. No se reenviará automáticamente.'
        }
      } catch (e) {
        if (n === sequence && s === context()) {
          error.value = settingError(e)
          if (confirmed)
            error.value = {
              ...error.value,
              uncertain: true,
              message:
                'La escritura fue confirmada; falta leer la fila vigente. Conservamos recibo e intención.',
            }
        }
      } finally {
        if (owner === n && s === context()) busy.value = false
      }
    }
    function reconfirm() {
      if (!canReconfirm.value || memory || busy.value) return
      drop()
      impact.value = null
      notice.value =
        'Se retiró el identificador tras consultar el resultado. Recarga y confirma otra vez; no cancela una operación del servidor.'
    }
    return {
      list,
      detail,
      resolution,
      receipt,
      impact,
      pending,
      error,
      busy,
      notice,
      canReconfirm,
      clear,
      create,
      replace,
      recover,
      reconfirm,
      retry: send,
      canRetry: () => memory !== null,
      invalidateImpact,
      loadList: (page = 1) =>
        read(
          () => service.list(page),
          (v) => {
            list.value = v
          },
        ),
      open: (id: string) => {
        detail.value = null
        impact.value = null
        return read(
          () => service.get(id),
          (v) => {
            detail.value = v
          },
        )
      },
      effective: (c: SettingContext) => {
        lastContext = structuredClone(c)
        resolution.value = null
        return read(
          () => service.effective(c),
          (v) => {
            resolution.value = v
          },
        )
      },
      previewImpact: (p: SettingParameters) => {
        impact.value = null
        const r = detail.value
        if (!r) return
        return read(
          () => service.impact(r.id, r.revision, p),
          (v) => {
            impact.value = v
          },
        )
      },
      beginCreate: () => {
        detail.value = null
        impact.value = null
        receipt.value = null
        error.value = null
      },
    }
  },
)
