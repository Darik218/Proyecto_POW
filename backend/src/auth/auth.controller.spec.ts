import type { Request, Response } from 'express';
import { jest } from '@jest/globals';
import { AuthConfig } from './auth.config';
import { AuthService } from './services/auth.service';
import { AuthController } from './auth.controller';

describe('AuthController cookie and response boundaries', () => {
  it('sets a secure HttpOnly refresh cookie and never returns its value in JSON', async () => {
    const config = new AuthConfig({
      AUTH_ACCESS_TOKEN_SECRET: 'a'.repeat(48),
      AUTH_REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
      CORS_ORIGINS: 'https://app.example.test',
      AUTH_COOKIE_SECURE: 'true',
    });
    const issued = {
      account: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'user@example.com',
        status: 'ACTIVE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      accessToken: 'access-secret-value',
      accessTokenExpiresAt: new Date(Date.now() + 900_000),
      refreshToken: 'refresh-secret-value',
      refreshExpiresAt: new Date(Date.now() + 60_000),
      csrfToken: 'csrf-public-value',
    };
    const authService = {
      login: jest.fn().mockResolvedValue(issued),
    } as unknown as AuthService;
    const controller = new AuthController(authService, config);
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;
    const body = await controller.login(
      { email: 'user@example.com', password: 'unused-password' },
      { ip: '127.0.0.1' } as Request,
      response,
    );

    expect(body).not.toHaveProperty('refreshToken');
    expect(body).not.toHaveProperty('passwordHash');
    expect(body.accessToken).toBe('access-secret-value');
    expect(cookie).toHaveBeenCalledTimes(2);
    expect(cookie).toHaveBeenCalledWith(
      'pow_refresh',
      'refresh-secret-value',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/v1/auth',
      }),
    );
    expect(cookie).toHaveBeenCalledWith(
      'pow_csrf',
      'csrf-public-value',
      expect.objectContaining({
        httpOnly: false,
        secure: true,
        sameSite: 'strict',
      }),
    );
  });
});
