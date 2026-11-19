import type { AuthAccountAttributes } from './auth-account.model';

// Correlation only: this cannot authenticate a request or rotate a token.
export type BrowserSessionContext = { contextId: string; csrfToken: string };

// Internal application contracts. Credential/session material is never a public view.
export type PublicAccount = AuthAccountAttributes;

export type StoredAccount = AuthAccountAttributes & {
  passwordHash: string;
  role: 'ATHLETE' | 'ADMIN';
};

export type SessionContext = {
  id: string;
  userId: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  user: AuthAccountAttributes;
};

export type IssuedSession = {
  account: AuthAccountAttributes;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
  csrfToken: string;
};

export type RefreshOutcome =
  | {
      kind: 'rotated';
      account: AuthAccountAttributes;
      sessionId: string;
      refreshExpiresAt: Date;
    }
  | { kind: 'invalid' | 'expired' | 'inactive' | 'reused' };

export type AuthenticatedIdentity = {
  account: AuthAccountAttributes;
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
