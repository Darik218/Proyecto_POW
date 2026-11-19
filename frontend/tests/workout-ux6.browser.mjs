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
import { tmpdir } from "node:os";
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
const fixture = JSON.parse(await readFile(cfg.credentialFile, "utf8"));
const evidenceRoot = resolve("../..", "ux6-validation/browser");
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
const exercise =
  catalog.find((value) => value.id === fixture.exercise?.id) ?? catalog[0];
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
  if (await sync("return innerWidth<900")) await click(".mobile-menu-button");
  await textClick(".app-sidebar a", label);
}
async function field(selector, value) {
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
async function completeActual(
  date,
  exerciseId,
  { load = "40", repetitions = 8, rpe = null, name = "Sesión UX6" } = {},
) {
  let session = await api(
    "post",
    "/workout-sessions",
    {
      id: randomUUID(),
      performedOn: date,
      timeZone: "UTC",
      recordingMode: "RETROSPECTIVE",
      name,
    },
    201,
  );
  session = await api(
    "post",
    `/workout-sessions/${session.id}/exercises`,
    { id: randomUUID(), exerciseId, expectedVersion: session.version },
    201,
  );
  session = await api("post", `/workout-sessions/${session.id}/start`, {
    expectedVersion: session.version,
  });
  session = await api(
    "post",
    `/workout-sessions/${session.id}/exercises/${session.exercises[0].id}/sets`,
    {
      id: randomUUID(),
      expectedVersion: session.version,
      setNumber: 1,
      load,
      loadUnit: "KG",
      repetitions,
      rpe,
      rir: null,
      status: "COMPLETED",
      kind: "WORK",
    },
    201,
  );
  return api("post", `/workout-sessions/${session.id}/complete`, {
    expectedVersion: session.version,
    confirmWithoutResults: false,
  });
}
async function observeRequests() {
  await sync(
    `window.__ux6Requests=[];if(!window.__ux6Observer){window.__ux6Observer=true;const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(method,url,...rest){this.__ux6={method:String(method).toUpperCase(),path:new URL(String(url),location.href).pathname};return open.call(this,method,url,...rest)};XMLHttpRequest.prototype.send=function(body){window.__ux6Requests.push({...this.__ux6,body:typeof body==='string'?JSON.parse(body):null});return send.apply(this,arguments)}}`,
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
    "register",
  );
  await sync(
    `window.__finalUxErrors=[];window.__finalUxWarnings=[];for(const level of ['error','warn']){const original=console[level];console[level]=function(...args){(level==='error'?window.__finalUxErrors:window.__finalUxWarnings).push(args.map(String).join(' '));return original.apply(this,args)}};window.addEventListener('error',e=>window.__finalUxErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__finalUxErrors.push(String(e.reason?.message??e.reason)));`,
  );
  await field("#email", email);
  await field("#password", password);
  await click("form.auth-form button[type=submit]");
  await until(() => sync('return location.pathname==="/app"'), "registered");
  await go("/app/overview");
  await go("/app");
  athleteId = (
    await sql.query(
      "SELECT a.id FROM athletes a JOIN users u ON u.id=a.user_id WHERE u.email=$1",
      [email],
    )
  ).rows[0].id;
  const today = await sync("return new Date().toISOString().slice(0,10)");
  const shift = (days) =>
    new Date(new Date(today + "T00:00:00Z").getTime() + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const zone = "UTC";
  const equipment = ["BARBELL", "DUMBBELL", "CABLE", "MACHINE", "BODYWEIGHT"];
  const savedPlans = [];
  async function savedPlanId(name) {
    await until(
      () =>
        sync(
          'return !!new URL(location.href).searchParams.get("planId")&&document.querySelector(".routine-current h2")?.textContent.trim()===arguments[0]',
          [name],
        ),
      "saved plan loaded " + name,
    );
    return sync('return new URL(location.href).searchParams.get("planId")');
  }
  async function openWizard() {
    await go("/app");
    await until(
      () =>
        sync(
          'return !!document.querySelector("[data-create-mode]")||[...document.querySelectorAll("main button")].some(e=>e.textContent.trim()==="Crear otra rutina")',
        ),
      "plan hub",
    );
    if (
      !(await sync(
        'return !!document.querySelector("[data-create-mode=recommended]")',
      ))
    )
      await textClick("main button", "Crear otra rutina");
    await click('[data-create-mode="recommended"]');
    await until(
      () => sync('return !!document.querySelector("#routine-frequency")'),
      "recommended wizard",
    );
  }
  async function draftBlocks() {
    const blocks = [];
    const tabs = await sync(
      'return document.querySelectorAll(".block-tab").length',
    );
    for (let i = 0; i < tabs; i++) {
      await click(`.block-tab:nth-child(${i + 1})`);
      blocks.push(
        await sync(
          'return {name:document.querySelector(".block-heading input").value,exercises:[...document.querySelectorAll(".exercise-targets")].map((e,index)=>({name:e.querySelector("legend").textContent.trim().replace(/^\\d+\\.\\s*/,""),position:index+1,targetSets:Number(e.querySelector(".target-grid label:nth-child(1) input").value),targetRepsMin:Number(e.querySelector(".target-grid label:nth-child(2) input").value),targetRepsMax:Number(e.querySelector(".target-grid label:nth-child(3) input").value),targetLoad:e.querySelector(".load-grid input").value||null,targetLoadUnit:e.querySelector(".load-grid select").value||null}))}',
        ),
      );
    }
    return blocks;
  }
  const prescription = (e) => ({
    exerciseId: e.exerciseId ?? e.exercise?.id,
    position: e.position,
    targetSets: e.targetSets,
    targetRepsMin: e.targetRepsMin,
    targetRepsMax: e.targetRepsMax,
    targetLoad: e.targetLoad === null ? null : Number(e.targetLoad),
    targetLoadUnit: e.targetLoadUnit ?? null,
  });
  async function pgPlanRows(id) {
    return (
      await sql.query(
        `SELECT w.week_number,d.id AS day_id,d.name,d.position AS day_position,d.weekday,p.id,p.exercise_id,p.position,p.target_sets,p.target_reps_min,p.target_reps_max,p.target_load::text,p.target_load_unit,e.name AS exercise_name,m.key AS muscle_group FROM training_plans t JOIN plan_weeks w ON w.training_plan_id=t.id JOIN plan_days d ON d.plan_week_id=w.id JOIN plan_exercises p ON p.plan_day_id=d.id JOIN exercises e ON e.id=p.exercise_id JOIN muscle_groups m ON m.id=e.primary_muscle_group_id WHERE t.id=$1 ORDER BY w.week_number,d.position,p.position`,
        [id],
      )
    ).rows;
  }
  async function planContent(id) {
    const rows = await pgPlanRows(id);
    return rows.map(({ day_id, id: prescriptionId, ...r }) => r);
  }
  async function chooseProgressExercise(id) {
    await click("[data-testid=progress-period-all]");
    await until(
      () =>
        sync(
          'return !!document.querySelector("[data-testid=progress-exercise]")&&document.querySelector("[data-testid=progress-overview]").getAttribute("aria-busy")==="false"',
        ),
      "progress loaded",
    );
    await field("[data-testid=progress-exercise]", id);
    await until(
      () =>
        sync(
          'return document.querySelector("[data-testid=progress-exercise]")?.value===arguments[0]&&document.querySelector("[data-testid=progress-overview]").getAttribute("aria-busy")==="false"',
          [id],
        ),
      "exercise progress loaded",
    );
  }
  async function openActivity(plan, week, day, activity, date) {
    await go(
      `/app/routine/${plan}/weeks/${week}/days/${day}?date=${date}&activityId=${activity}`,
    );
    await until(
      () =>
        sync(
          'return !!document.querySelector(".routine-start-panel")&&document.querySelector(".daily-guide")?.getAttribute("aria-busy")==="false"',
        ),
      "scheduled day and real guide",
    );
  }
  async function startVisible() {
    await until(
      () =>
        sync(
          'return [...document.querySelectorAll(".routine-start-panel button")].some(e=>!e.disabled&&/Empezar entrenamiento|Registrar entrenamiento de esta fecha/.test(e.textContent))',
        ),
      "scheduled start available",
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
      "live workout",
    );
    return sync('return location.pathname.split("/").pop()');
  }
  async function recordWholeSession(id, { loadOffset = 0, reps = 8 } = {}) {
    const session = await api("get", `/workout-sessions/${id}`);
    for (let i = 0; i < session.exercises.length; i++) {
      const task = session.exercises[i];
      const sets = task.targets.targetSets;
      for (let n = 1; n <= sets; n++) {
        await until(
          () =>
            sync(
              'return document.querySelector(".quick-set-form h4")?.textContent.includes(arguments[0])',
              [String(n)],
            ),
          "series form " + n,
        );
        await field(
          '.quick-set-form input[id$="-load"]',
          String(40 + i + loadOffset),
        );
        await field('.quick-set-form input[id$="-reps"]', String(reps));
        await textClick(".quick-set-form button", "Registrar serie");
        await until(
          async () =>
            (
              await sql.query(
                "SELECT count(*)::int AS n FROM set_records WHERE workout_exercise_id=$1",
                [task.id],
              )
            ).rows[0].n === n,
          "real PostgreSQL series " + n,
        );
      }
      await until(
        () =>
          sync(
            'return !!document.querySelector(".live-dominant .primary-button")',
          ),
        "exercise completed",
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
      "completed workout",
    );
    return api("get", `/workout-sessions/${id}`);
  }

  await check(
    "U01 guarded disposable database uses full real repository catalog",
    async () => {
      const catalog = await prepareCatalog();
      assert.ok(catalog.exercises >= 200);
      assert.ok(catalog.groups >= 10);
      return catalog;
    },
  );
  for (const [label, width, height] of [
    ["mobile", 390, 844],
    ["desktop", 1440, 1000],
  ]) {
    let proposed, payload, created;
    await check(
      `A-${label}-01 six-day PPL chooses seven Push exercises with explicit 3/2/2 allocation and same A/B`,
      async () => {
        await viewport(width, height);
        await openWizard();
        await field("#routine-frequency", "6");
        await click(".template-option:has(#routine-template-ppl)");
        await click('input[value="fixed"]');
        for (const day of [1, 2, 3, 4, 5, 6])
          await click("#routine-weekday-" + day);
        await click(".wizard-actions .primary-button");
        await until(
          () => sync('return !!document.querySelector("#routine-goal")'),
          "preferences",
        );
        await field("#routine-goal", "HYPERTROPHY");
        await field("#routine-experience", "INTERMEDIATE");
        for (const value of equipment)
          await click("#routine-equipment-" + value);
        // Final UX6 selectors are the explicit user preferences, not inferred training prescriptions.
        await click(".wizard-advanced > summary");
        await field("#routine-exercise-count", "7");
        await field("#routine-allocation-push-pectorales", "3");
        await field("#routine-allocation-push-deltoides", "2");
        await field("#routine-allocation-push-triceps", "2");
        await field("#routine-variant-push", "same");
        await textClick(".wizard-actions button", "Ver propuesta");
        await until(
          () =>
            sync('return document.querySelectorAll(".block-tab").length===6'),
          "six-session PPL preview",
        );
        await field("#routine-name", `PPL6 UX6 ${label}`);
        await field("#routine-weeks", "2");
        await field("#routine-start", shift(-7));
        proposed = await draftBlocks();
        assert.equal(proposed[0].exercises.length, 7);
        assert.equal(proposed[3].exercises.length, 7);
        assert.deepEqual(proposed[0].exercises, proposed[3].exercises);
        const names = proposed[0].exercises.map((e) => e.name);
        const groups = (
          await sql.query(
            "SELECT e.name,m.key FROM exercises e JOIN muscle_groups m ON m.id=e.primary_muscle_group_id WHERE e.name=ANY($1)",
            [names],
          )
        ).rows;
        assert.equal(groups.length, 7);
        assert.deepEqual(
          Object.fromEntries(
            ["pectorales", "deltoides", "triceps"].map((key) => [
              key,
              groups.filter((g) => g.key === key).length,
            ]),
          ),
          { pectorales: 3, deltoides: 2, triceps: 2 },
        );
        await click(".block-tab:first-child");
        await health(`${label}-ppl6-same-seven-push`);
        return {
          sessions: 6,
          push: 7,
          allocation: { pectorales: 3, deltoides: 2, triceps: 2 },
          sameAB: true,
        };
      },
    );
    await check(
      `A-${label}-02 visible copy and edits stay independent and persist exact identity order and targets`,
      async () => {
        // A visible copy replaces one existing session, so six weekly sessions remain six.
        await click(".block-tab:first-child");
        await field(
          ".exercise-targets:first-of-type .target-grid label:nth-child(1) input",
          "4",
        );
        await field(
          ".exercise-targets:first-of-type .target-grid label:nth-child(2) input",
          "9",
        );
        await field(
          ".exercise-targets:first-of-type .target-grid label:nth-child(3) input",
          "11",
        );
        await field(".exercise-targets:first-of-type .load-grid input", "42");
        await field(".exercise-targets:first-of-type .load-grid select", "KG");
        await click(
          '.exercise-targets:first-of-type button[aria-label^="Bajar "]',
        );
        const beforeCopy = await draftBlocks();
        assert.notDeepEqual(beforeCopy[0].exercises, beforeCopy[3].exercises);
        await click(".block-tab:nth-child(4)");
        const sourceId = await sync(
          "const select=document.querySelector(arguments[1]);return [...select.options].find(o=>o.textContent.trim()===arguments[0])?.value",
          [beforeCopy[0].name, '.builder select[id$="-copy-day"]'],
        );
        assert.ok(sourceId, "visible session copy source");
        await field('.builder select[id$="-copy-day"]', sourceId);
        await textClick(".builder button", "Copiar sesión");
        const afterCopy = await draftBlocks();
        assert.deepEqual(afterCopy[0].exercises, afterCopy[3].exercises);
        await click(".block-tab:nth-child(4)");
        await field(
          ".exercise-targets:first-of-type .target-grid label:nth-child(1) input",
          "5",
        );
        proposed = await draftBlocks();
        assert.deepEqual(proposed[0].exercises, beforeCopy[0].exercises);
        assert.equal(proposed[3].exercises[0].targetSets, 5);
        assert.notDeepEqual(proposed[0].exercises, proposed[3].exercises);
        await click(".block-tab:nth-child(4)");
        await health(`${label}-ppl6-copy-independent-edits`);
        await sync(
          'document.querySelector(".builder-targets").scrollIntoView({block:"start"});return true',
        );
        await health(`${label}-ppl6-copy-edited-targets`);
        await observeRequests();
        await click(".wizard-actions .primary-button");
        created = await savedPlanId(`PPL6 UX6 ${label}`);
        const writes = await sync(
          'return window.__ux6Requests.filter(r=>r.method==="POST"&&r.path.endsWith("/routine/plans"))',
        );
        assert.equal(writes.length, 1);
        payload = writes[0].body;
        const plan = await api("get", `/training-plans/${created}/planning`);
        assert.equal(plan.weeks.length, 2);
        for (const week of plan.weeks) {
          assert.equal(week.days.length, 6);
          for (let i = 0; i < 6; i++) {
            assert.equal(week.days[i].name, proposed[i].name);
            assert.deepEqual(
              week.days[i].exercises.map(prescription),
              payload.days[i].exercises.map(prescription),
            );
            assert.deepEqual(
              week.days[i].exercises.map((e) => e.exercise.name),
              proposed[i].exercises.map((e) => e.name),
            );
          }
        }
        const rows = await pgPlanRows(created);
        assert.equal(
          rows.length,
          payload.days.reduce((n, d) => n + d.exercises.length, 0) * 2,
        );
        assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
        for (const weekNumber of [1, 2])
          for (let i = 0; i < 6; i++) {
            const persisted = rows.filter(
              (r) => r.week_number === weekNumber && r.day_position === i + 1,
            );
            assert.deepEqual(
              persisted.map((r) => ({
                exerciseId: r.exercise_id,
                position: r.position,
                targetSets: r.target_sets,
                targetRepsMin: r.target_reps_min,
                targetRepsMax: r.target_reps_max,
                targetLoad:
                  r.target_load === null ? null : Number(r.target_load),
                targetLoadUnit: r.target_load_unit,
              })),
              payload.days[i].exercises.map(prescription),
            );
          }
        const replay = await api("post", "/routine/plans", payload, 201);
        assert.equal(replay.id, created);
        assert.equal(
          (
            await sql.query(
              "SELECT count(*)::int n FROM training_plans WHERE athlete_id=$1 AND name=$2",
              [athleteId, `PPL6 UX6 ${label}`],
            )
          ).rows[0].n,
          1,
        );
        await health(`${label}-ppl6-saved-exact-order`);
        savedPlans.push({ id: created, label, planning: plan });
        return {
          planId: created,
          weeks: 2,
          weeklySessions: 6,
          actualPersistedExercises: rows.length,
          uiPosts: 1,
          idempotentReplay: true,
        };
      },
    );
    await check(
      `A-${label}-03 saved PPL activates and schedules while targets and history remain intact`,
      async () => {
        const original = await planContent(created),
          history = await immutableHistory();
        await textClick(".routine-current .plan-actions button", "Usar como plan activo");
        await until(
          async () =>
            (await api("get", `/training-plans/${created}/planning`)).status ===
            "ACTIVE",
          "plan activation",
        );
        if (
          !(await sync(
            'return document.querySelector(".routine-options").open',
          ))
        )
          await click(".routine-options > summary");
        await field("#calendar-date", shift(-6));
        const plan = await api("get", `/training-plans/${created}/planning`),
          day = plan.weeks[0].days[0];
        await textClick(
          ".routine-options .plan-actions button",
          `Programar ${day.name} en esta fecha`,
        );
        await until(
          async () =>
            (
              await sql.query(
                "SELECT count(*)::int n FROM scheduled_activities WHERE plan_day_id=$1 AND scheduled_on=$2::date",
                [day.id, shift(-6)],
              )
            ).rows[0].n === 1,
          "calendar persisted",
        );
        await until(
          () => sync('return !!document.querySelector(".routine-calendar li")'),
          "calendar rendered",
        );
        assert.match(
          await sync(
            'return document.querySelector(".routine-calendar").textContent',
          ),
          new RegExp(day.name),
        );
        assert.deepEqual(await planContent(created), original);
        assert.equal(await immutableHistory(), history);
        await health(`${label}-active-calendar`);
        return {
          planId: created,
          status: "ACTIVE",
          activities: 1,
          targetsPreserved: true,
          historyPreserved: true,
        };
      },
    );
  }
  const mobile = savedPlans.at(-1),
    sourcePlan = mobile.planning;
  const previousDay = sourcePlan.weeks[0].days.find((d) =>
      /legs/i.test(d.name),
    ),
    nextDay = sourcePlan.weeks[1].days.find((d) => /legs/i.test(d.name));
  assert.ok(previousDay && nextDay);
  let previousSession, currentSession, previousSnapshot, plansSnapshot;
  await viewport(390, 844);
  await check(
    "B01 scheduled previous Legs completes with actual loads repetitions and no RPE or RIR",
    async () => {
      let activity = (
        await sql.query(
          "SELECT id,version,scheduled_on FROM scheduled_activities WHERE plan_day_id=$1 ORDER BY scheduled_on LIMIT 1",
          [previousDay.id],
        )
      ).rows[0];
      assert.ok(
        activity,
        "previous Legs is an existing generated calendar occurrence",
      );
      if (activity.scheduled_on.toISOString().slice(0, 10) !== shift(-7))
        activity = await api("patch", "/routine/activities/" + activity.id, {
          expectedVersion: activity.version,
          scheduledOn: shift(-7),
        });
      plansSnapshot = await immutablePlans();
      await openActivity(
        mobile.id,
        sourcePlan.weeks[0].id,
        previousDay.id,
        activity.id,
        shift(-7),
      );
      previousSession = await startVisible();
      const completed = await recordWholeSession(previousSession);
      assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.scheduledActivityId, activity.id);
      assert.equal(
        completed.actualSetCount,
        previousDay.exercises.reduce((n, e) => n + e.targetSets, 0),
      );
      const sets = (
        await sql.query(
          "SELECT r.load::text,r.repetitions,r.rpe,r.rir FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY e.order_in_session,r.set_number",
          [previousSession],
        )
      ).rows;
      assert.ok(sets.length > 0);
      assert.ok(
        sets.every(
          (s) => s.repetitions === 8 && s.rpe === null && s.rir === null,
        ),
      );
      assert.equal(await immutablePlans(), plansSnapshot);
      previousSnapshot = JSON.stringify(
        (
          await sql.query(
            "SELECT row_to_json(r)::text AS row FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY r.id",
            [previousSession],
          )
        ).rows,
      );
      await health("mobile-previous-legs-completed-without-effort");
      return {
        sessionId: previousSession,
        actualSets: sets.length,
        rpe: null,
        rir: null,
        scheduledActivity: activity.id,
      };
    },
  );
  await check(
    "B02 next weekly Legs shows previous records and an honest explanation before drafting",
    async () => {
      let activity = (
        await sql.query(
          "SELECT id,version FROM scheduled_activities WHERE plan_day_id=$1 ORDER BY scheduled_on LIMIT 1",
          [nextDay.id],
        )
      ).rows[0];
      assert.ok(
        activity,
        "next Legs is an existing generated calendar occurrence",
      );
      activity = await api("patch", "/routine/activities/" + activity.id, {
        expectedVersion: activity.version,
        scheduledOn: shift(1),
      });
      await openActivity(
        mobile.id,
        sourcePlan.weeks[1].id,
        nextDay.id,
        activity.id,
        shift(1),
      );
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
            [activity.id],
          )
        ).rows[0].n,
        0,
      );
      const guide = await api(
        "get",
        "/progression/workout-guide?activityId=" + activity.id,
      );
      assert.equal(guide.status, "TRAINABLE");
      assert.ok(
        guide.exercises.every((e) =>
          e.lastReference?.sessions.some(
            (s) => s.sessionId === previousSession,
          ),
        ),
      );
      const first = guide.exercises[0];
      assert.equal(first.lastReference.sessions[0].sets[0].rpe, null);
      assert.equal(first.lastReference.sessions[0].sets[0].repetitions, 8);
      assert.equal(Number(first.lastReference.sessions[0].sets[0].load), 40);
      const content = await sync(
        'return document.querySelector(".daily-guide").textContent',
      );
      assert.match(content, /Último registro anterior/);
      assert.match(content, /40(?:\.0+)?\s*KG\s*×\s*8/);
      assert.match(content, /recomendación|orientación|referencia/i);
      await health("mobile-next-week-legs-guide-prior-values");
      await viewport(1440, 1000);
      await health("desktop-next-week-legs-guide-prior-values");
      await viewport(390, 844);
      activity = await api("patch", "/routine/activities/" + activity.id, {
        expectedVersion: activity.version,
        scheduledOn: today,
      });
      assert.equal(activity.scheduledOn.slice(0, 10), today);
      await go("/app/overview");
      await openActivity(
        mobile.id,
        sourcePlan.weeks[1].id,
        nextDay.id,
        activity.id,
        today,
      );
      currentSession = await startVisible();
      await until(
        () =>
          sync(
            'return document.querySelector(\'.quick-set-form input[id$="-load"]\')?.value==="40"&&document.querySelector(\'.quick-set-form input[id$="-reps"]\')?.value==="8"',
          ),
        "prior values become editable draft",
      );
      assert.match(
        await sync(
          'return document.querySelector(".live-previous").textContent',
        ),
        /40(?:\.0+)?\s*KG\s*×\s*8/,
      );
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int n FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1",
            [currentSession],
          )
        ).rows[0].n,
        0,
      );
      await health("mobile-next-legs-editable-historical-draft");
      return {
        sessionId: currentSession,
        previousSession,
        draft: { load: 40, repetitions: 8 },
        automaticallyRecorded: 0,
        guideOrigin: first.guidanceSuggested?.origin,
        reasons: first.repetitionContext?.reasons,
      };
    },
  );
  await check(
    "B03 manually changed real values persist without historical or plan mutation",
    async () => {
      const completed = await recordWholeSession(currentSession, {
        loadOffset: 1,
        reps: 10,
      });
      assert.equal(completed.status, "COMPLETED");
      const sets = (
        await sql.query(
          "SELECT r.load::text,r.repetitions,r.rpe,r.rir FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY e.order_in_session,r.set_number",
          [currentSession],
        )
      ).rows;
      assert.equal(Number(sets[0].load), 41);
      assert.ok(
        sets.every(
          (s) => s.repetitions === 10 && s.rpe === null && s.rir === null,
        ),
      );
      const old = JSON.stringify(
        (
          await sql.query(
            "SELECT row_to_json(r)::text AS row FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY r.id",
            [previousSession],
          )
        ).rows,
      );
      assert.equal(old, previousSnapshot);
      assert.equal(await immutablePlans(), plansSnapshot);
      await health("mobile-next-legs-changed-real-record-completed");
      return {
        sessionId: currentSession,
        actualSets: sets.length,
        firstLoad: 41,
        repetitions: 10,
        historicalPreserved: true,
        planPreserved: true,
      };
    },
  );
  await check(
    "B04 Progreso shows both real records repetitions and load with no fabricated effort estimate",
    async () => {
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-exercise]")',
          ),
        "real progress",
      );
      const id = nextDay.exercises[0].exercise.id;
      await chooseProgressExercise(id);
      const data = await api(
        "get",
        "/workout-sessions/progress?period=all&exerciseId=" + id,
      );
      assert.deepEqual(
        data.series
          .map((s) => ({
            load: Number(s.load),
            repetitions: s.points.map((p) => p.repetitions),
            state: s.comparison.state,
            delta: s.comparison.repetitionsDelta,
          }))
          .sort((a, b) => a.load - b.load),
        [
          { load: 40, repetitions: [8], state: "BASELINE", delta: null },
          { load: 41, repetitions: [10], state: "BASELINE", delta: null },
        ],
      );
      assert.equal(data.estimates.length, 0);
      assert.ok(
        await sync(
          'return !!document.querySelector("[data-testid=progress-plan-day]")',
        ),
      );
      await field("[data-testid=progress-plan-day]", nextDay.id);
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]").getAttribute("aria-busy")==="false"',
          ),
        "exact training day progress",
      );
      const scoped = await api(
        "get",
        "/workout-sessions/progress?period=all&exerciseId=" +
          id +
          "&planDayId=" +
          nextDay.id,
      );
      assert.equal(scoped.series[0].points.length, 1);
      assert.equal(scoped.series[0].points[0].sessionId, currentSession);
      await health("mobile-progress-exact-next-legs-day");
      await field("[data-testid=progress-plan-day]", "");
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]").getAttribute("aria-busy")==="false"',
          ),
        "all days progress restored",
      );
      await chooseProgressExercise(id);
      assert.ok(
        await sync(
          'return !!document.querySelector("[data-testid=progress-repetitions-chart]")',
        ),
      );
      assert.ok(
        await sync(
          'return !!document.querySelector("[data-testid=progress-load-chart-KG]")',
        ),
      );
      assert.deepEqual(
        await sync(
          'return [...document.querySelectorAll("[data-testid=progress-load-chart-KG] circle title")].map(e=>Number(e.textContent.split(": ")[1].split(" ")[0]))',
        ),
        [40, 41],
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll("[data-testid=progress-comparison]").length',
        ),
        0,
      );
      const secondLoad = data.series.findIndex((s) => Number(s.load) === 41);
      await field("[data-testid=progress-load]", String(secondLoad));
      assert.match(
        await sync(
          'return document.querySelector(".exercise-progress .selected-record").textContent',
        ),
        /10 repeticiones/,
      );
      await sync(
        'document.querySelector(".exercise-progress").scrollIntoView({block:"start"});return true',
      );
      await health("mobile-progress-real-legs-records");
      await sync(
        'document.querySelector("[data-testid=progress-load-chart-KG]").closest("figure").scrollIntoView({block:"start"});return true',
      );
      await health("mobile-progress-actual-weight-evolution");
      await viewport(1440, 1000);
      await health("desktop-progress-real-legs-records");
      const counts = (
        await sql.query(
          "SELECT (SELECT count(*) FROM progression_recommendations WHERE athlete_id=$1)::int proposals,(SELECT count(*) FROM progression_applications WHERE athlete_id=$1)::int applications,(SELECT count(*) FROM progression_automation_consents WHERE athlete_id=$1)::int consents",
          [athleteId],
        )
      ).rows[0];
      assert.deepEqual(counts, { proposals: 0, applications: 0, consents: 0 });
      assert.equal(await immutablePlans(), plansSnapshot);
      return {
        recordedLoads: [40, 41],
        repetitions: [8, 10],
        comparison: "separate load baselines",
        effortEstimates: 0,
        ...counts,
      };
    },
  );
} catch (error) {
  if (!results.some((result) => result.status === "FAIL")) {
    results.push({
      name: "runtime/setup",
      status: "FAIL",
      error: error.message,
    });
    console.log("FAIL setup/runtime: " + error.message);
  }
  try {
    if (sid) {
      await shot("failure");
      await writeFile(
        join(evidence, "failure-dom.txt"),
        await sync(
          'return document.querySelector("main")?.textContent??document.body.textContent',
        ),
      );
      const layout = await sync(
        `const bounds=element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return {tag:element.tagName,className:String(element.className),left:r.left,right:r.right,width:r.width,height:r.height,display:s.display,visibility:s.visibility,inert:!!element.closest('[inert]'),transition:element.closest('[class*="-leave-"],[class*="-enter-"]')?.className??null}};return {innerWidth,innerHeight,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,body:bounds(document.body),scrollX,offenders:[...document.querySelectorAll('main *')].filter(element=>{const r=element.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,30).map(bounds)}`,
      );
      await writeFile(
        join(evidence, "failure-layout.json"),
        JSON.stringify(layout, null, 2),
      );
    }
  } catch {}
  process.exitCode = 1;
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
    `${results.filter((value) => value.status === "PASS").length} passed; ${results.filter((value) => value.status === "FAIL").length} failed`,
  );
  if (results.some((value) => value.status === "FAIL")) process.exitCode = 1;
}
