// Credential-free account identity used by authentication and its consumers.
// It is independent from the User persistence record and the HTTP representation.
export type AuthAccountAttributes = {
  id: string;
  email: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
};

export class AuthAccount implements AuthAccountAttributes {
  id: string;
  email: string;
  status: AuthAccountAttributes['status'];
  createdAt: Date;
  updatedAt: Date;

  constructor(account: AuthAccountAttributes) {
    this.id = account.id;
    this.email = account.email;
    this.status = account.status;
    this.createdAt = account.createdAt;
    this.updatedAt = account.updatedAt;
  }
}
