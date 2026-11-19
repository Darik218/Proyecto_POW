// Real Firefox against the explicitly supplied, independently guarded temporary runtime.
// Browser plugin is unavailable; the user authorized the existing Firefox/WebDriver fallback.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  readFile,
  realpath,
  mkdtemp,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
const require = createRequire(resolve("../backend/package.json"));
const { Client } = require("pg");
let raw = "";
for await (const part of process.stdin) raw += part;
const cfg = JSON.parse(raw),
  database = new URL(cfg.databaseUrl),
  origin = new URL(cfg.origin);
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/pulso_final_mvp_demo");
assert.notEqual(database.port, "5432");
assert.ok(cfg.dataDirectory.startsWith("/tmp/pulso-final-mvp-demo-"));
assert.equal(origin.hostname, "127.0.0.1");
assert.equal(cfg.periodic, false);
const sql = new Client({ connectionString: cfg.databaseUrl });
await sql.connect();
const {
  rows: [guard],
} = await sql.query(
  "SELECT current_database() AS name,current_setting('data_directory') AS directory,current_setting('port') AS port",
);
assert.equal(guard.name, "pulso_final_mvp_demo");
assert.equal(guard.port, database.port);
assert.equal(
  await realpath(guard.directory),
  await realpath(cfg.dataDirectory),
);
const uiFinal = process.argv.includes("--ui-final");
const evidenceRoot = resolve(
  "../..",
  uiFinal ? "ui-final-validation/browser" : "prog7-validation/browser",
);
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, "run-")),
  results = [],
  healthChecks = [];
const { rows: catalog } = await sql.query(
  "SELECT id,name FROM exercises WHERE is_active AND origin='GLOBAL' ORDER BY created_at LIMIT 2",
);
assert.ok(
  catalog.length,
  "At least one real active global catalog exercise is required",
);
const port = await new Promise((resolvePort) => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1", () => {
    const p = listener.address().port;
    listener.close(() => resolvePort(p));
  });
});
const driver = spawn(
  "/snap/firefox/current/usr/lib/firefox/geckodriver",
  ["--host", "127.0.0.1", "--port", String(port)],
  { stdio: "ignore" },
);
const driverUrl = `http://127.0.0.1:${port}`;
let sid, athleteId, planId, planning;
const email = `final-ux-${randomUUID()}@example.test`,
  password = randomBytes(24).toString("base64url") + "aA1!";
async function wd(path = "", method = "GET", body) {
  const response = await fetch(driverUrl + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error)
    throw Error(
      `WebDriver ${result.value?.error ?? response.status}: ${result.value?.message ?? ""}`,
    );
  return result.value;
}
const command = (path, method = "GET", body) =>
  wd("/session/" + sid + path, method, body);
