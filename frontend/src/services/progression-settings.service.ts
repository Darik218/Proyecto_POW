import { z } from 'zod'
import { api } from './api'
import { progressionError } from './progression.service'
import {
  settingContextSchema,
  settingListSchema,
  settingRecordSchema,
  settingReceiptSchema,
  settingCreateSchema,
  settingReplaceSchema,
  settingResolutionSchema,
  settingImpactSchema,
  settingParametersSchema,
} from '../schemas/progression-settings.schema'
import type {
  SettingCreate,
  SettingReplace,
  SettingContext,
  SettingParameters,
} from '../types/progression-settings'
const root = '/progression/settings',
  path = (id: string) => root + '/' + z.uuid().parse(id)
export const progressionSettingsService = {
  async list(page = 1) {
    return settingListSchema.parse(
      (await api.get(root, { params: { page, limit: 20 } })).data,
    )
  },
  async get(id: string) {
    return settingRecordSchema.parse((await api.get(path(id))).data)
  },
  async effective(context: SettingContext) {
    return settingResolutionSchema.parse(
      (await api.post(root + '/effective', settingContextSchema.parse(context)))
        .data,
    )
  },
  async create(input: SettingCreate) {
    return settingReceiptSchema.parse(
      (await api.post(root, settingCreateSchema.parse(input))).data,
    )
  },
  async replace(id: string, input: SettingReplace) {
    return settingReceiptSchema.parse(
      (await api.put(path(id), settingReplaceSchema.parse(input))).data,
    )
  },
  async operation(intentId: string) {
    return settingReceiptSchema.parse(
      (await api.get(root + '/operations/' + z.uuid().parse(intentId))).data,
    )
  },
  async impact(
    id: string,
    expectedRevision: string,
    parameters: SettingParameters,
  ) {
    return settingImpactSchema.parse(
      (
        await api.post(path(id) + '/impact', {
          expectedRevision,
          parameters: settingParametersSchema.parse(parameters),
        })
      ).data,
    )
  },
}
const messages: Record<string, string> = {
  SETTING_SCOPE_EXISTS:
    'Ya existe una configuración de este ámbito. Consúltala; no se sobrescribirá.',
  STALE_SETTING:
    'La fila cambió. Recarga sus valores y vuelve a revisar el impacto antes de guardar.',
  INVALID_SETTING:
    'Revisa los parámetros completos, rangos, precisión y ámbito. No se redondearán valores.',
  INTENT_REUSED:
    'Esta intención pertenece a otro contenido. Consulta el resultado antes de confirmar otra edición.',
}
export function settingError(e: unknown) {
  const r = progressionError(e)
  return { ...r, message: messages[r.code] ?? r.message }
}
