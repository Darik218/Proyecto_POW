import { Injectable } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;

function requiredSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(`${name} must contain at least 32 bytes.`);
  }
  return value;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw)
    throw new Error('CORS_ORIGINS must contain at least one allowed origin.');
  const origins = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) {
    throw new Error('CORS_ORIGINS must be an explicit origin allowlist.');
  }
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(
        'CORS_ORIGINS entries must be HTTP(S) origins without paths.',
      );
    }
  }
  return [...new Set(origins)];
}

@Injectable()
export class AuthConfig {
  readonly accessTokenSecret: string;
  readonly refreshTokenPepper: string;
  readonly allowedOrigins: readonly string[];
  readonly cookieSecure: boolean;
  readonly accessTokenTtlSeconds = 15 * 60;
  readonly idleTtlMs = 7 * DAY_MS;
  readonly absoluteTtlMs = 30 * DAY_MS;
  readonly refreshCookieName = 'pow_refresh';
  readonly csrfCookieName = 'pow_csrf';
  readonly cookiePath = '/api/v1/auth';
  readonly issuer = 'proyecto-pow';
  readonly audience = 'proyecto-pow-api';
  readonly loginAttemptLimit = 10;
  readonly loginAttemptWindowMs = 15 * 60 * 1000;
  readonly registerAttemptLimit = 10;
  readonly registerAttemptWindowMs = 60 * 60 * 1000;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.accessTokenSecret = requiredSecret(env, 'AUTH_ACCESS_TOKEN_SECRET');
    this.refreshTokenPepper = requiredSecret(env, 'AUTH_REFRESH_TOKEN_PEPPER');
    this.allowedOrigins = parseOrigins(env.CORS_ORIGINS);
    this.cookieSecure =
      env.AUTH_COOKIE_SECURE === undefined
        ? env.NODE_ENV === 'production'
        : env.AUTH_COOKIE_SECURE === 'true';
    if (
      env.AUTH_COOKIE_SECURE !== undefined &&
      !['true', 'false'].includes(env.AUTH_COOKIE_SECURE)
    ) {
      throw new Error('AUTH_COOKIE_SECURE must be true or false.');
    }
    if (env.NODE_ENV === 'production' && !this.cookieSecure) {
      throw new Error('AUTH_COOKIE_SECURE must be true in production.');
    }

  }
}