const sync = (script, args = []) =>
  command("/execute/sync", "POST", { script, args });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await pause(100);
  }
  const state = await sync(
    "return {path:location.pathname,text:document.querySelector('main')?.textContent.slice(-1800)}",
  );
  throw Error("Timeout " + label + " " + JSON.stringify(state));
}
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", detail });
    console.log("PASS " + name);
    return true;
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.log("FAIL " + name + ": " + error.message);
    throw error;
  }
}
async function execute(code, args = []) {
  const result = await command("/execute/async", "POST", {
    script: `const done=arguments[arguments.length-1];(async()=>{const auth=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth');${code}})().then(value=>done({value}),error=>done({error:error.message,status:error.response?.status}));`,
    args,
  });
  if (result.error) throw Error(result.error + " HTTP " + result.status);
  return result.value;
}
async function request(method, path, data) {
  return execute(
    "const response=await fetch(arguments[3]+arguments[1],{method:arguments[0].toUpperCase(),headers:{'Content-Type':'application/json','Authorization':'Bearer '+auth.accessToken},body:arguments[2]==null?undefined:JSON.stringify(arguments[2])});return {status:response.status,data:await response.json()}",
    [method, path, data, cfg.apiPath ?? "/api/v1"],
  );
}
async function go(path) {
  const pathname = new URL(path, cfg.origin).pathname;
  await execute(
    "await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(arguments[0]);return true",
    [path],
  );
  await until(
    () =>
      sync(
        'return location.pathname===arguments[0]&&!document.querySelector("vite-error-overlay")',
        [pathname],
      ),
    "route " + path,
  );
  await pause(200);
}
async function click(selector) {
  const element = await sync(
    'const e=document.querySelector(arguments[0]);if(!e||e.disabled||e.closest("[inert]")||!e.getClientRects().length)return null;e.scrollIntoView({block:"center"});return e',
    [selector],
  );
  assert.ok(element, "visible enabled control " + selector);
  await command(
    "/element/" + element["element-6066-11e4-a52e-4f735466cecf"] + "/click",
    "POST",
    {},
  );
}
async function textClick(selector, text) {
  const element = await sync(
    'const e=[...document.querySelectorAll(arguments[0])].find(e=>e.textContent.replace(/\\s+/g," ").trim()===arguments[1]&&!e.closest("[inert]"));if(!e||e.disabled||!e.getClientRects().length)return null;e.scrollIntoView({block:"center"});return e',
    [selector, text],
  );
  assert.ok(element, "visible enabled control " + text);
  await command(
    "/element/" + element["element-6066-11e4-a52e-4f735466cecf"] + "/click",
    "POST",
    {},
  );
}
async function navigate(label) {
  const mobile = await sync('return matchMedia("(max-width: 900px)").matches');
  if (uiFinal && mobile) {
    await textClick(".app-bottom-nav a", label);
    return;
  }
  if (mobile) await click(".mobile-menu-button");
  await textClick(".app-sidebar a", label);
}
async function field(selector, value) {
  await until(
    () =>
      sync(
        'const e=document.querySelector(arguments[0]);return !!e&&!e.disabled&&!!e.getClientRects().length&&(e.tagName!=="SELECT"||[...e.options].some(o=>o.value===arguments[1]))',
        [selector, String(value)],
      ),
    "visible ready field " + selector,
  );
  assert.equal(
    await sync(
      'const element=document.querySelector(arguments[0]);if(!element||element.disabled||!element.getClientRects().length)return false;element.value=arguments[1];element.dispatchEvent(new Event(element.tagName==="SELECT"?"change":"input",{bubbles:true}));return true',
      [selector, String(value)],
    ),
    true,
    "field " + selector,
  );
}
async function viewport(width, height) {
  await command("/moz/context", "POST", { context: "chrome" });
  await sync(
    "document.documentElement.style.minWidth='0px';document.documentElement.style.minHeight='0px';document.querySelector('#navigator-toolbox')?.style.setProperty('min-width','0px')",
  );
  await command("/moz/context", "POST", { context: "content" });
  await command("/window/rect", "POST", { width, height });
  for (let i = 0; i < 3; i++) {
    const actual = await sync(
      "return {width:innerWidth,height:innerHeight,outerWidth,outerHeight}",
    );
    if (actual.width === width && actual.height === height) return;
    await command("/window/rect", "POST", {
      width: width + actual.outerWidth - actual.width,
      height: height + actual.outerHeight - actual.height,
    });
  }
  assert.equal(await sync("return innerWidth"), width);
}
async function shot(name) {
  await writeFile(
    join(evidence, name + ".png"),
    Buffer.from(await command("/screenshot"), "base64"),
  );
}
async function health(name) {
  await pause(200);
  const value = await sync(
    'return {path:location.pathname,width:innerWidth,title:document.title,meaningful:document.querySelector("main")?.textContent.length,overflow:document.documentElement.scrollWidth-innerWidth,overlay:!!document.querySelector("vite-error-overlay"),falseEmpty:[...document.querySelectorAll("svg[data-testid^=progress-]")].filter(e=>e.closest("figure")?.textContent.includes("No hay registros para esta gráfica")).map(e=>e.getAttribute("data-testid")),errors:window.__finalUxErrors??[],warnings:window.__finalUxWarnings??[],offenders:[...document.querySelectorAll("main *")].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,8).map(e=>e.tagName+"."+e.className)}',
  );
  assert.ok(value.meaningful > 50);
  assert.equal(value.overlay, false);
  assert.deepEqual(value.falseEmpty, []);
  assert.ok(
    value.overflow <= 1,
    "overflow " +
      JSON.stringify({
        width: value.width,
        overflow: value.overflow,
        offenders: value.offenders,
      }),
  );
  assert.deepEqual(value.errors, []);
  assert.deepEqual(value.warnings, []);
  assert.match(value.title, /PULSO/i);
  await shot(name);
  healthChecks.push({ name, ...value });
  return value;
}

