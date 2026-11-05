import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedIdentity } from '../auth.types';
import { AuthRequest } from '../guards/auth-request';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedIdentity => {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.authIdentity)
      throw new Error(
        'AccessTokenGuard did not set the authenticated identity.',
      );
    return request.authIdentity;
  },
);
