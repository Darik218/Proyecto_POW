/** Presentation metadata only. Router definitions and access guards remain authoritative. */
export const navigation = [
  {
    name: "dashboard",
    label: "Inicio",
    icon: "home",
    section: "Tu entrenamiento",
    key: "dashboard",
  },
  {
    name: "home",
    label: "Mi rutina",
    icon: "dumbbell",
    section: "Tu entrenamiento",
    key: "routine",
  },
  {
    name: "training-plans",
    label: "Planificación",
    icon: "calendar",
    section: "Tu entrenamiento",
    key: "plans",
  },
  {
    name: "exercise-catalog",
    label: "Ejercicios",
    icon: "layers",
    section: "Tu entrenamiento",
    key: "exercises",
  },
  {
    name: "workout-sessions",
    label: "Entrenar",
    icon: "activity",
    section: "Tu entrenamiento",
    key: "workouts",
  },
  {
    name: "workout-history",
    label: "Historial",
    icon: "history",
    section: "Tu entrenamiento",
    key: "history",
  },
  {
    name: "progression",
    label: "Mi progreso",
    icon: "chart",
    section: "Tu rendimiento",
    key: "progression",
  },
  {
    name: "progression-settings",
    label: "Configuración",
    icon: "settings",
    section: "Tu rendimiento",
    key: "settings",
  },
  {
    name: "automation-consents",
    label: "Automatización",
    icon: "shield",
    section: "Tu rendimiento",
    key: "automation",
  },
  {
    name: "profile",
    label: "Perfil",
    icon: "user",
    section: "Tu cuenta",
    key: "profile",
  },
] as const;
/** Daily destinations only; advanced capabilities remain linked from their owning pages. */
export const primaryNavigation = [
  "dashboard",
  "workout-sessions",
  "home",
  "progression",
  "exercise-catalog",
  "profile",
].map((name) => navigation.find((item) => item.name === name)!);
export function navigationSection(routeName: unknown): string {
  const n = String(routeName);
  if (n === "dashboard") return "dashboard";
  if (n.startsWith("progression-setting")) return "settings";
  if (n.startsWith("progression")) return "progression";
  if (n.startsWith("automation")) return "automation";
  if (n === "profile" || n === "measurements") return "profile";
  if (n === "workout-history") return "history";
  if (n.startsWith("workout")) return "workouts";
  if (n.startsWith("training-plan")) return "plans";
  if (n.startsWith("exercise")) return "exercises";
  return "routine";
}
