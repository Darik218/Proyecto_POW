import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthConfig } from '../auth.config';

@Injectable()
export class AuthOriginGuard implements CanActivate {
  constructor(private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { origin?: string } }>();
    const origin = request.headers.origin;
    if (!origin || !this.config.allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Origin is not allowed.');
    }
    return true;
  }
}
