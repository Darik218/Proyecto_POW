import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { realpath, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import request from 'supertest';

const isolated = process.env.MVC6_TEST_DATABASE_URL ? describe : describe.skip;
isolated('Compiled main bootstrap with AppModule and Observe', () => {
  let child: ChildProcess, base: string;
  let output = '';
  let exit: Promise<unknown[]>;
  beforeAll(async () => {
    const url = process.env.MVC6_TEST_DATABASE_URL;
    const data = process.env.MVC6_TEST_DATA_DIRECTORY;
    const target = new URL(url!);
    if (url !== process.env.DATABASE_URL || target.hostname !== '127.0.0.1' ||
      target.pathname !== '/pulso_mvc6_test' || !target.port || !data?.startsWith('/tmp/pulso-mvc6-')) {
      throw new Error('An isolated bootstrap database is required.');
    }
    const check = new pg.Client({ connectionString: url });
    await check.connect();
    try {
      const { rows } = await check.query("SELECT current_database() AS database, current_setting('data_directory') AS directory");
      if (rows[0].database !== 'pulso_mvc6_test' || await realpath(rows[0].directory) !== await realpath(data)) throw new Error('Unexpected bootstrap database.');
    } finally { await check.end(); }
    // Refuse production Observe credentials: only the SDK's built-in disconnected scaffold mode is authorized.
    const module = await readFile(resolve('dist/app.module.js'), 'utf8');
    if (!module.includes("'YOUR_APP_KEY'") || !module.includes("'YOUR_APP_SECRET'")) throw new Error('Bootstrap test requires disconnected Observe scaffold credentials.');
    const probe = createServer();
    await new Promise<void>((accept, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', accept); });
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(accept => probe.close(() => accept()));
    base = 'http://127.0.0.1:' + port;
    child = spawn(process.execPath, [resolve('dist/main.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    exit = once(child, 'exit');
    child.stdout!.on('data', chunk => { output += String(chunk); });
    child.stderr!.on('data', chunk => { output += String(chunk); });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Compiled bootstrap exited before listening.');
      try { const response = await fetch(base + '/api/v1'); if (response.status === 200) return; } catch { /* wait for the owned child to listen */ }
      await delay(50);
    }
    throw new Error('Compiled bootstrap did not listen within 10 seconds.');
  }, 20000);
  afterAll(async () => {
    if (!child) return;
    if (child.exitCode === null) child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exit, new Promise<never>((_accept, reject) => {
        timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); reject(new Error('Bootstrap child did not shut down gracefully.')); }, 5000);
      })]);
    } finally { clearTimeout(timer); }
  });
  it('starts all AppModule providers from the real entrypoint and preserves the prefixed root response', async () => {
    await request(base).get('/api/v1').expect(200).expect('Hello World!');
    await request(base).get('/').expect(404);
    expect(output).toContain('Nest application successfully started');
    expect(output).toContain('Observe is installed but not connected yet');
  });
  it('keeps the actual global guard, validation and CORS configuration', async () => {
    await request(base).get('/api/v1/athletes/me').expect(401);
    await request(base).get('/api/v1/exercises?limit=101').expect(400);
    await request(base).post('/api/v1/auth/register').set('Origin', 'http://localhost:5173')
      .send({ email: 'invalid', password: '', extra: true }).expect(400);
    await request(base).post('/api/v1/auth/login').set('Origin', 'https://foreign.example.test').send({}).expect(403);
    await request(base).get('/api/v1').set('Origin', 'http://localhost:5173')
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173').expect('Access-Control-Allow-Credentials', 'true').expect(200);
  });
});
