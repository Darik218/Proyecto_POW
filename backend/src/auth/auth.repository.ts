import { RefreshOutcome, SessionContext, StoredAccount } from './auth.types';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export type NewAccount = {
  email: string;
  passwordHash: string;
};

export type NewSession = {
  userId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
};

export type RotateSession = {
  previousHash: string;
  nextHash: string;
  now: Date;
  nextIdleExpiry: Date;
};

export interface AuthRepository {
  createAccount(input: NewAccount): Promise<StoredAccount>;
  findAccountByEmail(email: string): Promise<StoredAccount | null>;
  createSession(input: NewSession): Promise<{ id: string }>;
  rotateRefreshToken(input: RotateSession): Promise<RefreshOutcome>;
  findActiveSession(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<SessionContext | null>;
  revokeByRefreshHash(tokenHash: string, now: Date): Promise<void>;
  revokeSession(sessionId: string, userId: string, now: Date): Promise<void>;
  revokeAllSessions(userId: string, now: Date): Promise<void>;
}
