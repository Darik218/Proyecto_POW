import { consentAcceptSchema } from '../schemas/automation-consent.schema'
import { defineStore } from 'pinia'
import { ref, shallowRef, watch, onScopeDispose } from 'vue'
import { useAuthStore } from './auth.store'
import {
  automationConsentService as service,
  consentError,
} from '../services/automation-consent.service'
import {
  rememberConsentIntent,
  recoverConsentIntent,
  forgetConsentIntent,
  type PendingConsent,
} from '../utils/consent-intents'
import type {
  ConsentContract,
  ConsentAccept,
  ConsentChallenge,
  ConsentAcknowledgments,
  ConsentInspection,
  ConsentReceipt,
  ConsentPreview,
  ConsentList,
  ConsentRequest,
  ConsentRevision,
  ConsentRevocation,
} from '../types/automation-consent'
const storage = () => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
type Operation =
  | { action: 'CREATE'; input: ConsentRequest }
  | { action: 'REVISE'; id: string; input: ConsentRevision }
  | { action: 'ACCEPT'; id: string; input: ConsentAccept }
  | { action: 'REVOKE'; id: string; input: ConsentRevocation }
export const useAutomationConsentStore = defineStore(
  'automation-consents',
  () => {
    const auth = useAuthStore(),
      list = shallowRef<ConsentList | null>(null),
      detail = shallowRef<ConsentInspection | null>(null),
      preview = shallowRef<ConsentPreview | null>(null),
      receipt = shallowRef<ConsentReceipt | null>(null),
      challenge = shallowRef<ConsentChallenge | null>(null),
      pending = shallowRef<PendingConsent | null>(null),
      error = shallowRef<ReturnType<typeof consentError> | null>(null),
      busy = ref(false),
      notice = ref(''),
      canReconfirm = ref(false)
    let revision = 0,
      owner = 0,
      stamp = '',
      memory: Operation | null = null,
      timer: ReturnType<typeof setTimeout> | undefined
    const context = () =>
      `${auth.user?.id ?? ''}:${auth.getSessionContextId() ?? ''}:${auth.getSessionGeneration()}`
    function drop() {
      memory = null
      pending.value = null
      canReconfirm.value = false
      clearTimeout(timer)
      forgetConsentIntent(storage())
    }
    function retention() {
      clearTimeout(timer)
      if (pending.value) {
        timer = setTimeout(
          () => {
            drop()
            notice.value =
              'Caducaron los identificadores temporales. Consulta tus solicitudes; esto no cancela ninguna transacción del servidor.'
          },
          Math.max(0, 30 * 60000 - (Date.now() - pending.value.createdAt)),
        )
        ;(timer as unknown as { unref?: () => void }).unref?.()
      }
    }
    function reset() {
      revision++
      list.value = null
      detail.value = null
      challenge.value = null
      preview.value = null
      receipt.value = null
      error.value = null
      busy.value = false
      notice.value = ''
      drop()
    }
    watch(
      () => [auth.user?.id, auth.status, auth.accessToken],
      () => {
        const next = context()
        if (next === stamp) return
        revision++
        list.value = null
        detail.value = null
        challenge.value = null
        preview.value = null
        receipt.value = null
        error.value = null
        memory = null
        busy.value = false
        notice.value = ''
        canReconfirm.value = false
        stamp = next
        const id = auth.user?.id,
          s = auth.getSessionContextId()
        pending.value =
          id && s ? recoverConsentIntent(storage(), id, s, Date.now()) : null
        if (!id || !s) forgetConsentIntent(storage())
        retention()
      },
      { immediate: true, flush: 'sync' },
    )
    onScopeDispose(() => clearTimeout(timer))
    async function read<T>(
      operation: () => Promise<T>,
      accept: (v: T) => void,
    ) {
      const n = ++revision,
        s = context()
      owner = n
      busy.value = true
      error.value = null
      try {
        const value = await operation()
        if (n === revision && s === context()) accept(value)
        return n === revision && s === context() ? value : undefined
      } catch (e) {
        if (n === revision && s === context()) error.value = consentError(e)
        return undefined
      } finally {
        if (owner === n && s === context()) busy.value = false
      }
    }
    function invalidate() {
      revision++
      challenge.value = null
      preview.value = null
      error.value = null
    }
    async function send() {
      if (!memory || busy.value) return
      const op = structuredClone(memory),
        n = ++revision,
        s = context()
      owner = n
      busy.value = true
      error.value = null
      let committed = false
      try {
        const result =
          op.action === 'CREATE'
            ? await service.request(op.input)
            : op.action === 'REVISE'
              ? await service.revise(op.id, op.input)
              : op.action === 'ACCEPT'
                ? await service.accept(op.id, op.input)
                : await service.revoke(op.id, op.input)
        if (n !== revision || s !== context()) return
        committed = true
        receipt.value = result
        if (pending.value) {
          pending.value = { ...pending.value, consentId: result.consentId }
          rememberConsentIntent(storage(), pending.value)
        }
        const current = await service.inspect(result.consentId)
        if (n !== revision || s !== context()) return
        receipt.value = result
        detail.value = current
        challenge.value = null
        preview.value = null
        notice.value =
          'Operación confirmada. Estado actual: ' +
          current.state +
          '. Ejecución automática deshabilitada.'
        drop()
      } catch (e) {
        if (n === revision && s === context()) {
          error.value = consentError(e)
          if (error.value.code === 'INVALID_RESPONSE' || committed)
            error.value = {
              ...error.value,
              uncertain: true,
              ...(committed
                ? {
                    message:
                      'La operación fue confirmada, pero no se pudo inspeccionar su estado actual. Conservamos el recibo y la intención; consulta nuevamente.',
                  }
                : {}),
            }
          if (!error.value.uncertain) drop()
        }
      } finally {
        if (owner === n && s === context()) busy.value = false
      }
    }
    async function submit(
      action: Exclude<Operation['action'], 'ACCEPT'>,
      contract?: ConsentContract,
    ) {
      if (busy.value || pending.value) return
      const accountId = auth.user?.id,
        sessionContext = auth.getSessionContextId()
      if (!accountId || !sessionContext) return
      const intentId = crypto.randomUUID(),
        id = detail.value?.id ?? null
      if (action === 'CREATE') {
        if (!contract || !preview.value) return
        memory = {
          action,
          input: { intentId, contract: structuredClone(contract) },
        }
      } else {
        if (
          !detail.value ||
          detail.value.state === 'REVOKED' ||
          (action === 'REVISE' && detail.value.state !== 'PENDING_CONFIRMATION')
        )
          return
        if (action === 'REVISE') {
          if (!contract || !preview.value) return
          memory = {
            action,
            id: detail.value.id,
            input: {
              intentId,
              expectedVersion: detail.value.version,
              contract: structuredClone(contract),
            },
          }
        } else
          memory = {
            action,
            id: detail.value.id,
            input: {
              intentId,
              expectedVersion: detail.value.version,
              reason: 'OWNER_REQUEST',
            },
          }
      }
      pending.value = {
        accountId,
        sessionContext,
        intentId,
        consentId: action === 'CREATE' ? null : id,
        action,
        createdAt: Date.now(),
      }
      rememberConsentIntent(storage(), pending.value)
      retention()
      await send()
    }
    async function loadChallenge() {
      challenge.value = null
      if (
        !detail.value ||
        detail.value.state !== 'PENDING_CONFIRMATION' ||
        pending.value ||
        busy.value
      )
        return
      const d = detail.value
      await read(
        () => service.challenge(d.id, d.version),
        (v) => {
          challenge.value = v
        },
      )
    }
    async function accept(
      acknowledgments: ConsentAcknowledgments,
      conditionsPresented: true,
    ) {
      const c = challenge.value,
        d = detail.value,
        accountId = auth.user?.id,
        sessionContext = auth.getSessionContextId()
      if (
        !c ||
        !d ||
        !accountId ||
        !sessionContext ||
        busy.value ||
        pending.value ||
        d.state !== 'PENDING_CONFIRMATION' ||
        c.consentId !== d.id ||
        c.version !== d.version
      )
        return
      let input: ConsentAccept
      try {
        input = consentAcceptSchema.parse({
          intentId: crypto.randomUUID(),
          challengeId: c.id,
          expectedVersion: c.version,
          expectedState: c.state,
          contractKey: c.contractKey,
          conditionsKey: c.conditionsKey,
          contextKey: c.contextKey,
          termsVersion: c.termsVersion,
          presentationVersion: c.presentationVersion,
          conditionsPresented,
          acknowledgments,
        })
      } catch (e) {
        error.value = consentError(e)
        return
      }
      pending.value = {
        accountId,
        sessionContext,
        intentId: input.intentId,
        consentId: d.id,
        action: 'ACCEPT',
        createdAt: Date.now(),
      }
      memory = { action: 'ACCEPT', id: d.id, input: structuredClone(input) }
      rememberConsentIntent(storage(), pending.value)
      retention()
      challenge.value = null
      await send()
    }
    async function recover() {
      const p = pending.value
      if (!p || busy.value) return
      await read(
        async () => {
          try {
            const event = await service.operation(p.intentId)
            return { event, current: await service.inspect(event.consentId) }
          } catch (e) {
            if (consentError(e).code === 'SOURCE_NOT_FOUND')
              return {
                event: null,
                current: p.consentId
                  ? await service.inspect(p.consentId)
                  : null,
              }
            throw e
          }
        },
        ({ event, current }) => {
          if (event && current) {
            receipt.value = event
            detail.value = current
            notice.value =
              'Intención confirmada; se muestra el estado actual ' +
              current.state +
              ', no el estado histórico del recibo.'
            drop()
          } else {
            if (current) detail.value = current
            canReconfirm.value = true
            notice.value =
              'Esta intención no se confirmó. No se reenviará automáticamente.'
          }
        },
      )
    }
    function reconfirm() {
      if (busy.value || memory || !canReconfirm.value) return
      drop()
      challenge.value = null
      preview.value = null
      notice.value =
        'Se retiró el identificador local tras consultar el estado. Inspecciona y confirma otra vez; no equivale a cancelar una petición del servidor.'
    }
    return {
      list,
      detail,
      challenge,
      loadChallenge,
      accept,
      preview,
      receipt,
      pending,
      error,
      busy,
      notice,
      canReconfirm,
      reset,
      invalidate,
      submit,
      recover,
      reconfirm,
      retry: send,
      canRetry: () => memory !== null,
      loadList: (page = 1, state?: string) =>
        read(
          () => service.list(page, state),
          (v) => {
            list.value = v
          },
        ),
      open: (id: string) => {
        detail.value = null
        challenge.value = null
        preview.value = null
        return read(
          () => service.inspect(id),
          (v) => {
            detail.value = v
          },
        )
      },
      generate: (contract: ConsentContract) =>
        read(
          () => service.preview(contract),
          (v) => {
            preview.value = v
          },
        ),
    }
  },
)
