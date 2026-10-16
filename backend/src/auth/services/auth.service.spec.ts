import { UnauthorizedException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { decode } from 'jsonwebtoken';
import { AuthConfig } from '../auth.config';
import { AuthRateLimiter } from '../security/auth-rate-limiter';
import { hashRefreshToken } from '../security/cookie.utils';
import { PasswordHasher } from '../security/password-hasher';
import { AuthService } from './auth.service';
import { FakeAuthRepository } from '../../../test/auth/fake-auth.repository';

const TEST_ENV: NodeJS.ProcessEnv = {
  AUTH_ACCESS_TOKEN_SECRET: 'a'.repeat(48),
  AUTH_REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
  CORS_ORIGINS: 'http://localhost:5173',
};

function createHarness() {
  const repository = new FakeAuthRepository();
  const passwordHasher = {
    hash: jest.fn(async (password: string) => `argon2id$test$${password}`),
    verify: jest.fn(
      async (hash: string, password: string) =>
        hash === `argon2id$test$${password}`,
    ),
    verifyUnknownAccount: jest.fn(async () => undefined),
  } as unknown as PasswordHasher;
  const config = new AuthConfig(TEST_ENV);
  const service = new AuthService(
    repository,
    passwordHasher,
    new AuthRateLimiter(),
    config,
  );
  return { service, repository, passwordHasher, config };
}

describe('AuthService', () => {
  it('registers account and athlete owner through repository; stores only password hash', async () => {
    const { service, repository } = createHarness();
    const issued = await service.register(
      '  User@Example.com ',
      'very-long-password',
      '127.0.0.1',
    );

    expect(repository.accounts.get('user@example.com')?.passwordHash).toBe(
      'argon2id$test$very-long-password',
    );
    expect(repository.accounts.get('user@example.com')?.passwordHash).not.toBe(
      'very-long-password',
    );
    expect(repository.accounts.get('user@example.com')?.role).toBe('ATHLETE');
    expect(issued.account).not.toHaveProperty('passwordHash');
    expect(issued).not.toHaveProperty('role');
    expect(issued).toHaveProperty('refreshToken');
  });

  it('normalizes email before account creation and signs in immediately', async () => {
    const { service, repository } = createHarness();
    const issued = await service.register(
      ' User@Example.com ',
      'very-long-password',
      '127.0.0.1',
    );
    expect(issued.accessToken).toEqual(expect.any(String));
    expect(repository.accounts.has('user@example.com')).toBe(true);
    expect(repository.sessions.size).toBe(1);
  });

  it('uses a 15 minute access token lifetime', async () => {
    const { service, config } = createHarness();
    const issued = await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    const claims = decode(issued.accessToken);
    expect(claims).not.toBeNull();
    if (typeof claims === 'object' && claims !== null) {
      expect(claims.exp! - claims.iat!).toBe(900);
    }
    expect(config.accessTokenTtlSeconds).toBe(900);
  });

  it('logs in with correct credentials and does not disclose account existence on failure', async () => {
    const { service } = createHarness();
    await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    await expect(
      service.login('USER@example.com', 'very-long-password', '127.0.0.1'),
    ).resolves.toHaveProperty('accessToken');
    await expect(
      service.login('user@example.com', 'incorrect-password', '127.0.0.1'),
    ).rejects.toThrow('Invalid email or password.');
    await expect(
      service.login('missing@example.com', 'incorrect-password', '127.0.0.1'),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('rejects suspended accounts', async () => {
    const { service, repository } = createHarness();
    await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    const account = repository.accounts.get('user@example.com');
    if (!account) throw new Error('Test account was not created.');
    account.status = 'SUSPENDED';
    await expect(
      service.login('user@example.com', 'very-long-password', '127.0.0.1'),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('limits login attempts per client IP even when the email changes', async () => {
    const { service } = createHarness();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        service.login(
          `missing${attempt}@example.com`,
          'wrong-password',
          '127.0.0.8',
        ),
      ).rejects.toThrow('Invalid email or password.');
    }
    await expect(
      service.login('another@example.com', 'wrong-password', '127.0.0.8'),
    ).rejects.toThrow('Too many authentication attempts.');
  });

  it('rotates refresh tokens, changes the hash, and caps idle expiry at the absolute deadline', async () => {
    const { service, repository, config } = createHarness();
    const initial = await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    const initialHash = hashRefreshToken(
      initial.refreshToken,
      config.refreshTokenPepper,
    );
    const session = [...repository.sessions.values()][0];
    if (!session) throw new Error('Test session was not created.');
    session.absoluteExpiresAt = new Date(Date.now() + 60_000);
    const rotated = await service.refresh(initial.refreshToken);

    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(repository.consumedHashes.get(initialHash)).toBe(session.id);
    expect(session.currentHash).toBe(
      hashRefreshToken(rotated.refreshToken, config.refreshTokenPepper),
    );
    expect(rotated.refreshExpiresAt.getTime()).toBeLessThanOrEqual(
      session.absoluteExpiresAt.getTime(),
    );
    expect(rotated.accessToken).not.toBe(initial.accessToken);
  });

  it('revokes only the reused token family and preserves independent device sessions', async () => {
    const { service, repository } = createHarness();
    const firstDevice = await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    const secondDevice = await service.login(
      'user@example.com',
      'very-long-password',
      '127.0.0.2',
    );
    const sessions = [...repository.sessions.values()];
    const first = sessions[0];
    const second = sessions[1];
    if (!first || !second) throw new Error('Expected independent sessions.');
    await service.refresh(firstDevice.refreshToken);

    await expect(
      service.refresh(firstDevice.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(first.revokedAt).not.toBeNull();
    expect(second.revokedAt).toBeNull();
    await expect(
      service.refresh(secondDevice.refreshToken),
    ).resolves.toHaveProperty('refreshToken');
  });

  it.each(['expired idle', 'absolute expiry'])(
    'rejects refresh after %s',
    async (expiryKind) => {
      const { service, repository } = createHarness();
      const issued = await service.register(
        'user@example.com',
        'very-long-password',
        '127.0.0.1',
      );
      const session = [...repository.sessions.values()][0];
      if (!session) throw new Error('Test session was not created.');
      const expired = new Date(Date.now() - 1000);
      if (expiryKind === 'expired idle') session.expiresAt = expired;
      else session.absoluteExpiresAt = expired;
      await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(session.revokedAt).not.toBeNull();
    },
  );

  it('rejects revoked and unknown refresh tokens', async () => {
    const { service, repository } = createHarness();
    const issued = await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    const session = [...repository.sessions.values()][0];
    if (!session) throw new Error('Test session was not created.');
    session.revokedAt = new Date();
    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refresh('unknown-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('supports idempotent logout for current and all sessions', async () => {
    const { service, repository } = createHarness();
    const current = await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    const other = await service.login(
      'user@example.com',
      'very-long-password',
      '127.0.0.2',
    );
    await service.logout(current.refreshToken);
    await service.logout(current.refreshToken);
    expect([...repository.sessions.values()][0]?.revokedAt).not.toBeNull();
    expect([...repository.sessions.values()][1]?.revokedAt).toBeNull();

    const identity = await service.authenticate(other.accessToken);
    await service.logoutAll(identity);
    await service.logoutAll(identity);
    expect(
      [...repository.sessions.values()].every(
        (session) => session.revokedAt !== null,
      ),
    ).toBe(true);
    await expect(
      service.authenticate(other.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid access tokens and requires a live owner session for the current account', async () => {
    const { service } = createHarness();
    await expect(service.authenticate('not-a-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const issued = await service.register(
      'user@example.com',
      'very-long-password',
      '127.0.0.1',
    );
    const identity = await service.authenticate(issued.accessToken);
    expect(await service.getCurrentAccount(identity)).toEqual(issued.account);
    expect(identity.account).not.toHaveProperty('passwordHash');
  });
});
