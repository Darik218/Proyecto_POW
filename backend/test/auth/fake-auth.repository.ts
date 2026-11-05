import {
  AuthRepository,
  NewAccount,
  NewSession,
  RotateSession,
} from '../../src/auth/auth.repository';
import {
  PublicAccount,
  RefreshOutcome,
  SessionContext,
  StoredAccount,
} from '../../src/auth/auth.types';
import { DuplicateEmailError } from '../../src/auth/services/errors';

type FakeSession = {
  id: string;
  userId: string;
  familyId: string;
  currentHash: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
};

function publicAccount(account: StoredAccount): PublicAccount {
  return {
    id: account.id,
    email: account.email,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export class FakeAuthRepository implements AuthRepository {
  readonly accounts = new Map<string, StoredAccount>();
  readonly sessions = new Map<string, FakeSession>();
  readonly consumedHashes = new Map<string, string>();
  private nextId = 1;

  async createAccount(input: NewAccount): Promise<StoredAccount> {
    if (this.accounts.has(input.email)) throw new DuplicateEmailError();
    const now = new Date();
    const account: StoredAccount = {
      id: `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`,
      email: input.email,
      passwordHash: input.passwordHash,
      role: 'ATHLETE',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(account.email, account);
    return account;
  }

  async findAccountByEmail(email: string): Promise<StoredAccount | null> {
    return this.accounts.get(email) ?? null;
  }

  async createSession(input: NewSession): Promise<{ id: string }> {
    const id = `10000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
    this.sessions.set(id, {
      id,
      userId: input.userId,
      familyId: input.tokenFamilyId,
      currentHash: input.refreshTokenHash,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      revokedAt: null,
    });
    return { id };
  }

  async rotateRefreshToken(input: RotateSession): Promise<RefreshOutcome> {
    const session = [...this.sessions.values()].find(
      (item) => item.currentHash === input.previousHash,
    );
    if (!session) {
      const consumedSessionId = this.consumedHashes.get(input.previousHash);
      if (!consumedSessionId) return { kind: 'invalid' };
      const reused = this.sessions.get(consumedSessionId);
      if (reused?.revokedAt === null)
        this.revokeFamily(reused.familyId, input.now);
      return { kind: 'reused' };
    }
    if (session.revokedAt) return { kind: 'invalid' };
    if (
      session.expiresAt <= input.now ||
      session.absoluteExpiresAt <= input.now
    ) {
      session.revokedAt = input.now;
      return { kind: 'expired' };
    }
    const account = [...this.accounts.values()].find(
      (item) => item.id === session.userId,
    );
    if (!account || account.status !== 'ACTIVE') {
      this.revokeFamily(session.familyId, input.now);
      return { kind: 'inactive' };
    }
    this.consumedHashes.set(input.previousHash, session.id);
    session.currentHash = input.nextHash;
    session.expiresAt = new Date(
      Math.min(
        input.nextIdleExpiry.getTime(),
        session.absoluteExpiresAt.getTime(),
      ),
    );
    return {
      kind: 'rotated',
      account: publicAccount(account),
      sessionId: session.id,
      refreshExpiresAt: session.expiresAt,
    };
  }

  async findActiveSession(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<SessionContext | null> {
    const session = this.sessions.get(sessionId);
    const account = [...this.accounts.values()].find(
      (item) => item.id === userId,
    );
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      !account ||
      account.status !== 'ACTIVE'
    )
      return null;
    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      revokedAt: session.revokedAt,
      user: publicAccount(account),
    };
  }

  async revokeByRefreshHash(tokenHash: string, now: Date): Promise<void> {
    const current = [...this.sessions.values()].find(
      (item) => item.currentHash === tokenHash,
    );
    const sessionId = current?.id ?? this.consumedHashes.get(tokenHash);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session) this.revokeFamily(session.familyId, now);
  }

  async revokeSession(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.userId === userId && !session.revokedAt)
      session.revokedAt = now;
  }

  async revokeAllSessions(userId: string, now: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt)
        session.revokedAt = now;
    }
  }

  revokeFamily(familyId: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId && !session.revokedAt)
        session.revokedAt = now;
    }
  }
}
