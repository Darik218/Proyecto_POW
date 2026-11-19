import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
const run = promisify(execFile)
const bin = process.env.PULSO_POSTGRES_BIN ?? '/usr/lib/postgresql/18/bin'
const root = await mkdtemp(join(tmpdir(), 'pulso-f06-'))
const data = join(root, 'data')
const socket = join(root, 'socket')
await mkdir(socket)
const probe = createServer()
await new Promise((accept, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', accept) })
const port = probe.address().port
await new Promise(accept => probe.close(accept))
let started = false
try {
  await run(join(bin, 'initdb'), ['-D', data, '--auth-local=trust', '--auth-host=trust', '--username=pulso_test', '--no-locale', '--encoding=UTF8'])
  await run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${socket}`, '-w', 'start'])
  started = true
  const database = 'pulso_f06_test'
  const client = new pg.Client({ connectionString: `postgresql://pulso_test@127.0.0.1:${port}/postgres` })
  await client.connect()
  try { await client.query('CREATE DATABASE pulso_f06_test') } finally { await client.end() }
  const url = `postgresql://pulso_test@127.0.0.1:${port}/${database}`
  const env = { ...process.env, DATABASE_URL: url, F06_TEST_DATABASE_URL: url, NODE_ENV: 'test', AUTH_ACCESS_TOKEN_SECRET: randomBytes(32).toString('hex'), AUTH_REFRESH_TOKEN_PEPPER: randomBytes(32).toString('hex'), CORS_ORIGINS: 'http://localhost:5173', AUTH_COOKIE_SECURE: 'false' }
  console.log('F06: isolated temporary PostgreSQL started; development database is not used.')
  await run(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env, maxBuffer: 2 * 1024 * 1024 })
  const result = await run(process.execPath, ['--experimental-vm-modules', resolve('node_modules/jest/bin/jest.js'), '--config', './test/jest-e2e.json', '--runInBand', 'workout-sessions.e2e-spec.ts'], { env, maxBuffer: 4 * 1024 * 1024 })
  process.stdout.write(result.stdout); process.stderr.write(result.stderr)
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  console.error('F06 isolated validation failed.')
  process.exitCode = 1
} finally {
  if (started) {
    try { await run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']); started = false }
    catch { console.error(`Temporary PostgreSQL cleanup requires attention: ${root}`); process.exitCode = 1 }
  }
  if (!started) await rm(root, { recursive: true, force: true })
}
