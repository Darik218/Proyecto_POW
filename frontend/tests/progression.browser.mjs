// Firefox real, Nest real y PostgreSQL efímero. Solo el runner aislado aporta configuración por stdin.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpath, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
const require = createRequire(resolve('../backend/package.json')),
  pg = require('pg'),
  { PrismaClient } = require('../backend/dist/generated/prisma/client.js'),
  { PrismaPg } = require('../backend/node_modules/@prisma/adapter-pg'),
  {
    PasswordHasher,
  } = require('../backend/dist/auth/security/password-hasher.js')
let raw = ''
for await (const part of process.stdin) raw += part
const cfg = JSON.parse(raw),
  url = new URL(cfg.databaseUrl)
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/pulso_prog6a_browser_test')
assert.ok(cfg.dataDirectory.startsWith('/tmp/pulso-prog6a-browser-'))
const sql = new pg.Client({ connectionString: cfg.databaseUrl })
await sql.connect()
const {
  rows: [location],
} = await sql.query(
  "SELECT current_database() AS name,current_setting('data_directory') AS directory",
)
assert.equal(location.name, 'pulso_prog6a_browser_test')
assert.equal(
  await realpath(location.directory),
  await realpath(cfg.dataDirectory),
)
const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: cfg.databaseUrl }),
  }),
  hasher = new PasswordHasher(),
  password = 'Progression-browser-fixture-2026!',
  results = [],
  evidence = await mkdtemp(join(tmpdir(), 'pulso-prog6a-evidence-'))
let sid
async function fixture(name) {
  const user = await db.user.create({
      data: {
        email: randomUUID() + '@example.test',
        passwordHash: await hasher.hash(password),
        athlete: { create: {} },
      },
      include: { athlete: true },
    }),
    athleteId = user.athlete.id,
    group = await db.muscleGroup.create({
      data: {
        key: randomUUID(),
        name: 'Browser fixture group ' + randomUUID(),
      },
    }),
    exercise = await db.exercise.create({
      data: {
        name: name + ' press',
        primaryMuscleGroupId: group.id,
        equipment: 'barbell',
        oneRmSuitability: 'SUITABLE',
      },
    }),
    tasks = []
  for (const date of ['2026-01-05', '2026-01-06']) {
    const session = await db.workoutSession.create({
        data: {
          athleteId,
          status: 'COMPLETED',
          performedOn: new Date(date),
          timeZone: 'UTC',
          startedAt: new Date(date + 'T12:00:00Z'),
          finishedAt: new Date(date + 'T13:00:00Z'),
        },
      }),
      task = await db.workoutExercise.create({
        data: {
          sessionId: session.id,
          exerciseId: exercise.id,
          orderInSession: 1,
          targetSets: 1,
          targetRepsMin: 5,
          targetRepsMax: 6,
          targetLoad: '80',
          targetLoadUnit: 'KG',
          targetRpe: '8',
          originalSnapshot: {
            exercise: { id: exercise.id },
            targets: {
              targetSets: 1,
              targetRepsMin: 5,
              targetRepsMax: 6,
              targetLoad: '80',
              targetLoadUnit: 'KG',
              targetRpe: '8',
            },
          },
        },
      })
    await db.setRecord.create({
      data: {
        workoutExerciseId: task.id,
        setNumber: 1,
        status: 'COMPLETED',
        kind: 'WORK',
        isCompleted: true,
        repetitions: 6,
        load: '80',
        loadUnit: 'KG',
        loadKg: '80',
        rpe: '7',
      },
    })
    tasks.push(task)
  }
  await db.progressionSetting.create({
    data: {
      athleteId,
      minSuccessfulSessions: 2,
      targetRpeMin: 6,
      targetRpeMax: 8,
      incrementAbsolute: '2.5',
      maxIncrementPercent: '10',
    },
  })
  const plan = await db.trainingPlan.create({
      data: { athleteId, name: name + ' futuro editable' },
    }),
    week = await db.planWeek.create({
      data: { trainingPlanId: plan.id, weekNumber: 1 },
    }),
    day = await db.planDay.create({
      data: { planWeekId: week.id, name: 'Push', position: 1 },
    }),
    p = await db.planExercise.create({
      data: {
        planWeekId: week.id,
        planDayId: day.id,
        exerciseId: exercise.id,
        position: 1,
        targetSets: 1,
        targetRepsMin: 5,
        targetRepsMax: 6,
        targetLoad: '80',
        targetLoadUnit: 'KG',
        targetRpe: '8',
      },
    }),
    {
      rows: [date],
    } = await sql.query(
      "SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date+7)::text AS on",
    ),
    activity = await db.scheduledActivity.create({
      data: {
        athleteId,
        planWeekId: week.id,
        planDayId: day.id,
        originalOn: new Date(date.on),
        scheduledOn: new Date(date.on),
        timeZone: 'UTC',
        title: name + ' actividad futura',
      },
    })
  return {
    user,
    athleteId,
    exercise,
    tasks,
    plan,
    week,
    day,
    p,
    activity,
    date: date.on,
  }
}
async function wd(path = '', method = 'GET', body) {
  const r = await fetch(cfg.driver + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }),
    json = await r.json()
  if (!r.ok || json.value?.error)
    throw Error(
      'WebDriver ' +
        (json.value?.error ?? r.status) +
        ': ' +
        (json.value?.message ?? ''),
    )
  return json.value
}
const command = (path, method = 'GET', body) =>
    wd('/session/' + sid + path, method, body),
  sync = (script, args = []) =>
    command('/execute/sync', 'POST', { script, args })
