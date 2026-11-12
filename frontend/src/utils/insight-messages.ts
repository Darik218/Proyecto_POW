/** Public wording only; eligibility remains entirely in the backend domain. */
const messages: Record<string, string> = {
  LOAD_MISSING: "falta la carga registrada",
  LOAD_INVALID: "la carga no es válida",
  LOAD_NOT_POSITIVE: "la carga debe ser mayor que cero",
  DECIMAL_OUT_OF_RANGE: "la carga queda fuera del rango admitido",
  UNIT_UNKNOWN: "falta una unidad explícita",
  CANONICAL_LOAD_MISSING: "falta la carga canónica verificable",
  CANONICAL_LOAD_INVALID: "la carga canónica no es válida",
  CANONICAL_LOAD_NOT_POSITIVE: "la carga canónica debe ser positiva",
  CANONICAL_LOAD_INCONSISTENT: "las cargas original y canónica no coinciden",
  REPETITIONS_MISSING: "faltan repeticiones",
  REPETITIONS_INVALID: "las repeticiones no son válidas",
  REPETITIONS_OUT_OF_RANGE: "la estimación admite entre 1 y 10 repeticiones",
  SESSION_STATUS_UNKNOWN: "no se conoce el estado histórico de la sesión",
  SESSION_NOT_COMPLETED: "la sesión no está finalizada",
  SET_STATUS_UNKNOWN: "la serie histórica no tiene clasificación",
  SET_NOT_COMPLETED: "la serie no está completada",
  SET_COMPLETION_INCONSISTENT: "el estado de la serie no es coherente",
  SET_COMPLETION_UNKNOWN: "falta la confirmación de serie completada",
  SET_KIND_UNKNOWN: "no se conoce el tipo de serie",
  SET_NOT_WORK: "la serie no es de trabajo",
  OMISSION_UNKNOWN: "no se conoce si el ejercicio fue omitido",
  EXERCISE_OMITTED: "el ejercicio fue omitido",
  SUITABILITY_UNKNOWN:
    "todavía no se ha definido si el ejercicio permite estimar 1RM",
  EXERCISE_NOT_SUITABLE: "este ejercicio no es apto para estimar 1RM",
  LOAD_MEANING_UNKNOWN: "falta confirmar qué significa la carga",
  LOAD_MEANING_UNSUPPORTED:
    "esta interpretación de carga no permite la estimación",
  RPE_INVALID: "el esfuerzo registrado no es válido",
};
export const insightReason = (reason: string) =>
  messages[reason] ?? "la evidencia no permite una estimación verificable";
