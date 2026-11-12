import axios from 'axios'
import { z } from 'zod'
import { api } from './api'
import {
  progressionCommandSchema,
  progressionContextSchema,
  previewSchema,
  proposalSchema,
  inspectionSchema,
  reviewRequestSchema,
  applicationRequestSchema,
  receiptSchema,
  readinessSchema,
  recommendationListSchema,
  saveRequestSchema,
  recipeSchema,
  reviewSchema,
  validitySchema,
} from '../schemas/progression.schema'
import type {
  ProgressionCommand,
  ReviewRequest,
  ApplicationRequest,
  SaveRequest,
} from '../types/progression'
const root = '/progression',
  path = (id: string) => `${root}/recommendations/${z.uuid().parse(id)}`
export const progressionService = {
  async context(command: ProgressionCommand) {
    return progressionContextSchema.parse(
      (
        await api.post(
          `${root}/context`,
          progressionCommandSchema.parse(command),
        )
      ).data,
    )
  },
  async preview(command: ProgressionCommand) {
    return previewSchema.parse(
      (
        await api.post(
          `${root}/preview`,
          progressionCommandSchema.parse(command),
        )
      ).data,
    )
  },
  async save(input: SaveRequest) {
    return proposalSchema.parse(
      (
        await api.post(
          `${root}/recommendations`,
          saveRequestSchema.parse(input),
        )
      ).data,
    )
  },
  async list(
    query: {
      page?: number
      limit?: number
      status?: string
      exerciseId?: string
      semanticKey?: string
    } = {},
  ) {
    return recommendationListSchema.parse(
      (await api.get(`${root}/recommendations`, { params: query })).data,
    )
  },
  async get(id: string) {
    return proposalSchema.parse((await api.get(path(id))).data)
  },
  async recipe(id: string) {
    return recipeSchema.parse((await api.get(path(id) + '/request')).data)
  },
  async inspect(id: string, command?: ProgressionCommand) {
    return inspectionSchema.parse(
      (await api.post(path(id) + '/inspection', command ? { command } : {}))
        .data,
    )
  },
  async validity(id: string, command?: ProgressionCommand) {
    return validitySchema.parse(
      (await api.post(path(id) + '/validity', command ? { command } : {})).data,
    )
  },
  async review(id: string, input: ReviewRequest) {
    return reviewSchema.parse(
      (await api.post(path(id) + '/reviews', reviewRequestSchema.parse(input)))
        .data,
    )
  },
  async readiness(id: string, activityId: string, intentId: string) {
    return readinessSchema.parse(
      (
        await api.post(path(id) + '/application-readiness', {
          activityId: z.uuid().parse(activityId),
          intentId: z.uuid().parse(intentId),
        })
      ).data,
    )
  },
  async apply(id: string, input: ApplicationRequest) {
    return receiptSchema.parse(
      (
        await api.post(
          path(id) + '/application',
          applicationRequestSchema.parse(input),
        )
      ).data,
    )
  },
  async receipt(id: string) {
    return receiptSchema.parse((await api.get(path(id) + '/application')).data)
  },
}
const messages: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'La sesión terminó. Inicia sesión de nuevo.',
  ORIGIN_NOT_ALLOWED: 'El origen de la solicitud no está autorizado.',
  SOURCE_NOT_FOUND: 'El recurso no existe o no está disponible para tu cuenta.',
  RESOURCE_NOT_FOUND: 'El recurso no está disponible.',
  REVALIDATION_PARAMETERS_REQUIRED:
    'Esta propuesta antigua no conserva todos sus parámetros. Requiere una nueva generación explícita.',
  REVIEW_CONFLICT: 'La revisión cambió. Vuelve a inspeccionar la propuesta.',
  INTENT_REUSED:
    'La intención corresponde a otra operación. Consulta el resultado antes de continuar.',
  APPLICATION_BLOCKED: 'El destino no cumple las condiciones de aplicación.',
  STALE_APPLICATION:
    'La propuesta o el destino cambiaron. Debes volver a inspeccionarlos.',
  STALE_PROPOSAL: 'La evidencia cambió. Genera una nueva vista previa.',
  ACCEPTANCE_REQUIRED: 'Confirma expresamente la política y la evidencia.',
  SOURCE_BUSY:
    'Hay una operación concurrente. Consulta el estado antes de reintentar.',
  VALIDATION_ERROR: 'Revisa los campos del formulario.',
  INVALID_POLICY: 'La política está incompleta o es incompatible.',
  INTERNAL_ERROR:
    'No se pudo completar la operación. Consulta su estado antes de repetirla.',
}
export function progressionError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      { code?: string; reasons?: unknown } | undefined
    return {
      uncertain:
        !error.response ||
        (error.response.status >= 500 && body?.code !== 'SOURCE_BUSY'),
      code: body?.code ?? 'NETWORK_ERROR',
      message: error.response
        ? (messages[body?.code ?? ''] ?? 'La operación requiere revisión.')
        : 'No se pudo confirmar el resultado. Comprueba el estado antes de reintentar.',
      reasons: Array.isArray(body?.reasons)
        ? body.reasons.filter((v): v is string => typeof v === 'string')
        : [],
    }
  }
  return {
    uncertain: false,
    code: 'INVALID_RESPONSE',
    message:
      'Los datos no cumplen el contrato esperado. Revisa la configuración o consulta el estado.',
    reasons: [] as string[],
  }
}