async function sourceModule(path) {
  const ts = require("typescript");
  async function sourceUrl(file) {
    let js = ts.transpileModule(await readFile(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    for (const match of [...js.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)]) {
      const dependency = resolve(
        dirname(file),
        match[2] + (match[2].endsWith(".ts") ? "" : ".ts"),
      );
      js = js.replace(
        match[0],
        "from " + JSON.stringify(await sourceUrl(dependency)),
      );
    }
    return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
  }
  return import(await sourceUrl(path));
}
async function prepareCatalog() {
  // Use the repository's real catalog metadata and ranking; never invent recommendation fixtures.
  const source = await sourceModule(
    resolve("../backend/prisma/exercise-catalog.seed.ts"),
  );
  const aliases = await sourceModule(
    resolve("../backend/prisma/exercise-aliases.seed.ts"),
  );
  const groups = new Map();
  await sql.query("BEGIN");
  try {
    for (const group of source.muscleGroups) {
      const {
        rows: [saved],
      } = await sql.query(
        "INSERT INTO muscle_groups(id,key,name,description,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(key) DO UPDATE SET key=excluded.key RETURNING id",
        [randomUUID(), group.key, group.name, group.description],
      );
      groups.set(group.key, saved.id);
    }
    const fields = {
      catalogKey: "catalog_key",
      name: "name",
      equipment: "equipment",
      equipmentType: "equipment_type",
      machineType: "machine_type",
      resistanceType: "resistance_type",
      movementType: "movement_type",
      movementPattern: "movement_pattern",
      grip: "grip",
      gripWidth: "grip_width",
      bodyPosition: "body_position",
      laterality: "laterality",
      movementPlane: "movement_plane",
      difficulty: "difficulty",
      oneRmSuitability: "one_rm_suitability",
      description: "description",
      instructions: "instructions",
    };
    for (const entry of source.exercises) {
      const rank = aliases.featuredExerciseKeys.indexOf(entry.catalogKey);
      const columns = [
        "id",
        "primary_muscle_group_id",
        "featured_rank",
        ...Object.values(fields),
        "updated_at",
      ];
      const values = [
        randomUUID(),
        groups.get(entry.primaryMuscleGroupKey),
        rank < 0 ? null : rank + 1,
        ...Object.keys(fields).map((key) => entry[key]),
        new Date(),
      ];
      const {
        rows: [saved],
      } = await sql.query(
        `INSERT INTO exercises(${columns.join(",")}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT(catalog_key) DO UPDATE SET catalog_key=excluded.catalog_key RETURNING id`,
        values,
      );
      for (const key of entry.secondaryMuscleGroupKeys ?? [])
        await sql.query(
          "INSERT INTO exercise_secondary_muscle_groups(exercise_id,muscle_group_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [saved.id, groups.get(key)],
        );
      for (const name of aliases.exerciseAliases[entry.catalogKey] ?? [])
        await sql.query(
          "INSERT INTO exercise_aliases(id,exercise_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [randomUUID(), saved.id, name],
        );
    }
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }
  return {
    source: "backend/prisma/exercise-catalog.seed.ts",
    groups: source.muscleGroups.length,
    exercises: source.exercises.length,
  };
}
async function immutableHistory() {
  return JSON.stringify(
    (
      await sql.query(
        "SELECT row_to_json(r)::text AS row FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id JOIN workout_sessions s ON s.id=e.session_id WHERE s.athlete_id=$1 ORDER BY r.id",
        [athleteId],
      )
    ).rows,
  );
}
async function immutablePlans() {
  const queries = [
    "SELECT row_to_json(p)::text AS row FROM training_plans p WHERE p.athlete_id=$1 ORDER BY p.id",
    "SELECT row_to_json(w)::text AS row FROM plan_weeks w JOIN training_plans p ON p.id=w.training_plan_id WHERE p.athlete_id=$1 ORDER BY w.id",
    "SELECT row_to_json(d)::text AS row FROM plan_days d JOIN plan_weeks w ON w.id=d.plan_week_id JOIN training_plans p ON p.id=w.training_plan_id WHERE p.athlete_id=$1 ORDER BY d.id",
    "SELECT row_to_json(e)::text AS row FROM plan_exercises e JOIN plan_weeks w ON w.id=e.plan_week_id JOIN training_plans p ON p.id=w.training_plan_id WHERE p.athlete_id=$1 ORDER BY e.id",
  ];
  const rows = [];
  for (const query of queries)
    rows.push((await sql.query(query, [athleteId])).rows);
  return JSON.stringify(rows);
}
async function api(method, path, body, status = 200) {
  const result = await request(method, path, body);
  assert.equal(result.status, status, JSON.stringify(result));
  return result.data;
}
async function observeRequests() {
  await sync(
    `window.__prog7Requests=[];if(!window.__prog7Observer){window.__prog7Observer=true;const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(method,url,...rest){this.__prog7={method:String(method).toUpperCase(),path:new URL(String(url),location.href).pathname};return open.call(this,method,url,...rest)};XMLHttpRequest.prototype.send=function(body){window.__prog7Requests.push({...this.__prog7,body:typeof body==='string'?JSON.parse(body):null});return send.apply(this,arguments)}}`,
  );
}

async function recordWholeSession(
  id,
  { offset = 0, reps = 8, beforeFirstSet, afterFirstSet } = {},
) {
  const session = await api("get", `/workout-sessions/${id}`);
  for (let i = 0; i < session.exercises.length; i++) {
    const task = session.exercises[i];
    await until(
      () =>
        sync(
          'return !!document.getElementById("live-exercise-"+arguments[0])&&!document.querySelector(".workout-live p[role=status].field-hint")',
          [task.id],
        ),
      "active task and loaded guide " + task.id,
    );
    if (i === 0) await beforeFirstSet?.(task);
    for (let n = 1; n <= task.targets.targetSets; n++) {
      await until(
        () =>
          sync(
            'return document.querySelector(".quick-set-form h4")?.textContent.includes(arguments[0])',
            [String(n)],
          ),
        "series " + n,
      );
      await field('.quick-set-form select[id$="-unit"]', "KG");
      await field('.quick-set-form input[id$="-load"]', 40 + i + offset);
      await field('.quick-set-form input[id$="-reps"]', reps);
      await textClick(".quick-set-form button", "Registrar serie");
      await until(
        async () =>
          (
            await sql.query(
              "SELECT count(*)::int n FROM set_records WHERE workout_exercise_id=$1",
              [task.id],
            )
          ).rows[0].n === n,
        "persisted set",
      );
      if (i === 0 && n === 1) await afterFirstSet?.(task);
    }
    await until(
      () =>
        sync(
          'return !!document.querySelector(".live-dominant .primary-button")',
        ),
      "exercise completion",
    );
    await textClick(
      ".live-dominant button",
      i === session.exercises.length - 1
        ? "Finalizar entrenamiento"
        : "Siguiente ejercicio",
    );
    if (i < session.exercises.length - 1)
      await until(
        () =>
          sync(
            'return document.querySelector(".live-position")?.textContent.includes(arguments[0])',
            [`${i + 2} de ${session.exercises.length}`],
          ),
        "next exercise",
      );
  }
  await until(
    () =>
      sync(
        'return !!document.querySelector(".workout-insights")&&!document.querySelector(".workout-live")',
      ),
    "session completed",
  );
  return api("get", `/workout-sessions/${id}`);
}

async function runProg7({ today, shift, zone }) {
  const weekday = new Date(today + "T00:00:00Z").getUTCDay() || 7;
  const nextWednesday = shift((3 - weekday + 7) % 7 || 7),
    previousWednesday = new Date(
      new Date(nextWednesday + "T00:00:00Z").getTime() - 7 * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  const schema = (
    await sql.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) ORDER BY table_name,ordinal_position",
      [
        [
          "plan_exercises",
          "plan_days",
          "plan_weeks",
          "workout_exercises",
          "set_records",
          "scheduled_activities",
        ],
      ],
    )
  ).rows;
  assert.ok(
    schema.some(
      (r) =>
        r.table_name === "workout_exercises" &&
        r.column_name === "order_in_session",
    ),
  );
  await writeFile(
    join(evidence, "verified-schema.json"),
    JSON.stringify(schema, null, 2),
  );
  await check(
    "P01 guarded private PostgreSQL with real complete catalog",
    async () => {
      const result = await prepareCatalog();
      assert.ok(result.exercises >= 200);
      return result;
    },
  );
  const legExercises = (
    await sql.query(
      "SELECT e.id,e.name,e.catalog_key FROM exercises e WHERE e.is_active AND e.origin='GLOBAL' AND e.catalog_key=ANY($1) ORDER BY array_position($1::text[],e.catalog_key)",
      [
        [
          "sentadilla-barra-alta",
          "flexion-rodilla-tumbado",
          "extension-cadera-hip-thrust-barra",
        ],
      ],
    )
  ).rows;
  assert.equal(legExercises.length, 3);
  planId = (
    await api(
      "post",
      "/routine/plans",
      {
        id: randomUUID(),
        name: "PROG7 Legs real weekly",
        durationWeeks: 3,
        frequency: 1,
        startsOn: previousWednesday,
        timeZone: zone,
        days: [
          {
            name: "Legs",
            weekday: 3,
            exercises: legExercises.map((e, i) => ({
              exerciseId: e.id,
              position: i + 1,
              targetSets: 3,
              targetRepsMin: 8,
              targetRepsMax: 12,
              targetLoad: null,
              targetLoadUnit: null,
            })),
          },
        ],
      },
      201,
    )
  ).id;
  planning = await api("get", `/training-plans/${planId}/planning`);
  await api(
    "post",
    `/routine/plans/${planId}/activate`,
    {
      id: randomUUID(),
      expectedVersion: planning.version,
    },
    201,
  );
  planning = await api("get", `/training-plans/${planId}/planning`);
  const previousWeek = planning.weeks[0],
    nextWeek = planning.weeks[1],
    previousDay = previousWeek.days[0],
    nextDay = nextWeek.days[0];
  assert.notEqual(previousDay.exercises[0].id, nextDay.exercises[0].id);
  let previousActivity = (
    await sql.query(
      "SELECT id,version,scheduled_on::text FROM scheduled_activities WHERE plan_day_id=$1 ORDER BY scheduled_on",
      [previousDay.id],
    )
  ).rows[0];
  let nextActivity = (
    await sql.query(
      "SELECT id,version,scheduled_on::text FROM scheduled_activities WHERE plan_day_id=$1 ORDER BY scheduled_on",
      [nextDay.id],
    )
  ).rows[0];
  assert.ok(previousActivity && nextActivity);
  if (previousActivity.scheduled_on !== previousWednesday)
    previousActivity = await api(
      "patch",
      "/routine/activities/" + previousActivity.id,
      {
        expectedVersion: previousActivity.version,
        scheduledOn: previousWednesday,
      },
    );
  if (nextActivity.scheduled_on !== nextWednesday)
    nextActivity = await api(
      "patch",
      "/routine/activities/" + nextActivity.id,
      { expectedVersion: nextActivity.version, scheduledOn: nextWednesday },
    );
  const plansBefore = await immutablePlans();
  let previousSession, currentSession, historyBefore, previousRawRows;
  async function openActivity(week, day, activity, date) {
    await go(
      `/app/routine/${planId}/weeks/${week.id}/days/${day.id}?date=${date}&activityId=${activity.id}`,
    );
    await until(
      () =>
        sync(
          'return !!document.querySelector(".routine-start-panel")&&document.querySelector(".daily-guide")?.getAttribute("aria-busy")==="false"',
        ),
      "scheduled day guide",
    );
  }
  async function startVisible() {
    await until(
      () =>
        sync(
          'return [...document.querySelectorAll(".routine-start-panel button")].some(e=>!e.disabled&&/Empezar entrenamiento|Registrar entrenamiento de esta fecha/.test(e.textContent))',
        ),
      "enabled start",
    );
    const label = await sync(
      'return [...document.querySelectorAll(".routine-start-panel button")].find(e=>!e.disabled&&/Empezar entrenamiento|Registrar entrenamiento de esta fecha/.test(e.textContent)).textContent.trim()',
    );
    await textClick(".routine-start-panel button", label);
    await until(
      () =>
        sync(
          'return !!document.querySelector(".workout-live .quick-set-form")',
        ),
      "live session",
    );
    return sync('return location.pathname.split("/").pop()');
  }
  await check(
    "B01 real scheduled prior Wednesday Legs complete without RPE or RIR",
    async () => {
      await openActivity(
        previousWeek,
        previousDay,
        previousActivity,
        previousWednesday,
      );
      const initialGuide = await api(
        "get",
        "/progression/workout-guide?activityId=" + previousActivity.id,
      );
      assert.ok(
        initialGuide.exercises.every(
          (e) =>
            e.lastReference === null &&
            e.preparation.stage === "PLAN_ONLY" &&
            e.preparation.draft.origin === "PLAN_TARGET",
        ),
      );
      await health("mobile-first-legs-no-history-plan-only");
      previousSession = await startVisible();
      const done = await recordWholeSession(previousSession);
      assert.equal(done.status, "COMPLETED");
      assert.equal(done.actualSetCount, 9);
      assert.equal(done.scheduledActivityId, previousActivity.id);
      const sets = (
        await sql.query(
          "SELECT r.load::text,r.repetitions,r.rpe,r.rir FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY e.order_in_session,r.set_number",
          [previousSession],
        )
      ).rows;
      assert.ok(
        sets.every(
          (s) => s.repetitions === 8 && s.rpe === null && s.rir === null,
        ),
      );
      historyBefore = await immutableHistory();
      previousRawRows = JSON.stringify(
        (
          await sql.query(
            "SELECT row_to_json(r)::text AS row FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY r.id",
            [previousSession],
          )
        ).rows,
      );
      assert.equal(await immutablePlans(), plansBefore);
      await health("mobile-previous-wednesday-completed");
      return { previousSession, previousWednesday, sets };
    },
  );
  await check(
    "B02 next Wednesday distinct Week2 prescription offers staged guide before any calculation",
    async () => {
      await openActivity(nextWeek, nextDay, nextActivity, nextWednesday);
      assert.equal(
        await sync(
          'return [...document.querySelectorAll(".routine-start-panel button")].some(e=>e.disabled&&e.textContent.includes("Vista previa de entrenamiento futuro"))',
        ),
        true,
      );
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int n FROM workout_sessions WHERE scheduled_activity_id=$1",
            [nextActivity.id],
          )
        ).rows[0].n,
        0,
      );
      const guide = await api(
          "get",
          "/progression/workout-guide?activityId=" + nextActivity.id,
        ),
        first = guide.exercises[0];
      assert.equal(first.guidanceSuggested?.origin, "HISTORICAL_REFERENCE");
      assert.ok(
        first.lastReference.sessions.some(
          (s) => s.sessionId === previousSession,
        ),
      );
      assert.equal(Number(first.lastReference.sessions[0].sets[0].load), 40);
      assert.equal(first.lastReference.sessions[0].sets[0].repetitions, 8);
      assert.equal(first.progressiveContext.ready, true);
      assert.equal(
        await sync(
          'return document.querySelector(".guide-exercise .workout-preparation")?.getAttribute("data-stage")',
        ),
        "REPETITION_READY",
      );
      const staged = await sync(
        'return Object.fromEntries(["before","plan","draft"].map(key=>[key,document.querySelector(".guide-exercise .preparation-"+key)?.textContent]))',
      );
      assert.match(staged.before, /40/);
      assert.match(staged.plan, /8/);
      assert.match(staged.plan, /12/);
      await writeFile(
        join(evidence, "guide-before-confirmation.json"),
        JSON.stringify(guide, null, 2),
      );
      await sync(
        'document.querySelector(".guide-exercise .workout-preparation").scrollIntoView({block:"start"});return true',
      );
      await health("mobile-next-wednesday-staged-guide");
      await viewport(1440, 1000);
      await health("desktop-next-wednesday-staged-guide");
      await viewport(390, 844);
      return {
        nextWednesday,
        previousPrescriptionId: previousDay.exercises[0].id,
        currentPrescriptionId: nextDay.exercises[0].id,
        before: { load: 40, reps: 8 },
        plan: first.target,
        origin: first.guidanceSuggested.origin,
        context: first.progressiveContext,
      };
    },
  );
  await check(
    "B02b Progreso plan day exercise selection prepares the actual upcoming scheduled day before history exists",
    async () => {
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-plan]")',
          ),
        "progress plan filter",
      );
      await click("[data-testid=progress-period-all]");
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.getAttribute("aria-busy")==="false"&&!!document.querySelector("[data-testid=progress-plan]")',
          ),
        "period loaded before plan selection",
      );
      await field("[data-testid=progress-plan]", planId);
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.getAttribute("aria-busy")==="false"',
          ),
        "owned plan progress",
      );
      await field("[data-testid=progress-plan-day]", nextDay.id);
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.getAttribute("aria-busy")==="false"',
          ),
        "next exact day progress",
      );
      await field("[data-testid=progress-exercise]", legExercises[0].id);
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.getAttribute("aria-busy")==="false"&&document.querySelector(".daily-guide")?.getAttribute("aria-busy")==="false"',
          ),
        "progress preparation guide",
      );
      const data = await api(
        "get",
        "/workout-sessions/progress?period=all&planId=" +
          planId +
          "&planDayId=" +
          nextDay.id +
          "&exerciseId=" +
          legExercises[0].id,
      );
      assert.equal(data.nextSession.activityId, nextActivity.id);
      assert.equal(data.nextSession.planDayId, nextDay.id);
      assert.equal(data.nextSession.performedOn.slice(0, 10), nextWednesday);
      assert.equal(data.series.length, 0);
      assert.ok(
        await sync(
          'return !!document.querySelector("[data-testid=progress-next-guide]")',
        ),
      );
      assert.ok(
        await sync(
          'return [...document.querySelectorAll("a")].some(a=>a.href.includes(arguments[0])&&a.href.includes(arguments[1]))',
          [nextActivity.id, nextDay.id],
        ),
      );
      await health(
        "mobile-progress-prepare-next-leg-without-exact-day-history",
      );
      await viewport(1440, 1000);
      await health(
        "desktop-progress-prepare-next-leg-without-exact-day-history",
      );
      await viewport(390, 844);
      await openActivity(nextWeek, nextDay, nextActivity, nextWednesday);
      return {
        planId,
        dayId: nextDay.id,
        exerciseId: legExercises[0].id,
        nextSession: data.nextSession,
        exactDayHistory: 0,
      };
    },
  );
  await check(
    "B03 explicit comparability confirmation calculates numerical repetitions without plan mutation",
    async () => {
      await observeRequests();
      await click(".guide-exercise:first-of-type .repetition-preview-button");
      await until(
        () =>
          sync(
            'return document.querySelector(".guide-exercise .workout-preparation")?.getAttribute("data-stage")==="REPETITION_DRAFT"',
          ),
        "explicit calculated preview",
      );
      const writes = await sync(
        'return window.__prog7Requests.filter(r=>r.method==="POST"&&r.path.includes("repetition-preview"))',
      );
      assert.equal(writes.length, 1);
      assert.equal(
        writes[0].body.policyContract,
        "session-repetition-preview-v2",
      );
      const guide = await api(
          "post",
          "/progression/workout-guide/repetition-preview",
          writes[0].body,
        ),
        first = guide.exercises[0];
      assert.equal(first.guidanceSuggested.origin, "CALCULATED");
      assert.equal(Number(first.guidanceSuggested.load), 40);
      assert.equal(first.guidanceSuggested.reps, 9);
      assert.match(
        await sync(
          'return document.querySelector(".guide-exercise .preparation-draft").textContent',
        ),
        /40[\s\S]*9/,
      );
      assert.equal(await immutablePlans(), plansBefore);
      assert.equal(await immutableHistory(), historyBefore);
      await writeFile(
        join(evidence, "guide-calculated-preview.json"),
        JSON.stringify(guide, null, 2),
      );
      await sync(
        'document.querySelector(".guide-exercise .workout-preparation").scrollIntoView({block:"start"});return true',
      );
      await health("mobile-explicit-numeric-repetition-preview");
      await viewport(1440, 1000);
      await health("desktop-explicit-numeric-repetition-preview");
      await viewport(390, 844);
      return {
        origin: "CALCULATED",
        load: 40,
        reps: 9,
        contract: writes[0].body.policyContract,
        planUnchanged: true,
        historyUnchanged: true,
      };
    },
  );
  await check(
    "B04 same scheduled activity rescheduled today creates editable draft and records only explicit manual values",
    async () => {
      nextActivity = await api(
        "patch",
        "/routine/activities/" + nextActivity.id,
        { expectedVersion: nextActivity.version, scheduledOn: today },
      );
      await go("/app/overview");
      await openActivity(nextWeek, nextDay, nextActivity, today);
      currentSession = await startVisible();
      await until(
        () =>
          sync(
            'return !!document.querySelector(".quick-set-form input[id$=-load]")&&!document.querySelector(".workout-live [role=status]")',
          ),
        "loaded editable draft",
      );
      const draft = await sync(
        'return {load:document.querySelector(".quick-set-form input[id$=-load]").value,reps:document.querySelector(".quick-set-form input[id$=-reps]").value,text:document.querySelector(".workout-live").textContent}',
      );
      if (previousWednesday < today) {
        assert.equal(draft.load, "40");
        assert.ok(["8", "9"].includes(draft.reps));
      } else {
        assert.equal(
          await sync(
            'return document.querySelector(".workout-live .workout-preparation")?.getAttribute("data-stage")',
          ),
          "REVIEW_REQUIRED",
        );
        assert.notEqual(draft.load, "40");
        assert.doesNotMatch(
          draft.text,
          /Esta sesión creará tu primera referencia/,
        );
        assert.match(draft.text, /ordenada|verificada/);
      }
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int n FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1",
            [currentSession],
          )
        ).rows[0].n,
        0,
      );
      await field('.quick-set-form select[id$="-unit"]', "KG");
      await field('.quick-set-form input[id$="-load"]', 41);
      await field('.quick-set-form input[id$="-reps"]', 10);
      assert.equal(await immutablePlans(), plansBefore);
      assert.equal(await immutableHistory(), historyBefore);
      await sync(
        'document.querySelector(".quick-set-form").scrollIntoView({block:"center"});return true',
      );
      await health("mobile-edited-draft-unrecorded");
      const complete = await recordWholeSession(currentSession, {
        offset: 1,
        reps: 10,
      });
      assert.equal(complete.status, "COMPLETED");
      assert.equal(complete.actualSetCount, 9);
      const actualRows = (
        await sql.query(
          "SELECT r.load::text,r.repetitions,r.rpe,r.rir FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY e.order_in_session,r.set_number",
          [currentSession],
        )
      ).rows;
      assert.equal(actualRows.length, 9);
      assert.deepEqual(
        actualRows.map((r) => Number(r.load)),
        [41, 41, 41, 42, 42, 42, 43, 43, 43],
      );
      assert.ok(
        actualRows.every(
          (r) => r.repetitions === 10 && r.rpe === null && r.rir === null,
        ),
      );
      assert.equal(
        JSON.stringify(
          (
            await sql.query(
              "SELECT row_to_json(r)::text AS row FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY r.id",
              [previousSession],
            )
          ).rows,
        ),
        previousRawRows,
      );
      assert.equal(await immutablePlans(), plansBefore);
      await health("mobile-manually-recorded-session-complete");
      return {
        currentSession,
        activityId: nextActivity.id,
        originalFutureDate: nextWednesday,
        today,
        draft,
        manuallyRecorded: { load: 41, reps: 10 },
        actualRows,
      };
    },
  );
  await check(
    "B05 Progreso renders actual exercise load/repetition data with plan/day selectors",
    async () => {
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-exercise]")',
          ),
        "progress",
      );
      await click("[data-testid=progress-period-all]");
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.getAttribute("aria-busy")==="false"',
          ),
        "progress load",
      );
      await field("[data-testid=progress-exercise]", legExercises[0].id);
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.getAttribute("aria-busy")==="false"',
          ),
        "exercise progress",
      );
      const data = await api(
        "get",
        "/workout-sessions/progress?period=all&exerciseId=" +
          legExercises[0].id,
      );
      assert.equal(data.estimates.length, 0);
      assert.deepEqual(
        data.series
          .map((s) => ({
            load: Number(s.load),
            reps: s.points.map((p) => p.repetitions),
          }))
          .sort((a, b) => a.load - b.load),
        [
          { load: 40, reps: [8] },
          { load: 41, reps: [10] },
        ],
      );
      assert.deepEqual(
        data.series.map((s) => Number(s.load)).sort((a, b) => a - b),
        [40, 41],
      );
      assert.ok(
        await sync(
          'return !!document.querySelector("[data-testid=progress-plan-day]")',
        ),
      );
      await health("mobile-progress-real-data-selection");
      await viewport(1440, 1000);
      await health("desktop-progress-real-data-selection");
      const counts = (
        await sql.query(
          "SELECT (SELECT count(*) FROM progression_recommendations WHERE athlete_id=$1)::int proposals,(SELECT count(*) FROM progression_applications WHERE athlete_id=$1)::int applications,(SELECT count(*) FROM progression_automation_consents WHERE athlete_id=$1)::int consents",
          [athleteId],
        )
      ).rows[0];
      assert.deepEqual(counts, { proposals: 0, applications: 0, consents: 0 });
      assert.equal(await immutablePlans(), plansBefore);
      return {
        series: data.series.map((s) => ({
          load: s.load,
          points: s.points.length,
        })),
        ...counts,
      };
    },
  );
}

