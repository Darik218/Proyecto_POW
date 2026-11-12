import { settingParametersSchema } from '../schemas/progression-settings.schema'
import type { SettingParameters } from '../types/progression-settings'
export const settingParameterFields = [
  ['minSuccessfulSessions', 'Mínimo de sesiones satisfactorias'],
  ['targetRpeMin', 'RPE mínimo (0–10)'],
  ['targetRpeMax', 'RPE máximo (0–10)'],
  ['incrementAbsolute', 'Incremento absoluto (unidad definida por política)'],
  ['incrementPercent', 'Incremento porcentual (%)'],
  ['maxIncrementPercent', 'Límite porcentual (%)'],
  ['maxLoad', 'Carga máxima (unidad definida por política)'],
] as const
export function settingFormValues(value?: SettingParameters) {
  return Object.fromEntries(
    settingParameterFields.map(([key]) => [
      key,
      value?.[key] === null || value?.[key] === undefined
        ? ''
        : String(value[key]),
    ]),
  ) as Record<keyof SettingParameters, string>
}
export function settingFormParameters(
  f: Record<keyof SettingParameters, string>,
): SettingParameters {
  if (!/^\d+$/.test(f.minSuccessfulSessions))
    throw Error('El mínimo de sesiones debe ser un entero')
  return settingParametersSchema.parse({
    minSuccessfulSessions: Number(f.minSuccessfulSessions),
    targetRpeMin: f.targetRpeMin,
    targetRpeMax: f.targetRpeMax,
    incrementAbsolute: f.incrementAbsolute === '' ? null : f.incrementAbsolute,
    incrementPercent: f.incrementPercent === '' ? null : f.incrementPercent,
    maxIncrementPercent: f.maxIncrementPercent,
    maxLoad: f.maxLoad === '' ? null : f.maxLoad,
  })
}
export const settingReasonLabel = (code: string) =>
  (
    ({
      SETTING_REQUIRED:
        'No hay una fila aplicable. Puedes crearla para este ámbito.',
      POLICY_PROVENANCE_REQUIRED:
        'Falta la política matemática explícita, su versión y procedencia.',
      SETTING_LOAD_UNIT_REQUIRED:
        'La unidad de las cargas debe declararse en la política.',
      UNIT_POLICY_MISMATCH:
        'La unidad declarada por la política no coincide con su rejilla.',
      MINIMUM_SETTING_MISMATCH:
        'La política de conteo no coincide con el mínimo de esta fila.',
      RPE_SETTING_MISMATCH:
        'El intervalo RPE de la política no coincide con el guardado.',
      AMBIGUOUS_INCREMENT_MODE:
        'La fila contiene ambos incrementos: la política debe elegir el modo.',
      INCREMENT_MODE_REQUIRED:
        'Configura un incremento o define explícitamente el modo en la política.',
      SETTING_VALUES_INVALID:
        'La fila histórica tiene parámetros inválidos o incompletos.',
      INCREMENT_REQUIRED: 'El modo elegido requiere un incremento positivo.',
      PERSISTED_PARAMETERS_INCOMPLETE_OR_INVALID:
        'La fila necesita parámetros completos válidos antes de poder guardarse.',
    }) as Record<string, string>
  )[code] ?? code
