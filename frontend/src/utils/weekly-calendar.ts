/** UTC is used only as a civil-date arithmetic tool; no persisted sporting date is timezone-converted. */
function civil(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError("Fecha civil inválida");
  const date = new Date(value + "T00:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new RangeError("Fecha civil inválida");
  return date;
}
export function shiftCivilDate(value: string, days: number) {
  if (!Number.isInteger(days)) throw new RangeError("Usa días completos");
  const date = civil(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function weekDates(anchor: string) {
  const day = civil(anchor).getUTCDay() || 7;
  const monday = shiftCivilDate(anchor, 1 - day);
  return Array.from({ length: 7 }, (_, i) => shiftCivilDate(monday, i));
}
type SessionState = { status: string };
type ActivityState = { status: string; workouts: readonly SessionState[] };
export function calendarDayState(
  activities: readonly ActivityState[],
  records: readonly SessionState[],
) {
  if (activities.length > 1)
    return { code: "MULTIPLE", label: `${activities.length} actividades` };
  const activity = activities[0],
    sessions = [...(activity?.workouts ?? []), ...records];
  if (activity?.status === "REST") return { code: "REST", label: "Descanso" };
  if (sessions.some((s) => s.status === "IN_PROGRESS"))
    return { code: "IN_PROGRESS", label: "En curso" };
  if (sessions.some((s) => s.status === "COMPLETED"))
    return { code: "COMPLETED", label: "Completado" };
  if (activity?.status === "OMITTED")
    return { code: "OMITTED", label: "Omitido" };
  if (activity?.status === "WITHDRAWN")
    return { code: "WITHDRAWN", label: "Retirado" };
  if (activity?.status === "RESCHEDULED")
    return { code: "RESCHEDULED", label: "Reprogramado" };
  if (activity) return { code: "PLANNED", label: "Previsto · sin registro" };
  if (sessions.length) return { code: "RECORDED", label: "Con registros" };
  return { code: "UNSCHEDULED", label: "Sin programación" };
}

export const calendarShortLabels: Record<string, string> = {
  UNSCHEDULED: "—",
  PLANNED: "Plan",
  RESCHEDULED: "Movido",
  REST: "Desc.",
  IN_PROGRESS: "En curso",
  COMPLETED: "Hecho",
  OMITTED: "Omit.",
  WITHDRAWN: "Retir.",
  RECORDED: "Datos",
  MULTIPLE: "Varias",
};
