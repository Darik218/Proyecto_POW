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
const evidence = await mkdtemp(join(tmpdir(), "pulso-final-ux-evidence-")),
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
let sid,
  athleteId,
  planId,
  planning,
  firstSession,
  secondSession,
  firstHistory,
  generationPayload,
  otherAccountToken;
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
  assert.equal(
    await sync(
      'const element=document.querySelector(arguments[0]);if(!element||element.disabled)return false;element.scrollIntoView({block:"center"});element.click();return true',
      [selector],
    ),
    true,
    "click " + selector,
  );
}
async function textClick(selector, text) {
  assert.equal(
    await sync(
      'const element=[...document.querySelectorAll(arguments[0])].find(e=>e.textContent.replace(/\\s+/g," ").trim()===arguments[1]);if(!element||element.disabled)return false;element.scrollIntoView({block:"center"});element.click();return true',
      [selector, text],
    ),
    true,
    "click " + text,
  );
}
async function field(selector, value) {
  assert.equal(
    await sync(
      'const element=document.querySelector(arguments[0]);if(!element||element.disabled)return false;element.value=arguments[1];element.dispatchEvent(new Event(element.tagName==="SELECT"?"change":"input",{bubbles:true}));return true',
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
    'return {path:location.pathname,width:innerWidth,title:document.title,meaningful:document.querySelector("main")?.textContent.length,overflow:document.documentElement.scrollWidth-innerWidth,overlay:!!document.querySelector("vite-error-overlay"),errors:window.__finalUxErrors??[],offenders:[...document.querySelectorAll("main *")].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,8).map(e=>e.tagName+"."+e.className)}',
  );
  assert.ok(value.meaningful > 50);
  assert.equal(value.overlay, false);
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
  await shot(name);
  return value;
}
async function history(sessionId) {
  return (
    await sql.query(
      "SELECT row_to_json(s)::text AS row FROM set_records s JOIN workout_exercises w ON w.id=s.workout_exercise_id WHERE w.session_id=$1 ORDER BY s.id",
      [sessionId],
    )
  ).rows.map((row) => row.row);
}
async function sessionSetup(date, mode) {
  const created = await request("post", "/workout-sessions", {
    id: randomUUID(),
    performedOn: date,
    timeZone: "UTC",
    recordingMode: mode,
    name: "Verificación UX",
    trainingPlanId: planId,
    planWeekId: planning.weeks[0].id,
    planDayId: planning.weeks[0].days.find((day) => day.weekday === 1).id,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data;
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
  await viewport(1440, 1000);
  await command("/url", "POST", { url: cfg.origin + "/register" });
  await until(
    () => sync('return !!document.querySelector("#email")'),
    "register form",
  );
  await sync(
    `window.__finalUxErrors=[];window.addEventListener('error',e=>window.__finalUxErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__finalUxErrors.push(String(e.reason?.message??e.reason)));const previous=console.error;console.error=function(...args){window.__finalUxErrors.push(args.map(String).join(' '));previous.apply(console,args)};const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(method,url,...rest){this.__finalUxUrl=String(url);return originalOpen.call(this,method,url,...rest)};XMLHttpRequest.prototype.send=function(body){if(this.__finalUxUrl?.endsWith('/routine/plans'))window.__finalUxGeneration=body;if(this.__finalUxUrl?.includes('/routine/plans/')&&this.__finalUxUrl.endsWith('/duplicate'))window.__finalUxDuplicate=body;return originalSend.call(this,body)}`,
  );
  await check("U01 fresh registration opens onboarding wizard", async () => {
    await field("#email", email);
    await field("#password", password);
    await click("form.auth-form button[type=submit]");
    await until(
      () =>
        sync(
          'return location.pathname==="/app"&&!!document.querySelector(".routine-wizard")',
        ),
      "new athlete onboarding",
    );
    const {
      rows: [athlete],
    } = await sql.query(
      "SELECT a.id FROM athletes a JOIN users u ON u.id=a.user_id WHERE u.email=$1",
      [email],
    );
    assert.ok(athlete);
    athleteId = athlete.id;
    return { route: "/app", wizard: true };
  });
  await check(
    "U02 PPL split has visible date and explicit targets only",
    async () => {
      await textClick(".style-option strong", "Push · Pull · Legs");
      await field("#routine-name", "PPL comprobada desde la interfaz");
      await field("#routine-weeks", "2");
      assert.match(
        await sync('return document.querySelector("#routine-start").value'),
        /^\d{4}-\d{2}-\d{2}$/,
      );
      await textClick(".routine-wizard .primary-button", "Continuar");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".builder-catalog input[type=search]")',
          ),
        "block editor",
      );
      await field(".builder-catalog input[type=search]", exercise.name);
      await pause(350);
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".catalog-option strong")].some(e=>e.textContent===arguments[0])',
            [exercise.name],
          ),
        "real catalog result",
      );
      for (const name of ["PUSH", "PULL", "LEGS"]) {
        assert.equal(
          await sync(
            'const button=[...document.querySelectorAll(".block-tab")].find(e=>e.textContent.trim().startsWith(arguments[0]));button?.click();return !!button',
            [name],
          ),
          true,
        );
        await sync(
          'const row=[...document.querySelectorAll(".catalog-option")].find(e=>e.querySelector("strong")?.textContent===arguments[0]);row.querySelector("input[type=checkbox]").click()',
          [exercise.name],
        );
        assert.deepEqual(
          await sync(
            'return [...document.querySelectorAll(".exercise-targets input")].slice(0,4).map(e=>e.value)',
          ),
          ["", "", "", ""],
        );
        await field(
          ".exercise-targets .target-grid label:nth-child(1) input",
          "1",
        );
        await field(
          ".exercise-targets .target-grid label:nth-child(2) input",
          "8",
        );
        await field(
          ".exercise-targets .target-grid label:nth-child(3) input",
          "8",
        );
        if (name === "PULL") {
          await field(".exercise-targets .load-grid input", "12.125");
          await field(".exercise-targets .load-grid select", "LB");
        }
      }
      await health("desktop-blocks");
      await viewport(390, 844);
      await health("mobile-blocks");
      await viewport(1440, 1000);
      await textClick(".routine-wizard .primary-button", "Continuar");
      await until(
        () =>
          sync(
            'return document.querySelectorAll(".weekday-assignment").length===7',
          ),
        "seven weekdays",
      );
      const assignments = await sync(
        'return [...document.querySelectorAll(".weekday-assignment select")].map(e=>e.selectedOptions[0].textContent)',
      );
      assert.deepEqual(assignments, [
        "PUSH",
        "PULL",
        "LEGS",
        "PUSH",
        "PULL",
        "LEGS",
        "Descanso",
      ]);
      await health("desktop-week-review");
      await viewport(390, 844);
      await health("mobile-week-review");
      await viewport(1440, 1000);
      return { blocks: 3, trainingDays: 6, restDays: 1, weeks: 2 };
    },
  );
  await check(
    "U03 create real independent day/week prescriptions and rest",
    async () => {
      await textClick(".routine-wizard .primary-button", "Crear mi rutina");
      await until(
        () =>
          sync(
            'return !document.querySelector(".routine-wizard")&&document.querySelectorAll(".routine-day").length>0',
          ),
        "created routine",
      );
      generationPayload = JSON.parse(
        await sync("return window.__finalUxGeneration"),
      );
      planId = generationPayload.id;
      const value = await request("get", `/training-plans/${planId}/planning`);
      assert.equal(value.status, 200);
      planning = value.data;
      assert.equal(planning.weeks.length, 2);
      assert.equal(
        planning.weeks.reduce((n, w) => n + w.days.length, 0),
        12,
      );
      const prescriptions = planning.weeks.flatMap((w) =>
        w.days.flatMap((d) => d.exercises),
      );
      assert.equal(prescriptions.length, 12);
      assert.equal(new Set(prescriptions.map((p) => p.id)).size, 12);
      for (const week of planning.weeks)
        for (const day of week.days) {
          assert.equal(
            day.exercises[0].targetLoad,
            day.name === "PULL" ? 12.125 : null,
          );
          assert.equal(
            day.exercises[0].targetLoadUnit,
            day.name === "PULL" ? "LB" : null,
          );
        }
      const {
        rows: [counts],
      } = await sql.query(
        "SELECT count(*) FILTER(WHERE status='REST')::int AS rest,count(*) FILTER(WHERE status='PLANNED')::int AS planned FROM scheduled_activities WHERE athlete_id=$1 AND plan_week_id=ANY($2::uuid[])",
        [athleteId, planning.weeks.map((w) => w.id)],
      );
      assert.deepEqual(counts, { rest: 2, planned: 12 });
      await health("desktop-created-routine");
      await viewport(390, 844);
      await health("mobile-created-routine");
      await viewport(1440, 1000);
      return {
        weeks: 2,
        days: 12,
        independentPrescriptions: 12,
        restActivities: 2,
      };
    },
  );
  await check(
    "U04 routine retry identity and changed payload conflict",
    async () => {
      const retry = await request("post", "/routine/plans", generationPayload);
      assert.equal(retry.status, 201);
      assert.equal(retry.data.id, planId);
      const changed = await request("post", "/routine/plans", {
        ...generationPayload,
        name: "Distinto",
      });
      assert.equal(changed.status, 409);
      const {
        rows: [count],
      } = await sql.query(
        "SELECT count(*)::int AS count FROM training_plans WHERE id=$1",
        [planId],
      );
      assert.equal(count.count, 1);
      const independent = await request("post", "/routine/plans", {
        ...generationPayload,
        id: randomUUID(),
        name: "Intención nueva explícita",
      });
      assert.equal(independent.status, 201);
      assert.notEqual(independent.data.id, planId);
      return { sameIntentCount: 1, changedPayload: 409, newIntent: 201 };
    },
  );
  await check("U05 ownership and atomic exact decimal rejection", async () => {
    assert.equal(
      (await request("get", `/training-plans/${fixture.plan.id}/planning`))
        .status,
      404,
    );
    const invalidId = randomUUID();
    const invalid = structuredClone(generationPayload);
    invalid.id = invalidId;
    invalid.days[0].exercises[0].targetLoad = "12.1251";
    invalid.days[0].exercises[0].targetLoadUnit = "KG";
    assert.equal(
      (await request("post", "/routine/plans", invalid)).status,
      400,
    );
    assert.equal(
      (
        await sql.query("SELECT id FROM training_plans WHERE id=$1", [
          invalidId,
        ])
      ).rowCount,
      0,
    );
    return { otherAthlete: 404, invalidDecimal: 400, partialPlanRows: 0 };
  });
  await check(
    "U06 existing copy day/week APIs produce independent targets",
    async () => {
      const week = planning.weeks[0],
        day = week.days[0];
      let copied = await request(
        "post",
        `/training-plans/${planId}/weeks/${week.id}/days/${day.id}/copy`,
        { position: 7, expectedVersion: planning.version },
      );
      assert.equal(copied.status, 201, JSON.stringify(copied.data));
      const copiedDay = copied.data.weeks[0].days.find((d) => d.position === 7);
      assert.ok(copiedDay);
      assert.notEqual(copiedDay.exercises[0].id, day.exercises[0].id);
      copied = await request(
        "post",
        `/training-plans/${planId}/weeks/${week.id}/copy`,
        { weekNumber: 3, expectedVersion: copied.data.version },
      );
      assert.equal(copied.status, 201, JSON.stringify(copied.data));
      assert.equal(copied.data.weeks.length, 3);
      planning = copied.data;
      return { copiedDayIndependent: true, weeks: 3 };
    },
  );
  await check(
    "U07 actual UI records yesterday 60KG x8 RPE8 work and completes",
    async () => {
      const dates = await sync(
        "const now=new Date(),yesterday=new Date(now);yesterday.setUTCDate(yesterday.getUTCDate()-1);return {today:now.toISOString().slice(0,10),yesterday:yesterday.toISOString().slice(0,10)}",
      );
      firstSession = await sessionSetup(dates.yesterday, "RETROSPECTIVE");
      await go("/app/workouts/" + firstSession.id);
      await until(
        () => sync('return !!document.querySelector(".workout-exercise-card")'),
        "first workout",
      );
      await textClick("button", "Comenzar registro anterior");
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Registrar serie")',
          ),
        "recordable session",
      );
      await textClick(".workout-exercise-card button", "Registrar serie");
      await until(
        () => sync('return !!document.querySelector(".quick-set-form")'),
        "set form",
      );
      await field('.quick-set-form input[id$="-load"]', "60");
      await field('.quick-set-form select[id$="-unit"]', "KG");
      await field('.quick-set-form input[id$="-reps"]', "8");
      await field('.quick-set-form input[id$="-rpe"]', "8");
      await textClick(".quick-set-form button", "Guardar serie");
      await until(async () => {
        const { rows } = await sql.query(
          "SELECT s.* FROM set_records s JOIN workout_exercises w ON w.id=s.workout_exercise_id WHERE w.session_id=$1",
          [firstSession.id],
        );
        return rows.length === 1;
      }, "persisted actual set");
      await textClick("button", "Finalizar entrenamiento");
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll("form")].some(e=>e.textContent.includes("Confirmación de cierre"))',
          ),
        "completion confirmation",
      );
      await sync(
        'const form=[...document.querySelectorAll("form")].find(e=>e.textContent.includes("Confirmación de cierre"));form.querySelector("input[type=checkbox]").click()',
      );
      await textClick("button", "Confirmar finalización");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".workout-insights .insight-orientation")',
          ),
        "immediate orientation",
      );
      const {
        rows: [set],
      } = await sql.query(
        "SELECT s.load::text,s.load_unit,s.repetitions,s.rpe::text,s.kind,s.status FROM set_records s JOIN workout_exercises w ON w.id=s.workout_exercise_id WHERE w.session_id=$1",
        [firstSession.id],
      );
      assert.equal(Number(set.load), 60);
      assert.equal(set.load_unit, "KG");
      assert.equal(set.repetitions, 8);
      assert.equal(Number(set.rpe), 8);
      assert.equal(set.kind, "WORK");
      assert.equal(set.status, "COMPLETED");
      firstHistory = await history(firstSession.id);
      await health("desktop-completed-orientation");
      return {
        load: "60",
        unit: "KG",
        repetitions: 8,
        rpe: 8,
        kind: "WORK",
        orientation: true,
      };
    },
  );
  await check(
    "U08 explicit load declaration renders descriptive Epley and Brzycki",
    async () => {
      await click(".workout-insights details summary");
      await until(
        () =>
          sync('return !!document.querySelector(".insight-declaration input")'),
        "load declaration",
      );
      assert.equal(
        await sync(
          'return document.querySelector(".insight-declaration input").checked',
        ),
        false,
      );
      assert.equal(
        await sync(
          'return document.querySelector(".insight-declaration button").disabled',
        ),
        true,
      );
      await click(".insight-declaration input");
      await click(".insight-declaration button");
      await until(
        () =>
          sync(
            'return document.querySelectorAll(".insight-estimate strong").length===2',
          ),
        "two formula estimates",
      );
      const estimates = await sync(
        'return [...document.querySelectorAll(".insight-estimate strong")].map(e=>e.textContent.replace(/\\s+/g," ").trim())',
      );
      assert.ok(
        estimates.some((text) => /EPLEY:\s*76(?:\D|$)/.test(text)),
        JSON.stringify(estimates),
      );
      assert.ok(
        estimates.some((text) => /BRZYCKI:\s*74\.482759/.test(text)),
        JSON.stringify(estimates),
      );
      assert.deepEqual(await history(firstSession.id), firstHistory);
      await health("desktop-estimates");
      await viewport(390, 844);
      await health("mobile-estimates");
      await viewport(1440, 1000);
      return { estimates, historicalSetsUnchanged: true };
    },
  );
  await check(
    "U09 next workout copies prior actual values only after confirmation",
    async () => {
      const today = await sync("return new Date().toISOString().slice(0,10)");
      secondSession = await sessionSetup(today, "LIVE");
      await go("/app/workouts/" + secondSession.id);
      await until(
        () => sync('return !!document.querySelector(".workout-exercise-card")'),
        "second workout",
      );
      await textClick("button", "Empezar entrenamiento");
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".workout-exercise-card button")].some(e=>e.textContent.trim()==="Registrar serie")',
          ),
        "record second",
      );
      await textClick(".workout-exercise-card button", "Registrar serie");
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".quick-set-form button")].some(e=>e.textContent.trim()==="Usar carga y repeticiones anteriores")',
          ),
        "previous actual reference",
      );
      await textClick(
        ".quick-set-form button",
        "Usar carga y repeticiones anteriores",
      );
      assert.deepEqual(
        await sync(
          "return arguments[0].map(selector=>document.querySelector(selector).value)",
          [
            [
              '.quick-set-form input[id$="-load"]',
              '.quick-set-form input[id$="-reps"]',
              '.quick-set-form input[id$="-rpe"]',
            ],
          ],
        ),
        ["60", "8", ""],
      );
      await textClick(".quick-set-form button", "Guardar serie");
      await until(
        () =>
          sync(
            'return document.querySelector(".quick-set-form [role=alert]")?.textContent.includes("Confirma")',
          ),
        "explicit copied result confirmation",
      );
      assert.equal(
        (
          await sql.query(
            "SELECT s.id FROM set_records s JOIN workout_exercises w ON w.id=s.workout_exercise_id WHERE w.session_id=$1",
            [secondSession.id],
          )
        ).rowCount,
        0,
      );
      await click(".quick-set-confirm input[type=checkbox]");
      await field('.quick-set-form input[id$="-rpe"]', "8");
      await textClick(".quick-set-form button", "Guardar serie");
      await until(
        async () =>
          (
            await sql.query(
              "SELECT s.id FROM set_records s JOIN workout_exercises w ON w.id=s.workout_exercise_id WHERE w.session_id=$1",
              [secondSession.id],
            )
          ).rowCount === 1,
        "copied actual values saved",
      );
      assert.deepEqual(await history(firstSession.id), firstHistory);
      await health("desktop-previous-reference");
      await viewport(390, 844);
      await health("mobile-previous-reference");
      return {
        previousLoad: "60",
        previousReps: 8,
        rpeWasNotCopied: true,
        confirmationRequired: true,
        historicalSetsUnchanged: true,
      };
    },
  );
  await check(
    "U10 inline private creation keeps wizard draft and enforces owner visibility",
    async () => {
      await viewport(1440, 1000);
      await go("/app?create=true");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".routine-wizard #routine-name")',
          ),
        "inline private wizard",
      );
      await field("#routine-name", "Borrador conservado con ejercicio propio");
      await field("#routine-weeks", "3");
      await textClick(".routine-wizard .primary-button", "Continuar");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".builder-catalog input[type=search]")',
          ),
        "inline private block",
      );
      await field(".block-heading input", "Bloque privado conservado");
      await field(".builder-catalog input[type=search]", exercise.name);
      await pause(350);
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".catalog-option strong")].some(e=>e.textContent===arguments[0])',
            [exercise.name],
          ),
        "existing draft exercise",
      );
      await sync(
        'const row=[...document.querySelectorAll(".catalog-option")].find(e=>e.querySelector("strong")?.textContent===arguments[0]);row.querySelector("input[type=checkbox]").click()',
        [exercise.name],
      );
      await field(
        ".exercise-targets .target-grid label:nth-child(1) input",
        "2",
      );
      await field(
        ".exercise-targets .target-grid label:nth-child(2) input",
        "6",
      );
      await field(
        ".exercise-targets .target-grid label:nth-child(3) input",
        "8",
      );
      await textClick(".catalog-heading button", "Crear ejercicio privado");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".personal-training-exercise")',
          ),
        "inline creator",
      );
      await field(
        '.personal-training-exercise input[id$="name"]',
        "Borrador que se cancela",
      );
      await textClick(".personal-training-exercise button", "Cancelar");
      assert.equal(
        await sync(
          'return !!document.querySelector(".personal-training-exercise")',
        ),
        false,
      );
      assert.deepEqual(
        await sync(
          'return [...document.querySelectorAll(".exercise-targets .target-grid input")].map(e=>e.value)',
        ),
        ["2", "6", "8"],
      );
      await textClick(".catalog-heading button", "Crear ejercicio privado");
      await until(
        () =>
          sync(
            'return document.querySelector(".personal-training-exercise select[id$=group]")?.options.length>1',
          ),
        "private muscle options",
      );
      assert.equal(
        await sync(
          'return [...document.querySelectorAll(".personal-training-exercise [required]")].filter(e=>e.getClientRects().length).length',
        ),
        3,
      );
      assert.equal(
        await sync(
          'return document.querySelector(".personal-training-exercise details").open',
        ),
        false,
      );
      const privateName = "Privado inline " + randomUUID();
      await field('.personal-training-exercise input[id$="name"]', privateName);
      const muscle = await sync(
        'return [...document.querySelector(".personal-training-exercise select[id$=group]").options].find(e=>e.value).value',
      );
      await field('.personal-training-exercise select[id$="group"]', muscle);
      await field('.personal-training-exercise select[id$="type"]', "DUMBBELL");
      await textClick(
        ".personal-training-exercise button",
        "Crear y seleccionar",
      );
      await until(
        () =>
          sync(
            'return !document.querySelector(".personal-training-exercise")&&document.querySelectorAll(".exercise-targets").length===2',
          ),
        "created and selected private exercise",
      );
      assert.equal(
        await sync(
          'return document.querySelector(".block-heading input").value',
        ),
        "Bloque privado conservado",
      );
      assert.ok(
        await sync(
          'return [...document.querySelectorAll(".exercise-targets legend")].some(e=>e.textContent.includes(arguments[0]))',
          [privateName],
        ),
      );
      assert.deepEqual(
        await sync(
          'return [...[...document.querySelectorAll(".exercise-targets")][1].querySelectorAll("input")].map(e=>e.value)',
        ),
        ["", "", "", ""],
      );
      assert.deepEqual(
        await sync(
          'return [...[...document.querySelectorAll(".exercise-targets")][0].querySelectorAll(".target-grid input")].map(e=>e.value)',
        ),
        ["2", "6", "8"],
      );
      const {
        rows: [created],
      } = await sql.query(
        "SELECT e.id,e.origin,e.owner_id,u.id AS expected_owner FROM exercises e CROSS JOIN users u WHERE e.name=$1 AND u.email=$2",
        [privateName, email],
      );
      assert.ok(created);
      assert.equal(created.origin, "PERSONAL");
      assert.equal(created.owner_id, created.expected_owner);
      assert.equal(
        (await request("get", "/exercises/" + created.id)).status,
        200,
      );
      const login = await fetch(
        new URL((cfg.apiPath ?? "/api/v1") + "/auth/login", cfg.origin),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: cfg.origin },
          body: JSON.stringify({
            email: fixture.user.email,
            password: fixture.password,
          }),
        },
      );
      assert.equal(login.status, 200, "fixture account login");
      const otherAccount = await login.json();
      otherAccountToken = otherAccount.accessToken;
      const hidden = await fetch(
        new URL(
          (cfg.apiPath ?? "/api/v1") + "/exercises/" + created.id,
          cfg.origin,
        ),
        { headers: { Authorization: "Bearer " + otherAccount.accessToken } },
      );
      assert.equal(
        hidden.status,
        404,
        "another athlete cannot read the private exercise",
      );
      assert.deepEqual(await history(firstSession.id), firstHistory);
      await health("desktop-inline-private-selected");
      await viewport(390, 844);
      await health("mobile-inline-private-selected");
      await viewport(1440, 1000);
      await textClick(".routine-wizard button", "Atrás");
      await until(
        () => sync('return !!document.querySelector("#routine-name")'),
        "preserved wizard metadata",
      );
      assert.equal(
        await sync('return document.querySelector("#routine-name").value'),
        "Borrador conservado con ejercicio propio",
      );
      assert.equal(
        await sync('return document.querySelector("#routine-weeks").value'),
        "3",
      );
      return {
        visibleRequiredFields: 3,
        privateResourceCreated: true,
        ownerCanRead: 200,
        otherAthleteCannotRead: 404,
        selectedTargetsBlank: true,
        cancelPreservesDraft: true,
        wizardMetadataPreserved: true,
        historicalSetsUnchanged: true,
      };
    },
  );
  await check(
    "U11 whole routine clone preserves all weeks and goals without history or permissions",
    async () => {
      await viewport(1440, 1000);
      await textClick(".routine-wizard button", "Cancelar");
      await until(
        () => sync('return !!document.querySelector("#routine-plan")'),
        "routine selector for clone",
      );
      await field("#routine-plan", planId);
      await until(
        () =>
          sync(
            'return document.querySelector("#routine-plan")?.value===arguments[0]&&document.querySelector("#routine-week")?.options.length===3&&[...document.querySelectorAll("button")].some(button=>button.textContent.trim()==="Duplicar rutina")',
            [planId],
          ),
        "original three-week PPL selected",
      );
      const sourceResponse = await request(
        "get",
        `/training-plans/${planId}/planning`,
      );
      assert.equal(sourceResponse.status, 200);
      const source = sourceResponse.data;
      assert.equal(source.weeks.length, 3);
      assert.deepEqual(
        source.weeks.map((week) => week.days.length),
        [7, 6, 7],
      );
      assert.ok(
        source.version > 0,
        "copy-day/week setup must produce a stale revision to test",
      );
      const snapshot = async () => {
        const queries = [
          "SELECT row_to_json(p)::text AS row FROM training_plans p WHERE p.id=$1 ORDER BY p.id",
          "SELECT row_to_json(w)::text AS row FROM plan_weeks w WHERE w.training_plan_id=$1 ORDER BY w.id",
          "SELECT row_to_json(d)::text AS row FROM plan_days d JOIN plan_weeks w ON w.id=d.plan_week_id WHERE w.training_plan_id=$1 ORDER BY d.id",
          "SELECT row_to_json(e)::text AS row FROM plan_exercises e JOIN plan_weeks w ON w.id=e.plan_week_id WHERE w.training_plan_id=$1 ORDER BY e.id",
          "SELECT row_to_json(a)::text AS row FROM scheduled_activities a JOIN plan_weeks w ON w.id=a.plan_week_id WHERE w.training_plan_id=$1 ORDER BY a.id",
          "SELECT row_to_json(s)::text AS row FROM workout_sessions s WHERE s.training_plan_id=$1 ORDER BY s.id",
          "SELECT row_to_json(e)::text AS row FROM workout_exercises e JOIN workout_sessions s ON s.id=e.session_id WHERE s.training_plan_id=$1 ORDER BY e.id",
          "SELECT row_to_json(r)::text AS row FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id JOIN workout_sessions s ON s.id=e.session_id WHERE s.training_plan_id=$1 ORDER BY r.id",
        ];
        return JSON.stringify(
          await Promise.all(
            queries.map(async (query) =>
              (await sql.query(query, [planId])).rows.map((row) => row.row),
            ),
          ),
        );
      };
      const sourceSqlBefore = await snapshot();
      const secondHistoryBefore = await history(secondSession.id);
      const logicalPrescription = (value) => ({
        exerciseId: value.exercise.id,
        position: value.position,
        targetSets: value.targetSets,
        targetReps: value.targetReps,
        targetRepsMin: value.targetRepsMin,
        targetRepsMax: value.targetRepsMax,
        targetLoad: value.targetLoad,
        targetLoadUnit: value.targetLoadUnit,
        targetRpe: value.targetRpe,
        notes: value.notes,
      });
      const logicalWeeks = (plan) =>
        plan.weeks.map((week) => ({
          weekNumber: week.weekNumber,
          objective: week.objective,
          days: week.days.map((day) => ({
            name: day.name,
            position: day.position,
            weekday: day.weekday,
            exercises: day.exercises.map(logicalPrescription),
          })),
          pendingExercises: week.pendingExercises.map(logicalPrescription),
        }));
      const entityIds = (plan) => [
        plan.id,
        ...plan.weeks.flatMap((week) => [
          week.id,
          ...week.pendingExercises.map((value) => value.id),
          ...week.days.flatMap((day) => [
            day.id,
            ...day.exercises.map((value) => value.id),
          ]),
        ]),
      ];
      await textClick("button", "Duplicar rutina");
      await until(
        () =>
          sync(
            'const form=[...document.querySelectorAll("form")].find(element=>element.querySelector("h2")?.textContent.trim()==="Duplicar rutina completa");return !!form?.querySelector("input:not([disabled])")',
          ),
        "verified clone source version",
      );
      const copyName = "Copia completa independiente " + randomUUID();
      assert.equal(
        await sync(
          'const form=[...document.querySelectorAll("form")].find(element=>element.querySelector("h2")?.textContent.trim()==="Duplicar rutina completa");const input=form.querySelector("input");input.value=arguments[0];input.dispatchEvent(new Event("input",{bubbles:true}));return true',
          [copyName],
        ),
        true,
      );
      await textClick("button", "Crear copia independiente");
      await until(
        () =>
          sync(
            'return !!window.__finalUxDuplicate&&![...document.querySelectorAll("form h2")].some(element=>element.textContent.trim()==="Duplicar rutina completa")',
          ),
        "whole routine clone created through UI",
      );
      const command = JSON.parse(
        await sync("return window.__finalUxDuplicate"),
      );
      assert.equal(command.name, copyName);
      assert.equal(command.expectedVersion, source.version);
      assert.notEqual(command.id, source.id);
      await until(
        () =>
          sync(
            'return document.querySelector("#routine-plan")?.value===arguments[0]&&document.querySelector("#routine-week")?.options.length===3',
            [command.id],
          ),
        "new copied routine selected",
      );
      const copyResponse = await request(
        "get",
        `/training-plans/${command.id}/planning`,
      );
      assert.equal(copyResponse.status, 200);
      const copy = copyResponse.data;
      assert.equal(copy.name, copyName);
      assert.equal(copy.status, "DRAFT");
      assert.equal(copy.startsOn, null);
      assert.equal(copy.endsOn, null);
      assert.ok(copy.weeks.every((week) => week.startsOn === null));
      assert.deepEqual(logicalWeeks(copy), logicalWeeks(source));
      const sourceIds = new Set(entityIds(source));
      const copiedIds = entityIds(copy);
      assert.equal(new Set(copiedIds).size, copiedIds.length);
      assert.ok(
        copiedIds.every((id) => !sourceIds.has(id)),
        "all copied planning IDs are fresh",
      );
      assert.ok(
        copy.weeks.every(
          (week) =>
            week.days.every(
              (day) =>
                !day.hasHistory &&
                day.exercises.every((value) => !value.hasHistory),
            ) && week.pendingExercises.every((value) => !value.hasHistory),
        ),
      );
      const {
        rows: [persisted],
      } = await sql.query(
        "SELECT name,status,starts_on,ends_on FROM training_plans WHERE id=$1 AND athlete_id=$2",
        [command.id, athleteId],
      );
      assert.deepEqual(persisted, {
        name: copyName,
        status: "DRAFT",
        starts_on: null,
        ends_on: null,
      });
      const {
        rows: [counts],
      } = await sql.query(
        `SELECT
        (SELECT count(*)::int FROM workout_sessions WHERE training_plan_id=$1) AS workouts,
        (SELECT count(*)::int FROM scheduled_activities a JOIN plan_weeks w ON w.id=a.plan_week_id WHERE w.training_plan_id=$1) AS activities,
        (SELECT count(*)::int FROM progression_recommendations r JOIN plan_weeks w ON w.id=r.plan_week_id WHERE w.training_plan_id=$1) AS recommendations,
        (SELECT count(*)::int FROM progression_automation_consents WHERE training_plan_id=$1) AS consents,
        (SELECT count(*)::int FROM progression_operational_grants g JOIN progression_automation_consents c ON c.id=g.consent_id WHERE c.training_plan_id=$1) AS grants,
        (SELECT count(*)::int FROM progression_applications WHERE athlete_id=$2) AS applications`,
        [command.id, athleteId],
      );
      assert.deepEqual(counts, {
        workouts: 0,
        activities: 0,
        recommendations: 0,
        consents: 0,
        grants: 0,
        applications: 0,
      });
      assert.equal(await snapshot(), sourceSqlBefore);
      assert.deepEqual(await history(firstSession.id), firstHistory);
      assert.deepEqual(await history(secondSession.id), secondHistoryBefore);
      await health("desktop-whole-routine-copy");
      await viewport(390, 844);
      await health("mobile-whole-routine-copy");
      await viewport(1440, 1000);
      const retry = await request(
        "post",
        `/routine/plans/${source.id}/duplicate`,
        command,
      );
      assert.equal(retry.status, 201);
      assert.equal(retry.data.id, copy.id);
      const {
        rows: [copies],
      } = await sql.query(
        "SELECT count(*)::int AS count FROM training_plans WHERE athlete_id=$1 AND name=$2",
        [athleteId, copyName],
      );
      assert.equal(
        copies.count,
        1,
        "same clone intent cannot create a second copy",
      );
      const concurrentCommand = {
        ...command,
        id: randomUUID(),
        name: copyName + " concurrente",
      };
      const concurrent = await execute(
        "return await Promise.all([0,1].map(async()=>{const r=await fetch(arguments[2]+arguments[0],{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.accessToken},body:JSON.stringify(arguments[1])});return{status:r.status,data:await r.json()}}))",
        [
          `/routine/plans/${source.id}/duplicate`,
          concurrentCommand,
          cfg.apiPath ?? "/api/v1",
        ],
      );
      assert.deepEqual(
        concurrent.map((r) => r.status),
        [201, 201],
      );
      assert.ok(concurrent.every((r) => r.data.id === concurrentCommand.id));
      assert.equal(
        (
          await sql.query(
            "SELECT id FROM training_plans WHERE athlete_id=$1 AND name=$2",
            [athleteId, concurrentCommand.name],
          )
        ).rowCount,
        1,
      );
      const changed = await request(
        "post",
        `/routine/plans/${source.id}/duplicate`,
        { ...command, name: copyName + " cambiado" },
      );
      assert.equal(changed.status, 409);
      const staleId = randomUUID();
      const stale = await request(
        "post",
        `/routine/plans/${source.id}/duplicate`,
        {
          id: staleId,
          expectedVersion: source.version - 1,
          name: "Versión anterior rechazada",
        },
      );
      assert.equal(stale.status, 409);
      assert.equal(
        (
          await sql.query("SELECT id FROM training_plans WHERE id=$1", [
            staleId,
          ])
        ).rowCount,
        0,
      );
      assert.ok(
        otherAccountToken,
        "U10 fixture account token is available for ownership verification",
      );
      const foreignId = randomUUID();
      const foreign = await fetch(
        new URL(
          (cfg.apiPath ?? "/api/v1") + `/routine/plans/${source.id}/duplicate`,
          cfg.origin,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + otherAccountToken,
          },
          body: JSON.stringify({
            id: foreignId,
            expectedVersion: source.version,
            name: "Origen ajeno rechazado",
          }),
        },
      );
      assert.equal(foreign.status, 404);
      assert.equal(
        (
          await sql.query("SELECT id FROM training_plans WHERE id=$1", [
            foreignId,
          ])
        ).rowCount,
        0,
      );
      assert.equal(await snapshot(), sourceSqlBefore);
      assert.deepEqual(await history(firstSession.id), firstHistory);
      assert.deepEqual(await history(secondSession.id), secondHistoryBefore);
      return {
        weeks: copy.weeks.length,
        daysByWeek: copy.weeks.map((week) => week.days.length),
        planningIdsFresh: copiedIds.length,
        goalsAndExactUnitsPreserved: true,
        sourceSqlUnchanged: true,
        historicalSetsUnchanged: true,
        status: "DRAFT",
        startsOn: null,
        workouts: 0,
        activities: 0,
        recommendations: 0,
        consents: 0,
        grants: 0,
        applications: 0,
        sameIntentCopyCount: 1,
        concurrentReplies: [201, 201],
        concurrentCopyCount: 1,
        changedPayload: 409,
        staleSourceVersion: 409,
        foreignSource: 404,
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
