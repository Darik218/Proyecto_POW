import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../../src/auth/auth.module';
import { AthletesModule } from '../../src/athletes/athletes.module';
import { ExercisesModule } from '../../src/exercises/exercises.module';
import { TrainingPlansModule } from '../../src/training-plans/training-plans.module';
import { WorkoutSessionsModule } from '../../src/workout-sessions/workout-sessions.module';
import { PrismaService } from '../../src/database/prisma.service';

export const isolated = process.env.MVC6_TEST_DATABASE_URL
  ? describe
  : describe.skip;
export const origin = 'http://localhost:5173';
export type Actor = {
  token: string;
  id: string;
  athleteId: string;
  csrf: string;
  cookie: string;
};

// All five functional modules, native guards and real persistence. No provider overrides.
export async function mvcHarness() {
  const url = process.env.MVC6_TEST_DATABASE_URL;
  const directory = process.env.MVC6_TEST_DATA_DIRECTORY;
  const target = new URL(url ?? 'http://invalid');
  if (
    !url ||
    url !== process.env.DATABASE_URL ||
    target.hostname !== '127.0.0.1' ||
    !target.port ||
    target.pathname !== '/pulso_mvc6_test' ||
    !directory?.startsWith('/tmp/pulso-mvc6-') ||
    !directory.endsWith('/data')
  ) {
    throw new Error('MVC-6 refuses a non-isolated database.');
  }
  const module = await Test.createTestingModule({
    imports: [
      AuthModule,
      AthletesModule,
      ExercisesModule,
      TrainingPlansModule,
      WorkoutSessionsModule,
    ],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  const [actual] = await prisma.$queryRaw<
    { database: string; directory: string }[]
  >`
    SELECT current_database() AS database, current_setting('data_directory') AS directory`;
  if (
    actual?.database !== 'pulso_mvc6_test' ||
    (await realpath(actual.directory)) !== (await realpath(directory))
  ) {
    await app.close();
    throw new Error('MVC-6 connected cluster identity mismatch.');
  }
  const http = () => request(app.getHttpServer());
  const get = (path: string, actor?: Actor) => {
    const result = http().get('/api/v1' + path);
    return actor
      ? result.set('Authorization', `Bearer ${actor.token}`)
      : result;
  };
  const send = (
    method: 'post' | 'patch' | 'delete',
    path: string,
    body: object,
    actor: Actor,
  ) =>
    http()
      [method]('/api/v1' + path)
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);
  async function actor(): Promise<Actor> {
    const response = await http()
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        email: `mvc6-${randomUUID()}@example.test`,
        password: 'mvc6-fixture-password-123',
      })
      .expect(201);
    const profile = await get('/athletes/me', {
      token: response.body.accessToken,
    } as Actor).expect(200);
    return {
      token: response.body.accessToken as string,
      id: response.body.user.id as string,
      athleteId: profile.body.id as string,
      csrf: response.body.csrfToken as string,
      cookie: (response.headers['set-cookie'] as unknown as string[])
        .find((value) => value.startsWith('pow_refresh='))!
        .split(';')[0]!,
    };
  }
  async function group() {
    const key = 'mvc6-' + randomUUID();
    return prisma.muscleGroup.create({
      data: { key, name: key, description: null },
    });
  }
  return { app, prisma, http, get, send, actor, group };
}
export type MvcHarness = Awaited<ReturnType<typeof mvcHarness>>;

export async function vueHttp(
  app: INestApplication,
  code: string,
  input: object = {},
) {
  if (!app.getHttpServer().listening) await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return new Promise<string>((accept, reject) => {
    const child = execFile(
      process.execPath,
      [
        '--experimental-strip-types',
        '--experimental-loader',
        './tests/typescript-loader.mjs',
        '--input-type=module',
        '-e',
        // Axios errors include credentials in config/headers; never dump them from a child.
        `process.on('uncaughtException', error => {
          console.error('Vue HTTP check failed: ' + error.name + ' status=' + (error.response?.status ?? 'none'));
          process.exit(1);
        });\n` + code,
      ],
      { cwd: resolve(process.cwd(), '../frontend'), timeout: 15000 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error('Vue HTTP verification failed: ' + stderr))
          : accept(stdout),
    );
    child.stdin?.end(
      JSON.stringify({
        baseURL: `http://127.0.0.1:${address.port}/api/v1`,
        ...input,
      }),
    );
  });
}
