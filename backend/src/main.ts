import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule, ObserveInstrument } from './app.module';
import { AuthConfig } from './auth/auth.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });
  const authConfig = app.get(AuthConfig);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [...authConfig.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-CSRF-Token',
      'X-Request-Id',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }),
  );
  const production = process.env.NODE_ENV === 'production';
  if (production) {
    const frontend = resolve(__dirname, '../../frontend/dist');
    const index = resolve(frontend, 'index.html');
    accessSync(index, constants.R_OK);
    if (process.env.RENDER === 'true') {
      app.set('trust proxy', 1);
    }
    app.useStaticAssets(frontend, { index: false });
    app.use((request: Request, response: Response, next: NextFunction) => {
      const isRead = request.method === 'GET' || request.method === 'HEAD';
      const isSpaRoute = /^\/(?:$|(?:login|register)\/?$|app(?:\/|$))/.test(
        request.path,
      );
      if (!isRead || !isSpaRoute || !request.accepts('html')) {
        next();
        return;
      }
      response.set('Cache-Control', 'no-cache').sendFile(index, (error) => {
        if (error) next(error);
      });
    });
  }
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3000;
  if (production) await app.listen(port, '0.0.0.0');
  else await app.listen(port);
}
void bootstrap();
