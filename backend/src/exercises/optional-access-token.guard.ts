import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthRequest } from '../auth/guards/auth-request';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';

@Injectable()
export class OptionalAccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokenGuard: AccessTokenGuard) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (request.headers.authorization === undefined) return true;
    return this.accessTokenGuard.canActivate(context);
  }
}
