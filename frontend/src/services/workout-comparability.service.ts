export type ComparisonClaim =
  "sameVariant" | "sameEquipment" | "sameLoadConvention" | "externalTotal";
export const repetitionClaims: readonly ComparisonClaim[] = [
  "sameVariant",
  "sameEquipment",
  "sameLoadConvention",
];
export const loadClaims: readonly ComparisonClaim[] = [
  "sameVariant",
  "sameEquipment",
  "externalTotal",
];
/** Ephemeral declarations, not authorizations. No credentials, snapshots or browser storage. */
export function createWorkoutComparabilityMemory(capacity = 64) {
  let activeScope: string | null = null;
  const entries = new Map<string, Partial<Record<ComparisonClaim, true>>>();
  function setScope(scope: string | null) {
    if (scope !== activeScope) {
      entries.clear();
      activeScope = scope;
    }
  }
  function missing(
    scope: string | null,
    key: string | null | undefined,
    claims: readonly ComparisonClaim[],
  ) {
    const known =
      scope && scope === activeScope && key ? entries.get(key) : undefined;
    return claims.filter((claim) => known?.[claim] !== true);
  }
  function record(
    scope: string | null,
    key: string | null | undefined,
    claims: Partial<Record<ComparisonClaim, true>>,
  ) {
    if (!scope || scope !== activeScope || !key || !/^[a-f0-9]{64}$/.test(key))
      return;
    const next = { ...entries.get(key) };
    for (const field of [...repetitionClaims, "externalTotal"] as const)
      if (claims[field] === true) next[field] = true;
    // A declaration that all compared loads mean external total explicitly fixes their recording convention.
    if (next.externalTotal) next.sameLoadConvention = true;
    entries.delete(key);
    entries.set(key, next);
    if (entries.size > capacity) entries.delete(entries.keys().next().value!);
  }
  return { setScope, missing, record };
}
export const workoutComparability = createWorkoutComparabilityMemory();
