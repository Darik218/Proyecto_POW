import { z } from 'zod'
import { api } from './api'
import { progressionError } from './progression.service'
import {
  consentContractSchema,
  consentAcceptSchema,
  consentChallengeSchema,
  consentInspectionSchema,
  consentReceiptSchema,
  consentPreviewSchema,
  consentCandidatesSchema,
  consentListSchema,
  consentRequestSchema,
  consentRevisionSchema,
  consentRevocationSchema,
} from '../schemas/automation-consent.schema'
import type {
  ConsentContract,
  ConsentAccept,
  ConsentRequest,
  ConsentRevision,
  ConsentRevocation,
} from '../types/automation-consent'
const root = '/progression/automation-consents',
  path = (id: string) => root + '/' + z.uuid().parse(id)
export const automationConsentService = {
  async challenge(id: string, expectedVersion: number) {
    return consentChallengeSchema.parse(
      (await api.post(path(id) + '/acceptance-challenges', { expectedVersion }))
        .data,
    )
  },
  async accept(id: string, input: ConsentAccept) {
    return consentReceiptSchema.parse(
      (
        await api.post(
          path(id) + '/acceptances',
          consentAcceptSchema.parse(input),
        )
      ).data,
    )
  },
  async list(page = 1, state?: string) {
    return consentListSchema.parse(
      (
        await api.get(root, {
          params: { page, limit: 20, ...(state ? { state } : {}) },
        })
      ).data,
    )
  },
  async candidates(query: {
    exerciseId: string
    trainingPlanId?: string
    unit: 'KG' | 'LB'
    page?: number
  }) {
    return consentCandidatesSchema.parse(
      (await api.get(root + '/candidates', { params: query })).data,
    )
  },
  async preview(contract: ConsentContract) {
    return consentPreviewSchema.parse(
      (
        await api.post(root + '/preview', {
          contract: consentContractSchema.parse(contract),
        })
      ).data,
    )
  },
  async inspect(id: string) {
    return consentInspectionSchema.parse((await api.get(path(id))).data)
  },
  async operation(intentId: string) {
    return consentReceiptSchema.parse(
      (await api.get(root + '/operations/' + z.uuid().parse(intentId))).data,
    )
  },
  async request(input: ConsentRequest) {
    return consentReceiptSchema.parse(
      (await api.post(root, consentRequestSchema.parse(input))).data,
    )
  },
  async revise(id: string, input: ConsentRevision) {
    return consentReceiptSchema.parse(
      (
        await api.post(
          path(id) + '/revisions',
          consentRevisionSchema.parse(input),
        )
      ).data,
    )
  },
  async revoke(id: string, input: ConsentRevocation) {
    return consentReceiptSchema.parse(
      (
        await api.post(
          path(id) + '/revocations',
          consentRevocationSchema.parse(input),
        )
      ).data,
    )
  },
}
const messages: Record<string, string> = {
  ACCEPTANCE_CHALLENGE_INVALID:
    'El desafío ya no corresponde a estas condiciones o sesión, o ha caducado. Vuelve a inspeccionar antes de confirmar.',
  CONSENT_ALREADY_ACCEPTED:
    'La versión ya fue aceptada sin ejecución habilitada. Para cambiar condiciones se requiere otra solicitud.',
  STALE_CONSENT:
    'La solicitud cambió. Consulta su versión actual antes de decidir.',
  CONSENT_REVOKED: 'La solicitud está revocada y no puede reactivarse.',
  CONSENT_EXPIRED:
    'La vigencia terminó. Revisa las fechas con offset explícito.',
  AMBIGUOUS_AUTOMATION_CONSENT:
    'Hay otra solicitud con prescripciones y vigencia superpuestas. Revísala o revócala; no se combinarán permisos.',
  CONSENT_CONFIGURATION_REQUIRED:
    'El contrato no es configurable con los destinos y parámetros actuales. Revisa los límites, las unidades y la configuración registrada.',
  INVALID_CONSENT_COMMAND: 'Revisa los campos y la versión de la solicitud.',
}
export function consentError(e: unknown) {
  const value = progressionError(e)
  return { ...value, message: messages[value.code] ?? value.message }
}
