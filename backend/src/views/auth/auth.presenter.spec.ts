import { AuthPresenter } from './auth.presenter';

describe('AuthPresenter public contracts', () => {
  const presenter = new AuthPresenter();
  const account = {
    id: 'test-user-id',
    email: 'test@example.test',
    status: 'ACTIVE' as const,
    createdAt: new Date('2026-01-01T00:00:00.123Z'),
    updatedAt: new Date('2026-02-01T00:00:00.456Z'),
    passwordHash: 'test-only-hash',
    role: 'ADMIN',
    sessions: [{ refreshTokenHash: 'test-only-refresh-hash' }],
  };
  const expectedAccount = {
    id: 'test-user-id',
    email: 'test@example.test',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.123Z',
    updatedAt: '2026-02-01T00:00:00.456Z',
  };

  it('allowlists exactly the public /me fields, keeping timestamps and account status', () => {
    expect(JSON.parse(JSON.stringify(presenter.account(account)))).toEqual(
      expectedAccount,
    );
    expect(presenter.account({ ...account, status: 'CLOSED' }).status).toBe(
      'CLOSED',
    );
  });

  it('keeps access and public CSRF fields while excluding raw refresh and internal metadata', () => {
    const issued = {
      account,
      accessToken: 'test-only-access',
      csrfToken: 'test-public-csrf',
      accessTokenExpiresAt: new Date('2026-01-01T00:15:00.123Z'),
      refreshToken: 'test-only-refresh',
      refreshExpiresAt: new Date('2026-01-08T00:00:00.123Z'),
      sessionId: 'internal-session',
      refreshTokenHash: 'internal-hash',
    };
    const result = presenter.session(issued);
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      user: expectedAccount,
      accessToken: 'test-only-access',
      csrfToken: 'test-public-csrf',
      accessTokenExpiresAt: '2026-01-01T00:15:00.123Z',
    });
    expect(result.accessTokenExpiresAt).toBeInstanceOf(Date);
    expect(account).toHaveProperty('passwordHash', 'test-only-hash');
  });
});
