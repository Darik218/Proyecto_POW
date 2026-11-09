import type { AuthAccountAttributes } from '../../models/auth/auth-account.model';
import type { IssuedSession } from '../../models/auth/auth-session.model';

export type AccountResponse = {
  id: string;
  email: string;
  status: AuthAccountAttributes['status'];
  createdAt: Date;
  updatedAt: Date;
};

export type AuthResponse = {
  user: AccountResponse;
  accessToken: string;
  accessTokenExpiresAt: Date;
  csrfToken: string;
};

// Public JSON allowlists only. Token issuance and HTTP cookies stay outside the view.
export class AuthPresenter {
  account(account: AuthAccountAttributes): AccountResponse {
    return {
      id: account.id,
      email: account.email,
      status: account.status,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  session(session: IssuedSession): AuthResponse {
    return {
      user: this.account(session.account),
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      csrfToken: session.csrfToken,
    };
  }
}