try {
  await until(async () => {
    try {
      return !!(await wd("/status"));
    } catch {
      return false;
    }
  }, "driver");
  sid = (
    await wd("/session", "POST", {
      capabilities: {
        alwaysMatch: {
          browserName: "firefox",
          "moz:firefoxOptions": {
            binary: "/snap/firefox/current/usr/lib/firefox/firefox",
            args: ["-headless", "-remote-allow-system-access"],
            prefs: { "ui.prefersReducedMotion": 1 },
          },
        },
      },
    })
  ).sessionId;
  await command("/timeouts", "POST", { script: 30000, pageLoad: 30000 });
  await viewport(390, 844);
  await command("/url", "POST", { url: cfg.origin + "/register" });
  await until(
    () => sync('return !!document.querySelector("#email")'),
    "registration",
  );
  await sync(
    `window.__finalUxErrors=[];window.__finalUxWarnings=[];for(const level of ['error','warn']){const original=console[level];console[level]=function(...args){(level==='error'?window.__finalUxErrors:window.__finalUxWarnings).push(args.map(String).join(' '));return original.apply(this,args)}};window.addEventListener('error',e=>window.__finalUxErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__finalUxErrors.push(String(e.reason?.message??e.reason)));`,
  );
  await field("#email", email);
  await field("#password", password);
  await click("form.auth-form button[type=submit]");
  await until(() => sync('return location.pathname==="/app"'), "registered");
  athleteId = (
    await sql.query(
      "SELECT a.id FROM athletes a JOIN users u ON u.id=a.user_id WHERE u.email=$1",
      [email],
    )
  ).rows[0].id;
  const zone = await sync(
    "return Intl.DateTimeFormat().resolvedOptions().timeZone",
  );
  const today = await sync(
      'return new Intl.DateTimeFormat("en-CA",{timeZone:arguments[0],year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())',
      [zone],
    ),
    shift = (days) =>
      new Date(new Date(today + "T00:00:00Z").getTime() + days * 86400000)
        .toISOString()
        .slice(0, 10);
  if (uiFinal) {
    const { runUiFinal } = await import("./workout-ui-final.scenario.mjs");
    await runUiFinal({
      api,
      athleteId,
      check,
      click,
      command,
      field,
      go,
      health,
      immutableHistory,
      immutablePlans,
      navigate,
      observeRequests,
      prepareCatalog,
      recordWholeSession,
      shift,
      shot,
      sql,
      sync,
      textClick,
      today,
      until,
      viewport,
      zone,
    });
  } else {
    await runProg7({ today, shift, zone });
  }
} catch (error) {
  if (!results.some((r) => r.status === "FAIL"))
    results.push({
      name: "runtime/setup",
      status: "FAIL",
      error: error.message,
    });
  console.error(error.stack);
  process.exitCode = 1;
  try {
    if (sid) {
      await shot("failure");
      await writeFile(
        join(evidence, "failure-dom.txt"),
        await sync(
          'return document.querySelector("main")?.textContent??document.body.textContent',
        ),
      );
      await writeFile(
        join(evidence, "failure-state.json"),
        JSON.stringify(
          await sync(
            "return {url:location.href,width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,errors:window.__finalUxErrors,warnings:window.__finalUxWarnings,body:document.body.innerHTML}",
          ),
          null,
          2,
        ),
      );
    }
  } catch {}
} finally {
  await writeFile(
    join(evidence, "health.json"),
    JSON.stringify(healthChecks, null, 2),
  );
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(
      {
        browser: "Firefox",
        browserPlugin: "not available; Firefox explicitly authorized",
        guard: {
          database: guard.name,
          port: guard.port,
          directory: guard.directory,
        },
        results,
      },
      null,
      2,
    ),
  );
  if (sid)
    try {
      await wd("/session/" + sid, "DELETE");
    } catch {}
  driver.kill();
  await sql.end();
  console.log("UI evidence: " + evidence);
  console.log(
    `${results.filter((r) => r.status === "PASS").length} passed; ${results.filter((r) => r.status === "FAIL").length} failed`,
  );
  if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
}
