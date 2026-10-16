import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DuplicateEmailError } from './services/errors';
import {
  AuthRepository,
  NewAccount,
  NewSession,
  RotateSession,
} from './auth.repository';
import {
  PublicAccount,
  RefreshOutcome,
  SessionContext,
  StoredAccount,
} from './auth.types';

type LockedSession = {
  id: string;
  userId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  lastUsedAt: Date;
  generation: number;
  revokedAt: Date | null;
};

function toPublicAccount(account: {
  id: string;
  email: string;
  status: PublicAccount['status'];
  createdAt: Date;
  updatedAt: Date;
}): PublicAccount {
  return {
    id: account.id,
    email: account.email,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function toStoredAccount(account: {
  id: string;
  email: string;
  passwordHash: string;
  role: StoredAccount['role'];
  status: StoredAccount['status'];
  createdAt: Date;
  updatedAt: Date;
}): StoredAccount {
  return {
    ...toPublicAccount(account),
    passwordHash: account.passwordHash,
    role: account.role,
  };
}

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAccount(input: NewAccount): Promise<StoredAccount> {
    try {
      const account = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          role: 'ATHLETE',
          athlete: { create: {} },
        },
      });
      return toStoredAccount(account);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  async findAccountByEmail(email: string): Promise<StoredAccount | null> {
    const account = await this.prisma.user.findUnique({ where: { email } });
    return account ? toStoredAccount(account) : null;
  }

  async createSession(input: NewSession): Promise<{ id: string }> {
    const session = await this.prisma.authSession.create({
      data: {
        userId: input.userId,
        tokenFamilyId: input.tokenFamilyId,
        refreshTokenHash: input.refreshTokenHash,
        createdAt: input.createdAt,
        lastUsedAt: input.createdAt,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      },
      select: { id: true },
    });
    return session;
  }

  async rotateRefreshToken(input: RotateSession): Promise<RefreshOutcome> {
    return this.prisma.$transaction(
      async (tx): Promise<RefreshOutcome> => {
        // READ COMMITTED plus this row lock serializes refreshes for one session.
        // A waiting request rechecks the old-hash predicate after the winner commits,
        // then finds that hash in auth_session_tokens and revokes this family.
        const currentRows = await tx.$queryRaw<LockedSession[]>`
          SELECT id,
                 user_id AS "userId",
                 token_family_id AS "tokenFamilyId",
                 refresh_token_hash AS "refreshTokenHash",
                 created_at AS "createdAt",
                 expires_at AS "expiresAt",
                 absolute_expires_at AS "absoluteExpiresAt",
                 last_used_at AS "lastUsedAt",
                 generation,
                 revoked_at AS "revokedAt"
          FROM auth_sessions
          WHERE refresh_token_hash = ${input.previousHash}
          FOR UPDATE
        `;
        const current = currentRows[0];

        if (!current) {
          const consumed = await tx.authSessionToken.findUnique({
            where: { tokenHash: input.previousHash },
            select: { sessionId: true },
          });
          if (!consumed) return { kind: 'invalid' };

          const lockedRows = await tx.$queryRaw<LockedSession[]>`
            SELECT id,
                   user_id AS "userId",
                   token_family_id AS "tokenFamilyId",
                   refresh_token_hash AS "refreshTokenHash",
                   created_at AS "createdAt",
                   expires_at AS "expiresAt",
                   absolute_expires_at AS "absoluteExpiresAt",
                   last_used_at AS "lastUsedAt",
                   generation,
                   revoked_at AS "revokedAt"
            FROM auth_sessions
            WHERE id = ${consumed.sessionId}::uuid
            FOR UPDATE
          `;
          const reusedSession = lockedRows[0];
          if (reusedSession && reusedSession.revokedAt === null) {
            await tx.authSession.updateMany({
              where: {
                tokenFamilyId: reusedSession.tokenFamilyId,
                revokedAt: null,
              },
              data: { revokedAt: input.now },
            });
          }
          return { kind: 'reused' };
        }

        if (current.revokedAt !== null) return { kind: 'invalid' };
        if (
          current.expiresAt <= input.now ||
          current.absoluteExpiresAt <= input.now
        ) {
          await tx.authSession.updateMany({
            where: { id: current.id, revokedAt: null },
            data: { revokedAt: input.now },
          });
          return { kind: 'expired' };
        }

        const account = await tx.user.findUnique({
          where: { id: current.userId },
        });
        if (!account || account.status !== 'ACTIVE') {
          await tx.authSession.updateMany({
            where: { tokenFamilyId: current.tokenFamilyId, revokedAt: null },
            data: { revokedAt: input.now },
          });
          return { kind: 'inactive' };
        }

        await tx.authSessionToken.create({
          data: {
            sessionId: current.id,
            tokenHash: input.previousHash,
            generation: current.generation,
            createdAt: current.lastUsedAt,
            consumedAt: input.now,
          },
        });
        await tx.authSession.update({
          where: { id: current.id },
          data: {
            refreshTokenHash: input.nextHash,
            generation: { increment: 1 },
            lastUsedAt: input.now,
            expiresAt: new Date(
              Math.min(
                input.nextIdleExpiry.getTime(),
                current.absoluteExpiresAt.getTime(),
              ),
            ),
          },
        });

        return {
          kind: 'rotated',
          account: toPublicAccount(account),
          sessionId: current.id,
          refreshExpiresAt: new Date(
            Math.min(
              input.nextIdleExpiry.getTime(),
              current.absoluteExpiresAt.getTime(),
            ),
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async findActiveSession(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<SessionContext | null> {
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!session) return null;
    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      revokedAt: session.revokedAt,
      user: toPublicAccount(session.user),
    };
  }

  async revokeByRefreshHash(tokenHash: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const currentRows = await tx.$queryRaw<LockedSession[]>`
        SELECT id,
               user_id AS "userId",
               token_family_id AS "tokenFamilyId",
               refresh_token_hash AS "refreshTokenHash",
               created_at AS "createdAt",
               expires_at AS "expiresAt",
               absolute_expires_at AS "absoluteExpiresAt",
               last_used_at AS "lastUsedAt",
               generation,
               revoked_at AS "revokedAt"
        FROM auth_sessions
        WHERE refresh_token_hash = ${tokenHash}
        FOR UPDATE
      `;
      const current = currentRows[0];
      if (current) {
        await tx.authSession.updateMany({
          where: { tokenFamilyId: current.tokenFamilyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return;
      }

      const consumed = await tx.authSessionToken.findUnique({
        where: { tokenHash },
        select: { sessionId: true },
      });
      if (!consumed) return;
      const lockedRows = await tx.$queryRaw<LockedSession[]>`
        SELECT id,
               user_id AS "userId",
               token_family_id AS "tokenFamilyId",
               refresh_token_hash AS "refreshTokenHash",
               created_at AS "createdAt",
               expires_at AS "expiresAt",
               absolute_expires_at AS "absoluteExpiresAt",
               last_used_at AS "lastUsedAt",
               generation,
               revoked_at AS "revokedAt"
        FROM auth_sessions
        WHERE id = ${consumed.sessionId}::uuid
        FOR UPDATE
      `;
      const session = lockedRows[0];
      if (session) {
        await tx.authSession.updateMany({
          where: { tokenFamilyId: session.tokenFamilyId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
    });
  }

  async revokeSession(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAllSessions(userId: string, now: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
