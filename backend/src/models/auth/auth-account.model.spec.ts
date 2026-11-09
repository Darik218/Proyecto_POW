import { AuthAccount } from './auth-account.model';

describe('AuthAccount identity boundary', () => {
  it('keeps identity, state and dates without carrying credential or session material', () => {
    const stored = {
      id: 'user-id',
      email: 'test@example.test',
      status: 'SUSPENDED' as const,
      createdAt: new Date('2026-01-01T00:00:00.123Z'),
      updatedAt: new Date('2026-02-01T00:00:00.456Z'),
      role: 'ADMIN',
      passwordHash: 'test-only-hash',
      sessions: [{ refreshTokenHash: 'test-only-token-hash' }],
    };
    const account = new AuthAccount(stored);
    expect(account).toEqual({
      id: 'user-id',
      email: 'test@example.test',
      status: 'SUSPENDED',
      createdAt: new Date('2026-01-01T00:00:00.123Z'),
      updatedAt: new Date('2026-02-01T00:00:00.456Z'),
    });
    expect(account.createdAt).toBe(stored.createdAt);
    expect(account.updatedAt).toBe(stored.updatedAt);
  });
});
