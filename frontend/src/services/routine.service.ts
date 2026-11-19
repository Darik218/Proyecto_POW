import { z } from "zod";
import { api } from "./api";
import {
  generateRoutineSchema,
  type GenerateRoutine,
} from "../schemas/routine.schema";
export {
  generateRoutineSchema,
  type GenerateRoutine,
} from "../schemas/routine.schema";
const uuid = z.uuidv4();
const activitySchema = z
  .object({
    id: uuid,
    planWeekId: uuid.nullable(),
    planDayId: uuid.nullable(),
    originalPlanDayId: uuid.nullable(),
    originalOn: z.iso.datetime({ offset: true }),
    scheduledOn: z.iso.datetime({ offset: true }),
    timeZone: z.string(),
    title: z.string(),
    status: z.enum(["PLANNED", "RESCHEDULED", "OMITTED", "WITHDRAWN", "REST"]),
    version: z.number().int().nonnegative(),
    workouts: z.array(
      z.object({
        id: uuid,
        status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
        performedOn: z.iso.datetime({ offset: true }).nullable(),
      }),
    ),
  })
  .strict();
export type ScheduledActivity = z.infer<typeof activitySchema>;
export type PlanningVersion = { id: string; expectedVersion: number };
const resultSchema = z
  .object({ planId: uuid, dayIds: z.array(uuid).optional() })
  .strict();
const path = (id: string) => `/routine/plans/${uuid.parse(id)}`;
export const routineService = {
  async duplicate(
    planId: string,
    input: { id: string; expectedVersion: number; name: string },
  ) {
    const command = z
      .object({
        id: uuid,
        expectedVersion: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(160),
      })
      .strict()
      .parse(input);
    const { data } = await api.post<unknown>(
      `${path(planId)}/duplicate`,
      command,
    );
    return z.object({ id: uuid }).strict().parse(data);
  },
  async generate(input: GenerateRoutine) {
    const { data } = await api.post<unknown>(
      "/routine/plans",
      generateRoutineSchema.parse(input),
    );
    return z.object({ id: uuid }).strict().parse(data);
  },
  async activities(
    query: { weekId?: string; from: string; to: string; timeZone: string },
    signal?: AbortSignal,
  ) {
    const { data } = await api.get<unknown>("/routine/activities", {
      params: query,
      signal,
    });
    return z.array(activitySchema).parse(data);
  },
  async createActivity(input: {
    id: string;
    planWeekId?: string;
    planDayId?: string;
    scheduledOn: string;
    timeZone: string;
    title: string;
    status: "PLANNED" | "REST";
  }) {
    const { data } = await api.post<unknown>("/routine/activities", input);
    return activitySchema.parse(data);
  },
  async updateActivity(
    id: string,
    input: {
      expectedVersion: number;
      scheduledOn?: string;
      status?: "PLANNED" | "OMITTED" | "WITHDRAWN";
    },
  ) {
    const { data } = await api.patch<unknown>(
      `/routine/activities/${uuid.parse(id)}`,
      input,
    );
    return activitySchema.parse(data);
  },
  async transition(
    id: string,
    action: "activate" | "archive",
    input: PlanningVersion,
  ) {
    const { data } = await api.post<unknown>(`${path(id)}/${action}`, input);
    return resultSchema.parse(data);
  },
  async newDay(
    id: string,
    input: PlanningVersion & {
      timeZone?: string;
      weekId: string;
      name: string;
      position: number;
      weekday: number | null;
    },
  ) {
    const { data } = await api.post<unknown>(`${path(id)}/days`, input);
    return resultSchema.parse(data);
  },
  async copy(
    id: string,
    input: PlanningVersion & {
      timeZone?: string;
      sourceDayId: string;
      mode: "NEW_DAY" | "APPEND";
      targetDayId?: string;
      weekIds?: string[];
    },
  ) {
    const { data } = await api.post<unknown>(`${path(id)}/copy`, input);
    return resultSchema.parse(data);
  },
  async future(
    id: string,
    dayId: string,
    action: "future-copy" | "withdraw",
    input: PlanningVersion & { fromDate: string; timeZone: string },
  ) {
    const { data } = await api.post<unknown>(
      `${path(id)}/days/${uuid.parse(dayId)}/${action}`,
      input,
    );
    return resultSchema.parse(data);
  },
};
export function activityLabel(activity: ScheduledActivity) {
  if (activity.status === "REST") return "Descanso voluntario";
  if (activity.workouts.some((w) => w.status === "COMPLETED"))
    return "Completado";
  if (activity.workouts.some((w) => w.status === "IN_PROGRESS"))
    return "En curso";
  return {
    PLANNED: "Programado · sin registro",
    RESCHEDULED: "Reprogramado · sin registro",
    OMITTED: "Omitido voluntariamente",
    WITHDRAWN: "Retirado de la programación",
  }[activity.status];
}
