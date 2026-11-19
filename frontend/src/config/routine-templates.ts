/** Editorial structures. Catalog metadata supplies every exercise; names never imply suitability. */
export type RoutineTemplateId =
  | "fullbody"
  | "upperlower"
  | "ppl"
  | "arnold"
  | "muscle-groups"
  | "ppl-upperlower"
  | "upperlower-fullbody"
  | "free";
export type TemplateSession = {
  key: string;
  family: string;
  variant: number;
  name: string;
  muscleGroups: string[];
};
export const routineTemplates: {
  id: RoutineTemplateId;
  label: string;
  description: string;
  frequencies: number[];
}[] = [
  {
    id: "fullbody",
    label: "Full body",
    description: "Cuerpo completo con variantes A/B/C.",
    frequencies: [1, 2, 3],
  },
  {
    id: "upperlower",
    label: "Torso · Pierna",
    description: "Alterna torso y tren inferior.",
    frequencies: [2, 4],
  },
  {
    id: "ppl",
    label: "Push · Pull · Legs",
    description: "Empuje, tirón y piernas.",
    frequencies: [3, 6],
  },
  {
    id: "arnold",
    label: "Arnold",
    description: "Pecho/espalda, hombros/brazos y piernas.",
    frequencies: [3, 6],
  },
  {
    id: "muscle-groups",
    label: "Grupos musculares",
    description: "Una distribución de cinco sesiones.",
    frequencies: [5],
  },
  {
    id: "ppl-upperlower",
    label: "PPL + Torso · Pierna",
    description: "Cinco sesiones combinadas.",
    frequencies: [5],
  },
  {
    id: "upperlower-fullbody",
    label: "Torso · Pierna + Full body",
    description: "Tres sesiones combinadas.",
    frequencies: [3],
  },
  {
    id: "free",
    label: "Propia / Libre",
    description: "Define cada sesión a tu manera.",
    frequencies: [1, 2, 3, 4, 5, 6, 7],
  },
];
const upper = [
  "pectorales",
  "dorsales",
  "espalda-alta",
  "deltoides",
  "biceps",
  "triceps",
];
const lower = ["cuadriceps", "isquiotibiales", "gluteos", "gemelos"];
const full = [
  "cuadriceps",
  "pectorales",
  "dorsales",
  "isquiotibiales",
  "deltoides",
];
const types: Record<string, { name: string; muscleGroups: string[] }> = {
  full: { name: "Full body", muscleGroups: full },
  upper: { name: "Torso", muscleGroups: upper },
  lower: { name: "Pierna", muscleGroups: lower },
  push: { name: "Push", muscleGroups: ["pectorales", "deltoides", "triceps"] },
  pull: {
    name: "Pull",
    muscleGroups: ["dorsales", "espalda-alta", "deltoides", "biceps"],
  },
  legs: { name: "Legs", muscleGroups: lower },
  chestback: {
    name: "Pecho · Espalda",
    muscleGroups: ["pectorales", "dorsales", "espalda-alta"],
  },
  shouldersarms: {
    name: "Hombros · Brazos",
    muscleGroups: ["deltoides", "biceps", "triceps"],
  },
  chest: { name: "Pecho", muscleGroups: ["pectorales"] },
  back: { name: "Espalda", muscleGroups: ["dorsales", "espalda-alta"] },
  shoulders: { name: "Hombros", muscleGroups: ["deltoides"] },
  arms: { name: "Brazos", muscleGroups: ["biceps", "triceps"] },
  free: { name: "Mi sesión", muscleGroups: [] },
};
export function templateSessions(
  id: RoutineTemplateId,
  frequency: number,
): TemplateSession[] {
  const template = routineTemplates.find((v) => v.id === id);
  if (!template?.frequencies.includes(frequency))
    throw new Error("Elige una frecuencia disponible para esta estructura.");
  const base: Record<RoutineTemplateId, string[]> = {
    fullbody: ["full"],
    upperlower: ["upper", "lower"],
    ppl: ["push", "pull", "legs"],
    arnold: ["chestback", "shouldersarms", "legs"],
    "muscle-groups": ["chest", "back", "legs", "shoulders", "arms"],
    "ppl-upperlower": ["push", "pull", "legs", "upper", "lower"],
    "upperlower-fullbody": ["upper", "lower", "full"],
    free: ["free"],
  };
  const seen: Record<string, number> = {};
  return Array.from({ length: frequency }, (_, i) => {
    const key = base[id][i % base[id].length]!;
    const variant = String.fromCharCode(97 + (seen[key] ?? 0));
    seen[key] = (seen[key] ?? 0) + 1;
    return {
      key: `${key}-${variant}`,
      family: key,
      variant: seen[key]! - 1,
      name: `${types[key]!.name} ${variant.toUpperCase()}`,
      muscleGroups: [...types[key]!.muscleGroups],
    };
  });
}
export function recommendedTemplate(frequency: number): RoutineTemplateId {
  return frequency <= 3
    ? "fullbody"
    : frequency === 4
      ? "upperlower"
      : frequency === 5
        ? "ppl-upperlower"
        : frequency === 6
          ? "ppl"
          : "free";
}

/** Starting counts only: the user can change both count and distribution. */
export const exerciseCountPresets = [
  {
    id: "brief",
    label: "Breve · 3–4 ejercicios",
    min: 3,
    max: 4,
    count: 4,
    minutes: 30,
  },
  {
    id: "balanced",
    label: "Equilibrada · 5–6 ejercicios",
    min: 5,
    max: 6,
    count: 5,
    minutes: 45,
  },
  {
    id: "extensive",
    label: "Extensa · 7–9 ejercicios",
    min: 7,
    max: 9,
    count: 7,
    minutes: 60,
  },
  {
    id: "custom",
    label: "Personalizada",
    min: 1,
    max: 20,
    count: 5,
    minutes: 45,
  },
] as const;
export const templateMuscleLabels: Record<string, string> = {
  pectorales: "Pecho",
  dorsales: "Dorsales",
  "espalda-alta": "Espalda alta",
  deltoides: "Hombros",
  biceps: "Bíceps",
  triceps: "Tríceps",
  cuadriceps: "Cuádriceps",
  isquiotibiales: "Isquiotibiales",
  gluteos: "Glúteos",
  gemelos: "Gemelos",
};
export function defaultMuscleAllocation(
  session: TemplateSession,
  count: number,
): Record<string, number> {
  const allocation = Object.fromEntries(
    session.muscleGroups.map((key) => [key, 0]),
  );
  for (let index = 0; index < count && session.muscleGroups.length; index++) {
    const key = session.muscleGroups[index % session.muscleGroups.length]!;
    allocation[key] = (allocation[key] ?? 0) + 1;
  }
  return allocation;
}
