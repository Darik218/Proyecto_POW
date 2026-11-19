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
const evidence = await mkdtemp(join(tmpdir(), "pulso-ux3-evidence-")),
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
      'const element=document.querySelector(arguments[0]);if(!element||element.disabled||!element.getClientRects().length)return false;element.scrollIntoView({block:"center"});element.click();return true',
      [selector],
    ),
    true,
    "click " + selector,
  );
}
async function textClick(selector, text) {
  assert.equal(
    await sync(
      'const element=[...document.querySelectorAll(arguments[0])].find(e=>e.textContent.replace(/\\s+/g," ").trim()===arguments[1]);if(!element||element.disabled||!element.getClientRects().length)return false;element.scrollIntoView({block:"center"});element.click();return true',
      [selector, text],
    ),
    true,
    "click " + text,
  );
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
  await viewport(390, 844);
  await command("/url", "POST", { url: cfg.origin + "/register" });
  await until(
    () => sync('return !!document.querySelector("#email")'),
    "registration",
  );
  await sync(
    `window.__finalUxErrors=[];window.addEventListener('error',e=>window.__finalUxErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__finalUxErrors.push(String(e.reason?.message??e.reason)));`,
  );
  let today,
    zone = "UTC",
    day,
    activity,
    currentSession,
    planBefore,
    secondExercise,
    firstHistorical,
    latestContextKey,
    initialProposal;
  const shift = (value, n) => {
    const date = new Date(value + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  };
  async function guideFor(source) {
    const query = new URLSearchParams(source);
    const value = await request("get", "/progression/workout-guide?" + query);
    assert.equal(value.status, 200, JSON.stringify(value.data));
    return value.data;
  }
  async function preview(source, g) {
    const e = g.exercises.find((e) => e.exerciseId === exercise.id);
    const input = {
      source,
      exerciseId: exercise.id,
      contextKey: e.repetitionContext.contextKey,
      policyContract: "session-repetition-preview-v1",
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        sameLoadConvention: true,
      },
    };
    const value = await request(
      "post",
      "/progression/workout-guide/repetition-preview",
      input,
    );
    return { value, input };
  }
  async function historical(date, effort = null) {
    const created = await request("post", "/workout-sessions", {
      id: randomUUID(),
      performedOn: date,
      timeZone: zone,
      recordingMode: "RETROSPECTIVE",
      trainingPlanId: planId,
      planWeekId: planning.weeks[0].id,
      planDayId: day.id,
      name: "Push anterior",
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    let current = (
      await request("post", "/workout-sessions/" + created.data.id + "/start", {
        expectedVersion: created.data.version,
      })
    ).data;
    for (const task of current.exercises)
      for (
        let number = 1;
        number <= (task.exercise.id === exercise.id ? 3 : 1);
        number++
      ) {
        const saved = await request(
          "post",
          `/workout-sessions/${current.id}/exercises/${task.id}/sets`,
          {
            id: randomUUID(),
            expectedVersion: current.version,
            setNumber: number,
            load: task.exercise.id === exercise.id ? "40" : "40",
            loadUnit: "KG",
            repetitions: 8,
            rpe: effort,
            status: "COMPLETED",
            kind: "WORK",
          },
        );
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        current = saved.data;
      }
    const closed = await request(
      "post",
      "/workout-sessions/" + current.id + "/complete",
      { expectedVersion: current.version, confirmWithoutResults: false },
    );
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    return closed.data;
  }
  await check(
    "U01 real mobile account and two-exercise Push plan with no initial history",
    async () => {
      await field("#email", email);
      await field("#password", password);
      await click("form.auth-form button[type=submit]");
      await until(
        () => sync('return location.pathname==="/app"'),
        "new athlete",
      );
      today = await sync("return new Date().toISOString().slice(0,10)");
      athleteId = (
        await sql.query(
          "SELECT a.id FROM athletes a JOIN users u ON u.id=a.user_id WHERE u.email=$1",
          [email],
        )
      ).rows[0].id;
      const group = (
        await sql.query(
          "SELECT m.key FROM muscle_groups m JOIN exercises e ON e.primary_muscle_group_id=m.id WHERE e.id=$1",
          [exercise.id],
        )
      ).rows[0].key;
      const second = await request("post", "/exercises", {
        name: "Remo UX-3 " + randomUUID().slice(0, 8),
        primaryMuscleGroupKey: group,
        equipment: "Barra",
        equipmentType: "BARBELL",
        oneRmSuitability: "SUITABLE",
      });
      assert.equal(second.status, 201, JSON.stringify(second.data));
      secondExercise = second.data;
      const generated = await request("post", "/routine/plans", {
        id: randomUUID(),
        name: "Push UX-3",
        durationWeeks: 1,
        frequency: 1,
        timeZone: zone,
        days: [
          {
            name: "Push",
            weekday: null,
            exercises: [
              {
                exerciseId: exercise.id,
                position: 1,
                targetSets: 3,
                targetRepsMin: 8,
                targetRepsMax: 12,
                targetLoad: "40",
                targetLoadUnit: "KG",
              },
              {
                exerciseId: secondExercise.id,
                position: 2,
                targetSets: 1,
                targetRepsMin: 8,
                targetRepsMax: 12,
                targetLoad: "40",
                targetLoadUnit: "KG",
              },
            ],
          },
        ],
      });
      assert.equal(generated.status, 201, JSON.stringify(generated.data));
      planId = generated.data.id;
      planning = (await request("get", `/training-plans/${planId}/planning`))
        .data;
      day = planning.weeks[0].days[0];
      const noHistory = await guideFor({
        planDayId: day.id,
        performedOn: today,
        timeZone: zone,
      });
      assert.equal(
        noHistory.exercises[0].guidanceSuggested.origin,
        "INSUFFICIENT_DATA",
      );
      assert.equal(noHistory.exercises[0].guidanceSuggested.load, null);
      assert.equal(noHistory.exercises[0].repetitionContext.ready, false);
      assert.ok(
        noHistory.exercises[0].repetitionContext.reasons.includes(
          "NO_ELIGIBLE_HISTORY",
        ),
      );
      return { firstBaseline: true, exercises: 2, noInventedProposal: true };
    },
  );
  await check(
    "U02 one completed session without effort or setting yields an optional extra rep within the plan",
    async () => {
      firstHistorical = await historical(shift(today, -3));
      const source = { planDayId: day.id, performedOn: today, timeZone: zone },
        g = await guideFor(source);
      const context = g.exercises[0].repetitionContext;
      assert.equal(context.ready, true);
      assert.equal(context.minimumSessions, 1);
      assert.equal(context.minimumSource, "PLAN_BOUND_INITIAL_POLICY");
      const { value } = await preview(source, g);
      assert.equal(value.status, 200, JSON.stringify(value.data));
      const result = value.data.exercises[0].guidanceSuggested;
      assert.equal(result.origin, "CALCULATED");
      assert.equal(result.policyVersion, "session-repetition-preview-v1");
      assert.equal(result.reps, 9);
      assert.equal(Number(result.load), 40);
      assert.equal(result.executionAuthorized, false);
      return {
        repetitions: result.reps,
        unchangedLoad: result.load,
        rpe: null,
        noAdvancedSettings: true,
      };
    },
  );
  await check(
    "U03 repeated compatible history still calculates rather than copying a saved proposal",
    async () => {
      await historical(shift(today, -1), 7);
      const source = { planDayId: day.id, performedOn: today, timeZone: zone },
        g = await guideFor(source);
      const { value, input } = await preview(source, g);
      assert.equal(value.status, 200, JSON.stringify(value.data));
      initialProposal = value.data.exercises[0].guidanceSuggested;
      assert.equal(initialProposal.origin, "CALCULATED");
      assert.equal(initialProposal.reps, 9);
      assert.equal(initialProposal.executionAuthorized, false);
      const invalid = await request(
        "post",
        "/progression/workout-guide/repetition-preview",
        {
          ...input,
          declaration: {
            sameVariant: true,
            sameEquipment: false,
            sameLoadConvention: true,
          },
        },
      );
      assert.equal(invalid.status, 400);
      const undeclaredConvention = await request(
        "post",
        "/progression/workout-guide/repetition-preview",
        { ...input, declaration: { sameVariant: true, sameEquipment: true } },
      );
      assert.equal(undeclaredConvention.status, 400);
      const n = (
        await sql.query(
          "SELECT count(*)::int AS n FROM progression_recommendations WHERE athlete_id=$1",
          [athleteId],
        )
      ).rows[0].n;
      assert.equal(n, 0);
      return {
        actualRepetitionAdvice: 9,
        historicalRepetitions: 8,
        persistedProposals: n,
        falseDeclarationRejected: true,
      };
    },
  );
  await check(
    "U04 mobile Home starts the exact scheduled Push in one action",
    async () => {
      const made = await request("post", "/routine/activities", {
        id: randomUUID(),
        planWeekId: planning.weeks[0].id,
        planDayId: day.id,
        scheduledOn: today,
        timeZone: zone,
        title: "Push UX-3",
        status: "PLANNED",
      });
      assert.equal(made.status, 201, JSON.stringify(made.data));
      activity = made.data;
      planBefore = (
        await sql.query(
          "SELECT row_to_json(p)::text AS row FROM plan_exercises p JOIN plan_days d ON d.id=p.plan_day_id WHERE d.id=$1 ORDER BY p.id",
          [day.id],
        )
      ).rows;
      await go("/app/overview");
      await until(
        () => sync('return !!document.querySelector(".calendar-zone summary")'),
        "calendar",
      );
      await click(".calendar-zone summary");
      await field(".weekly-training select", "UTC");
      await until(
        () =>
          sync(
            'return !document.querySelector(".weekly-training[aria-busy=true]")',
          ),
        "loaded calendar",
      );
      await sync(
        'const day=[...document.querySelectorAll(".week-day")].find(e=>e.getAttribute("aria-label").includes(arguments[0]));day.click()',
        [today],
      );
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".weekly-training>button")].some(e=>e.textContent.trim()==="Comenzar entrenamiento")',
          ),
        "start action",
      );
      await textClick(".weekly-training>button", "Comenzar entrenamiento");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".workout-live .quick-set-form")',
          ),
        "focused training",
      );
      currentSession = await sync('return location.pathname.split("/").pop()');
      assert.equal(
        await sync(
          'return document.querySelectorAll(".workout-live .quick-set-form").length',
        ),
        1,
      );
      assert.equal(
        await sync(
          `return document.querySelector('.quick-set-form input[id$="-load"]').value`,
        ),
        "40",
      );
      const actionBounds = await sync(
        'const r=document.querySelector(".workout-live .quick-set-form .primary-button").getBoundingClientRect();return{top:r.top,bottom:r.bottom,viewport:innerHeight}',
      );
      assert.ok(
        actionBounds.top >= 0 && actionBounds.bottom <= actionBounds.viewport,
        "primary action should fit mobile viewport " +
          JSON.stringify(actionBounds),
      );
      const inputBounds = await sync(
        `return [...document.querySelectorAll('.workout-live .quick-set-form input[id$="-load"], .workout-live .quick-set-form input[id$="-reps"]')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom}})`,
      );
      assert.ok(
        inputBounds.every((r) => r.top >= 0 && r.bottom < actionBounds.top),
        "recording fields must remain above action " +
          JSON.stringify({ inputBounds, actionBounds }),
      );
      await health("mobile-live-start");
      return { singleEditableForm: true, source: activity.id, actionBounds };
    },
  );
  await check(
    "U05 one plain-language confirmation calculates the editable next-series target without technical settings",
    async () => {
      await until(
        () =>
          sync(
            'return !!document.querySelector(".workout-live .repetition-preview-button")',
          ),
        "repetition prompt",
      );
      await click(".workout-live .repetition-preview-button");
      await until(
        () =>
          sync(
            'return document.querySelector(".live-guidance")?.textContent.includes("9")',
          ),
        "calculated repetitions",
      );
      assert.equal(
        await sync(
          `return document.querySelector('.quick-set-form input[id$="-load"]').value`,
        ),
        "40",
      );
      assert.equal(
        await sync(
          `return document.querySelector('.quick-set-form input[id$="-reps"]').value`,
        ),
        "9",
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll(".repetition-guidance input[type=checkbox]").length',
        ),
        0,
      );
      assert.equal(
        await sync(
          'return !!document.querySelector(".live-calculation[open]")',
        ),
        false,
      );
      await health("mobile-calculated-repetitions");
      return {
        calculatedReps: 9,
        priorReps: 8,
        unchangedLoad: "40",
        advancedConfigurationSteps: 0,
      };
    },
  );
  await check(
    "U06 three sets use a single register action, retain manual load and start the chosen rest timer",
    async () => {
      await click(".rest-timer>summary");
      await field(".rest-timer input", "45");
      await field('.quick-set-form input[id$="-load"]', "41");
      for (let n = 1; n <= 3; n++) {
        await textClick(".quick-set-form button", "Registrar serie");
        await until(async () => {
          const {
            rows: [r],
          } = await sql.query(
            "SELECT count(*)::int AS n FROM set_records s JOIN workout_exercises w ON w.id=s.workout_exercise_id WHERE w.session_id=$1 AND w.exercise_id=$2",
            [currentSession, exercise.id],
          );
          return r.n === n;
        }, "saved series " + n);
        if (n < 3) {
          await until(
            () =>
              sync(
                'return document.querySelector(".quick-set-form h4")?.textContent.includes(arguments[0])',
                [String(n + 1)],
              ),
            "next series ready",
          );
          assert.equal(
            await sync(
              `return document.querySelector('.quick-set-form input[id$="-load"]').value`,
            ),
            "41",
          );
        }
      }
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".live-dominant button")].some(e=>e.textContent.trim()==="Siguiente ejercicio")',
          ),
        "next exercise action",
      );
      assert.equal(
        await sync(
          'return document.querySelector(".live-position").textContent.trim()',
        ),
        "Ejercicio 1 de 2",
      );
      assert.ok(
        await sync(
          'return !!document.querySelector(".rest-timer [role=timer]")',
        ),
      );
      assert.equal(
        await sync(
          'return document.querySelectorAll(".live-review .compact-set-row").length',
        ),
        3,
      );
      assert.deepEqual(
        (
          await sql.query(
            "SELECT s.load::text,s.rpe,s.rir FROM set_records s JOIN workout_exercises w ON w.id=s.workout_exercise_id WHERE w.session_id=$1 AND w.exercise_id=$2 ORDER BY s.set_number",
            [currentSession, exercise.id],
          )
        ).rows,
        [1, 2, 3].map(() => ({ load: "41.000", rpe: null, rir: null })),
      );
      return {
        registerActions: 3,
        actualLoad: "41",
        proposedLoad: "40",
        rir: null,
        rpe: null,
      };
    },
  );
  await check(
    "U07 next exercise and normal closure require no authorization checkbox",
    async () => {
      await textClick(".live-dominant button", "Siguiente ejercicio");
      await until(
        () =>
          sync(
            'return document.querySelector(".live-position")?.textContent.includes("2 de 2")',
          ),
        "second exercise",
      );
      await textClick(".quick-set-form button", "Registrar serie");
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".live-dominant button")].some(e=>e.textContent.trim()==="Finalizar entrenamiento")',
          ),
        "final action",
      );
      await textClick(".live-dominant button", "Finalizar entrenamiento");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".workout-insights")&&!document.querySelector(".workout-live")',
          ),
        "completed summary",
      );
      const current = await request(
        "get",
        "/workout-sessions/" + currentSession,
      );
      assert.equal(current.data.status, "COMPLETED");
      assert.equal(current.data.scheduledActivityId, activity.id);
      assert.equal(current.data.actualSetCount, 4);
      assert.equal(
        await sync(
          'return document.querySelectorAll(".workout-close-form input[type=checkbox]").length',
        ),
        0,
      );
      await health("mobile-completed-summary");
      await viewport(1440, 1000);
      await health("desktop-completed-summary");
      await viewport(390, 844);
      return {
        registeredSets: 4,
        completionClicks: 1,
        authorizationCheckboxes: 0,
      };
    },
  );
  await check(
    "U08 the next Push evaluates the newly recorded session without inventing effort or another increase",
    async () => {
      const tomorrow = shift(today, 1),
        source = { planDayId: day.id, performedOn: tomorrow, timeZone: zone },
        g = await guideFor(source);
      const c = g.exercises[0].calculationContext;
      assert.ok(c.tasks.some((t) => t.sessionId === currentSession));
      assert.notEqual(c.contextKey, latestContextKey);
      latestContextKey = c.contextKey;
      let result = g.exercises[0].guidanceSuggested;
      if (g.exercises[0].repetitionContext.ready) {
        const { value } = await preview(source, g);
        assert.equal(value.status, 200, JSON.stringify(value.data));
        result = value.data.exercises[0].guidanceSuggested;
      }
      assert.ok(
        result.reps === null || result.reps !== 10,
        "manual different load cannot become a false comparable rep increase",
      );
      const scheduled = await request("post", "/routine/activities", {
        id: randomUUID(),
        planWeekId: planning.weeks[0].id,
        planDayId: day.id,
        scheduledOn: tomorrow,
        timeZone: zone,
        title: "Próximo Push",
        status: "PLANNED",
      });
      assert.equal(scheduled.status, 201);
      await go("/app/overview");
      await until(
        () => sync('return !!document.querySelector(".calendar-zone summary")'),
        "home after completion",
      );
      await click(".calendar-zone summary");
      await field(".weekly-training select", "UTC");
      await until(
        () =>
          sync(
            'return !document.querySelector(".weekly-training[aria-busy=true]")',
          ),
        "next schedule",
      );
      await sync(
        'const b=[...document.querySelectorAll(".week-day")].find(e=>e.getAttribute("aria-label").includes(arguments[0]));if(!b)throw Error("next day outside displayed week");b.click()',
        [tomorrow],
      );
      await until(
        () =>
          sync(
            'return document.querySelector(".weekly-training")?.textContent.includes("Próximo Push")',
          ),
        "next Push",
      );
      return {
        newSessionEvaluated: true,
        action: result.action,
        noInferredRpe: true,
      };
    },
  );
  await check(
    "U09 old references request recalibration without a guessed strength reduction",
    async () => {
      const source = {
          planDayId: day.id,
          performedOn: shift(today, 35),
          timeZone: zone,
        },
        g = await guideFor(source);
      const result = g.exercises[0].guidanceSuggested;
      assert.equal(result.load, null);
      assert.equal(result.action, "REVIEW_REQUIRED");
      assert.ok(result.reasons.includes("REFERENCE_OUTSIDE_PREVIEW_PERIOD"));
      return { action: result.action, load: null };
    },
  );
  await check(
    "U10 calculated drafts and actual logging never modify the plan or create automatic applications",
    async () => {
      assert.deepEqual(
        (
          await sql.query(
            "SELECT row_to_json(p)::text AS row FROM plan_exercises p JOIN plan_days d ON d.id=p.plan_day_id WHERE d.id=$1 ORDER BY p.id",
            [day.id],
          )
        ).rows,
        planBefore,
      );
      const {
        rows: [counts],
      } = await sql.query(
        "SELECT (SELECT count(*) FROM progression_recommendations WHERE athlete_id=$1)::int AS proposals,(SELECT count(*) FROM progression_applications WHERE athlete_id=$1)::int AS applications,(SELECT count(*) FROM progression_automation_consents WHERE athlete_id=$1)::int AS consents",
        [athleteId],
      );
      assert.deepEqual(counts, { proposals: 0, applications: 0, consents: 0 });
      return counts;
    },
  );
  await check(
    "U11 recent and frequent selection reuse owned history and substitution preserves the original task",
    async () => {
      const recent = await request(
        "get",
        "/exercises/visible?selection=RECENT&limit=20&offset=0",
      );
      const frequent = await request(
        "get",
        "/exercises/visible?selection=FREQUENT&limit=20&offset=0",
      );
      assert.equal(recent.status, 200, JSON.stringify(recent.data));
      assert.equal(frequent.status, 200, JSON.stringify(frequent.data));
      assert.ok(frequent.data.items.some((e) => e.id === exercise.id));
      assert.ok(recent.data.items.some((e) => e.id === secondExercise.id));
      const variant = await request("post", "/exercises", {
        name: "Variante UX3 " + randomUUID().slice(0, 8),
        primaryMuscleGroupKey: secondExercise.primaryMuscleGroup.key,
        equipment: "Barra",
        equipmentType: "BARBELL",
        oneRmSuitability: "SUITABLE",
      });
      assert.equal(variant.status, 201, JSON.stringify(variant.data));
      const made = await request("post", "/workout-sessions", {
        id: randomUUID(),
        performedOn: today,
        timeZone: zone,
        recordingMode: "LIVE",
        name: "Cambio en sesión",
        trainingPlanId: planId,
        planWeekId: planning.weeks[0].id,
        planDayId: day.id,
      });
      assert.equal(made.status, 201, JSON.stringify(made.data));
      const started = await request(
        "post",
        `/workout-sessions/${made.data.id}/start`,
        { expectedVersion: made.data.version },
      );
      const original = started.data.exercises[0];
      const omitted = await request(
        "patch",
        `/workout-sessions/${made.data.id}/exercises/${original.id}`,
        { expectedVersion: started.data.version, isOmitted: true },
      );
      assert.equal(omitted.status, 200, JSON.stringify(omitted.data));
      await go(`/app/workouts/${made.data.id}`);
      await until(
        () => sync('return !!document.querySelector(".live-toolbar")'),
        "substitution session",
      );
      await textClick(".live-toolbar button", "Añadir o cambiar ejercicio");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".quick-add-exercise .exercise-picker")',
          ),
        "recent picker",
      );
      assert.equal(
        await sync(
          'return [...document.querySelectorAll(".quick-add-exercise .routine-tabs button")].find(e=>e.textContent.trim()==="Recientes")?.getAttribute("aria-pressed")',
        ),
        "true",
      );
      await textClick(".quick-add-exercise .routine-tabs button", "Habituales");
      await until(
        () =>
          sync(
            'return !!document.querySelector(".picker-results input[type=radio]")',
          ),
        "frequent results",
      );
      await field(
        '.quick-add-exercise input[type="search"]',
        variant.data.name,
      );
      await until(
        () =>
          sync(
            'return [...document.querySelectorAll(".picker-results label")].some(e=>e.textContent.includes(arguments[0]))',
            [variant.data.name],
          ),
        "variant search",
      );
      await click('.picker-results input[type="radio"]');
      await field(".quick-substitution select", original.id);
      await textClick(
        ".quick-add-exercise button[type=submit]",
        "Añadir ejercicio seleccionado",
      );
      await until(
        async () =>
          (
            await request("get", `/workout-sessions/${made.data.id}`)
          ).data.exercises.some((e) => e.exercise.id === variant.data.id),
        "substitution persisted",
      );
      const saved = (await request("get", `/workout-sessions/${made.data.id}`))
        .data;
      const replaced = saved.exercises.find(
        (e) => e.exercise.id === variant.data.id,
      );
      assert.equal(replaced.replacesWorkoutExerciseId, original.id);
      assert.equal(
        saved.exercises.find((e) => e.id === original.id).isOmitted,
        true,
      );
      assert.equal(replaced.sets.length, 0);
      await health("mobile-recent-substitution");
      return {
        recent: recent.data.items.length,
        frequent: frequent.data.items.length,
        retainedOriginal: true,
        noCopiedResults: true,
      };
    },
  );
  await check(
    "U12 a different authenticated account cannot inspect the private guide context",
    async () => {
      const response = await fetch(cfg.origin + "/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: cfg.origin },
        body: JSON.stringify({
          email: `other-${randomUUID()}@example.test`,
          password,
        }),
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      const denied = await fetch(
        cfg.origin +
          "/api/v1/progression/workout-guide?" +
          new URLSearchParams({
            planDayId: day.id,
            performedOn: today,
            timeZone: zone,
          }),
        { headers: { Authorization: "Bearer " + body.accessToken } },
      );
      assert.ok(
        [403, 404].includes(denied.status),
        "other account private context status=" + denied.status,
      );
      return { deniedStatus: denied.status };
    },
  );
  await check(
    "U13 configured load progression without RPE reuses compliance math and keeps readiness stricter",
    async () => {
      const loadExerciseResult = await request("post", "/exercises", {
        name: "Carga comparable UX3 " + randomUUID().slice(0, 8),
        primaryMuscleGroupKey: secondExercise.primaryMuscleGroup.key,
        equipment: "Barra",
        equipmentType: "BARBELL",
        oneRmSuitability: "SUITABLE",
      });
      assert.equal(
        loadExerciseResult.status,
        201,
        JSON.stringify(loadExerciseResult.data),
      );
      const loadExercise = loadExerciseResult.data;
      const setting = await request("post", "/progression/settings", {
        intentId: randomUUID(),
        scope: { exerciseId: null, trainingPlanId: null },
        parameters: {
          minSuccessfulSessions: 2,
          targetRpeMin: "6",
          targetRpeMax: "8",
          incrementAbsolute: "2.5",
          incrementPercent: null,
          maxIncrementPercent: "10",
          maxLoad: null,
        },
      });
      assert.equal(setting.status, 201, JSON.stringify(setting.data));
      const made = await request("post", "/routine/plans", {
        id: randomUUID(),
        name: "Carga sin esfuerzo UX3",
        durationWeeks: 1,
        frequency: 1,
        timeZone: zone,
        days: [
          {
            name: "Carga",
            weekday: null,
            exercises: [
              {
                exerciseId: loadExercise.id,
                position: 1,
                targetSets: 3,
                targetRepsMin: 8,
                targetRepsMax: 12,
                targetLoad: "40",
                targetLoadUnit: "KG",
              },
            ],
          },
        ],
      });
      assert.equal(made.status, 201, JSON.stringify(made.data));
      planId = made.data.id;
      planning = (await request("get", `/training-plans/${planId}/planning`))
        .data;
      day = planning.weeks[0].days[0];
      for (const date of [shift(today, -3), shift(today, -1)]) {
        const created = await request("post", "/workout-sessions", {
          id: randomUUID(),
          performedOn: date,
          timeZone: zone,
          recordingMode: "RETROSPECTIVE",
          name: "Carga anterior",
          trainingPlanId: planId,
          planWeekId: planning.weeks[0].id,
          planDayId: day.id,
        });
        assert.equal(created.status, 201, JSON.stringify(created.data));
        let actual = (
          await request("post", `/workout-sessions/${created.data.id}/start`, {
            expectedVersion: created.data.version,
          })
        ).data;
        for (let i = 1; i <= 3; i++) {
          const saved = await request(
            "post",
            `/workout-sessions/${actual.id}/exercises/${actual.exercises[0].id}/sets`,
            {
              id: randomUUID(),
              expectedVersion: actual.version,
              setNumber: i,
              load: "40",
              loadUnit: "KG",
              repetitions: 12,
              rpe: null,
              rir: null,
              status: "COMPLETED",
              kind: "WORK",
            },
          );
          assert.equal(saved.status, 201, JSON.stringify(saved.data));
          actual = saved.data;
        }
        const completed = await request(
          "post",
          `/workout-sessions/${actual.id}/complete`,
          { expectedVersion: actual.version, confirmWithoutResults: false },
        );
        assert.equal(completed.status, 200, JSON.stringify(completed.data));
      }
      const source = { planDayId: day.id, performedOn: today, timeZone: zone },
        g = await guideFor(source);
      const previewInput = {
        source,
        exerciseId: loadExercise.id,
        contextKey: g.exercises[0].calculationContext.contextKey,
        gridStep: "2.5",
        incrementMode: "ABSOLUTE",
        declaration: {
          sameVariant: true,
          sameEquipment: true,
          externalTotal: true,
        },
      };
      const readiness = await request(
        "post",
        "/progression/workout-guide/preview",
        { ...previewInput, policyContract: "session-readiness-preview-v1" },
      );
      assert.equal(readiness.status, 200, JSON.stringify(readiness.data));
      assert.notEqual(
        readiness.data.exercises[0].guidanceSuggested.action,
        "INCREASE",
      );
      const compliance = await request(
        "post",
        "/progression/workout-guide/preview",
        {
          ...previewInput,
          policyContract: "session-load-compliance-preview-v1",
        },
      );
      assert.equal(compliance.status, 200, JSON.stringify(compliance.data));
      const calculated = compliance.data.exercises[0].guidanceSuggested;
      assert.equal(calculated.origin, "CALCULATED", JSON.stringify(calculated));
      assert.equal(calculated.action, "INCREASE");
      assert.equal(calculated.load, "42.500000");
      assert.equal(calculated.executionAuthorized, false);
      const before = (
        await sql.query(
          "SELECT row_to_json(p)::text AS row FROM plan_exercises p WHERE p.plan_day_id=$1 ORDER BY p.id",
          [day.id],
        )
      ).rows;
      const session = await request("post", "/workout-sessions", {
        id: randomUUID(),
        performedOn: today,
        timeZone: zone,
        recordingMode: "LIVE",
        name: "Carga guiada UX3",
        trainingPlanId: planId,
        planWeekId: planning.weeks[0].id,
        planDayId: day.id,
      });
      assert.equal(session.status, 201, JSON.stringify(session.data));
      const started = await request(
        "post",
        `/workout-sessions/${session.data.id}/start`,
        { expectedVersion: session.data.version },
      );
      assert.equal(started.status, 200, JSON.stringify(started.data));
      await go(`/app/workouts/${session.data.id}`);
      await until(
        () => sync('return !!document.querySelector(".live-calculation")'),
        "load policy options",
      );
      await click(".live-calculation>summary");
      assert.equal(
        await sync(
          'return document.querySelector(".live-calculation select").value',
        ),
        "session-load-compliance-preview-v1",
      );
      await field(".live-calculation input", "2.5");
      await textClick(
        ".live-calculation button",
        "Calcular con estos registros comparables",
      );
      await until(
        () =>
          sync(
            `return document.querySelector('.quick-set-form input[id$="-load"]').value==="42.5"`,
          ),
        "RPE-free calculated load draft",
      );
      await health("mobile-load-without-rpe");
      await viewport(1440, 1000);
      await health("desktop-load-without-rpe");
      assert.deepEqual(
        (
          await sql.query(
            "SELECT row_to_json(p)::text AS row FROM plan_exercises p WHERE p.plan_day_id=$1 ORDER BY p.id",
            [day.id],
          )
        ).rows,
        before,
      );
      const counts = (
        await sql.query(
          "SELECT (SELECT count(*) FROM progression_recommendations WHERE athlete_id=$1)::int AS proposals,(SELECT count(*) FROM progression_applications WHERE athlete_id=$1)::int AS applications",
          [athleteId],
        )
      ).rows[0];
      assert.deepEqual(counts, { proposals: 0, applications: 0 });
      return {
        historicalLoad: "40",
        historicalRepetitions: 12,
        newLoad: calculated.load,
        readinessAction: readiness.data.exercises[0].guidanceSuggested.action,
        compliancePolicy: calculated.policyVersion,
        actualEffort: null,
        planUnchanged: true,
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
