export function authReturnPath(value: unknown): string {
  const fallback = "/app/overview";
  if (
    typeof value !== "string" ||
    !/^\/app(?:[/?#]|$)/.test(value) ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return fallback;
  const resolved = new URL(value, "https://pulso.invalid");
  return /^\/app(?:\/|$)/.test(resolved.pathname)
    ? resolved.pathname + resolved.search + resolved.hash
    : fallback;
}
