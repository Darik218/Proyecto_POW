import { AuthConfig } from './auth.config';

const BASE_ENV: NodeJS.ProcessEnv = {
  AUTH_ACCESS_TOKEN_SECRET: 'a'.repeat(48),
  AUTH_REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
  CORS_ORIGINS: 'http://localhost:5173',
};

describe('AuthConfig', () => {
  it('uses insecure cookies by default in development and secure cookies in production', () => {
    expect(new AuthConfig({ ...BASE_ENV, NODE_ENV: 'development' }).cookieSecure).toBe(
      false,
    );
    expect(new AuthConfig({ ...BASE_ENV, NODE_ENV: 'production' }).cookieSecure).toBe(
      true,
    );
  });

  it('rejects explicitly insecure cookies in production', () => {
    expect(
      () =>
        new AuthConfig({
          ...BASE_ENV,
          NODE_ENV: 'production',
          AUTH_COOKIE_SECURE: 'false',
        }),
    ).toThrow('AUTH_COOKIE_SECURE must be true in production.');
  });

  it('requires explicit CORS origins and independent strong secrets', () => {
    expect(
      () => new AuthConfig({ ...BASE_ENV, CORS_ORIGINS: '*' }),
    ).toThrow('CORS_ORIGINS must be an explicit origin allowlist.');
    expect(
      () =>
        new AuthConfig({
          ...BASE_ENV,
          AUTH_REFRESH_TOKEN_PEPPER: 'short',
        }),
    ).toThrow('AUTH_REFRESH_TOKEN_PEPPER must contain at least 32 bytes.');
  });
});
