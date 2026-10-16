import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AUTH_REPOSITORY } from './auth.repository';
import { AuthOriginGuard } from './guards/auth-origin.guard';
import { AccessTokenGuard } from './guards/access-token.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { PrismaAuthRepository } from './prisma-auth.repository';
import { AuthRateLimiter } from './security/auth-rate-limiter';
import { PasswordHasher } from './security/password-hasher';
import { AuthService } from './services/auth.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    { provide: AuthConfig, useFactory: () => new AuthConfig() },
    AuthService,
    PasswordHasher,
    AuthRateLimiter,
    AuthOriginGuard,
    AccessTokenGuard,
    CsrfGuard,
    { provide: AUTH_REPOSITORY, useClass: PrismaAuthRepository },
  ],
  exports: [AuthService, AccessTokenGuard],
})
export class AuthModule {}
