export type PublicAccount = {
  id: string;
  email: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
};

export type StoredAccount = PublicAccount & {
  passwordHash: string;
  role: 'ATHLETE' | 'ADMIN';
};

export type SessionContext = {
  id: string;
  userId: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  user: PublicAccount;
};

export type IssuedSession = {
  account: PublicAccount;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
  csrfToken: string;
};

export type RefreshOutcome =
  | {
      kind: 'rotated';
      account: PublicAccount;
      sessionId: string;
      refreshExpiresAt: Date;
    }
  | { kind: 'invalid' | 'expired' | 'inactive' | 'reused' };

export type AuthenticatedIdentity = {
  account: PublicAccount;
  sessionId: string;
};

export type AccessTokenClaims = {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
};
