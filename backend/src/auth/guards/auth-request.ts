import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth.types';

export type AuthRequest = Request & { authIdentity?: AuthenticatedIdentity };
