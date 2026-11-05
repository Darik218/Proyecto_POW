import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth.config';

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function setAuthCookies(
  response: Response,
  config: AuthConfig,
  refreshToken: string,
  csrfToken: string,
  expiresAt: Date,
): void {
  const common = {
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    expires: expiresAt,
  };
  response.cookie(config.refreshCookieName, refreshToken, {
    ...common,
    httpOnly: true,
    path: config.cookiePath,
  });
  response.cookie(config.csrfCookieName, csrfToken, {
    ...common,
    httpOnly: false,
    path: config.cookiePath,
  });
}

export function clearAuthCookies(response: Response, config: AuthConfig): void {
  const common = {
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    path: config.cookiePath,
  };
  response.clearCookie(config.refreshCookieName, { ...common, httpOnly: true });
  response.clearCookie(config.csrfCookieName, { ...common, httpOnly: false });
}
