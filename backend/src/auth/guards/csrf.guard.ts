import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthConfig } from '../auth.config';
import { constantTimeEqual, readCookie } from '../security/cookie.utils';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    const headerToken = request.headers['x-csrf-token'];
    const cookieToken = readCookie(request, this.config.csrfCookieName);

    if (
      !origin ||
      !this.config.allowedOrigins.includes(origin) ||
      typeof headerToken !== 'string' ||
      !cookieToken ||
      !constantTimeEqual(headerToken, cookieToken)
    ) {
      throw new ForbiddenException('CSRF validation failed.');
    }
    return true;
  }
}
