import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sign, verify, JwtPayload } from 'jsonwebtoken';
import { AuthConfig } from '../auth.config';
import { AUTH_REPOSITORY } from '../auth.repository';
import type { AuthRepository } from '../auth.repository';
import {
  AuthenticatedIdentity,
  IssuedSession,
  PublicAccount,
} from '../auth.types';
import { AuthRateLimiter } from '../security/auth-rate-limiter';
import { createOpaqueToken, hashRefreshToken } from '../security/cookie.utils';
import { PasswordHasher } from '../security/password-hasher';
import { DuplicateEmailError } from './errors';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthResponse = {
  user: PublicAccount;
  accessToken: string;
  accessTokenExpiresAt: Date;
  csrfToken: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly rateLimiter: AuthRateLimiter,
    private readonly config: AuthConfig,
  ) {}

  async register(
    emailInput: string,
    password: string,
    ipAddress: string,
  ): Promise<IssuedSession> {
    const normalizedEmail = this.normalizeEmail(emailInput);
    const rateKey = this.rateKey('register', ipAddress);
    this.rateLimiter.consume(
      rateKey,
      this.config.registerAttemptLimit,
      this.config.registerAttemptWindowMs,
    );

    const passwordHash = await this.passwordHasher.hash(password);
    let account;
    try {
      account = await this.repository.createAccount({
        email: normalizedEmail,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        throw new ConflictException('Unable to create account.');
      }
      throw error;
    }
    return this.createSession(account);
  }

  async login(
    emailInput: string,
    password: string,
    ipAddress: string,
  ): Promise<IssuedSession> {
    const normalizedEmail = this.normalizeEmail(emailInput);
    const ipRateKey = this.rateKey('login-ip', ipAddress);
    const accountRateKey = this.rateKey('login-account', normalizedEmail);
    const rateKeys = [ipRateKey, accountRateKey];
    for (const key of rateKeys) {
      this.rateLimiter.consume(
        key,
        this.config.loginAttemptLimit,
        this.config.loginAttemptWindowMs,
      );
    }

    const account = await this.repository.findAccountByEmail(normalizedEmail);
    if (!account) {
      await this.passwordHasher.verifyUnknownAccount(password);
      throw new UnauthorizedException('Invalid email or password.');
    }
    const validPassword = await this.passwordHasher.verify(
      account.passwordHash,
      password,
    );
    if (!validPassword || account.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password.');
    }
    this.rateLimiter.reset(accountRateKey);
    return this.createSession(account);
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const now = new Date();
    const nextRefreshToken = createOpaqueToken();
    const outcome = await this.repository.rotateRefreshToken({
      previousHash: hashRefreshToken(
        refreshToken,
        this.config.refreshTokenPepper,
      ),
      nextHash: hashRefreshToken(
        nextRefreshToken,
        this.config.refreshTokenPepper,
      ),
      now,
      nextIdleExpiry: new Date(now.getTime() + this.config.idleTtlMs),
    });

    if (outcome.kind === 'reused') {
      this.logger.warn('AUTH_REFRESH_TOKEN_REUSE_DETECTED');
      throw new UnauthorizedException('Refresh session is invalid.');
    }
    if (outcome.kind !== 'rotated') {
      throw new UnauthorizedException('Refresh session is invalid.');
    }

    const accessTokenExpiresAt = new Date(
      now.getTime() + this.config.accessTokenTtlSeconds * 1000,
    );
    return {
      account: outcome.account,
      accessToken: this.signAccessToken(outcome.account.id, outcome.sessionId),
      accessTokenExpiresAt,
      refreshToken: nextRefreshToken,
      refreshExpiresAt: outcome.refreshExpiresAt,
      csrfToken: createOpaqueToken(),
    };
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (!refreshToken) return;
    await this.repository.revokeByRefreshHash(
      hashRefreshToken(refreshToken, this.config.refreshTokenPepper),
      new Date(),
    );
  }

  async logoutAll(identity: AuthenticatedIdentity): Promise<void> {
    await this.repository.revokeAllSessions(identity.account.id, new Date());
  }

  async authenticate(accessToken: string): Promise<AuthenticatedIdentity> {
    const now = new Date();
    let payload: string | JwtPayload;
    try {
      payload = verify(accessToken, this.config.accessTokenSecret, {
        algorithms: ['HS256'],
        audience: this.config.audience,
        issuer: this.config.issuer,
        clockTimestamp: Math.floor(now.getTime() / 1000),
      });
    } catch {
      throw new UnauthorizedException('Authentication required.');
    }

    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      !UUID_PATTERN.test(payload.sub) ||
      !UUID_PATTERN.test(payload.sid)
    ) {
      throw new UnauthorizedException('Authentication required.');
    }
    const session = await this.repository.findActiveSession(
      payload.sid,
      payload.sub,
      now,
    );
    if (!session) throw new UnauthorizedException('Authentication required.');
    return { account: session.user, sessionId: session.id };
  }

  async getCurrentAccount(
    identity: AuthenticatedIdentity,
  ): Promise<PublicAccount> {
    return identity.account;
  }

  private async createSession(account: {
    id: string;
    email: string;
    status: PublicAccount['status'];
    createdAt: Date;
    updatedAt: Date;
  }): Promise<IssuedSession> {
    const now = new Date();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.absoluteTtlMs,
    );
    const refreshExpiresAt = new Date(
      Math.min(
        now.getTime() + this.config.idleTtlMs,
        absoluteExpiresAt.getTime(),
      ),
    );
    const refreshToken = createOpaqueToken();
    const session = await this.repository.createSession({
      userId: account.id,
      tokenFamilyId: randomUUID(),
      refreshTokenHash: hashRefreshToken(
        refreshToken,
        this.config.refreshTokenPepper,
      ),
      createdAt: now,
      expiresAt: refreshExpiresAt,
      absoluteExpiresAt,
    });
    const accessTokenExpiresAt = new Date(
      now.getTime() + this.config.accessTokenTtlSeconds * 1000,
    );
    return {
      account: {
        id: account.id,
        email: account.email,
        status: account.status,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
      accessToken: this.signAccessToken(account.id, session.id),
      accessTokenExpiresAt,
      refreshToken,
      refreshExpiresAt,
      csrfToken: createOpaqueToken(),
    };
  }

  private signAccessToken(userId: string, sessionId: string): string {
    return sign({ sid: sessionId }, this.config.accessTokenSecret, {
      algorithm: 'HS256',
      audience: this.config.audience,
      expiresIn: this.config.accessTokenTtlSeconds,
      issuer: this.config.issuer,
      jwtid: randomUUID(),
      subject: userId,
    });
  }

  private normalizeEmail(email: string): string {
    return email.normalize('NFKC').trim().toLowerCase();
  }

  private rateKey(purpose: string, value: string): string {
    return createHash('sha256')
      .update(`${purpose}\u0000${value}`)
      .digest('hex');
  }
}
