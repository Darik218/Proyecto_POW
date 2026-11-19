const labels: Record<string, string> = {
  NO_REPRESENTABLE_INCREMENT:
    "El salto de peso disponible no permite un aumento dentro de los límites configurados.",
  GRID_HAS_NO_POSITIVE_INCREMENT:
    "El salto de peso disponible no produce un aumento válido para esta carga.",
  PLAN_TARGET_AVAILABLE: "Se usa el objetivo del plan como punto de partida.",
  NO_ELIGIBLE_HISTORY:
    "Todavía no hay sesiones anteriores completas para comparar.",
  FIRST_BASELINE: "Esta sesión servirá como primera referencia.",
  PLAN_WITH_REFERENCE:
    "El historial sirve como referencia junto al objetivo del plan.",
  COMPARABILITY_DECLARATION_REQUIRED:
    "Confirma la variante, el equipo y la forma de anotar el peso para comparar.",
  REPETITION_TARGET_ADVANCE:
    "Completaste las series comparables: puedes probar una repetición más dentro del rango del plan.",
  REPETITION_RANGE_COMPLETED:
    "Ya alcanzaste el máximo de repeticiones del plan. Un aumento de carga requiere su propia evaluación.",
  LOAD_INCREMENT_REQUIRES_EXPLICIT_POLICY:
    "Subir peso requiere una política e incrementos de carga configurados.",
  LOAD_FROM_RECORDED_HISTORY:
    "El plan no fija peso: se toma la carga que registraste, sin modificar el plan.",
  EFFORT_NOT_REQUIRED_BY_POLICY:
    "Este criterio utiliza series y repeticiones; no exige RPE ni RIR.",
  MINIMUM_NOT_REACHED:
    "Aún faltan sesiones completas comparables para avanzar; conserva la referencia.",
  CONTEXTUAL_HISTORY_ONLY:
    "El registro viene de otro día o rutina. Úsalo como referencia manual si el equipo y la forma de anotar el peso coinciden.",
  PARTIAL_SESSION_REFERENCE:
    "La referencia es una sesión parcial; revisa sus resultados antes de reutilizarlos.",
  SESSION_NOT_COMPLETED: "La sesión anterior no está completada.",
  INCOMPLETE_HISTORY:
    "Faltan resultados completos o una clasificación verificable de las series.",
  WORK_SET_NOT_COMPLETED: "Una serie de trabajo anterior no se completó.",
  WORK_SLOT_MAPPING_INCOMPLETE:
    "Las series registradas no cubren todas las series previstas.",
  SET_KIND_UNKNOWN: "Falta confirmar qué series eran de trabajo.",
  LOAD_UNIT_UNKNOWN: "La unidad de un peso anterior no está registrada.",
  KNOWN_LOAD_BASELINE_REQUIRED:
    "Falta una carga con unidad conocida que pueda usarse como referencia.",
  RECORDED_LOAD_DIFFERS:
    "Los pesos registrados difieren; revisa qué carga corresponde a esta sesión.",
  HISTORY_REPETITIONS_INCONSISTENT:
    "Los resultados cambian entre sesiones comparadas. Puedes consultar las series registradas.",
  REPETITIONS_OUTSIDE_PRESCRIBED_RANGE:
    "Las repeticiones registradas están fuera del rango del plan.",
  HISTORICAL_TARGETS_DIFFER:
    "Los objetivos capturados en el historial difieren de los actuales.",
  HISTORICAL_TARGETS_INCOMPATIBLE:
    "Los objetivos del historial no son compatibles con esta sesión.",
  DESTINATION_TARGETS_CHANGED:
    "El objetivo de esta sesión cambió; vuelve a comprobar la comparación.",
  PRESCRIPTION_TARGETS_CHANGED:
    "La prescripción cambió desde que se guardó la referencia.",
  PRESCRIPTION_HISTORY_REQUIRED:
    "Falta un historial con los objetivos del plan capturados.",
  PRESCRIPTION_REQUIRED:
    "Falta un objetivo del plan al que vincular esta comparación.",
  REFERENCE_OUTSIDE_PREVIEW_PERIOD:
    "La referencia queda fuera de la semana de esta sesión y de la anterior; necesita revisión.",
  STALE_REFERENCE:
    "La referencia es antigua; revísala antes de preparar una nueva orientación.",
  REVIEW_REFERENCE_BEFORE_TRAINING:
    "Revisa la referencia y el objetivo antes de entrenar.",
  REVIEW_REQUIRED:
    "La referencia necesita revisión antes de calcular una nueva orientación.",
  INTRADAY_ORDER_UNKNOWN:
    "Hay varias sesiones en la misma fecha y no se conoce su orden.",
  SAME_DAY_NOT_ORDERED:
    "No se supone qué sesión ocurrió primero en la misma fecha.",
  DUPLICATE_SESSION_REFERENCE: "Hay una sesión duplicada en la comparación.",
  DUPLICATE_SET_REFERENCE: "Hay una serie duplicada en la comparación.",
  DATE_UNKNOWN: "Falta una fecha verificable del entrenamiento anterior.",
  TIME_ZONE_MISMATCH: "Las zonas horarias de los registros no coinciden.",
  READ_LIMIT_REACHED:
    "El historial consultado alcanzó su límite y la comparación puede estar incompleta.",
  FUTURE_CUTOFF_UNVERIFIED:
    "La sesión es futura y su historial deberá comprobarse de nuevo antes de entrenar.",
  SETTING_REQUIRED:
    "Configura el incremento para evaluar si puedes subir de peso.",
  CONFIGURATION_REQUIRED:
    "La evaluación de carga necesita configuración del ejercicio.",
  INCREMENT_REQUIRED: "Falta configurar el incremento de peso.",
  POLICY_PROVENANCE_REQUIRED:
    "Falta una política explícita para evaluar un aumento de carga.",
  SETTING_LOAD_UNIT_REQUIRED:
    "Falta definir la unidad de la configuración de carga.",
  AMBIGUOUS_INCREMENT_MODE:
    "Hay más de un incremento posible; elige cuál evaluar.",
  INCREMENT_MODE_REQUIRED:
    "Selecciona el tipo de incremento que quieres evaluar.",
  AMBIGUOUS_SETTING_SCOPE:
    "Hay configuraciones que se solapan para este ejercicio.",
  SETTING_MINIMUM_INVALID:
    "El mínimo de sesiones configurado necesita revisión.",
  TARGET_UNIT_REQUIRED: "Falta la unidad del peso objetivo.",
  TARGET_UNIT_MISMATCH:
    "La unidad del objetivo y la de la propuesta no coinciden.",
  DESTINATION_DECIMAL_INCOMPATIBLE:
    "La precisión de la carga no puede registrarse sin cambiar el valor.",
  SUBSTITUTION_NOT_COMPARABLE:
    "El ejercicio fue sustituido; sus resultados no se equiparan automáticamente.",
  EXERCISE_OMITTED: "Este ejercicio está omitido en la sesión.",
  SESSION_NOT_TRAINABLE: "Esta sesión no está disponible para entrenar.",
  DESTINATION_UNAVAILABLE:
    "El destino de la orientación ya no está disponible.",
  SOURCE_OWNERSHIP_MISMATCH: "No se pudo verificar el origen de los registros.",
  RECORDED_EFFORT_ABOVE_TARGET:
    "El esfuerzo registrado supera el objetivo; revisa la referencia.",
  RECORDED_EFFORT_CONTEXT: "El esfuerzo registrado se muestra como contexto.",
  RECORDED_EFFORT_INVALID: "Un valor de esfuerzo registrado necesita revisión.",
  PROPOSAL_EXPIRED: "La propuesta guardada ha caducado.",
  PROPOSAL_OBSOLETE:
    "La propuesta guardada ya no corresponde al contexto actual.",
  PROPOSAL_NOT_ACTIVE: "La propuesta guardada ya no está activa.",
  REVALIDATION_UNAVAILABLE:
    "No se pudo volver a verificar la propuesta guardada.",
  NEWER_REFERENCE_OUTSIDE_PROPOSAL:
    "Hay resultados más recientes que no formaban parte de la propuesta.",
  CYCLE_CONFLICT: "Otra propuesta ocupa el mismo ciclo de progresión.",
  CYCLE_UNRESERVED: "La propuesta no tiene reservado su ciclo de progresión.",
};

export function workoutGuideReason(code: string): string | undefined {
  return Object.hasOwn(labels, code) ? labels[code] : undefined;
}

// Preserve decimal precision without converting official strings to numbers.
export function formatGuideLoad(
  value: string | null,
  unit?: "KG" | "LB" | null,
): string {
  if (value === null) return "Peso sin registrar";
  const [whole, decimals] = value.split(".");
  const fraction = decimals?.replace(/0+$/, "");
  const load = fraction ? `${whole},${fraction}` : whole;
  return unit
    ? `${load} ${unit.toLowerCase()}`
    : `${load} (unidad sin registrar)`;
}

export function guideRepetitions(
  reps: number | null,
  repsBySet?: readonly number[],
): string {
  if (repsBySet?.length) return repsBySet.join(" / ");
  return reps?.toString() ?? "—";
}
