import type { z } from 'zod'
import type {
  settingParametersSchema,
  settingScopeSchema,
  settingRecordSchema,
  settingResolutionSchema,
  settingContextSchema,
  settingListSchema,
  settingCreateSchema,
  settingReplaceSchema,
  settingReceiptSchema,
  settingImpactSchema,
} from '../schemas/progression-settings.schema'
export type SettingParameters = z.infer<typeof settingParametersSchema>
export type SettingScope = z.infer<typeof settingScopeSchema>
export type SettingRecord = z.infer<typeof settingRecordSchema>
export type SettingResolution = z.infer<typeof settingResolutionSchema>
export type SettingContext = z.infer<typeof settingContextSchema>
export type SettingList = z.infer<typeof settingListSchema>
export type SettingCreate = z.infer<typeof settingCreateSchema>
export type SettingReplace = z.infer<typeof settingReplaceSchema>
export type SettingReceipt = z.infer<typeof settingReceiptSchema>
export type SettingImpact = z.infer<typeof settingImpactSchema>
