import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import pg from 'pg'

const run = promisify(execFile)
const pattern = process.argv.includes('--performance') ? '^(progression(-migration)?|performance)\\.e2e-spec\\.ts$' : '^progression(-migration)?\\.e2e-spec\\.ts$'
const bin = process.env.PULSO_POSTGRES_BIN ?? '/usr/lib/postgresql/18/bin'
const root = await mkdtemp(join(tmpdir(), 'pulso-prog1b-'))
const data = join(root, 'data'), socket = join(root, 'socket'), database = 'pulso_prog1b_test'
let started = false
try {
  await mkdir(socket)
  const probe = createServer()
  await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok) })
  const port = probe.address().port
  await new Promise(ok => probe.close(ok))
  await run(join(bin, 'initdb'), ['-D', data, '--auth-local=trust', '--auth-host=trust', '--username=pulso_test', '--no-locale', '--encoding=UTF8'])
  await run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${socket}`, '-w', 'start'])
  started = true
  const admin = new pg.Client({ host: '127.0.0.1', port, user: 'pulso_test', database: 'postgres' })
  await admin.connect()
  try {
    const { rows } = await admin.query("SELECT current_setting('data_directory') AS directory")
    if (await realpath(rows[0].directory) !== await realpath(data)) throw Error('Wrong temporary cluster')
    await admin.query('CREATE DATABASE pulso_prog1b_test')
  } finally { await admin.end() }
  const url = `postgresql://pulso_test@127.0.0.1:${port}/${database}`
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== String(port) || target.pathname !== '/pulso_prog1b_test') throw Error('Unsafe URL')
  const check = new pg.Client({ connectionString: url })
  await check.connect()
  try {
    const { rows } = await check.query("SELECT current_database() AS name, current_setting('data_directory') AS directory, inet_server_port() AS port")
    if (rows[0].name !== database || rows[0].port !== port || await realpath(rows[0].directory) !== await realpath(data)) throw Error('Unsafe database')
  } finally { await check.end() }
  const env = { ...process.env, DATABASE_URL: url, PROG1B_TEST_DATABASE_URL: url, PROG1B_TEST_DATA_DIRECTORY: data,
    PROG1B_TEST_PORT: String(port), NODE_ENV: 'test' }
  console.log(`PROG-1B verified temporary cluster: ${data}; 127.0.0.1:${port}/${database}; no development or seeds.`)
  const prisma = resolve('node_modules/prisma/build/index.js')
  for (const args of [['migrate', 'deploy'], ['migrate', 'status'], ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']]) {
    const result = await run(process.execPath, [prisma, ...args], { env, timeout: 60000, maxBuffer: 2 ** 21 })
    process.stdout.write(result.stdout)
  }
  const result = await run(process.execPath, ['--experimental-vm-modules', resolve('node_modules/jest/bin/jest.js'), '--config', './test/jest-e2e.json', '--runInBand', '--testPathPatterns', pattern],
    { env, timeout: 180000, maxBuffer: 2 ** 23 })
  process.stdout.write(result.stdout); process.stderr.write(result.stderr)
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  console.error('PROG-1B isolated verification failed: ' + error.message)
  process.exitCode = 1
} finally {
  if (started) {
    try { await run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']); started = false }
    catch { console.error('Temporary cluster cleanup pending: ' + root); process.exitCode = 1 }
  }
  if (!started) { await rm(root, { recursive: true, force: true }); console.log('PROG-1B temporary cluster stopped and removed.') }
}
