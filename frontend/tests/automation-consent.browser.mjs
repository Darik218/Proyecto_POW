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
assert.equal(url.pathname, '/pulso_prog6b_browser_test')
assert.ok(cfg.dataDirectory.startsWith('/tmp/pulso-prog6b-browser-'))
const sql = new pg.Client({ connectionString: cfg.databaseUrl })
await sql.connect()
const {
  rows: [location],
} = await sql.query(
  "SELECT current_database() AS name,current_setting('data_directory') AS directory",
)
assert.equal(location.name, 'pulso_prog6b_browser_test')
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
  evidence = await mkdtemp(join(tmpdir(), 'pulso-prog6b-evidence-'))
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
    script: `const done=arguments[arguments.length-1];(async()=>{const auth=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('auth'),store=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('automation-consents');${code}})().then(value=>done({value}),error=>done({error:error.message,status:error.response?.status}));`,
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
async function history() {
  const result = {}
  for (const table of [
    'training_plans',
    'plan_weeks',
    'plan_days',
    'plan_exercises',
    'workout_sessions',
    'workout_exercises',
    'set_records',
    'one_rm_estimates',
    'scheduled_activities',
    'progression_recommendations',
    'recommendation_reviews',
    'progression_applications',
  ])
    result[table] = (
      await sql.query(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${table} t`,
      )
    ).rows[0].hash
  return result
}
async function prepare(f) {
  await go('/app/progression/automation/new')
  await input('input[type="search"]', f.exercise.name)
  await click(`input[type="radio"][value="${f.exercise.id}"]`)
  for (const [k, v] of Object.entries({
    scope: 'PLAN',
    plan: f.plan.id,
    unit: 'KG',
  }))
    await input(`[data-consent="${k}"]`, v)
  await click('[data-testid="consentCandidates"]')
  await until(
    () => sync('return !!document.querySelector("[data-target]")'),
    'candidates',
  )
  assert.equal(
    await sync('return document.querySelector("[data-target]").checked'),
    false,
  )
  await click(`[data-target="${f.p.id}"]`)
  for (const t of f.tasks) {
    await click(`[data-consent-task="${t.id}"]`)
    await input(`[data-consent-original="${t.id}"]`, '1')
    await input(`[data-consent-adjusted="${t.id}"]`, '1')
  }
  await input('[data-consent="anchor"]', f.tasks[1].id)
  await input('[data-consent="minimumSessions"]', '2')
  const fields = {
    id: 'browser-consent-policy',
    version: 'v1',
    reference: 'explicit browser fixture, not a production policy',
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
    step: '2.5',
    origin: '0',
    gridSource: 'explicit fixture plates',
    closed: 'true',
  }
  for (const [key, value] of Object.entries(fields))
    await input(`[data-consent-policy="${key}"]`, value)
  await click('[data-consent="declaration"]')
  const {
    rows: [dates],
  } = await sql.query(
    'SELECT to_char(clock_timestamp()-interval \'1 hour\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS start,to_char(clock_timestamp()+interval \'30 days\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS end',
  )
  for (const [k, v] of Object.entries({
    maximumAbsoluteIncrement: '2.5',
    maximumPercentIncrement: '5',
    maximumLoad: '200.000001',
    maximumApplicationsPerWeek: '1',
    historyWindowDays: '28',
    weekStartsOn: '1',
    startsAt: dates.start,
    endsAt: dates.end,
    timeZone: 'UTC',
    termsVersion: 'explicit-fixture-terms-v1',
    reference: 'Browser configuration request, not acceptance',
  }))
    await input(`[data-consent="${k}"]`, v)
  await click('[data-testid="consentPreview"]')
  await until(
    () => execute('return !!store?.preview||!!store?.error'),
    'preview',
  )
  assert.equal(await execute('return store.error?.code??null'), null)
  assert.equal(
    await sync(
      'return document.querySelector("[data-testid=createConsent]").disabled',
    ),
    true,
  )
}
try {
  const f = await fixture('Consentimiento principal'),
    g = await fixture('Consentimiento perdido'),
    h = await fixture('Sesión revocada'),
    acceptedFixture = cfg.acceptance
      ? await fixture('Aceptación inactiva')
      : null,
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
    'C01 protected consent URL requires real authentication',
    async () => {
      await go('/app/progression/automation')
      assert.equal(await sync('return location.pathname'), '/login')
    },
  )
  await check(
    'C02 real login reaches progression and pending consent list',
    async () => {
      await login(f)
      await go('/app/progression')
      await click('a[href="/app/progression/automation"]')
      await until(
        () =>
          sync(
            'return document.querySelector("h1")?.textContent.includes("Consentimiento recurrente")',
          ),
        'list',
      )
      assert.equal(
        await sync('return document.querySelectorAll(".app-header").length'),
        1,
      )
    },
  )
  await check(
    'C03 structured scope/policy/limits/offset validity and explicit target selection',
    async () => {
      await prepare(f)
      assert.equal(
        await execute('return store.preview.executionAuthorized'),
        false,
      )
      assert.equal(
        await execute(
          'return store.preview.snapshot.contract.limits.maximumLoad',
        ),
        '200.000001',
      )
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=confirmConsentRequest]").checked',
        ),
        false,
      )
      await screenshot('request-desktop')
    },
  )
  let id
  await check(
    'C04 human request confirmation records only PENDING_CONFIRMATION',
    async () => {
      await click('[data-testid="confirmConsentRequest"]')
      await click('[data-testid="createConsent"]')
      await until(
        () =>
          sync('return !!document.querySelector("[data-testid=consentSaved]")'),
        'saved',
      )
      id = await execute('return store.detail.id')
      await click('[data-testid="consentSaved"]')
      await until(
        () =>
          sync('return !!document.querySelector("[data-testid=consentState]")'),
        'detail',
      )
      assert.equal(
        (
          await db.progressionAutomationConsent.findUniqueOrThrow({
            where: { id },
          })
        ).state,
        'PENDING_CONFIRMATION',
      )
      assert.equal(
        await execute('return store.detail.acceptance.available'),
        true,
      )
      assert.equal(await db.progressionApplication.count(), 0)
    },
  )
  await check(
    'C05 exact stored conditions and immutable CREATE audit are visible',
    async () => {
      assert.equal(await execute('return store.detail.events.length'), 1)
      assert.equal(
        await execute(
          'return store.detail.events[0].snapshot.contract.limits.maximumLoad',
        ),
        '200.000001',
      )
      assert.match(
        await sync('return document.querySelector("main").textContent'),
        /Aceptación humana, sin ejecución habilitada/,
      )
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=confirmRevokeConsent]").checked',
        ),
        false,
      )
    },
  )
  await check(
    'C06 reviewing conditions appends version and preserves the earlier snapshot',
    async () => {
      await click('[data-testid="editConsent"]')
      await click('[data-testid="consentCandidates"]')
      await input('[data-consent="maximumLoad"]', '190.000001')
      await click('[data-consent="declaration"]')
      await click('[data-testid="consentPreview"]')
      await until(
        () => execute('return !!store.preview||!!store.error'),
        'revision preview',
      )
      assert.equal(await execute('return store.error?.code??null'), null)
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=confirmConsentRevision]").checked',
        ),
        false,
      )
      await click('[data-testid="confirmConsentRevision"]')
      await click('[data-testid="reviseConsent"]')
      await until(
        () => execute('return store.detail.version===2'),
        'new version',
      )
      assert.equal(
        await execute(
          'return store.detail.events[0].snapshot.contract.limits.maximumLoad',
        ),
        '200.000001',
      )
      assert.equal(
        await execute(
          'return store.detail.snapshot.contract.limits.maximumLoad',
        ),
        '190.000001',
      )
    },
  )
  await check('C07 explicit revocation is terminal and auditable', async () => {
    await click('[data-testid="confirmRevokeConsent"]')
    await click('[data-testid="revokeConsent"]')
    await until(
      () => execute("return store.detail.state==='REVOKED'"),
      'revoked',
    )
    assert.equal(await execute('return store.detail.version'), 3)
    assert.equal(
      await sync(
        'return !!document.querySelector("[data-testid=editConsent]")',
      ),
      false,
    )
  })
  await check('C08 reload retains REVOKED and all three versions', async () => {
    await go('/app/progression/automation/' + id)
    await until(() => execute('return !!store?.detail'), 'reloaded')
    assert.equal(await execute('return store.detail.state'), 'REVOKED')
    assert.equal(await execute('return store.detail.events.length'), 3)
  })
  await check(
    'C09 mobile layout and real keyboard focus preserve readable conditions',
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
      await screenshot('revoked-mobile')
      await command('/window/rect', 'POST', { width: 1440, height: 950 })
    },
  )
  await check(
    'C10 another account cannot read or revoke the first account request',
    async () => {
      await execute('await auth.logout()')
      await login(g)
      await go('/app/progression/automation/' + id)
      await until(() => execute('return !!store?.error'), 'foreign')
      assert.equal(await execute('return store.error.code'), 'SOURCE_NOT_FOUND')
      assert.equal(await execute('return store.detail'), null)
    },
  )
  await check(
    'C11 real committed CREATE response is lost and stays uncertain',
    async () => {
      await prepare(g)
      assert.equal(
        (
          await fetch(
            cfg.origin + '/api/v1/__prog6b_test__/lose-next-consent-response',
            { method: 'POST' },
          )
        ).status,
        204,
      )
      await click('[data-testid="confirmConsentRequest"]')
      await click('[data-testid="createConsent"]')
      await until(
        () => execute('return store.error?.uncertain===true&&!store.busy'),
        'unknown outcome',
      )
      assert.equal(
        await db.progressionAutomationConsent.count({
          where: { athleteId: g.athleteId },
        }),
        1,
      )
      assert.equal(await execute('return store.pending.action'), 'CREATE')
    },
  )
  let recovered
  await check(
    'C12 reload recovers by the original intention without replaying a private contract',
    async () => {
      await go('/app/progression/automation')
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=consentRecover]")',
          ),
        'identifiers',
      )
      assert.equal(await execute('return store.canRetry()'), false)
      assert.doesNotMatch(
        await sync('return Object.values(sessionStorage).join(" ")'),
        /accessToken|refreshToken|csrfToken|snapshot|contract|policy/,
      )
      await click('[data-testid="consentRecover"]')
      await until(
        () => execute('return !store.pending&&!!store.detail'),
        'confirmed',
      )
      recovered = await execute('return store.detail.id')
      assert.equal(
        await db.progressionAutomationConsentEvent.count({
          where: { consentId: recovered },
        }),
        1,
      )
    },
  )
  await check(
    'C13 current configuration changes are shown beside immutable original settings',
    async () => {
      await db.progressionSetting.updateMany({
        where: { athleteId: g.athleteId },
        data: { incrementAbsolute: '3' },
      })
      await go('/app/progression/automation/' + recovered)
      await until(() => execute('return !!store?.detail'), 'configuration')
      assert.equal(
        await execute('return store.detail.currentConfiguration'),
        'CHANGED',
      )
      assert.equal(
        await execute(
          'return store.detail.snapshot.bindings[0].selected.incrementAbsolute',
        ),
        '2.500',
      )
      assert.equal(
        await execute(
          'return store.detail.currentSnapshot.bindings[0].selected.incrementAbsolute',
        ),
        '3.000',
      )
      await db.progressionSetting.updateMany({
        where: { athleteId: g.athleteId },
        data: { incrementAbsolute: '2.5' },
      })
    },
  )
  await check(
    'C14 lost revocation response recovers the current terminal state',
    async () => {
      await click('[data-testid="confirmRevokeConsent"]')
      assert.equal(
        (
          await fetch(
            cfg.origin + '/api/v1/__prog6b_test__/lose-next-consent-response',
            { method: 'POST' },
          )
        ).status,
        204,
      )
      await click('[data-testid="revokeConsent"]')
      await until(
        () => execute('return store.error?.uncertain===true&&!store.busy'),
        'lost revoke',
      )
      await click('[data-testid="consentRecover"]')
      await until(
        () => execute("return !store.pending&&store.detail.state==='REVOKED'"),
        'recovered revoke',
      )
      assert.equal(
        await db.progressionAutomationConsentEvent.count({
          where: { consentId: recovered },
        }),
        2,
      )
    },
  )
  await check(
    'C15 revoked session cannot create a request and clears its previous UI context',
    async () => {
      await execute('await auth.logout()')
      await login(h)
      await prepare(h)
      await click('[data-testid="confirmConsentRequest"]')
      await db.authSession.updateMany({
        where: { userId: h.user.id },
        data: { revokedAt: new Date() },
      })
      await click('[data-testid="createConsent"]')
      await until(
        () => execute("return auth.status==='anonymous'"),
        'session revoked',
      )
      assert.equal(
        await db.progressionAutomationConsent.count({
          where: { athleteId: h.athleteId },
        }),
        0,
      )
      assert.equal(await execute('return store.detail'), null)
    },
  )
  await check(
    'C16 plans/workouts/history untouched and no automatic application or simulated session',
    async () => {
      assert.deepEqual(await history(), before)
      assert.equal(await db.progressionApplication.count(), 0)
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
  if (cfg.acceptance) {
    let acceptedId, acceptedInput
    await check(
      'A01 real login creates a pending request for explicit human acceptance',
      async () => {
        await login(acceptedFixture)
        await prepare(acceptedFixture)
        await click('[data-testid="confirmConsentRequest"]')
        await click('[data-testid="createConsent"]')
        await until(
          () => execute('return !!store.receipt&&!store.busy'),
          'new pending',
        )
        acceptedId = await execute('return store.receipt.consentId')
        await go('/app/progression/automation/' + acceptedId)
        await until(() => execute('return !!store.detail'), 'pending detail')
      },
    )
    await check(
      'A02 issued exact challenge starts with five unchecked acknowledgments',
      async () => {
        await click('[data-testid="requestAcceptanceChallenge"]')
        await until(() => execute('return !!store.challenge'), 'challenge')
        for (const name of [
          'Policy',
          'Limits',
          'Destinations',
          'Validity',
          'Revocation',
        ])
          assert.equal(
            await sync('return document.querySelector(arguments[0]).checked', [
              '[data-testid="accept' + name + '"]',
            ]),
            false,
          )
        assert.equal(
          await sync(
            'return document.querySelector("[data-testid=confirmHumanAcceptance]").disabled',
          ),
          true,
        )
        const c = await execute('return store.challenge')
        assert.equal(c.version, 1)
        assert.equal(c.executionAuthorized, false)
        assert.equal(c.snapshot.contract.limits.maximumLoad, '200.000001')
      },
    )
    await check(
      'A03 partial confirmation is blocked and a new challenge resets previous marks',
      async () => {
        await click('[data-testid="acceptPolicy"]')
        assert.equal(
          await sync(
            'return document.querySelector("[data-testid=confirmHumanAcceptance]").disabled',
          ),
          true,
        )
        await click('[data-testid="requestAcceptanceChallenge"]')
        await until(
          () => execute('return !store.busy&&!!store.challenge'),
          'new challenge',
        )
        assert.equal(
          await sync(
            'return document.querySelector("[data-testid=acceptPolicy]").checked',
          ),
          false,
        )
      },
    )
    await check(
      'A04 five explicit acknowledgments commit acceptance despite a lost response',
      async () => {
        await execute(
          "const original=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){if(typeof body==='string'){try{const v=JSON.parse(body);if(v.challengeId&&v.acknowledgments)window.__acceptanceInput=v}catch{}}return original.apply(this,arguments)};",
        )
        for (const name of [
          'Policy',
          'Limits',
          'Destinations',
          'Validity',
          'Revocation',
        ])
          await click('[data-testid="accept' + name + '"]')
        await screenshot('acceptance-desktop')
        assert.equal(
          (
            await fetch(
              cfg.origin + '/api/v1/__prog6b_test__/lose-next-consent-response',
              { method: 'POST' },
            )
          ).status,
          204,
        )
        await click('[data-testid="confirmHumanAcceptance"]')
        await until(
          () => execute('return !store.busy&&store.error?.uncertain===true'),
          'lost acceptance',
        )
        acceptedInput = await sync('return window.__acceptanceInput')
        assert.ok(
          acceptedInput?.intentId,
          'Observed actual acceptance payload required',
        )
        const row = await db.progressionAutomationConsent.findUniqueOrThrow({
          where: { id: acceptedId },
        })
        assert.equal(row.state, 'ACCEPTED_INACTIVE')
        assert.equal(row.version, 2)
        assert.equal(
          await db.progressionAutomationConsentEvent.count({
            where: { consentId: acceptedId, action: 'ACCEPT' },
          }),
          1,
        )
      },
    )
    await check(
      'A05 reload recovers intention without replaying private acknowledgment payload',
      async () => {
        await go('/app/progression/automation/' + acceptedId)
        await until(
          () => execute('return !!store.pending&&!store.busy'),
          'recover IDs',
        )
        assert.doesNotMatch(
          await sync(
            "return sessionStorage.getItem('pulso:pending-consent:v1')",
          ),
          /acknowledgments|conditionsPresented|contractKey/,
        )
        await click('[data-testid="consentRecover"]')
        await until(
          () =>
            execute(
              "return !store.pending&&store.detail?.state==='ACCEPTED_INACTIVE'",
            ),
          'accepted recovery',
        )
        assert.equal(
          await execute('return store.detail.acceptance.humanAcceptance'),
          'RECORDED',
        )
        assert.equal(
          await execute('return store.detail.executionAuthorized'),
          false,
        )
        assert.equal(
          await db.progressionAutomationConsentEvent.count({
            where: { consentId: acceptedId, action: 'ACCEPT' },
          }),
          1,
        )
      },
    )
    await check(
      'A06 accepted terms stay immutable with no revision or execution action',
      async () => {
        assert.equal(
          await sync(
            'return !!document.querySelector("[data-testid=editConsent]")',
          ),
          false,
        )
        assert.equal(
          await sync(
            'return !!document.querySelector("[data-testid=confirmHumanAcceptance]")',
          ),
          false,
        )
        assert.match(
          await sync('return document.querySelector("main").textContent'),
          /sin ejecución/i,
        )
        const events = await db.progressionAutomationConsentEvent.findMany({
          where: { consentId: acceptedId },
          orderBy: { version: 'asc' },
        })
        assert.deepEqual(events[0].snapshot, events[1].snapshot)
        assert.equal(events[0].snapshot.humanAcceptance, 'NOT_RECORDED')
        assert.equal(events[1].acceptanceEvidence.conditionsPresented, true)
      },
    )
    await check(
      'A07 mobile audit and explicit revocation preserve historical acceptance',
      async () => {
        await command('/window/rect', 'POST', { width: 500, height: 850 })
        await screenshot('accepted-inactive-mobile')
        assert.equal(
          await sync(
            'return document.documentElement.scrollWidth<=innerWidth+1',
          ),
          true,
        )
        await click('[data-testid="confirmRevokeConsent"]')
        await click('[data-testid="revokeConsent"]')
        await until(
          () => execute("return !store.busy&&store.detail?.state==='REVOKED'"),
          'accepted revocation',
        )
        assert.equal(
          await db.progressionAutomationConsentEvent.count({
            where: { consentId: acceptedId },
          }),
          3,
        )
      },
    )
    await check(
      'A08 a fresh intention with old challenge cannot revive a revoked consent',
      async () => {
        const status = await execute(
          "if(auth.status!=='authenticated'||!auth.accessToken)throw Error('Real authenticated browser context required');const r=await fetch('/api/v1/progression/automation-consents/'+arguments[0]+'/acceptances',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.accessToken},body:JSON.stringify({...arguments[1],intentId:crypto.randomUUID()})});return r.status",
          [acceptedId, acceptedInput],
        )
        assert.equal(status, 409)
        assert.equal(
          (
            await db.progressionAutomationConsent.findUniqueOrThrow({
              where: { id: acceptedId },
            })
          ).state,
          'REVOKED',
        )
      },
    )
    await check(
      'A09 terminal reload preserves acceptance audit and leaves plans/workouts untouched',
      async () => {
        await go('/app/progression/automation/' + acceptedId)
        await until(
          () => execute('return !!store.detail&&!store.busy'),
          'terminal reload',
        )
        assert.equal(
          await execute('return store.detail.acceptance.humanAcceptance'),
          'RECORDED',
        )
        assert.equal(
          await execute('return store.detail.events[1].action'),
          'ACCEPT',
        )
        assert.deepEqual(await history(), before)
        assert.equal(await db.progressionApplication.count(), 0)
        assert.equal(
          await db.progressionSetting.count({
            where: { autoApplyAuthorized: true },
          }),
          0,
        )
      },
    )
  }
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
