import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const run = promisify(execFile)
const groups = {
  sessions: '^workout-sessions\\.e2e-spec\\.ts$',
  recording: '^r2-workout-sessions\\.e2e-spec\\.ts$',
  contracts: '^workout-mvc\\.e2e-spec\\.ts$',
  all: '(r2-workout-sessions|workout-sessions|workout-mvc)\\.e2e-spec\\.ts$',
}
const group = process.argv[2] ?? 'all'
if (!Object.hasOwn(groups, group)) throw new Error('Choose sessions, recording, contracts or all.')
const bin = process.env.PULSO_POSTGRES_BIN ?? '/usr/lib/postgresql/18/bin'
const root = await mkdtemp(join(tmpdir(), 'pulso-mvc4-'))
const data = join(root, 'data')
const socket = join(root, 'socket')
const database = 'pulso_f06_test' // Existing isolated suites explicitly require this name.
let started = false
try {
  await mkdir(socket)
  const probe = createServer()
  await new Promise((accept, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', accept)
  })
  const port = probe.address().port
  await new Promise((accept) => probe.close(accept))
  await run(join(bin, 'initdb'), ['-D', data, '--auth-local=trust', '--auth-host=trust',
    '--username=pulso_mvc_test', '--no-locale', '--encoding=UTF8'])
  await run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port} -k ${socket}`, '-w', 'start'])
  started = true
  const admin = new pg.Client({ host: '127.0.0.1', port, user: 'pulso_mvc_test', database: 'postgres' })
  await admin.connect()
  try {
    const { rows } = await admin.query("SELECT current_setting('data_directory') AS directory")
    if (await realpath(rows[0].directory) !== await realpath(data)) throw new Error('Cluster isolation check failed.')
    await admin.query('CREATE DATABASE pulso_f06_test')
  } finally { await admin.end() }
  const url = `postgresql://pulso_mvc_test@127.0.0.1:${port}/${database}`
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || Number(target.port) !== port ||
      target.pathname !== '/pulso_f06_test' || database === 'proyecto_pow_dev') throw new Error('Unsafe test target.')
  const check = new pg.Client({ connectionString: url })
  await check.connect()
  try {
    const { rows } = await check.query('SELECT current_database() AS database')
    if (rows[0].database !== database) throw new Error('Database isolation check failed.')
  } finally { await check.end() }
  const env = { ...process.env, DATABASE_URL: url, UX_TEST_DATABASE_URL: url,
    MVC4_TEST_DATABASE_URL: url, MVC4_TEST_DATA_DIRECTORY: data,
    R1_TEST_DATABASE_URL: url, R2_TEST_DATABASE_URL: url, F06_TEST_DATABASE_URL: url,
    UX_MEASUREMENTS_FILE: join(root, 'measurements.json'), NODE_ENV: 'test',
    AUTH_ACCESS_TOKEN_SECRET: randomBytes(32).toString('hex'),
    AUTH_REFRESH_TOKEN_PEPPER: randomBytes(32).toString('hex'),
    CORS_ORIGINS: 'http://localhost:5173', AUTH_COOKIE_SECURE: 'false' }
  console.log(`MVC-4: isolated cluster verified; database ${database}; development is not used.`)
  const prisma = resolve('node_modules/prisma/build/index.js')
  await run(process.execPath, [prisma, 'migrate', 'deploy'], { env, timeout: 60000, maxBuffer: 2 ** 21 })
  await run(process.execPath, [prisma, 'migrate', 'status'], { env, timeout: 60000, maxBuffer: 2 ** 21 })
  await run(process.execPath, [prisma, 'migrate', 'diff', '--from-config-datasource',
    '--to-schema', 'prisma/schema.prisma', '--exit-code'], { env, timeout: 60000, maxBuffer: 2 ** 21 })
  console.log('MVC-4: existing migrations applied only to temporary cluster; schema matches; no seeds executed.')
  const result = await run(process.execPath, ['--experimental-vm-modules', resolve('node_modules/jest/bin/jest.js'),
    '--config', './test/jest-e2e.json', '--runInBand', '--testPathPatterns', groups[group]],
  { env, timeout: 180000, maxBuffer: 2 ** 23 })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  console.error('MVC-4 isolated verification failed.')
  process.exitCode = 1
} finally {
  if (started) {
    try { await run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']); started = false }
    catch { console.error(`Temporary cluster needs cleanup: ${root}`); process.exitCode = 1 }
  }
  if (!started) await rm(root, { recursive: true, force: true })
}
