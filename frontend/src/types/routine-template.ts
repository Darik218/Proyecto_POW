/** Catalog metadata used by the deterministic proposal; exercise names are display-only. */
export type TemplateCatalogExercise = {
  id: string;
  name: string;
  primaryMuscleGroup: { key: string };
  equipmentType: string;
  difficulty: string | null;
  movementPattern?: string | null;
  movementType?: string | null;
  machineType?: string | null;
  bodyPosition?: string | null;
  laterality?: string | null;
  grip?: string | null;
  gripWidth?: string | null;
  /** Local query ordering, never a global usage claim. */
  usageRank?: number;
  editorialRank?: number;
};
export type TemplateVariantStrategy =
  "same" | "partial" | "different" | "independent";
export type TemplatePreferences = {
  experience: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  equipment: string[];
  goal: "GENERAL" | "HYPERTROPHY" | "STRENGTH";
  exerciseCount?: number;
  /** An editable editorial planning reference, never a physiological prediction. */
  durationMinutes?: number;
  muscleAllocations?: Record<string, Record<string, number>>;
  familyStrategies?: Record<string, TemplateVariantStrategy>;
};
