import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import { AuthConfig } from '../auth.config';
import { AuthenticatedIdentity } from '../auth.types';
import { AuthService } from '../services/auth.service';
import { AuthOriginGuard } from './auth-origin.guard';
import { AuthRequest } from './auth-request';
import { AccessTokenGuard } from './access-token.guard';
import { CsrfGuard } from './csrf.guard';

const config = new AuthConfig({
  AUTH_ACCESS_TOKEN_SECRET: 'a'.repeat(48),
  AUTH_REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
  CORS_ORIGINS: 'https://app.example.test',
});

function contextFor(request: AuthRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('authentication guards', () => {
  it('rejects /auth/me without a bearer access token', async () => {
    const guard = new AccessTokenGuard({
      authenticate: jest.fn(),
    } as unknown as AuthService);
    const request = { headers: {} } as AuthRequest;
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('validates bearer identity and attaches only the authenticated identity to the request', async () => {
    const identity: AuthenticatedIdentity = {
      account: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'user@example.com',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sessionId: '10000000-0000-4000-8000-000000000001',
    };
    const authenticate = jest.fn().mockResolvedValue(identity);
    const guard = new AccessTokenGuard({
      authenticate,
    } as unknown as AuthService);
    const request = {
      headers: { authorization: 'Bearer access-token' },
    } as AuthRequest;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('access-token');
    expect(request.authIdentity).toEqual(identity);
  });

  it('requires matching CSRF cookie/header and an explicitly allowed Origin', () => {
    const guard = new CsrfGuard(config);
    const valid = {
      headers: {
        origin: 'https://app.example.test',
        'x-csrf-token': 'random-csrf-value-which-is-long-enough',
        cookie: 'pow_csrf=random-csrf-value-which-is-long-enough',
      },
    } as AuthRequest;
    expect(guard.canActivate(contextFor(valid))).toBe(true);

    const missingHeader = {
      headers: {
        origin: 'https://app.example.test',
        cookie: valid.headers.cookie,
      },
    } as AuthRequest;
    expect(() => guard.canActivate(contextFor(missingHeader))).toThrow(
      ForbiddenException,
    );

    const foreignOrigin = {
      headers: {
        ...valid.headers,
        origin: 'https://attacker.example.test',
      },
    } as AuthRequest;
    expect(() => guard.canActivate(contextFor(foreignOrigin))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects missing and foreign origins on registration and login', () => {
    const guard = new AuthOriginGuard(config);
    expect(() => guard.canActivate(contextFor({ headers: {} } as AuthRequest))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      guard.canActivate(
        contextFor({ headers: { origin: 'https://attacker.example.test' } } as AuthRequest),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        contextFor({ headers: { origin: 'https://app.example.test' } } as AuthRequest),
      ),
    ).toBe(true);
  });
});
