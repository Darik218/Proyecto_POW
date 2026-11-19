// Firefox real, Nest real y PostgreSQL efímero. Solo el runner aislado aporta configuración por stdin.
import assert from 'node:assert/strict'
import { consentFixture } from './automation-consent.fixtures.mjs'
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
  evidence = await mkdtemp(join(tmpdir(), 'pulso-settings1-evidence-'))
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
    script: `const done=arguments[arguments.length-1];(async()=>{const auth=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('auth'),store=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('progression-settings');${code}})().then(value=>done({value}),error=>done({error:error.message,status:error.response?.status}));`,
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
    'return {path:location.pathname,errors:window.__routeErrors,progression:document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia._s.get("progression")?.error,link:document.querySelector("[data-testid=savedDetail]")?.getAttribute("href")}',
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
    'progression_automation_consents',
    'progression_automation_consent_events',
  ])
    result[table] = (
      await sql.query(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${table} t`,
      )
    ).rows[0].hash
  return result
}
const values = {
  minSuccessfulSessions: '2',
  targetRpeMin: '6.0',
  targetRpeMax: '8.0',
  incrementAbsolute: '2.500',
  incrementPercent: '',
  maxIncrementPercent: '10.000',
  maxLoad: '',
}
async function fields(overrides = {}) {
  for (const [k, v] of Object.entries({ ...values, ...overrides }))
    await input(`[data-setting-param="${k}"]`, v)
}
async function navigate(path) {
  await execute(
    "await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(arguments[0]);return true",
    [path],
  )
  await until(
    () => sync('return !document.querySelector("vite-error-overlay")'),
    'navigation',
  )
}
async function selectExercise(f) {
  await input('input[type="search"]', f.exercise.name)
  await click(`input[type="radio"][value="${f.exercise.id}"]`)
}
async function createScope(f, kind, overrides = {}) {
  await navigate('/app/progression/settings/new')
  await input('[data-testid=settingScope]', kind)
  if (kind !== 'ATHLETE') await selectExercise(f)
  if (kind === 'EXERCISE_PLAN')
    await input('[data-testid=settingPlan]', f.plan.id)
  await fields(overrides)
  await click('[data-testid=saveSetting]')
  await until(
    () => execute('return !store.busy&&(!!store.receipt||!!store.error)'),
    'create scope',
  )
  assert.equal(await execute('return store.error?.code??null'), null)
  return execute('return store.receipt.settingId')
}
async function effective(f, plan = false) {
  await navigate('/app/progression/settings')
  await selectExercise(f)
  if (plan) await input('[data-testid=effectiveSettingPlan]', f.plan.id)
  await click('[data-testid=resolveSetting]')
  await until(
    () => execute('return !store.busy&&(!!store.resolution||!!store.error)'),
    'effective',
  )
  assert.equal(await execute('return store.error?.code??null'), null)
  return execute(
    'return {scope:store.resolution.scope,id:store.resolution.selected?.id,reasons:store.resolution.settingReasons,execution:store.resolution.executionAuthorized,parameters:store.resolution.selected?.parameters}',
  )
}
async function api(path, method, body) {
  return execute(
    "const r=await fetch('/api/v1/progression/settings'+arguments[0],{method:arguments[1],headers:{Authorization:'Bearer '+auth.accessToken,'Content-Type':'application/json'},...(arguments[2]?{body:JSON.stringify(arguments[2])}:{})});return {status:r.status,body:await r.json()}",
    [path, method, body],
  )
}
try {
  const f = await fixture('Settings principal'),
    g = await fixture('Settings otra cuenta')
  await db.progressionSetting.deleteMany({
    where: { athleteId: { in: [f.athleteId, g.athleteId] } },
  })
  const before = await history()
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
    'S01 protected settings URL requires authentication',
    async () => {
      await go('/app/progression/settings')
      assert.equal(await sync('return location.pathname'), '/login')
    },
  )
  await check(
    'S02 actual login and navigation preserve single layout',
    async () => {
      await login(f)
      await go('/app/progression')
      await click('a[href="/app/progression/settings"]')
      await until(
        () =>
          sync('return !!document.querySelector("[data-testid=noSettings]")'),
        'empty list',
      )
      assert.equal(
        await sync('return document.querySelectorAll(".app-header").length'),
        1,
      )
    },
  )
  await check('S03 explicit context has no invented setting', async () => {
    const r = await effective(f)
    assert.equal(r.id, null)
    assert.ok(r.reasons.includes('SETTING_REQUIRED'))
    assert.equal(r.execution, false)
  })
  const dates = {
    start: '2026-01-05',
    finish: '2026-01-12',
    cutoff: '2026-01-11',
  }
  await check(
    'S04 missing configuration links from real progression context without automatic calculation',
    async () => {
      await navigate('/app/progression/new')
      for (const [k, v] of Object.entries({
        plan: f.plan.id,
        week: f.week.id,
        day: f.day.id,
        prescription: f.p.id,
        start: dates.start,
        endExclusive: dates.finish,
        cutoffOn: dates.cutoff,
        from: '2026-01-01',
        timeZone: 'UTC',
        weekStartsOn: '1',
      }))
        await input(`[data-testid="${k}"]`, v)
      await click('[data-testid=context]')
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=configureMissingSetting]")',
          ),
        'missing config',
      )
      await click('[data-testid=configureMissingSetting]')
      await until(
        () => sync('return location.pathname==="/app/progression/settings"'),
        'settings return context',
      )
      await click('[data-testid=newSetting]')
      await input('[data-testid=settingScope]', 'ATHLETE')
      assert.ok(
        await sync(
          'return [...document.querySelectorAll("[data-setting-param]")].every(e=>e.value==="")',
        ),
      )
    },
  )
  let general, exercise, plan
  await check(
    'S05 explicit complete general creation persists exact decimals',
    async () => {
      await fields()
      await click('[data-testid=saveSetting]')
      await until(
        () => execute('return !store.busy&&!!store.receipt'),
        'general saved',
      )
      general = await execute('return store.receipt.settingId')
      assert.equal(
        await db.progressionSetting.count({
          where: { athleteId: f.athleteId },
        }),
        1,
      )
      assert.equal(
        (
          await db.progressionSetting.findUniqueOrThrow({
            where: { id: general },
          })
        ).incrementAbsolute.toFixed(3),
        '2.500',
      )
      await screenshot('settings-created-desktop')
    },
  )
  await check(
    'S06 return restores destination/dates and requires explicit fresh context',
    async () => {
      await click('[data-testid=returnToProgression]')
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=prescription]")?.value===arguments[0]',
            [f.p.id],
          ),
        'draft restored',
      )
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=start]").value',
        ),
        dates.start,
      )
      assert.equal(
        await execute(
          "return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('progression').preview",
        ),
        null,
      )
      await click('[data-testid=context]')
      await until(
        () =>
          execute(
            "return !!document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('progression').context",
          ),
        'fresh context',
      )
      assert.equal(
        await execute(
          "return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('progression').context.configuration.scope",
        ),
        'ATHLETE',
      )
      assert.equal(
        await execute(
          "return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('progression').context.configuration.selected.incrementAbsolute",
        ),
        '2.500',
      )
    },
  )
  await check(
    'S07 effective general exposes whole-row provenance and separate policy requirements',
    async () => {
      const r = await effective(f)
      assert.equal(r.id, general)
      assert.equal(r.scope, 'ATHLETE')
      assert.ok(
        await sync(
          'return document.querySelector("[data-testid=settingResolution]").textContent.includes("procedencia fila")',
        ),
      )
      assert.ok(
        await execute('return store.resolution.externalRequirements.length>0'),
      )
    },
  )
  await check(
    'S08 exercise setting overrides general without merging null maxLoad',
    async () => {
      exercise = await createScope(f, 'EXERCISE', {
        incrementAbsolute: '1.250',
      })
      const r = await effective(f)
      assert.equal(r.id, exercise)
      assert.equal(r.scope, 'EXERCISE')
      assert.equal(r.parameters.maxLoad, null)
    },
  )
  await check(
    'S09 exercise-plan setting has highest precedence and explicit target',
    async () => {
      plan = await createScope(f, 'EXERCISE_PLAN', {
        incrementAbsolute: '0.500',
      })
      const r = await effective(f, true)
      assert.equal(r.id, plan)
      assert.equal(r.scope, 'EXERCISE_PLAN')
    },
  )
  let oldRevision
  await check(
    'S10 replacing full row requires impact and initially unchecked confirmation',
    async () => {
      await navigate('/app/progression/settings/' + plan)
      await until(
        () =>
          execute('return store.detail?.id===arguments[0]&&!store.busy', [
            plan,
          ]),
        'edit row',
      )
      oldRevision = await execute('return store.detail.revision')
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=saveSetting]").disabled',
        ),
        true,
      )
      await input('[data-setting-param=incrementAbsolute]', '0.750')
      await click('[data-testid=settingImpact]')
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=confirmSettingImpact]")',
          ),
        'impact',
      )
      assert.equal(
        await sync(
          'return document.querySelector("[data-testid=confirmSettingImpact]").checked',
        ),
        false,
      )
      await click('[data-testid=confirmSettingImpact]')
      await click('[data-testid=saveSetting]')
      await until(
        () =>
          execute('return !store.busy&&store.detail?.revision!==arguments[0]', [
            oldRevision,
          ]),
        'updated',
      )
      assert.equal(
        (
          await db.progressionSetting.findUniqueOrThrow({ where: { id: plan } })
        ).incrementAbsolute.toFixed(3),
        '0.750',
      )
    },
  )
  await check(
    'S11 stale revision conflicts and cannot overwrite current row',
    async () => {
      const params = await execute('return store.detail.parameters'),
        r = await api('/' + plan, 'PUT', {
          intentId: randomUUID(),
          expectedRevision: oldRevision,
          parameters: params,
          confirmImpact: true,
        })
      assert.equal(r.status, 409)
      assert.equal(r.body.code, 'STALE_SETTING')
    },
  )
  await check(
    'S12 duplicate scope and exact precision validation reject without extra rows',
    async () => {
      const params = await execute('return store.detail.parameters')
      const dup = await api('', 'POST', {
        intentId: randomUUID(),
        scope: { exerciseId: f.exercise.id, trainingPlanId: null },
        parameters: params,
      })
      assert.equal(dup.status, 409)
      const bad = await api('', 'POST', {
        intentId: randomUUID(),
        scope: { exerciseId: null, trainingPlanId: null },
        parameters: { ...params, incrementAbsolute: '0.0001' },
      })
      assert.equal(bad.status, 422)
      assert.equal(
        await db.progressionSetting.count({
          where: { athleteId: f.athleteId },
        }),
        3,
      )
    },
  )
  await check(
    'S13 actual unit mismatch and incomplete parameters remain rejected without inference',
    async () => {
      await effective(f, true)
      const policy = consentFixture().contract.policy
      const mismatch = await api('/effective', 'POST', {
        exerciseId: f.exercise.id,
        trainingPlanId: f.plan.id,
        policy: { ...policy, settingLoadUnit: 'LB' },
      })
      assert.equal(mismatch.status, 200)
      assert.ok(mismatch.body.reasons.includes('UNIT_POLICY_MISMATCH'))
      assert.equal(mismatch.body.executionAuthorized, false)
      const incomplete = await api('', 'POST', {
        intentId: randomUUID(),
        scope: { exerciseId: null, trainingPlanId: null },
        parameters: { minSuccessfulSessions: 2 },
      })
      assert.equal(incomplete.status, 400)
      const foreignContext = await api('/effective', 'POST', {
        exerciseId: f.exercise.id,
        trainingPlanId: g.plan.id,
      })
      assert.equal(foreignContext.status, 404)
      assert.ok(
        await sync(
          'return document.querySelector("[data-testid=settingResolution]").textContent.includes("no tienen unidad propia")',
        ),
      )
    },
  )
  await check(
    'S14 post-COMMIT lost PUT retains only bounded identifiers',
    async () => {
      await navigate('/app/progression/settings/' + plan)
      await until(
        () =>
          execute('return store.detail?.id===arguments[0]&&!store.busy', [
            plan,
          ]),
        'reload edit',
      )
      await input('[data-setting-param=incrementAbsolute]', '1.000')
      await click('[data-testid=settingImpact]')
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=confirmSettingImpact]")',
          ),
        'impact again',
      )
      await click('[data-testid=confirmSettingImpact]')
      await execute(
        "await fetch('/api/v1/__prog6b_test__/lose-next-consent-response',{method:'POST'});return true",
      )
      await click('[data-testid=saveSetting]')
      await until(
        () => execute('return !store.busy&&!!store.pending&&!!store.error'),
        'lost response',
      )
      assert.equal(
        (
          await db.progressionSetting.findUniqueOrThrow({ where: { id: plan } })
        ).incrementAbsolute.toFixed(3),
        '1.000',
      )
      const cache = await sync(
        'return JSON.parse(sessionStorage.getItem("pulso:pending-setting:v1"))',
      )
      assert.ok(cache.intentId)
      assert.equal(cache.parameters, undefined)
      assert.equal(cache.expectedRevision, undefined)
    },
  )
  await check(
    'S15 reload recovers receipt/current state without resending private operation',
    async () => {
      const beforeReceipts = await db.progressionSettingMutation.count()
      await go('/app/progression/settings/' + plan)
      await click('[data-testid=recoverSetting]')
      await until(
        () => execute('return !store.busy&&!store.pending&&!!store.receipt'),
        'recover confirmed',
      )
      assert.equal(
        await execute('return store.detail.parameters.incrementAbsolute'),
        '1.000',
      )
      assert.equal(await db.progressionSettingMutation.count(), beforeReceipts)
      assert.equal(
        await sync('return sessionStorage.getItem("pulso:pending-setting:v1")'),
        null,
      )
    },
  )
  await check(
    'S16 mobile layout, keyboard focus and form labels remain usable',
    async () => {
      await command('/window/rect', 'POST', { width: 390, height: 844 })
      await navigate('/app/progression/settings/' + plan)
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-setting-param=targetRpeMin]")',
          ),
        'mobile form',
      )
      assert.equal(
        await sync('return document.documentElement.scrollWidth<=innerWidth+1'),
        true,
      )
      await sync(
        'document.querySelector("[data-setting-param=targetRpeMin]").focus()',
      )
      assert.equal(
        await sync(
          'return document.activeElement.getAttribute("data-setting-param")',
        ),
        'targetRpeMin',
      )
      assert.ok(
        await sync(
          'return [...document.querySelectorAll("[data-setting-param]")].every(e=>e.closest("label"))',
        ),
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
        await sync(
          'return document.activeElement.getAttribute("data-setting-param")',
        ),
        'targetRpeMax',
      )
      assert.equal(
        await sync('return document.activeElement.matches(":focus-visible")'),
        true,
      )
      console.log(
        'Verified compact CSS viewport: ' +
          JSON.stringify(
            await sync(
              'return {width:innerWidth,height:innerHeight,devicePixelRatio}',
            ),
          ),
      )
      await screenshot('settings-mobile')
    },
  )
  await check(
    'S17 account change clears cached context and prevents foreign row/receipt reads',
    async () => {
      await execute('await auth.logout();return true')
      await login(g)
      await go('/app/progression/settings')
      await until(
        () =>
          sync('return !!document.querySelector("[data-testid=noSettings]")'),
        'other empty',
      )
      const r = await api('/' + plan, 'GET')
      assert.equal(r.status, 404)
      assert.equal(await execute('return store.detail'), null)
    },
  )
  await check(
    'S20 lost CREATE after commit recovers by intention after reload without duplication',
    async () => {
      await navigate('/app/progression/settings/new')
      await input('[data-testid=settingScope]', 'ATHLETE')
      await fields()
      await execute(
        "await fetch('/api/v1/__prog6b_test__/lose-next-consent-response',{method:'POST'});return true",
      )
      await sync(
        'const e=document.querySelector("[data-testid=saveSetting]");e.click();e.click()',
      )
      await until(
        () => execute('return !store.busy&&!!store.pending&&!!store.error'),
        'lost create',
      )
      assert.equal(
        await db.progressionSetting.count({
          where: { athleteId: g.athleteId },
        }),
        1,
      )
      const receipts = await db.progressionSettingMutation.count()
      await go('/app/progression/settings')
      await click('[data-testid=recoverSetting]')
      await until(
        () => execute('return !store.busy&&!store.pending&&!!store.receipt'),
        'recover create',
      )
      assert.equal(await db.progressionSettingMutation.count(), receipts)
      assert.equal(
        await db.progressionSetting.count({
          where: { athleteId: g.athleteId },
        }),
        1,
      )
    },
  )
  await check(
    'S18 revoked persistent session cannot write configuration',
    async () => {
      await db.authSession.updateMany({
        where: { userId: g.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      const r = await api('', 'POST', {
        intentId: randomUUID(),
        scope: { exerciseId: null, trainingPlanId: null },
        parameters: {
          minSuccessfulSessions: 2,
          targetRpeMin: '6.0',
          targetRpeMax: '8.0',
          incrementAbsolute: '2.500',
          incrementPercent: null,
          maxIncrementPercent: '10.000',
          maxLoad: null,
        },
      })
      assert.equal(r.status, 401)
      assert.equal(
        await db.progressionSetting.count({
          where: { athleteId: g.athleteId },
        }),
        1,
      )
    },
  )
  await check(
    'S19 all historical training/planning/consent evidence unchanged and no automation',
    async () => {
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