async function execute(code, args = []) {
  const r = await command('/execute/async', 'POST', {
    script: `const done=arguments[arguments.length-1];(async()=>{const auth=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('auth'),store=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('progression');${code}})().then(value=>done({value}),error=>done({error:error.message,status:error.response?.status}));`,
    args,
  })
  if (r.error) throw Error(r.error)
  return r.value
}
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 80))
  }
  const text = await sync(
    "return document.querySelector('main')?.textContent.slice(-2000)",
  )
  const debug = await sync(
    'return {path:location.pathname,errors:window.__routeErrors,link:document.querySelector("[data-testid=savedDetail]")?.getAttribute("href")}',
  )
  throw Error('Timeout ' + label + ': ' + JSON.stringify(debug) + ' ' + text)
}
async function go(path) {
  await command('/url', 'POST', { url: cfg.origin + path })
  await until(
    () =>
      sync(
        'return !!document.querySelector("main")&&!document.querySelector("vite-error-overlay")',
      ),
    'page ' + path,
  )
}
async function input(selector, value) {
  await until(
    () =>
      sync(
        'const e=document.querySelector(arguments[0]);return !!e&&(e.tagName!=="SELECT"||[...e.options].some(o=>o.value===arguments[1]))',
        [selector, value],
      ),
    selector,
  )
  await sync(
    "const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))",
    [selector, value],
  )
}
async function click(selector) {
  await until(
    () =>
      sync(
        'const e=document.querySelector(arguments[0]);return !!e&&!e.disabled',
        [selector],
      ),
    'enabled ' + selector,
  )
  await sync('document.querySelector(arguments[0]).click()', [selector])
}
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, status: 'PASS' })
    console.log('PASS ' + name)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message })
    throw e
  }
}
async function screenshot(name) {
  await writeFile(
    join(evidence, name + '.png'),
    Buffer.from(await command('/screenshot'), 'base64'),
  )
}
async function login(f) {
  await go('/login')
  await input('#email', f.user.email)
  await input('#password', password)
  await sync("document.querySelector('form').requestSubmit()")
  await until(() => sync("return location.pathname==='/app'"), 'login')
}
async function prepare(f) {
  await go('/app/progression/new')
  for (const [name, value] of [
    ['plan', f.plan.id],
    ['week', f.week.id],
    ['day', f.day.id],
    ['prescription', f.p.id],
    ['start', '2026-01-05'],
    ['endExclusive', '2026-01-12'],
    ['cutoffOn', '2026-01-11'],
    ['from', '2026-01-01'],
    ['timeZone', 'UTC'],
    ['weekStartsOn', '1'],
  ])
    await input(`[data-testid="${name}"]`, value)
  await click('[data-testid="context"]')
  await until(
    () => sync('return !!document.querySelector("[data-task]")'),
    'context historical tasks',
  )
  for (const t of f.tasks) {
    await click(`[data-task="${t.id}"]`)
    await input(`[data-original="${t.id}"]`, '1')
    await input(`[data-adjusted="${t.id}"]`, '1')
  }
  await input('[data-testid="anchor"]', f.tasks[1].id)
  await input(
    '[data-testid="protocol"]',
    'browser explicit comparable protocol',
  )
  await input('[data-testid="equipment"]', 'browser explicit barbell')
  await click('[data-testid="loadDeclaration"]')
  const fields = {
    id: 'browser-human-policy',
    version: 'v1',
    reference: 'explicit test-only policy, not a production default',
    basis: 'ADJUSTED',
    basicReps: 'MINIMUM',
    basicLoad: 'AT_LEAST_TARGET',
    readinessReps: 'UPPER_BOUND',
    readinessLoad: 'AT_LEAST_TARGET',
    rpeMin: '6',
    rpeMax: '8',
    criterion: 'BASIC',
    mode: 'ACCUMULATED',
    sameDate: 'DISTINCT_SESSIONS',
    settingRpeUse: 'REQUIRE_INTERVAL',
    review: 'NOT_REQUIRED_EXPLICIT',
    incrementMode: 'ABSOLUTE',
    unit: 'KG',
    step: '2.5',
    origin: '0',
    gridSource: 'explicit test-only plates',
    closed: 'true',
  }
  for (const [key, value] of Object.entries(fields))
    await input(`[data-policy="${key}"]`, value)
  await click('[data-testid="generate"]')
  await until(
    () => execute('return !!store?.preview||!!store?.error'),
    'preview response',
  )
  assert.equal(await execute('return store?.error?.code??null'), null)
  assert.equal(await execute('return store.preview.decision'), 'INCREASE')
  await click('[data-testid="save"]')
  await until(
    () => sync('return !!document.querySelector("[data-testid=savedDetail]")'),
    'saved proposal',
  )
  const id = await execute('return store.proposal.id')
  await execute(
    "window.__routeErrors=[];const router=document.querySelector('#app').__vue_app__.config.globalProperties.$router;router.onError(error=>window.__routeErrors.push(error.message));return true",
  )
  await click('[data-testid="savedDetail"]')
  await until(
    () => sync('return !!document.querySelector("[data-testid=acceptPolicy]")'),
    'review form',
  )
  return id
}
async function approve() {
  await click('[data-testid="acceptPolicy"]')
  await click('[data-testid="acceptEvidence"]')
  await click('[data-testid="approve"]')
  await until(
    () => execute("return store.proposal?.status==='APPROVED'"),
    'approved response',
  )
}
async function readiness(f) {
  for (const [field, value] of [
    ['activityFrom', f.date],
    ['activityTo', f.date],
    ['activityZone', 'UTC'],
  ])
    await input(`[data-testid="${field}"]`, value)
  await click('[data-testid="activities"]')
  await until(
    () =>
      sync(
        'return document.querySelector("[data-testid=activity]")?.options.length>1',
      ),
    'activity options',
  )
  await input('[data-testid="activity"]', f.activity.id)
  await click('[data-testid="readiness"]')
  await until(
    () => execute('return !!store.readiness||!!store.error'),
    'readiness',
  )
  assert.equal(await execute('return store.readiness?.eligible'), true)
}
async function history() {
  const result = {}
  for (const table of [
    'workout_sessions',
    'workout_exercises',
    'set_records',
    'one_rm_estimates',
  ])
    result[table] = (
      await sql.query(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${table} t`,
      )
    ).rows[0].hash
  return result
}
try {
  const f = await fixture('Recorrido manual'),
    g = await fixture('Respuesta perdida'),
    h = await fixture('Rechazo'),
    v = await fixture('Conflicto de versión'),
    expired = await fixture('Sesión revocada'),
    before = await history()
  sid = (
    await wd('/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            binary: '/snap/firefox/current/usr/lib/firefox/firefox',
            args: ['-headless'],
          },
        },
      },
    })
  ).sessionId
  await command('/timeouts', 'POST', { script: 25000, pageLoad: 25000 })
  await check(
    'P01 protected progression route rejects unauthenticated access',
    async () => {
      await go('/app/progression')
      assert.equal(await sync('return location.pathname'), '/login')
    },
  )
  await check('P02 real login and navigation with one layout', async () => {
    await login(f)
    await go('/app/progression')
    assert.equal(
      await sync('return document.querySelectorAll(".app-header").length'),
      1,
    )
    assert.equal(
      await sync(
        'return [...document.querySelectorAll("a")].some(a=>a.getAttribute("href")==="/app/progression")',
      ),
      true,
    )
  })
  let saved
  await check(
    'P03 explicit plan/week/day/prescription and policy generate, inspect and save',
    async () => {
      saved = await prepare(f)
      assert.equal(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: saved },
          })
        ).status,
        'PENDING',
      )
      assert.match(
        await sync('return document.querySelector("main").textContent'),
        /Objetivo original/,
      )
      assert.match(
        await sync('return document.querySelector("main").textContent'),
        /Resultados ejecutados/,
      )
      await screenshot('proposal-desktop')
    },
  )
  await check(
    'P04 no preselected acceptance and one checkbox cannot approve',
    async () => {
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=approve]").disabled',
        ),
        true,
      )
      await click('[data-testid="acceptPolicy"]')
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=approve]").disabled',
        ),
        true,
      )
      await click('[data-testid="acceptPolicy"]')
    },
  )
  await check(
    'P05 reinspection resets previous human acknowledgments',
    async () => {
      await click('[data-testid="acceptPolicy"]')
      await click('[data-testid="acceptEvidence"]')
      await click('[data-testid="revalidate"]')
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=acceptPolicy]").checked===false',
          ),
        'checkbox reset',
      )
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=approve]").disabled',
        ),
        true,
      )
    },
  )
  await check(
    'P06 explicit approval produces APPROVED and no load change',
    async () => {
      await approve()
      assert.equal(
        (
          await db.planExercise.findUniqueOrThrow({ where: { id: f.p.id } })
        ).targetLoad.toFixed(3),
        '80.000',
      )
      assert.equal(
        await db.progressionApplication.count({
          where: { recommendationId: saved },
        }),
        0,
      )
    },
  )
  await check(
    'P07 actual future activity and server application readiness',
    async () => {
      await readiness(f)
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=confirmApply]").checked',
        ),
        false,
      )
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=apply]").disabled',
        ),
        true,
      )
    },
  )
  await check(
    'P08 explicit manual application persists one increment and receipt',
    async () => {
      await click('[data-testid="confirmApply"]')
      await click('[data-testid="apply"]')
      await until(
        () => sync('return !!document.querySelector("[data-testid=receipt]")'),
        'application receipt',
      )
      // A confirmed write receipt is visible before the follow-up inspection.
      // Wait for both stages; keeping the receipt early protects lost reads.
      await until(
        () => execute('return !store.busy'),
        'application inspection settled',
      )
      assert.equal(
        await execute('return store.inspection.proposal.status'),
        'APPLIED',
      )
      assert.equal(
        (
          await db.planExercise.findUniqueOrThrow({ where: { id: f.p.id } })
        ).targetLoad.toFixed(3),
        '82.500',
      )
      assert.equal(
        (await db.trainingPlan.findUniqueOrThrow({ where: { id: f.plan.id } }))
          .version,
        1,
      )
      assert.equal(
        await db.progressionApplication.count({
          where: { recommendationId: saved },
        }),
        1,
      )
    },
  )
  await check(
    'P09 reload restores APPLIED receipt and never applies twice',
    async () => {
      await go('/app/progression/recommendations/' + saved)
      await until(
        () => sync('return !!document.querySelector("[data-testid=receipt]")'),
        'receipt after reload',
      )
      assert.equal(
        await sync('return !!document.querySelector("[data-testid=apply]")'),
        false,
      )
      assert.equal(
        await db.progressionApplication.count({
          where: { recommendationId: saved },
        }),
        1,
      )
    },
  )
  await check(
    'P10 mobile layout, keyboard focus and no horizontal overflow',
    async () => {
      await command('/window/rect', 'POST', { width: 500, height: 850 })
      assert.equal(
        await sync('return document.documentElement.scrollWidth<=innerWidth'),
        true,
      )
      await command('/actions', 'POST', {
        actions: [
          {
            type: 'key',
            id: 'keyboard',
            actions: [
              { type: 'keyDown', value: '\uE004' },
              { type: 'keyUp', value: '\uE004' },
            ],
          },
        ],
      })
      assert.equal(
        await sync('return document.activeElement!==document.body'),
        true,
      )
      await sync(
        'document.querySelector("[data-testid=receipt]").scrollIntoView({block:"start"})',
      )
      await screenshot('receipt-mobile')
      await command('/window/rect', 'POST', { width: 1440, height: 950 })
    },
  )
  await check(
    'P11 foreign recommendation is inaccessible after account switch',
    async () => {
      await execute('await auth.logout()')
      await login(g)
      await go('/app/progression/recommendations/' + saved)
      await until(() => execute('return !!store?.error'), 'foreign response')
      assert.equal(await execute('return store.error.code'), 'SOURCE_NOT_FOUND')
      assert.equal(
        await sync('return !!document.querySelector("[data-testid=approve]")'),
        false,
      )
    },
  )
  let lost
  await check('P12 second explicit proposal is independent', async () => {
    lost = await prepare(g)
    await approve()
    await readiness(g)
  })
  await check(
    'P13 lost committed response preserves pending exact intention',
    async () => {
      assert.equal(
        (
          await fetch(
            cfg.origin +
              '/api/v1/__prog6a_test__/lose-next-application-response',
            { method: 'POST' },
          )
        ).status,
        204,
      )
      await click('[data-testid="confirmApply"]')
      await click('[data-testid="apply"]')
      await until(
        () => execute('return store.error?.uncertain===true&&!store.busy'),
        'uncertain committed response',
      )
      assert.equal(
        await db.progressionApplication.count({
          where: { recommendationId: lost },
        }),
        1,
      )
      assert.equal(await execute('return store.receipt'), null)
      assert.equal(await execute('return store.pending.kind'), 'APPLY')
    },
  )
  await check(
    'P14 reload recovers identifiers bound to the same real session without secret storage',
    async () => {
      await go('/app/progression/recommendations/' + lost)
      await until(
        () => sync('return !!document.querySelector("[data-testid=recover]")'),
        'pending after reload',
      )
      const stored = await sync(
        'return Object.values(sessionStorage).join(" ")',
      )
      assert.doesNotMatch(
        stored,
        /accessToken|refreshToken|csrfToken|snapshot|acceptPolicy|command/,
      )
      assert.equal(await execute('return store.canRetry()'), false)
    },
  )
  await check(
    'P15 receipt recovery confirms original intent and one plan version',
    async () => {
      await click('[data-testid="recover"]')
      await until(
        () => execute('return !store.pending&&!!store.receipt'),
        'recovered receipt',
      )
      assert.equal(await execute('return store.proposal.status'), 'APPLIED')
      assert.equal(
        (await db.trainingPlan.findUniqueOrThrow({ where: { id: g.plan.id } }))
          .version,
        1,
      )
      assert.equal(
        await db.progressionApplication.count({
          where: { recommendationId: lost },
        }),
        1,
      )
      assert.equal(
        await sync('return !!document.querySelector("[data-testid=apply]")'),
        false,
      )
    },
  )
  await check(
    'P16 explicit rejection remains immutable and cannot apply',
    async () => {
      await execute('await auth.logout()')
      await login(h)
      const rec = await prepare(h)
      await input(
        '[data-testid="justification"]',
        'Prefiero revisar esta programación.',
      )
      await click('[data-testid="reject"]')
      await until(
        () => execute("return store.proposal?.status==='REJECTED'"),
        'rejection',
      )
      assert.equal(
        await sync('return !!document.querySelector("[data-testid=apply]")'),
        false,
      )
      assert.equal(
        await db.progressionApplication.count({
          where: { recommendationId: rec },
        }),
        0,
      )
    },
  )
  await check(
    'P18 stale plan version cannot be applied from a previously eligible UI',
    async () => {
      await execute('await auth.logout()')
      await login(v)
      const rec = await prepare(v)
      await approve()
      await readiness(v)
      await db.trainingPlan.update({
        where: { id: v.plan.id },
        data: { version: { increment: 1 } },
      })
      await click('[data-testid="confirmApply"]')
      await click('[data-testid="apply"]')
      await until(
        () => execute('return !!store.error&&!store.busy'),
        'version conflict',
      )
      assert.equal(
        await db.progressionApplication.count({
          where: { recommendationId: rec },
        }),
        0,
      )
      assert.equal(
        (
          await db.planExercise.findUniqueOrThrow({ where: { id: v.p.id } })
        ).targetLoad.toFixed(3),
        '80.000',
      )
    },
  )
  await check(
    'P19 revoked session cannot confirm a pending review',
    async () => {
      await execute('await auth.logout()')
      await login(expired)
      const rec = await prepare(expired)
      await click('[data-testid="acceptPolicy"]')
      await click('[data-testid="acceptEvidence"]')
      await db.authSession.updateMany({
        where: { userId: expired.user.id },
        data: { revokedAt: new Date() },
      })
      await click('[data-testid="approve"]')
      await until(
        () => execute("return auth.status==='anonymous'"),
        'expired session recovery rejected',
      )
      assert.equal(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: rec },
          })
        ).status,
        'PENDING',
      )
      assert.equal(
        await db.recommendationReview.count({
          where: { recommendationId: rec },
        }),
        0,
      )
      assert.equal(await execute('return store.proposal'), null)
    },
  )
  await check(
    'P17 no historical changes and no recurrent consent activation',
    async () => {
      assert.deepEqual(await history(), before)
      assert.equal(await db.progressionAutomationConsent.count(), 0)
      assert.equal(
        await db.progressionSetting.count({
          where: { autoApplyAuthorized: true },
        }),
        0,
      )
      assert.equal(
        await sync('return !!document.querySelector("vite-error-overlay")'),
        false,
      )
    },
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
  try {
    await screenshot('failure')
  } catch {}
} finally {
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify(results, null, 2),
  )
  console.log('Firefox evidence: ' + evidence)
  console.log(
    `Firefox: ${results.filter((v) => v.status === 'PASS').length} passed; ${results.filter((v) => v.status === 'FAIL').length} failed; ${results.length} distinct checks.`,
  )
  if (sid)
    try {
      await wd('/session/' + sid, 'DELETE')
    } catch {}
  await db.$disconnect()
  await sql.end()
}
