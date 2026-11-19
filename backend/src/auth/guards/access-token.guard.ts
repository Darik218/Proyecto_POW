import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { AuthRequest } from './auth-request';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required.');
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (!token || token.includes(' '))
      throw new UnauthorizedException('Authentication required.');
    request.authIdentity = await this.authService.authenticate(token);
    return true;
  }
}
