export const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;

export function sessionCreationCutoff(now: Date): Date {
  return new Date(now.getTime() - SESSION_ABSOLUTE_TTL_MS);
}

export function effectiveSessionDeadline(session: {
  createdAt: Date;
  absoluteExpiresAt: Date;
}): Date {
  return new Date(
    Math.min(
      session.absoluteExpiresAt.getTime(),
      session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS,
    ),
  );
}

export function sessionExpired(
  session: { createdAt: Date; absoluteExpiresAt: Date; expiresAt: Date },
  now: Date,
): boolean {
  return session.expiresAt <= now || effectiveSessionDeadline(session) <= now;
}
