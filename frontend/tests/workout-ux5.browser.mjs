// Real Firefox against the explicitly supplied, independently guarded temporary runtime.
// Browser plugin is unavailable; the user authorized the existing Firefox/WebDriver fallback.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, realpath, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
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
const evidence = await mkdtemp(join(tmpdir(), "pulso-ux5-evidence-")),
  results = [];
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
  return value;
}

async function sourceModule(path) {
  const ts = require("typescript");
  const js = ts.transpileModule(await readFile(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64")
  );
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
  { load = "40", repetitions = 8, rpe = null, name = "Sesión UX5" } = {},
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
    `window.__ux5Requests=[];if(!window.__ux5Observer){window.__ux5Observer=true;const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(method,url,...rest){this.__ux5={method:String(method).toUpperCase(),path:new URL(String(url),location.href).pathname};return open.call(this,method,url,...rest)};XMLHttpRequest.prototype.send=function(body){window.__ux5Requests.push({...this.__ux5,body:typeof body==='string'?JSON.parse(body):null});return send.apply(this,arguments)}}`,
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
  const ago = (n) =>
    new Date(new Date(today + "T00:00:00Z").getTime() - n * 86400000)
      .toISOString()
      .slice(0, 10);
  const equipment = ["BARBELL", "DUMBBELL", "CABLE", "MACHINE", "BODYWEIGHT"];
  let baseline,
    second,
    noRpe,
    unsuitable,
    planPayload,
    planSnapshot,
    historySnapshot,
    baselineExercise,
    noRpeExercise,
    unsuitableExercise;
  async function savedPlanId(name) {
    await until(
      () =>
        sync(
          'const id=new URL(location.href).searchParams.get("planId"),select=document.querySelector("#routine-plan");return !!id&&(!select||select.value===id)&&document.querySelector(".routine-current h2")?.textContent.trim()===arguments[0]',
          [name],
        ),
      "saved plan loaded " + name,
    );
    return sync('return new URL(location.href).searchParams.get("planId")');
  }
  async function chooseProgressExercise(id) {
    await click("[data-testid=progress-period-all]");
    await until(
      () =>
        sync(
          'return !!document.querySelector("[data-testid=progress-exercise]")&&document.querySelector("[data-testid=progress-overview]").getAttribute("aria-busy")==="false"',
        ),
      "progress period loaded",
    );
    await field("[data-testid=progress-exercise]", id);
    await until(
      () =>
        sync(
          'return document.querySelector("[data-testid=progress-exercise]")?.value===arguments[0]&&document.querySelector("[data-testid=progress-overview]").getAttribute("aria-busy")==="false"',
          [id],
        ),
      "selected exercise loaded",
    );
  }
  async function openWizard(label) {
    await go("/app");
    await until(
      () => sync('return !document.querySelector(".routine-form")'),
      "wizard closed",
    );
    await until(
      () =>
        sync(
          'return !!document.querySelector("[data-create-mode]")||[...document.querySelectorAll("main button")].some(e=>e.textContent.trim()==="Crear otra rutina")',
        ),
      "plan hub rendered",
    );
    const mode =
      label === "Elegir plantilla"
        ? "library"
        : label === "Tengo mi rutina"
          ? "custom"
          : "recommended";
    if (
      !(await sync("return !!document.querySelector(arguments[0])", [
        '[data-create-mode="' + mode + '"]',
      ]))
    )
      await textClick("main button", "Crear otra rutina");
    await until(
      () =>
        sync("return !!document.querySelector(arguments[0])", [
          '[data-create-mode="' + mode + '"]',
        ]),
      "creation mode visible",
    );
    await click('[data-create-mode="' + mode + '"]');
    await until(
      () => sync('return !!document.querySelector("#routine-frequency")'),
      "wizard",
    );
  }
  async function guidedOptions(frequency, template, { flexible = false } = {}) {
    await field("#routine-frequency", frequency);
    await click(`.template-option:has(#routine-template-${template})`);
    await click(`input[value="${flexible ? "flexible" : "fixed"}"]`);
    if (!flexible)
      for (const day of frequency === 4
        ? [1, 2, 4, 5]
        : Array.from({ length: frequency }, (_, i) => i + 1))
        await click("#routine-weekday-" + day);
    await click(".wizard-actions .primary-button");
    await until(
      () => sync('return !!document.querySelector("#routine-goal")'),
      "preferences",
    );
    await field("#routine-goal", "GENERAL");
    await field("#routine-experience", "BEGINNER");
    for (const value of equipment) await click("#routine-equipment-" + value);
  }
  await check(
    "U01 sparse real catalog fails closed without inventing exercises",
    async () => {
      const counts = (
        await sql.query(
          "SELECT count(*)::int AS matching FROM muscle_groups WHERE key=ANY($1)",
          [["pectorales", "dorsales", "cuadriceps"]],
        )
      ).rows[0];
      assert.equal(counts.matching, 0);
      await openWizard("Crear plan recomendado");
      await guidedOptions(4, "upperlower");
      await textClick(".wizard-actions button", "Ver propuesta");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".form-error, .template-missing")',
          ),
        "catalog evidence missing",
      );
      const content = await sync(
        'return document.querySelector(".routine-form").textContent',
      );
      assert.match(content, /catálogo|faltan|disponible|completar/i);
      assert.equal(
        await sync(
          'return document.querySelectorAll(".exercise-targets").length',
        ),
        0,
      );
      await click(".wizard-actions .primary-button");
      await until(
        () =>
          sync('return !!document.querySelector(".routine-form .form-error")'),
        "empty proposal cannot save",
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll(".exercise-targets").length',
        ),
        0,
      );
      await click(".wizard-actions .primary-button");
      await until(
        () => sync('return !!document.querySelector(".form-error")'),
        "sparse save blocked",
      );
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int AS n FROM training_plans WHERE athlete_id=$1",
            [athleteId],
          )
        ).rows[0].n,
        0,
      );
      await health("mobile-sparse-catalog");
      await textClick(".wizard-actions button", "Cancelar");
      return counts;
    },
  );
  await check(
    "U02 disposable fixture uses complete repository catalog metadata and real ranking",
    async () => {
      const detail = await prepareCatalog();
      assert.ok(detail.exercises >= 200);
      assert.ok(detail.groups >= 10);
      return detail;
    },
  );
  await check(
    "U03 mobile Home to Mi plan exposes three distinct creation paths",
    async () => {
      await go("/app/overview");
      await health("mobile-home");
      await navigate("Mi plan");
      await until(
        () => sync('return location.pathname==="/app"'),
        "Mi plan from Home",
      );
      await until(
        () =>
          sync(
            'return document.querySelectorAll("[data-create-mode]").length===3',
          ),
        "creation paths rendered",
      );
      for (const label of ["recommended", "library", "custom"])
        assert.equal(
          await sync(
            'return !!document.querySelector("[data-create-mode="+arguments[0]+"]")',
            [label],
          ),
          true,
        );
      await health("mobile-plan-entry");
      return { route: "/app", paths: 3 };
    },
  );
  await check(
    "U04 recommended frequency4 Upper Lower explicit weekdays and equipment",
    async () => {
      await openWizard("Crear plan recomendado");
      await guidedOptions(4, "upperlower");
      assert.equal(
        await sync(
          'return document.querySelector("#routine-experience").value',
        ),
        "BEGINNER",
      );
      assert.equal(
        await sync(
          'return [...document.querySelectorAll("input[id^=routine-equipment-]:checked")].length',
        ),
        equipment.length,
      );
      await textClick(".wizard-actions button", "Ver propuesta");
      await until(
        () => sync('return document.querySelectorAll(".block-tab").length===4'),
        "four proposed sessions",
      );
      await health("mobile-recommended-preview");
      return { frequency: 4, template: "upperlower", equipment };
    },
  );
  await check(
    "U05 preview contains real editable exercises and prescriptions before saving",
    async () => {
      await field("#routine-name", "Plan recomendado UX5");
      await field("#routine-weeks", "2");
      const tabs = await sync(
        'return [...document.querySelectorAll(".block-tab")].map(e=>e.textContent.trim())',
      );
      assert.equal(tabs.length, 4);
      const proposed = await sync(
        'return [...document.querySelectorAll(".exercise-targets legend")].map(e=>e.textContent.trim())',
      );
      assert.ok(proposed.length >= 4);
      await field(".exercise-targets .target-grid input", "3");
      assert.equal(
        await sync(
          'return document.querySelector(".exercise-targets .target-grid input").value',
        ),
        "3",
      );
      const chosen = await sync(
        'return document.querySelector(".exercise-targets legend").textContent.trim().split(". ").slice(1).join(". ")',
      );
      const actual = (
        await sql.query("SELECT equipment_type FROM exercises WHERE name=$1", [
          chosen,
        ])
      ).rows[0];
      assert.ok(actual);
      assert.ok(equipment.includes(actual.equipment_type));
      await observeRequests();
      const searchField = await sync(
        'return document.querySelector(".builder .exercise-picker input[type=search]")',
      );
      assert.ok(searchField);
      await command(
        "/element/" +
          searchField["element-6066-11e4-a52e-4f735466cecf"] +
          "/value",
        "POST",
        { text: "\uE007", value: ["\uE007"] },
      );
      await pause(200);
      assert.equal(
        await sync(
          'return window.__ux5Requests.filter(r=>r.method==="POST"&&r.path.endsWith("/routine/plans")).length',
        ),
        0,
      );
      assert.equal(
        await sync('return !!document.querySelector(".routine-form")'),
        true,
      );
      await health("mobile-editable-preview");
      return { sessions: tabs, firstExercise: chosen, editedSets: 3 };
    },
  );
  await check(
    "U06 save existing routine POST and replay idempotence produce one plan",
    async () => {
      await observeRequests();
      await click(".wizard-actions .primary-button");
      await until(
        () =>
          sync(
            'return !document.querySelector(".routine-form")&&!!document.querySelector(".routine-current")',
          ),
        "saved plan",
      );
      planId = await sync(
        'return new URL(location.href).searchParams.get("planId")',
      );
      assert.ok(planId);
      const writes = await sync(
        'return window.__ux5Requests.filter(r=>r.method==="POST"&&r.path.endsWith("/routine/plans"))',
      );
      assert.equal(writes.length, 1);
      planPayload = writes[0].body;
      const replay = await api("post", "/routine/plans", planPayload, 201);
      assert.equal(replay.id, planId);
      planning = await api("get", `/training-plans/${planId}/planning`);
      assert.equal(planning.weeks.length, 2);
      assert.equal(planning.weeks[0].days.length, 4);
      assert.deepEqual(
        planning.weeks[0].days.map((d) => d.weekday),
        [1, 2, 4, 5],
      );
      assert.equal(planning.weeks[0].days[0].exercises[0].targetSets, 3);
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int AS n FROM training_plans WHERE athlete_id=$1",
            [athleteId],
          )
        ).rows[0].n,
        1,
      );
      await health("mobile-saved-plan");
      return { planId, weeks: 2, days: 4, uiPosts: 1, idempotentReplay: true };
    },
  );
  await check(
    "U07 open saved day and start a real workout through visible controls",
    async () => {
      await click(".routine-session-tabs button:first-child");
      await click(".routine-day-preview a.primary-button");
      await until(
        () => sync('return !!document.querySelector(".routine-start-panel")'),
        "saved day",
      );
      await field("#routine-execution-date", today);
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".routine-start-panel button")].some(e=>e.textContent.trim()==="Empezar entrenamiento"&&!e.disabled)',
          ),
        "start enabled",
      );
      const before = await immutablePlans();
      await textClick(".routine-start-panel button", "Empezar entrenamiento");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".workout-live .quick-set-form")',
          ),
        "real live workout",
      );
      const id = await sync('return location.pathname.split("/").pop()');
      const workout = await api("get", `/workout-sessions/${id}`);
      assert.equal(workout.status, "IN_PROGRESS");
      assert.equal(
        workout.planDayId ?? workout.planDay?.id,
        planning.weeks[0].days[0].id,
      );
      assert.equal(await immutablePlans(), before);
      await health("mobile-real-start");
      await field('.quick-set-form input[id$="-load"]', "40");
      await field('.quick-set-form input[id$="-reps"]', "8");
      await textClick(".quick-set-form button", "Registrar serie");
      await until(
        async () =>
          (await api("get", `/workout-sessions/${id}`)).actualSetCount === 1,
        "actual series saved",
      );
      await textClick(".live-toolbar button", "Terminar");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".workout-insights")&&!document.querySelector(".workout-live")',
          ),
        "real workout completed",
      );
      const closed = await api("get", `/workout-sessions/${id}`);
      assert.equal(closed.status, "COMPLETED");
      assert.equal(await immutablePlans(), before);
      return {
        id,
        status: workout.status,
        closed: closed.status,
        actualSetCount: closed.actualSetCount,
      };
    },
  );
  await check(
    "U08 existing plan day can change scheduling without changing sibling prescriptions",
    async () => {
      planning = await api("get", `/training-plans/${planId}/planning`);
      const day = planning.weeks[0].days[1],
        before = planning.weeks[0].days[0].exercises,
        savedHistory = await immutableHistory();
      const schedulingBefore = await immutablePlans();
      await go("/app?planId=" + planId);
      await until(
        () =>
          sync(
            'return document.querySelectorAll(".routine-session-tabs button").length===4',
          ),
        "weekly distribution",
      );
      await click(".routine-session-tabs button:nth-child(2)");
      await click(".routine-quick-schedule summary");
      const movedTo = ago(-2);
      await field("#selected-schedule-date", movedTo);
      await click(".routine-quick-schedule button");
      await until(
        async () =>
          (
            await sql.query(
              "SELECT count(*)::int AS n FROM scheduled_activities WHERE plan_day_id=$1 AND scheduled_on=$2::date",
              [day.id, movedTo],
            )
          ).rows[0].n === 1,
        "weekly date move persisted",
      );
      assert.equal(await immutablePlans(), schedulingBefore);
      assert.equal(await immutableHistory(), savedHistory);
      await health("mobile-weekly-date-edited");
      await go(
        `/app/routine/${planId}/weeks/${planning.weeks[0].id}/days/${day.id}?edit=true`,
      );
      await until(
        () => sync('return !!document.querySelector(".plan-day-card")'),
        "day editor",
      );
      await textClick(".plan-day-card button", "Editar día");
      await field(".plan-form select", "6");
      await textClick(".plan-form button", "Guardar día");
      await until(async () => {
        planning = await api("get", `/training-plans/${planId}/planning`);
        return (
          planning.weeks[0].days.find((d) => d.id === day.id).weekday === 6
        );
      }, "changed weekday persisted");
      assert.deepEqual(planning.weeks[0].days[0].exercises, before);
      assert.equal(await immutableHistory(), savedHistory);
      await health("mobile-existing-day-edited");
      return { day: day.id, weekday: 6, siblingPreserved: true };
    },
  );
  await check(
    "U09 library Full body and PPL produce real populated editable previews",
    async () => {
      const seen = [];
      for (const [frequency, template, label] of [
        [3, "fullbody", "Full body"],
        [6, "ppl", "PPL"],
      ]) {
        await openWizard("Elegir plantilla");
        await guidedOptions(frequency, template);
        await textClick(".wizard-actions button", "Ver propuesta");
        await until(
          () =>
            sync(
              'return document.querySelectorAll(".block-tab").length===arguments[0]',
              [frequency],
            ),
          label + " preview",
        );
        assert.ok(
          (await sync(
            'return document.querySelectorAll(".exercise-targets").length',
          )) >= 3,
        );
        seen.push({ template, sessions: frequency });
        await health("mobile-library-" + template);
        await textClick(".wizard-actions button", "Cancelar");
      }
      return seen;
    },
  );

  await check(
    "U10 custom routine and flexible library order save through real controls",
    async () => {
      await go("/app");
      if (
        !(await sync(
          'return !!document.querySelector("[data-create-mode=custom]")',
        ))
      )
        await textClick("main button", "Crear otra rutina");
      await click("[data-create-mode=custom]");
      await until(
        () => sync('return !!document.querySelector("#routine-name")'),
        "custom wizard",
      );
      await field("#routine-name", "Rutina propia UX5");
      await field("#routine-weeks", "1");
      await click(".wizard-actions .primary-button");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".picker-results input[type=checkbox]")',
          ),
        "custom real catalog",
      );
      await click(".picker-results input[type=checkbox]");
      await until(
        () => sync('return !!document.querySelector(".exercise-targets")'),
        "custom targets",
      );
      await field(
        ".exercise-targets .target-grid label:nth-child(1) input",
        "2",
      );
      await field(
        ".exercise-targets .target-grid label:nth-child(2) input",
        "8",
      );
      await field(
        ".exercise-targets .target-grid label:nth-child(3) input",
        "12",
      );
      await click(".wizard-actions .primary-button");
      await until(
        () => sync('return !!document.querySelector(".week-assignments")'),
        "custom weekdays",
      );
      await click(".wizard-actions .primary-button");
      await until(
        () => sync('return !document.querySelector(".routine-form")'),
        "custom saved",
      );
      const custom = await savedPlanId("Rutina propia UX5");
      assert.notEqual(custom, planId);
      await openWizard("Elegir plantilla");
      await guidedOptions(2, "fullbody", { flexible: true });
      await textClick(".wizard-actions button", "Ver propuesta");
      await until(
        () => sync('return document.querySelectorAll(".block-tab").length===2'),
        "flexible preview",
      );
      await field("#routine-name", "Flexible UX5");
      await field("#routine-weeks", "1");
      await click(".wizard-actions .primary-button");
      await until(
        () => sync('return !document.querySelector(".routine-form")'),
        "flexible saved",
      );
      const flexible = await savedPlanId("Flexible UX5");
      const saved = await api("get", `/training-plans/${flexible}/planning`);
      assert.equal(saved.weeks[0].days.length, 2);
      assert.ok(saved.weeks[0].days.every((day) => day.weekday === null));
      assert.equal(saved.startsOn, null);
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int AS n FROM scheduled_activities WHERE plan_week_id=$1",
            [saved.weeks[0].id],
          )
        ).rows[0].n,
        0,
      );
      await health("mobile-flexible-saved");
      return { custom, flexible, orderedSessions: 2, datedActivities: 0 };
    },
  );
  await check(
    "U11 real completed API session renders an exercise baseline and accessible charts",
    async () => {
      const candidates = (
        await sql.query(
          `SELECT id,name,one_rm_suitability FROM exercises e WHERE catalog_key IS NOT NULL AND is_active AND NOT EXISTS(SELECT 1 FROM plan_exercises p JOIN plan_weeks w ON w.id=p.plan_week_id JOIN training_plans t ON t.id=w.training_plan_id WHERE t.athlete_id=$1 AND p.exercise_id=e.id) ORDER BY catalog_key`,
          [athleteId],
        )
      ).rows;
      [baselineExercise, noRpeExercise] = candidates.filter(
        (e) => e.one_rm_suitability === "SUITABLE",
      );
      unsuitableExercise = candidates.find(
        (e) => e.one_rm_suitability === "NOT_SUITABLE",
      );
      assert.ok(baselineExercise && noRpeExercise && unsuitableExercise);
      baseline = await completeActual(ago(8), baselineExercise.id, {
        load: "40",
        repetitions: 8,
        rpe: 7,
        name: "Primera referencia UX5",
      });
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-exercise]")',
          ),
        "real overview",
      );
      await chooseProgressExercise(baselineExercise.id);
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.textContent.includes("Primera referencia")',
          ),
        "visible baseline",
      );
      const data = await api(
        "get",
        "/workout-sessions/progress?period=all&exerciseId=" +
          baselineExercise.id,
      );
      assert.equal(data.series[0].comparison.state, "BASELINE");
      assert.equal(data.series[0].points.length, 1);
      assert.equal(data.series[0].points[0].repetitions, 8);
      const renderedFrequency = await sync(
        'return [...document.querySelectorAll("table")].find(t=>t.querySelector("caption")?.textContent==="Sesiones completadas por semana")? [...[...document.querySelectorAll("table")].find(t=>t.querySelector("caption")?.textContent==="Sesiones completadas por semana").querySelectorAll("tbody td")].map(td=>Number(td.textContent)):[]',
      );
      assert.deepEqual(
        renderedFrequency,
        data.frequency.map((point) => point.sessions),
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll("[data-testid=progress-frequency-chart], [data-testid=progress-repetitions-chart]").length',
        ),
        2,
      );
      assert.ok(
        await sync(
          'return [...document.querySelectorAll("table caption")].some(e=>e.textContent.includes("Repeticiones registradas"))',
        ),
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll("[data-testid=progress-overview] input[type=checkbox]").length',
        ),
        0,
      );
      await health("mobile-progress-baseline");
      return {
        sessionId: baseline.id,
        exerciseId: baselineExercise.id,
        repetitions: 8,
        state: "BASELINE",
      };
    },
  );
  await check(
    "U12 second real session renders actual repetitions evolution without fabricated values",
    async () => {
      second = await completeActual(ago(1), baselineExercise.id, {
        load: "40",
        repetitions: 10,
        rpe: 7,
        name: "Segunda referencia UX5",
      });
      await go("/app");
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-exercise]")',
          ),
        "progress reloaded",
      );
      await chooseProgressExercise(baselineExercise.id);
      const data = await api(
        "get",
        "/workout-sessions/progress?period=all&exerciseId=" +
          baselineExercise.id,
      );
      assert.equal(data.series[0].comparison.state, "COMPARED");
      assert.equal(data.series[0].comparison.repetitionsDelta, 2);
      assert.deepEqual(
        data.series[0].points.map((p) => p.repetitions),
        [8, 10],
      );
      await until(
        () =>
          sync(
            'return document.querySelector("[data-testid=progress-overview]")?.textContent.includes("+2")',
          ),
        "visible real delta",
      );
      await click(".exercise-progress .observations button:first-child");
      await until(
        () =>
          sync(
            'return document.querySelector(".exercise-progress .selected-record")?.textContent.includes("8 repeticiones")',
          ),
        "inspect actual baseline point",
      );
      await click(".exercise-progress .progress-chart details summary");
      const table = await sync(
        'return [...document.querySelectorAll("table")].find(e=>e.querySelector("caption")?.textContent.includes("Repeticiones registradas"))?.textContent',
      );
      assert.match(table, /8/);
      assert.match(table, /10/);
      assert.equal(
        await sync(
          'return document.querySelector(".exercise-progress .progress-chart details").open',
        ),
        true,
      );
      await click(".exercise-progress .progress-chart details summary");
      await click(".exercise-progress .observations button:first-child");
      assert.match(
        await sync(
          'return document.querySelector(".exercise-progress .selected-record").textContent',
        ),
        /8 repeticiones/,
      );
      await health("mobile-progress-multiple");
      return { sessionId: second.id, repetitions: [8, 10], delta: 2 };
    },
  );
  await check(
    "U13 all four period selectors query real date windows and update visible data",
    async () => {
      const observations = [];
      for (const period of ["7", "30", "90", "all"]) {
        await click("[data-testid=progress-period-" + period + "]");
        await until(
          () =>
            sync(
              'return document.querySelector(arguments[0]).getAttribute("aria-pressed")==="true"',
              ["[data-testid=progress-period-" + period + "]"],
            ),
          "period " + period,
        );
        const data = await api(
          "get",
          `/workout-sessions/progress?period=${period}&exerciseId=${baselineExercise.id}`,
        );
        assert.equal(data.period, period);
        assert.equal(data.series[0].points.length, period === "7" ? 1 : 2);
        await until(
          () =>
            sync(
              'return document.querySelector("[data-testid=progress-overview]").getAttribute("aria-busy")==="false"&&document.querySelectorAll("[data-testid=progress-repetitions-chart] circle").length===arguments[0]',
              [period === "7" ? 1 : 2],
            ),
          "visible period points " + period,
        );
        observations.push({ period, points: data.series[0].points.length });
      }
      await health("mobile-progress-periods");
      return observations;
    },
  );
  await check(
    "U14 completed work with no RPE still renders useful repetitions baseline",
    async () => {
      noRpe = await completeActual(ago(2), noRpeExercise.id, {
        load: "35",
        repetitions: 9,
        rpe: null,
        name: "Sin RPE UX5",
      });
      await go("/app");
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-exercise]")',
          ),
        "progress no RPE",
      );
      await chooseProgressExercise(noRpeExercise.id);
      const data = await api(
        "get",
        "/workout-sessions/progress?period=all&exerciseId=" + noRpeExercise.id,
      );
      assert.equal(data.series[0].points[0].repetitions, 9);
      assert.equal(data.estimates.length, 0);
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-repetitions-chart]")',
          ),
        "no RPE chart",
      );
      assert.match(
        await sync(
          'return document.querySelector(".exercise-progress .selected-record").textContent',
        ),
        /9 repeticiones/,
      );
      await health("mobile-progress-without-rpe");
      return { sessionId: noRpe.id, repetitions: 9, estimates: 0 };
    },
  );
  await check(
    "U15 exercise unfit for 1RM keeps actual data without technical checkbox panel or duration invention",
    async () => {
      unsuitable = await completeActual(ago(3), unsuitableExercise.id, {
        load: "10",
        repetitions: 12,
        rpe: 7,
        name: "Ejercicio sin 1RM UX5",
      });
      await go("/app");
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-exercise]")',
          ),
        "progress unfit",
      );
      await chooseProgressExercise(unsuitableExercise.id);
      const data = await api(
        "get",
        "/workout-sessions/progress?period=all&exerciseId=" +
          unsuitableExercise.id,
      );
      assert.equal(data.series[0].points[0].repetitions, 12);
      assert.equal(data.estimates.length, 0);
      assert.equal(data.duration.status, "UNSUPPORTED");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-repetitions-chart]")',
          ),
        "unfit actual chart",
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll("[data-testid=progress-overview] input[type=checkbox]").length',
        ),
        0,
      );
      assert.match(
        await sync(
          'return document.querySelector(".exercise-progress .selected-record").textContent',
        ),
        /12 repeticiones/,
      );
      await click(".metric-context summary");
      assert.match(
        await sync(
          'return document.querySelector(".metric-context").textContent',
        ),
        /no se muestra una evolución de tiempo/i,
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll("svg[data-testid^=progress-estimate]").length',
        ),
        0,
      );
      await health("mobile-progress-unfit-1rm");
      return {
        sessionId: unsuitable.id,
        repetitions: 12,
        estimates: 0,
        duration: "UNSUPPORTED",
      };
    },
  );
  planSnapshot = await immutablePlans();
  historySnapshot = await immutableHistory();
  await check(
    "U16 progress history link opens real completed records and preserved actual sets",
    async () => {
      await textClick("[data-testid=progress-overview] a", "Ver historial →");
      await until(
        () => sync('return location.pathname==="/app/history"'),
        "real history",
      );
      await until(
        () =>
          sync(
            'return document.querySelector("main").textContent.includes("Primera referencia UX5")',
          ),
        "baseline in history",
      );
      await health("mobile-real-history");
      const baselineRead = await api("get", `/workout-sessions/${baseline.id}`);
      assert.equal(baselineRead.actualSetCount, 1);
      assert.equal(baselineRead.exercises[0].sets[0].repetitions, 8);
      return { baselineSaved: true, actualSets: 1 };
    },
  );
  await check(
    "U17 foreign athlete history and plan remain inaccessible",
    async () => {
      const deniedSession = await request(
        "get",
        "/workout-sessions/" + fixture.tasks[0].sessionId,
      );
      assert.equal(deniedSession.status, 404);
      const deniedPlan = await request(
        "get",
        "/training-plans/" + fixture.plan.id + "/planning",
      );
      assert.equal(deniedPlan.status, 404);
      const overview = await api(
        "get",
        "/workout-sessions/progress?period=all",
      );
      assert.equal(
        overview.exercises.some((e) => e.id === fixture.exercise.id),
        false,
      );
      return {
        sessionStatus: 404,
        planStatus: 404,
        foreignExerciseAbsent: true,
      };
    },
  );
  await check(
    "U18 desktop charts and plan remain healthy with no history plan or automation writes",
    async () => {
      await viewport(1440, 1000);
      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-exercise]")',
          ),
        "desktop progress",
      );
      await chooseProgressExercise(baselineExercise.id);
      await health("desktop-progress");
      await go("/app?planId=" + planId);
      await until(
        () =>
          sync(
            'return document.querySelectorAll(".routine-session-tabs button").length===4',
          ),
        "desktop saved plan",
      );
      await health("desktop-plan");
      assert.equal(await immutablePlans(), planSnapshot);
      assert.equal(await immutableHistory(), historySnapshot);
      const counts = (
        await sql.query(
          "SELECT (SELECT count(*) FROM progression_recommendations WHERE athlete_id=$1)::int AS proposals,(SELECT count(*) FROM progression_applications WHERE athlete_id=$1)::int AS applications,(SELECT count(*) FROM progression_automation_consents WHERE athlete_id=$1)::int AS consents",
          [athleteId],
        )
      ).rows[0];
      assert.deepEqual(counts, { proposals: 0, applications: 0, consents: 0 });
      return { plansPreserved: true, historyPreserved: true, ...counts };
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
