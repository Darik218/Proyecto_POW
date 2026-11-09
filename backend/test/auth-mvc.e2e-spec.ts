import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { decode, sign, verify, type JwtPayload } from 'jsonwebtoken';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthConfig } from '../src/auth/auth.config';
import { PrismaService } from '../src/database/prisma.service';
import { hashRefreshToken } from '../src/auth/security/cookie.utils';
import { jest } from '@jest/globals';
import { ModulesContainer } from '@nestjs/core';
import { AuthController } from '../src/controllers/auth/auth.controller';
import { AuthPresenter } from '../src/views/auth/auth.presenter';
import { AuthAccount } from '../src/models/auth/auth-account.model';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../src/auth/auth.repository';

type AuthBody = {
  user: {
    id: string;
    email: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  accessToken: string;
  accessTokenExpiresAt: string;
  csrfToken: string;
};
type Login = { body: AuthBody; cookie: string; email: string };
const PASSWORD = 'mvc5-test-only-password-123';
const ORIGIN = 'http://localhost:5173';
const isolated = process.env.MVC5_TEST_DATABASE_URL ? describe : describe.skip;

// Every write uses a fresh /tmp cluster created by run-auth-mvc-isolated.mjs.
// This suite never falls back to the development DATABASE_URL.
isolated('MVC-5 auth characterization with isolated PostgreSQL', () => {
  let app: INestApplication, prisma: PrismaService, config: AuthConfig;
  const run = randomUUID();
  const http = () => request(app.getHttpServer());
  const cookie = (response: request.Response, name = 'pow_refresh') => {
    const values = response.headers['set-cookie'] as unknown as string[];
    const match = values?.find((value) => value.startsWith(name + '='));
    if (!match) throw new Error('Expected test authentication cookie.');
    return match.split(';')[0]!;
  };
  const csrf = (auth: Login) =>
    `${auth.cookie}; pow_csrf=${auth.body.csrfToken}`;
  const sid = (auth: Login) =>
    (decode(auth.body.accessToken) as JwtPayload).sid as string;
  const refresh = (auth: Login) =>
    http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', auth.body.csrfToken)
      .set('Cookie', csrf(auth));
  const logout = (auth: Login) =>
    http()
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', auth.body.csrfToken)
      .set('Cookie', csrf(auth));
  const logoutAll = (auth: Login) =>
    http()
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${auth.body.accessToken}`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', auth.body.csrfToken)
      .set('Cookie', csrf(auth));
  const me = (token: string) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  const session = (auth: Login) =>
    prisma.authSession.findUniqueOrThrow({ where: { id: sid(auth) } });
  const hash = (auth: Login) =>
    hashRefreshToken(
      decodeURIComponent(auth.cookie.slice('pow_refresh='.length)),
      config.refreshTokenPepper,
    );
  const from = (response: request.Response, email: string): Login => ({
    body: response.body as AuthBody,
    cookie: cookie(response),
    email,
  });
  async function register() {
    const email = `mvc5-${run.slice(0, 12)}-${randomUUID()}@example.test`;
    const response = await http()
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ email, password: PASSWORD })
      .expect(201);
    return from(response, email);
  }
  async function login(auth: Login) {
    return from(
      await http()
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: auth.email, password: PASSWORD })
        .expect(200),
      auth.email,
    );
  }

  beforeEach(async () => {
    const url = process.env.MVC5_TEST_DATABASE_URL!;
    const target = new URL(url);
    const directory = process.env.MVC5_TEST_DATA_DIRECTORY;
    if (
      url !== process.env.DATABASE_URL ||
      target.hostname !== '127.0.0.1' ||
      target.pathname !== '/pulso_auth_mvc_test' ||
      !target.port ||
      !directory?.startsWith('/tmp/pulso-mvc5-') ||
      !directory.endsWith('/data')
    ) {
      throw new Error('MVC-5 refuses a non-isolated PostgreSQL target.');
    }
    const module = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    app = module.createNestApplication();
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
    prisma = app.get(PrismaService);
    config = app.get(AuthConfig);
    const [targetRow] = await prisma.$queryRaw<
      { database: string; directory: string }[]
    >`
      SELECT current_database() AS database, current_setting('data_directory') AS directory`;
    if (
      targetRow?.database !== 'pulso_auth_mvc_test' ||
      (await realpath(targetRow.directory)) !== (await realpath(directory))
    ) {
      throw new Error('MVC-5 PostgreSQL isolation verification failed.');
    }
  });
  afterEach(async () => {
    await app?.close();
  });

  it('registers the account and athlete atomically; preserves the exact JSON contract and 15-minute signed claims', async () => {
    const requestStartedAt = Date.now();
    const auth = await register();
    const requestFinishedAt = Date.now();
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: auth.body.user.id },
      include: { athlete: true },
    });
    expect(row.athlete?.userId).toBe(row.id);
    expect(row.passwordHash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(row.passwordHash.split('$')[3]?.split(',').sort()).toEqual([
      'm=19456',
      'p=1',
      't=2',
    ]);
    expect(auth.body.user).toEqual({
      id: row.id,
      email: row.email,
      status: 'ACTIVE',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    expect(Object.keys(auth.body).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'csrfToken',
      'user',
    ]);
    const claims = verify(auth.body.accessToken, config.accessTokenSecret, {
      algorithms: ['HS256'],
      issuer: 'proyecto-pow',
      audience: 'proyecto-pow-api',
    }) as JwtPayload;
    expect(claims.sub).toBe(row.id);
    expect(claims.sid).toBe((await session(auth)).id);
    expect(claims.exp! - claims.iat!).toBe(900);
    expect(claims.jti).toEqual(expect.any(String));
    expect(Object.keys(claims).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'sid',
      'sub',
    ]);
    // The response expiry uses the clock before createSession persistence; JWT iat
    // is sampled afterwards and rounded to seconds. A DB round-trip may cross a second.
    expect(Date.parse(auth.body.accessTokenExpiresAt)).toBeGreaterThanOrEqual(
      requestStartedAt + 900000,
    );
    expect(Date.parse(auth.body.accessTokenExpiresAt)).toBeLessThanOrEqual(
      requestFinishedAt + 900000,
    );
    expect((await me(auth.body.accessToken).expect(200)).body).toEqual(
      auth.body.user,
    );
    await http()
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ email: ' ' + auth.email.toUpperCase() + ' ', password: PASSWORD })
      .expect(409);
    expect(await prisma.user.count({ where: { email: row.email } })).toBe(1);
  });

  it('keeps cookies scoped, strict and HttpOnly only for refresh; logout clears exactly the same scope and no JSON', async () => {
    const auth = await register();
    const response = await http()
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: auth.email, password: PASSWORD })
      .expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2);
    for (const value of cookies) {
      expect(value).toContain('Path=/api/v1/auth;');
      expect(value).toContain('SameSite=Strict');
      expect(value).toMatch(/Expires=/);
      expect(value).not.toMatch(/; Secure|Domain=|Max-Age=/);
    }
    expect(cookies.find((value) => value.startsWith('pow_refresh='))).toContain(
      'HttpOnly',
    );
    expect(
      cookies.find((value) => value.startsWith('pow_csrf=')),
    ).not.toContain('HttpOnly');
    const active = from(response, auth.email);
    const result = await logout(active).expect(204);
    expect(result.text).toBe('');
    const cleared = result.headers['set-cookie'] as unknown as string[];
    expect(cleared).toHaveLength(2);
    for (const value of cleared)
      expect(value).toMatch(
        /Path=\/api\/v1\/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT/,
      );
    await logout(active).expect(204);
    await me(active.body.accessToken).expect(401);
  });

  it('keeps generic credential failures and rejects inactive accounts without changing other accounts', async () => {
    const auth = await register();
    for (const email of [auth.email, `missing-${randomUUID()}@example.test`]) {
      const result = await http()
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ email, password: 'incorrect-password' })
        .expect(401);
      expect(result.body).toEqual({
        message: 'Invalid email or password.',
        error: 'Unauthorized',
        statusCode: 401,
      });
      expect(result.headers['set-cookie']).toBeUndefined();
    }
    await prisma.user.update({
      where: { id: auth.body.user.id },
      data: { status: 'SUSPENDED' },
    });
    await me(auth.body.accessToken).expect(401);
    await http()
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: auth.email, password: PASSWORD })
      .expect(401);
    await refresh(auth).expect(401);
    expect((await session(auth)).revokedAt).not.toBeNull();
  });

  it('preserves origin, double-submit CSRF and whitelist validation without consuming the refresh on rejection', async () => {
    for (const path of ['register', 'login']) {
      await http()
        .post('/api/v1/auth/' + path)
        .send({})
        .expect(403);
      await http()
        .post('/api/v1/auth/' + path)
        .set('Origin', 'https://foreign.test')
        .send({})
        .expect(403);
      await http()
        .post('/api/v1/auth/' + path)
        .set('Origin', ORIGIN)
        .send({ email: 'not-an-email', password: '', userId: randomUUID() })
        .expect(400);
    }
    const auth = await register();
    for (const path of ['refresh', 'logout', 'logout-all']) {
      const base = () =>
        http()
          .post('/api/v1/auth/' + path)
          .set('Authorization', `Bearer ${auth.body.accessToken}`);
      await base().set('Origin', ORIGIN).set('Cookie', csrf(auth)).expect(403);
      await base()
        .set('Origin', ORIGIN)
        .set('Cookie', csrf(auth))
        .set('X-CSRF-Token', 'wrong')
        .expect(403);
      await base()
        .set('Origin', 'https://foreign.test')
        .set('Cookie', csrf(auth))
        .set('X-CSRF-Token', auth.body.csrfToken)
        .expect(403);
    }
    expect((await session(auth)).generation).toBe(0);
    expect((await session(auth)).revokedAt).toBeNull();
    await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `pow_csrf=${auth.body.csrfToken}`)
      .set('X-CSRF-Token', auth.body.csrfToken)
      .expect(401);
  });

  it('rejects absent, altered, expired and incompatible JWT claims even for a live session', async () => {
    const auth = await register();
    await http().get('/api/v1/auth/me').expect(401);
    await me('invalid').expect(401);
    const claims = {
      sub: auth.body.user.id,
      sid: sid(auth),
      iss: config.issuer,
      aud: config.audience,
    };
    for (const patch of [
      { exp: 1 },
      { aud: 'other' },
      { iss: 'other' },
      { sid: randomUUID() },
      { sub: randomUUID() },
      { sid: 'not-a-uuid' },
    ]) {
      const token = sign({ ...claims, ...patch }, config.accessTokenSecret, {
        algorithm: 'HS256',
      });
      await me(token).expect(401);
    }
    await me(
      sign(claims, 'not-the-test-signing-secret', { algorithm: 'HS256' }),
    ).expect(401);
    await me(
      sign(claims, config.accessTokenSecret, { algorithm: 'HS384' }),
    ).expect(401);
    await me(auth.body.accessToken).expect(200);
  });

  it('rotates once, stores only hashes and revokes the reused family while another device remains valid', async () => {
    const first = await register();
    const second = await login(first);
    expect(sid(second)).not.toBe(sid(first));
    expect((await session(second)).tokenFamilyId).not.toBe(
      (await session(first)).tokenFamilyId,
    );
    const rotated = from(await refresh(first).expect(200), first.email);
    expect(rotated.cookie).not.toBe(first.cookie);
    expect((await session(first)).refreshTokenHash).toBe(hash(rotated));
    const consumed = await prisma.authSessionToken.findUniqueOrThrow({
      where: { tokenHash: hash(first) },
    });
    expect(consumed.sessionId).toBe(sid(first));
    expect(consumed.generation).toBe(0);
    await refresh(first).expect(401);
    expect((await session(first)).revokedAt).not.toBeNull();
    await refresh(rotated).expect(401);
    await me(rotated.body.accessToken).expect(401);
    expect((await session(second)).revokedAt).toBeNull();
    await refresh(second).expect(200);
  });

  it.each(['idle', 'absolute'] as const)(
    'enforces %s expiry in both identity and rotation, revoking the expired session',
    async (kind) => {
      const auth = await register();
      const initial = await session(auth);
      expect(initial.expiresAt.getTime() - initial.createdAt.getTime()).toBe(
        7 * 86400000,
      );
      expect(
        initial.absoluteExpiresAt.getTime() - initial.createdAt.getTime(),
      ).toBe(30 * 86400000);
      await prisma.authSession.update({
        where: { id: sid(auth) },
        data: {
          createdAt: new Date(Date.now() - 40 * 86400000),
          ...(kind === 'idle'
            ? { expiresAt: new Date(Date.now() - 1000) }
            : { absoluteExpiresAt: new Date(Date.now() - 1000) }),
        },
      });
      await me(auth.body.accessToken).expect(401);
      await refresh(auth).expect(401);
      expect((await session(auth)).revokedAt).not.toBeNull();
    },
  );

  it('caps idle expiry at the absolute deadline without extending the absolute lifetime', async () => {
    const auth = await register();
    const deadline = new Date(Date.now() + 60000);
    await prisma.authSession.update({
      where: { id: sid(auth) },
      data: { absoluteExpiresAt: deadline },
    });
    const rotated = from(await refresh(auth).expect(200), auth.email);
    expect((await session(rotated)).expiresAt).toEqual(deadline);
    expect((await session(rotated)).absoluteExpiresAt).toEqual(deadline);
  });

  it('keeps logout and logout-all scoped to their owner, including concurrent refreshes and retries', async () => {
    const first = await register();
    const device = await login(first);
    const thirdDevice = await login(first);
    const other = await register();
    await logout(first).expect(204);
    expect((await session(device)).revokedAt).toBeNull();
    await refresh(first).expect(401);
    const responses = await Promise.all([refresh(device), logoutAll(device)]);
    expect([200, 401]).toContain(responses[0]!.status);
    expect(responses[1]!.status).toBe(204);
    expect((await session(device)).revokedAt).not.toBeNull();
    expect((await session(thirdDevice)).revokedAt).not.toBeNull();
    expect((await session(other)).revokedAt).toBeNull();
    await me(device.body.accessToken).expect(401);
    await refresh(device).expect(401);
    await me(other.body.accessToken).expect(200);
  });

  it('serializes competing refreshes: exactly one rotation, one reuse rejection and persistent family revocation', async () => {
    const auth = await register();
    const responses = await Promise.all([refresh(auth), refresh(auth)]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 401]);
    const current = await session(auth);
    expect(current.generation).toBe(1);
    expect(current.revokedAt).not.toBeNull();
    expect(
      await prisma.authSessionToken.count({ where: { sessionId: current.id } }),
    ).toBe(1);
    const winner = from(
      responses.find((response) => response.status === 200)!,
      auth.email,
    );
    await me(winner.body.accessToken).expect(401);
    await refresh(winner).expect(401);
  });

  it('serializes logout against rotation and never revives the logged-out session', async () => {
    const auth = await register();
    const results = await Promise.all([refresh(auth), logout(auth)]);
    expect([200, 401]).toContain(results[0]!.status);
    expect(results[1]!.status).toBe(204);
    expect((await session(auth)).revokedAt).not.toBeNull();
    if (results[0]!.status === 200)
      await refresh(from(results[0]!, auth.email)).expect(401);
    await me(auth.body.accessToken).expect(401);
  });

  it('rolls back the consumed token and generation when persistence fails midway through rotation', async () => {
    const first = await register();
    const other = await login(first);
    const before = await session(first);
    const repository = app.get<AuthRepository>(AUTH_REPOSITORY);
    // A real unique violation at the update occurs after the consumed-token INSERT.
    await expect(
      repository.rotateRefreshToken({
        previousHash: hash(first),
        nextHash: hash(other),
        now: new Date(),
        nextIdleExpiry: new Date(Date.now() + 7 * 86400000),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.authSessionToken.count({ where: { sessionId: sid(first) } }),
    ).toBe(0);
    expect(await session(first)).toEqual(before);
    await refresh(first).expect(200);
    await me(other.body.accessToken).expect(200);
  });

  it('registers one MVC controller and passes domain identities through the presenter in real HTTP flows', async () => {
    const modules = [...app.get(ModulesContainer).values()];
    const controllers = modules
      .flatMap((module) => [...module.controllers.values()])
      .filter((wrapper) => wrapper.metatype === AuthController);
    expect(controllers).toHaveLength(1);
    const presenter = app.get(AuthPresenter);
    const issued = jest.spyOn(presenter, 'session');
    const account = jest.spyOn(presenter, 'account');
    try {
      const auth = await register();
      await login(auth);
      await refresh(auth).expect(200);
      await me(auth.body.accessToken).expect(200);
      expect(issued).toHaveBeenCalledTimes(3);
      for (const [session] of issued.mock.calls) {
        expect(session.account).toBeInstanceOf(AuthAccount);
        expect(session.account).not.toHaveProperty('passwordHash');
      }
      expect(account.mock.calls.at(-1)![0]).toBeInstanceOf(AuthAccount);
    } finally {
      issued.mockRestore();
      account.mockRestore();
    }
  });

  it('retains the IP attempt limit across different invalid credentials', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await http()
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({
          email: `missing-${attempt}@example.test`,
          password: 'incorrect-password',
        })
        .expect(401);
    }
    const result = await http()
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'different@example.test', password: 'incorrect-password' })
      .expect(429);
    expect(result.body.message).toBe('Too many authentication attempts.');
  });

  it('supports the unchanged Vue Axios/Pinia session lifecycle against the real HTTP API and PostgreSQL', async () => {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const code = `
      import assert from 'node:assert/strict';
      import {randomUUID} from 'node:crypto';
      import {createPinia,setActivePinia} from 'pinia';
      import {api,installAuthInterceptors} from './src/services/api.ts';
      import {authService,registerSchema,loginSchema} from './src/services/auth.service.ts';
      import {useAuthStore} from './src/stores/auth.store.ts';
      let stage='transport';try{
      let raw='';for await(const part of process.stdin)raw+=part;
      const {baseURL}=JSON.parse(raw);api.defaults.baseURL=baseURL;
      api.defaults.headers.common.Origin='http://localhost:5173';
      // Node has no browser cookie jar: transport real Set-Cookie values in test memory only.
      const jar=new Map();
      api.interceptors.response.use(response=>{
        for(const value of response.headers['set-cookie']??[]){
          const pair=value.split(';')[0],index=pair.indexOf('=');
          const name=pair.slice(0,index),token=pair.slice(index+1);
          if(token)jar.set(name,token);else jar.delete(name);
        }return response;
      });
      api.interceptors.request.use(config=>{
        if(config.url.startsWith('/auth/'))config.headers.set('Cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));
        return config;
      });
      // JavaScript sees only the CSRF cookie; refresh remains unavailable to the store.
      globalThis.document={get cookie(){return jar.has('pow_csrf')?'pow_csrf='+jar.get('pow_csrf'):''}};
      setActivePinia(createPinia());let store=useAuthStore();
      installAuthInterceptors({getAccessToken:()=>store.accessToken,refreshSession:()=>store.refreshSession(),clearSession:()=>store.clearSession()});
      const form=registerSchema.parse({email:'mvc5-vue-'+randomUUID()+'@example.test',password:'mvc5-only-password-123'});
      stage='register';await store.register(form);assert.equal(store.status,'authenticated');
      assert.deepEqual(Object.keys(store.user).sort(),['createdAt','email','id','status','updatedAt']);
      assert.equal(store.user.email,form.email);
      stage='refresh';const initial=store.accessToken;await store.refreshSession();assert.notEqual(store.accessToken,initial);
      stage='initialize';store.$dispose();setActivePinia(createPinia());store=useAuthStore();assert.equal(store.accessToken,null);await store.initialize();assert.equal(store.status,'authenticated');
      await assert.rejects(store.login({...form,password:'incorrect-password'}),e=>e.response.status===401);
      assert.equal(store.status,'anonymous');assert.equal(store.accessToken,null);
      await store.login(loginSchema.parse(form));await store.logout();
      assert.equal(store.isAuthenticated,false);assert.equal(jar.size,0);
      await store.login(form);const last=store.accessToken;await store.logoutAll();
      assert.equal(store.status,'anonymous');assert.equal(jar.size,0);
      await assert.rejects(authService.me(last),e=>e.response.status===401);
      console.log('Vue authentication HTTP contract passed');
      }catch(error){console.error('Vue check failed at '+stage+' status '+(error.response?.status??'none'));process.exitCode=1}
    `;
    const output = await new Promise<string>((accept, reject) => {
      const child = execFile(
        process.execPath,
        [
          '--experimental-strip-types',
          '--experimental-loader',
          './tests/typescript-loader.mjs',
          '--input-type=module',
          '-e',
          code,
        ],
        { cwd: resolve(process.cwd(), '../frontend'), timeout: 15000 },
        (error, stdout, stderr) =>
          error
            ? reject(
                new Error('Vue authentication HTTP check failed: ' + stderr),
              )
            : accept(stdout),
      );
      child.stdin?.end(
        JSON.stringify({ baseURL: `http://127.0.0.1:${address.port}/api/v1` }),
      );
    });
    expect(output).toContain('Vue authentication HTTP contract passed');
  });
});
