import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { useAuthStore } from './auth.store'
import {
  progressionService,
  progressionError,
} from '../services/progression.service'
import {
  forgetProgressionIntent,
  rememberProgressionIntent,
  recoverProgressionIntent,
  type PendingProgression,
} from '../utils/progression-intents'
import type {
  ProgressionCommand,
  ProgressionFormDraft,
  ProgressionPreview,
  ProgressionContext,
  ProgressionProposal,
  ProgressionInspection,
  ApplicationReadiness,
  ApplicationReceipt,
  RecommendationList,
  SaveRequest,
  ReviewRequest,
  ApplicationRequest,
} from '../types/progression'
const storage = () => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
export const useProgressionStore = defineStore('progression', () => {
  const auth = useAuthStore(),
    preview = shallowRef<ProgressionPreview | null>(null),
    settingsDraft = shallowRef<ProgressionFormDraft | null>(null),
    context = shallowRef<ProgressionContext | null>(null),
    proposal = shallowRef<ProgressionProposal | null>(null),
    inspection = shallowRef<ProgressionInspection | null>(null),
    readiness = shallowRef<ApplicationReadiness | null>(null),
    receipt = shallowRef<ApplicationReceipt | null>(null),
    list = shallowRef<RecommendationList | null>(null),
    error = shallowRef<ReturnType<typeof progressionError> | null>(null),
    pending = shallowRef<PendingProgression | null>(null),
    busy = ref(false),
    notice = ref(''),
    canReconfirm = ref(false)
  let revision = 0,
    busyOwner = 0,
    stamp = '',
    memory:
      | { kind: 'SAVE'; input: SaveRequest }
      | { kind: 'REVIEW'; id: string; input: ReviewRequest }
      | { kind: 'APPLY'; id: string; input: ApplicationRequest }
      | null = null
  const current = () =>
    `${auth.user?.id ?? ''}:${auth.getSessionContextId() ?? ''}:${auth.getSessionGeneration()}`
  function reset() {
    revision++
    settingsDraft.value = null
    preview.value = null
    context.value = null
    proposal.value = null
    inspection.value = null
    readiness.value = null
    receipt.value = null
    list.value = null
    error.value = null
    pending.value = null
    memory = null
    notice.value = ''
    canReconfirm.value = false
    busy.value = false
  }
  watch(
    () => [auth.user?.id, auth.status, auth.accessToken],
    () => {
      const next = current()
      if (next !== stamp) {
        reset()
        stamp = next
        const account = auth.user?.id,
          session = auth.getSessionContextId()
        if (account && session)
          pending.value = recoverProgressionIntent(
            storage(),
            account,
            session,
            Date.now(),
          )
        else forgetProgressionIntent(storage())
      }
    },
    { immediate: true, flush: 'sync' },
  )
  function invalidatePreview() {
    revision++
    preview.value = null
    error.value = null
  }
  function clearContext() {
    revision++
    context.value = null
    preview.value = null
  }
  function beginDraft() {
    clearContext()
    proposal.value = null
    inspection.value = null
    readiness.value = null
    receipt.value = null
  }
  function clearApplication() {
    revision++
    readiness.value = null
  }
  async function read<T>(
    operation: () => Promise<T>,
    accept: (value: T) => void,
  ) {
    const r = ++revision,
      s = current()
    busyOwner = r
    busy.value = true
    error.value = null
    try {
      const value = await operation()
      if (r === revision && s === current()) accept(value)
      return r === revision && s === current() ? value : undefined
    } catch (e) {
      if (r === revision && s === current()) error.value = progressionError(e)
      return undefined
    } finally {
      if (busyOwner === r && s === current()) busy.value = false
    }
  }
  function mark(
    kind: PendingProgression['kind'],
    id: string | null,
    intentId: string | null,
    semanticKey: string | null,
  ) {
    const accountId = auth.user?.id,
      sessionContext = auth.getSessionContextId()
    if (!accountId || !sessionContext)
      throw Error('Authenticated session context required')
    pending.value = {
      accountId,
      sessionContext,
      kind,
      recommendationId: id,
      intentId,
      semanticKey,
      createdAt: Date.now(),
    }
    rememberProgressionIntent(storage(), pending.value)
  }
  function settled() {
    canReconfirm.value = false
    pending.value = null
    memory = null
    forgetProgressionIntent(storage())
  }
  async function send() {
    if (!memory || busy.value) return
    const op = structuredClone(memory),
      r = ++revision,
      s = current()
    busyOwner = r
    busy.value = true
    error.value = null
    let committed = false
    try {
      if (op.kind === 'SAVE') {
        const result = await progressionService.save(op.input)
        if (s !== current() || r !== revision) return
        proposal.value = result
        notice.value = 'Propuesta guardada. No se ha aplicado.'
      } else if (op.kind === 'REVIEW') {
        await progressionService.review(op.id, op.input)
        committed = true
        if (s !== current() || r !== revision) return
        const inspected = await progressionService.inspect(op.id)
        if (s !== current() || r !== revision) return
        inspection.value = inspected
        proposal.value = inspected.proposal
        notice.value = 'Decisión registrada. Aprobar no aplica la carga.'
      } else {
        const result = await progressionService.apply(op.id, op.input)
        if (s !== current() || r !== revision) return
        committed = true
        receipt.value = result
        const inspected = await progressionService.inspect(op.id)
        if (s !== current() || r !== revision) return
        receipt.value = result
        inspection.value = inspected
        proposal.value = inspected.proposal
        readiness.value = null
        notice.value = 'Aplicación confirmada por el servidor.'
      }
      if (s === current() && r === revision) settled()
    } catch (e) {
      if (s === current() && r === revision) {
        error.value = progressionError(e)
        if (error.value.code === 'INVALID_RESPONSE' || committed)
          error.value = {
            ...error.value,
            uncertain: true,
            ...(committed
              ? {
                  message:
                    'La escritura fue confirmada; falta inspeccionar el estado vigente. Conservamos su intención para consultar el resultado.',
                }
              : {}),
          }
        if (!error.value.uncertain) {
          if (op.kind === 'APPLY') readiness.value = null
          settled()
        }
      }
    } finally {
      if (s === current() && busyOwner === r) busy.value = false
    }
  }
  async function save(command: ProgressionCommand) {
    if (busy.value || pending.value || !preview.value) return
    const p = preview.value,
      input = structuredClone({
        command,
        expectedSemanticKey: p.semanticKey,
        expectedDependencyKeys: p.dependencyKeys,
      })
    mark('SAVE', null, null, p.semanticKey)
    memory = { kind: 'SAVE', input }
    await send()
  }
  async function review(input: ReviewRequest) {
    if (busy.value || pending.value || !proposal.value) return
    const id = proposal.value.id
    mark('REVIEW', id, input.intentId, input.expectedSemanticKey)
    memory = { kind: 'REVIEW', id, input: structuredClone(input) }
    await send()
  }
  async function apply() {
    const input = readiness.value?.command
    if (busy.value || pending.value || !input || !readiness.value?.eligible)
      return
    mark(
      'APPLY',
      input.recommendationId,
      input.intentId,
      input.expectedSemanticKey,
    )
    memory = {
      kind: 'APPLY',
      id: input.recommendationId,
      input: structuredClone(input),
    }
    await send()
  }
  async function recover() {
    const p = pending.value
    if (!p || busy.value) return
    await read(
      async () => {
        if (p.kind === 'SAVE') {
          const found = await progressionService.list({
            semanticKey: p.semanticKey ?? undefined,
          })
          return {
            saved: found.items[0]
              ? await progressionService.get(found.items[0].id)
              : null,
          }
        }
        if (p.kind === 'APPLY') {
          try {
            return {
              applied: await progressionService.receipt(p.recommendationId!),
              inspected: await progressionService.inspect(p.recommendationId!),
            }
          } catch (e) {
            if (progressionError(e).code === 'RESOURCE_NOT_FOUND')
              return {
                inspected: await progressionService.inspect(
                  p.recommendationId!,
                ),
              }
            throw e
          }
        }
        return {
          inspected: await progressionService.inspect(p.recommendationId!),
        }
      },
      (result) => {
        if ('saved' in result && result.saved) {
          proposal.value = result.saved
          notice.value = 'Guardado confirmado.'
          settled()
        } else if ('applied' in result && result.applied) {
          receipt.value = result.applied
          readiness.value = null
          if ('inspected' in result && result.inspected) {
            inspection.value = result.inspected
            proposal.value = result.inspected.proposal
          }
          notice.value =
            result.applied.intentId === p.intentId
              ? 'Aplicación original confirmada.'
              : 'Existe una aplicación confirmada con otra intención. No se repetirá.'
          settled()
        } else if ('inspected' in result && result.inspected) {
          inspection.value = result.inspected
          proposal.value = result.inspected.proposal
          if (result.inspected.events.some((e) => e.intentId === p.intentId)) {
            notice.value = 'Revisión original confirmada.'
            settled()
          } else {
            canReconfirm.value = true
            notice.value =
              'No se confirmó esta intención. Puedes reintentar el mismo envío si permanece en memoria.'
          }
        } else {
          canReconfirm.value = true
          notice.value =
            'El guardado no se confirmó. Reintenta únicamente la intención original.'
        }
      },
    )
  }
  function reconfirm() {
    if (!canReconfirm.value || memory || busy.value) return
    settled()
    readiness.value = null
    notice.value =
      'Se retiró el identificador local tras consultar el estado. Esto no cancela una petición del servidor. Inspecciona otra vez y confirma de nuevo antes de escribir.'
  }
  return {
    canReconfirm,
    reconfirm,
    settingsDraft,
    keepSettingsDraft: (v: ProgressionFormDraft) => {
      settingsDraft.value = structuredClone(v)
    },
    clearSettingsDraft: () => {
      settingsDraft.value = null
    },
    preview,
    context,
    proposal,
    inspection,
    readiness,
    receipt,
    list,
    error,
    pending,
    busy,
    notice,
    reset,
    invalidatePreview,
    clearContext,
    beginDraft,
    clearApplication,
    save,
    review,
    apply,
    recover,
    retry: send,
    canRetry: () => memory !== null,
    loadContext: (command: ProgressionCommand) =>
      read(
        () => progressionService.context(command),
        (v) => {
          context.value = v
        },
      ),
    generate: (command: ProgressionCommand) =>
      read(
        () => progressionService.preview(command),
        (v) => {
          preview.value = v
        },
      ),
    loadList: (page = 1, status?: string) =>
      read(
        () =>
          progressionService.list({
            page,
            limit: 20,
            ...(status ? { status } : {}),
          }),
        (v) => {
          list.value = v
        },
      ),
    open: (id: string) => {
      proposal.value = null
      inspection.value = null
      readiness.value = null
      receipt.value = null
      return read(
        () => progressionService.inspect(id),
        (v) => {
          inspection.value = v
          proposal.value = v.proposal
        },
      )
    },
    check: (id: string) => {
      readiness.value = null
      return read(
        () => progressionService.inspect(id),
        (v) => {
          inspection.value = v
          proposal.value = v.proposal
        },
      )
    },
    prepareApplication: (id: string, activityId: string, intentId: string) => {
      readiness.value = null
      return read(
        async () => {
          const prepared = await progressionService.readiness(
            id,
            activityId,
            intentId,
          )
          return {
            prepared,
            inspected: prepared.receipt
              ? await progressionService.inspect(id)
              : null,
          }
        },
        ({ prepared, inspected }) => {
          readiness.value = prepared
          if (prepared.receipt) {
            receipt.value = prepared.receipt
            if (inspected) {
              inspection.value = inspected
              proposal.value = inspected.proposal
            }
          }
        },
      )
    },
    loadReceipt: (id: string) =>
      read(
        () => progressionService.receipt(id),
        (v) => {
          receipt.value = v
        },
      ),
  }
})
