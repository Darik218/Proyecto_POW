import { z } from "zod";
const uuid = z.uuidv4();
const generationPrescriptionSchema = z
  .object({
    exerciseId: uuid,
    position: z.number().int().min(1).max(1000),
    targetSets: z.number().int().min(1, "Indica al menos una serie.").max(1000),
    targetReps: z.number().int().min(1).max(10000).nullable().optional(),
    targetRepsMin: z
      .number()
      .int()
      .min(1, "Indica las repeticiones mínimas.")
      .max(10000),
    targetRepsMax: z
      .number()
      .int()
      .min(1, "Indica las repeticiones máximas.")
      .max(10000),
    targetLoad: z
      .string()
      .regex(
        /^(?:0|[1-9]\d{0,4})(?:\.\d{1,3})?$/,
        "Usa una carga entre 0 y 99999.999, con hasta tres decimales.",
      )
      .nullable(),
    targetLoadUnit: z.enum(["KG", "LB"]).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.targetRepsMin <= value.targetRepsMax &&
      (value.targetReps == null ||
        (value.targetReps === value.targetRepsMin &&
          value.targetReps === value.targetRepsMax)),
    "Revisa el rango de repeticiones.",
  )
  .refine(
    (value) => (value.targetLoad === null) === (value.targetLoadUnit === null),
    "Una carga requiere su unidad; deja ambos vacíos si aún no la conoces.",
  );
const dayTemplate = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Escribe el nombre del día.")
      .max(160, "El nombre admite hasta 160 caracteres."),
    weekday: z.number().int().min(1).max(7).nullable(),
    exercises: z
      .array(generationPrescriptionSchema)
      .min(1, "Selecciona al menos un ejercicio para cada bloque.")
      .max(100)
      .refine(
        (values) =>
          new Set(values.map((value) => value.exerciseId)).size ===
          values.length,
        "No repitas un ejercicio en el mismo bloque.",
      )
      .refine(
        (values) =>
          values.every((value, index) => value.position === index + 1),
        "Revisa el orden de los ejercicios.",
      )
      .optional(),
  })
  .strict();
export const generateRoutineSchema = z
  .object({
    id: uuid,
    name: z
      .string()
      .trim()
      .min(1, "Escribe el nombre de tu plan.")
      .max(160, "El nombre admite hasta 160 caracteres."),
    durationWeeks: z
      .number({ error: "Introduce un número de semanas." })
      .int("Usa semanas completas.")
      .min(1, "La duración mínima es una semana.")
      .max(52, "La duración máxima es 52 semanas."),
    frequency: z
      .number({ error: "Introduce un número de días." })
      .int("Usa un número entero de días.")
      .min(1, "Selecciona al menos un día.")
      .max(7, "Selecciona hasta siete días iniciales."),
    startsOn: z.iso
      .date({ error: "Introduce una fecha inicial válida." })
      .nullable()
      .optional(),
    timeZone: z.string().min(1).max(100),
    days: z.array(dayTemplate).min(1).max(7),
    restWeekdays: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .refine(
        (values) => new Set(values).size === values.length,
        "No repitas días de descanso.",
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.days.length === value.frequency,
    "La frecuencia y los días deben coincidir.",
  )
  .refine(
    (value) =>
      !(value.restWeekdays ?? []).some((weekday) =>
        value.days.some((day) => day.weekday === weekday),
      ),
    "Un día no puede ser descanso y entrenamiento a la vez.",
  )
  .refine(
    (value) => !value.restWeekdays?.length || !!value.startsOn,
    "Elige la fecha inicial para guardar los días de descanso.",
  );
export type GenerateRoutine = z.infer<typeof generateRoutineSchema>;
