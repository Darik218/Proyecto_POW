import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthConfig } from '../../auth/auth.config';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { LoginDto } from '../../auth/dto/login.dto';
import { RegisterDto } from '../../auth/dto/register.dto';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthOriginGuard } from '../../auth/guards/auth-origin.guard';
import { CsrfGuard } from '../../auth/guards/csrf.guard';
import type {
  AuthenticatedIdentity,
  IssuedSession,
} from '../../auth/auth.types';
import {
  clearAuthCookies,
  readCookie,
  setAuthCookies,
} from '../../auth/security/cookie.utils';
import { AuthService } from '../../auth/services/auth.service';
import { AuthPresenter } from '../../views/auth/auth.presenter';
import type { AuthResponse } from '../../views/auth/auth.presenter';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AuthConfig,
    private readonly presenter: AuthPresenter,
  ) {}

  @Post('register')
  @UseGuards(AuthOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.authService.register(
      body.email,
      body.password,
      request.ip ?? 'unknown',
    );
    return this.completeLogin(session, response);
  }

  @Post('login')
  @UseGuards(AuthOriginGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.authService.login(
      body.email,
      body.password,
      request.ip ?? 'unknown',
    );
    return this.completeLogin(session, response);
  }

  @Post('refresh')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const refreshToken = readCookie(request, this.config.refreshCookieName);
    if (!refreshToken)
      throw new UnauthorizedException('Refresh session is invalid.');
    const session = await this.authService.refresh(refreshToken);
    return this.completeLogin(session, response);
  }

  @Post('logout')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(
      readCookie(request, this.config.refreshCookieName),
    );
    clearAuthCookies(response, this.config);
  }

  @Post('logout-all')
  @UseGuards(AccessTokenGuard, CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logoutAll(identity);
    clearAuthCookies(response, this.config);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async getMe(@CurrentAuth() identity: AuthenticatedIdentity) {
    return this.presenter.account(
      await this.authService.getCurrentAccount(identity),
    );
  }

  private completeLogin(
    session: IssuedSession,
    response: Response,
  ): AuthResponse {
    setAuthCookies(
      response,
      this.config,
      session.refreshToken,
      session.csrfToken,
      session.refreshExpiresAt,
    );
    return this.presenter.session(session);
  }
}
