import { progressionPolicySchema } from '../schemas/progression.schema'
import type { ProgressionContext } from '../types/progression'
export const policyFields = [
  ['id', 'Nombre de la política', null],
  ['version', 'Versión de la política', null],
  ['reference', 'Referencia y justificación de la política', null],
  ['basis', 'Objetivos que se evaluarán', ['ORIGINAL', 'ADJUSTED']],
  ['basicReps', 'Repeticiones para cumplimiento', ['MINIMUM', 'UPPER_BOUND']],
  [
    'basicLoad',
    'Carga para cumplimiento',
    ['IGNORE', 'AT_LEAST_TARGET', 'EXACT_TARGET', 'IF_PRESENT_AT_LEAST'],
  ],
  ['readinessReps', 'Repeticiones para readiness', ['MINIMUM', 'UPPER_BOUND']],
  [
    'readinessLoad',
    'Carga para readiness',
    ['AT_LEAST_TARGET', 'EXACT_TARGET', 'IF_PRESENT_AT_LEAST'],
  ],
  ['rpeMin', 'RPE mínimo para readiness', null],
  ['rpeMax', 'RPE máximo para readiness', null],
  ['criterion', 'Criterio para contar sesiones', ['BASIC', 'READINESS']],
  ['mode', 'Conteo de sesiones', ['ACCUMULATED', 'CONSECUTIVE']],
  [
    'sameDate',
    'Sesiones en la misma fecha',
    ['DISTINCT_SESSIONS', 'DISTINCT_DATES'],
  ],
  [
    'settingRpeUse',
    'Uso del intervalo RPE configurado',
    ['REQUIRE_INTERVAL', 'CONTEXT_ONLY_EXPLICIT'],
  ],
  [
    'review',
    'Revisión por señales',
    ['NOT_REQUIRED_EXPLICIT', 'ANY_SIGNAL', 'TEMPORAL_SIGNAL'],
  ],
  ['incrementMode', 'Tipo de incremento configurado', ['ABSOLUTE', 'PERCENT']],
  ['unit', 'Unidad de la configuración y rejilla', ['KG', 'LB']],
  ['step', 'Paso de carga disponible', null],
  ['origin', 'Origen de la rejilla de cargas', null],
  ['gridSource', 'Referencia de la rejilla', null],
  ['closed', 'Exigir semana cerrada', ['true', 'false']],
] as const
export const signalFields = [
  [
    'rpeComparison',
    'Comparabilidad RPE',
    ['STRICT_PROG2', 'MATCHED_LOAD_DESCRIPTIVE'],
  ],
  ['referenceSize', 'Número de referencias', null],
  ['rpeThreshold', 'Umbral de cambio RPE', null],
  ['performanceThresholdPercent', 'Umbral de rendimiento (%)', null],
  ['minimumRpeCoveragePercent', 'Cobertura RPE mínima (%)', null],
  ['k', 'Señales requeridas para persistencia (k)', null],
  ['m', 'Observaciones para persistencia (m)', null],
] as const
export function setPositions(text: string) {
  if (!/^\d+(\s*,\s*\d+)*$/.test(text.trim()))
    throw Error('Indica posiciones de series separadas por comas.')
  const values = text.split(',').map((v) => Number(v.trim()))
  if (
    values.length > 1000 ||
    values.some((v) => !Number.isSafeInteger(v) || v < 1) ||
    new Set(values).size !== values.length
  )
    throw Error('Las posiciones deben ser enteras, positivas y únicas.')
  return values
}
export function buildProgressionPolicy(
  fields: Record<string, string>,
  slots: Record<string, { original: string; adjusted: string }>,
  ids: string[],
  anchor: string,
  selected: Pick<
    NonNullable<ProgressionContext['configuration']['selected']>,
    'minSuccessfulSessions'
  > | null,
) {
  if (!selected)
    throw Error(
      'Falta configuración de progresión registrada. No se crearán valores predeterminados.',
    )
  const f = fields,
    signal = f.review !== 'NOT_REQUIRED_EXPLICIT',
    persistence = f.review === 'TEMPORAL_SIGNAL'
  return progressionPolicySchema.parse({
    id: f.id,
    version: f.version,
    provenance: { source: 'EXPLICIT_INTERNAL_POLICY', reference: f.reference },
    basis: f.basis,
    baseline: 'DESTINATION_PRESCRIPTION',
    cohort: { mode: 'EXPLICIT_TASK_SET', taskIds: ids },
    assessment: {
      compliance: {
        id: f.id + '-compliance',
        slots: ids.map((taskId) => ({
          taskId,
          original: setPositions(slots[taskId]?.original ?? ''),
          adjusted: setPositions(slots[taskId]?.adjusted ?? ''),
          originalLoadMeaning: 'EXTERNAL_TOTAL',
          adjustedLoadMeaning: 'EXTERNAL_TOTAL',
        })),
        basic: {
          repetitions: f.basicReps,
          load: f.basicLoad,
          rpe: 'DESCRIBE',
          coverage: 'ALL_REQUIRED',
        },
        readiness: {
          repetitions: f.readinessReps,
          load: f.readinessLoad,
          rpe: { minimum: f.rpeMin, maximum: f.rpeMax },
          coverage: 'ALL_REQUIRED',
        },
      },
      count: {
        id: f.id + '-count',
        basis: f.basis,
        criterion: f.criterion,
        mode: f.mode,
        sameDate: f.sameDate,
        minimumSessions: selected.minSuccessfulSessions,
        anchorTaskId: anchor,
      },
      ...(signal
        ? {
            signal: {
              id: f.id + '-signal',
              basis: f.basis,
              rpeComparison: f.rpeComparison,
              referenceSize: Number(f.referenceSize),
              rpeThreshold: f.rpeThreshold,
              performanceThresholdPercent: f.performanceThresholdPercent,
              minimumRpeCoveragePercent: f.minimumRpeCoveragePercent,
            },
          }
        : {}),
      ...(persistence
        ? {
            persistence: {
              id: f.id + '-persistence',
              k: Number(f.k),
              m: Number(f.m),
            },
          }
        : {}),
    },
    settingRpeUse: f.settingRpeUse,
    review: f.review,
    oneRm: 'DESCRIPTIVE_CONTEXT_ONLY',
    requireClosedWeek: f.closed === 'true',
    knowledge: 'CURRENT_RECORDS_FOR_SPORTING_CUTOFF',
    loadMeaning: 'EXTERNAL_TOTAL',
    settingLoadUnit: f.unit,
    incrementMode: f.incrementMode,
    grid: {
      unit: f.unit,
      step: f.step,
      origin: f.origin,
      rounding: 'FLOOR',
      source: f.gridSource,
    },
  })
}
