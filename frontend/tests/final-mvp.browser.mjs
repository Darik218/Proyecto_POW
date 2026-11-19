// Firefox real, Nest real y PostgreSQL efímero. Solo el runner aislado aporta configuración por stdin.
import assert from "node:assert/strict";
import { demoExerciseSnapshot } from "./final-mvp.fixtures.mjs";
import { createRequire } from "node:module";
import { realpath, mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
const require = createRequire(resolve("../backend/package.json")),
  pg = require("pg"),
  { PrismaClient } = require("../backend/dist/generated/prisma/client.js"),
  { PrismaPg } = require("../backend/node_modules/@prisma/adapter-pg"),
  {
    PasswordHasher,
  } = require("../backend/dist/auth/security/password-hasher.js");
let raw = "";
for await (const part of process.stdin) raw += part;
const cfg = JSON.parse(raw),
  url = new URL(cfg.databaseUrl);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/pulso_final_mvp_demo");
assert.ok(cfg.dataDirectory.startsWith("/tmp/pulso-final-mvp-demo-"));
const sql = new pg.Client({ connectionString: cfg.databaseUrl });
await sql.connect();
const {
  rows: [location],
} = await sql.query(
  "SELECT current_database() AS name,current_setting('data_directory') AS directory,current_setting('port') AS port",
);
assert.equal(location.name, "pulso_final_mvp_demo");
assert.equal(location.port, url.port);
assert.equal(
  await realpath(location.directory),
  await realpath(cfg.dataDirectory),
);
const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: cfg.databaseUrl }),
  }),
  hasher = new PasswordHasher(),
  password = randomBytes(24).toString("base64url") + "aA1!",
  results = [],
  evidence = await mkdtemp(join(tmpdir(), "pulso-final-mvp-evidence-"));
let sid;
const cycleStart = new Date();
cycleStart.setUTCHours(0, 0, 0, 0);
cycleStart.setUTCDate(
  cycleStart.getUTCDate() - ((cycleStart.getUTCDay() + 6) % 7) - 7,
);
const isoDay = (offset) =>
  new Date(cycleStart.getTime() + offset * 86400000).toISOString().slice(0, 10);
async function fixture(name) {
  const user = await db.user.create({
      data: {
        email: randomUUID() + "@example.test",
        passwordHash: await hasher.hash(password),
        athlete: { create: {} },
      },
      include: { athlete: true },
    }),
    athleteId = user.athlete.id,
    group = await db.muscleGroup.create({
      data: {
        key: randomUUID(),
        name: "Browser fixture group " + randomUUID(),
      },
    }),
    exercise = await db.exercise.create({
      data: {
        name: name + " press",
        primaryMuscleGroupId: group.id,
        equipment: "barbell",
        oneRmSuitability: "SUITABLE",
      },
    }),
    tasks = [];
  for (const date of [isoDay(0), isoDay(1)]) {
    const session = await db.workoutSession.create({
        data: {
          athleteId,
          status: "COMPLETED",
          performedOn: new Date(date),
          timeZone: "UTC",
          startedAt: new Date(date + "T12:00:00Z"),
          finishedAt: new Date(date + "T13:00:00Z"),
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
          targetLoad: "80",
          targetLoadUnit: "KG",
          targetRpe: "8",
          originalSnapshot: demoExerciseSnapshot({
            id: exercise.id,
            name: exercise.name,
            equipment: exercise.equipment,
            muscleGroup: group.name,
          }),
        },
      });
    await db.setRecord.create({
      data: {
        workoutExerciseId: task.id,
        setNumber: 1,
        status: "COMPLETED",
        kind: "WORK",
        isCompleted: true,
        repetitions: 6,
        load: "80",
        loadUnit: "KG",
        loadKg: "80",
        rpe: "7",
      },
    });
    tasks.push(task);
  }
  await db.progressionSetting.create({
    data: {
      athleteId,
      minSuccessfulSessions: 2,
      targetRpeMin: 6,
      targetRpeMax: 8,
      incrementAbsolute: "2.5",
      maxIncrementPercent: "10",
    },
  });
  const plan = await db.trainingPlan.create({
      data: { athleteId, name: name + " futuro editable" },
    }),
    week = await db.planWeek.create({
      data: { trainingPlanId: plan.id, weekNumber: 1 },
    }),
    day = await db.planDay.create({
      data: { planWeekId: week.id, name: "Push", position: 1 },
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
        targetLoad: "80",
        targetLoadUnit: "KG",
        targetRpe: "8",
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
        timeZone: "UTC",
        title: name + " actividad futura",
      },
    });
  return {
    user: { id: user.id, email: user.email },
    athleteId,
    exercise,
    tasks,
    plan,
    week,
    day,
    p,
    activity,
    date: date.on,
  };
}
async function wd(path = "", method = "GET", body) {
  const r = await fetch(cfg.driver + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }),
    json = await r.json();
  if (!r.ok || json.value?.error)
    throw Error(
      "WebDriver " +
        (json.value?.error ?? r.status) +
        ": " +
        (json.value?.message ?? ""),
    );
  return json.value;
}
const command = (path, method = "GET", body) =>
    wd("/session/" + sid + path, method, body),
  sync = (script, args = []) =>
    command("/execute/sync", "POST", { script, args });
async function execute(code, args = []) {
  const r = await command("/execute/async", "POST", {
    script: `const done=arguments[arguments.length-1];(async()=>{const auth=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('auth'),store=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('automation-consents'),progress=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('progression'),operational=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('operational-progression');${code}})().then(value=>done({value}),error=>done({error:error.message,status:error.response?.status}));`,
    args,
  });
  if (r.error) throw Error(r.error);
  return r.value;
}
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  const text = await sync(
    "return document.querySelector('main')?.textContent.slice(-2000)",
  );
  const debug = await sync(
    'return {path:location.pathname,errors:window.__routeErrors,link:document.querySelector("[data-testid=savedDetail]")?.getAttribute("href")}',
  );
  throw Error("Timeout " + label + ": " + JSON.stringify(debug) + " " + text);
}
async function go(path) {
  await command("/url", "POST", { url: cfg.origin + path });
  await until(
    () =>
      sync(
        'return !!document.querySelector("main")&&!document.querySelector("vite-error-overlay")',
      ),
    "page " + path,
  );
}
async function input(selector, value) {
  await until(
    () =>
      sync(
        'const e=document.querySelector(arguments[0]);return !!e&&(e.tagName!=="SELECT"||[...e.options].some(o=>o.value===arguments[1]))',
        [selector, value],
      ),
    selector,
  );
  await sync(
    "const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))",
    [selector, value],
  );
}
async function click(selector) {
  await until(
    () =>
      sync(
        "const e=document.querySelector(arguments[0]);return !!e&&!e.disabled",
        [selector],
      ),
    "enabled " + selector,
  );
  await sync("document.querySelector(arguments[0]).click()", [selector]);
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.message });
    throw e;
  }
}
async function screenshot(name) {
  await writeFile(
    join(evidence, name + ".png"),
    Buffer.from(await command("/screenshot"), "base64"),
  );
}
async function login(f) {
  await go("/login");
  await input("#email", f.user.email);
  await input("#password", f.password);
  await sync("document.querySelector('form').requestSubmit()");
  await until(
    () =>
      sync(
        "return location.pathname==='/app/overview' && !!document.querySelector('.dashboard-page')",
      ),
    "login",
  );
}
async function history() {
  const result = {};
  for (const table of [
    "training_plans",
    "plan_weeks",
    "plan_days",
    "plan_exercises",
    "workout_sessions",
    "workout_exercises",
    "set_records",
    "one_rm_estimates",
    "scheduled_activities",
    "progression_recommendations",
    "recommendation_reviews",
    "progression_applications",
  ])
    result[table] = (
      await sql.query(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${table} t`,
      )
    ).rows[0].hash;
  return result;
}
async function prepareConsent(f) {
  await go("/app/progression/automation/new");
  await input('input[type="search"]', f.exercise.name);
  await click(`input[type="radio"][value="${f.exercise.id}"]`);
  for (const [k, v] of Object.entries({
    scope: "PLAN",
    plan: f.plan.id,
    unit: "KG",
  }))
    await input(`[data-consent="${k}"]`, v);
  await click('[data-testid="consentCandidates"]');
  await until(
    () => sync('return !!document.querySelector("[data-target]")'),
    "candidates",
  );
  assert.equal(
    await sync('return document.querySelector("[data-target]").checked'),
    false,
  );
  await click(`[data-target="${f.p.id}"]`);
  for (const t of f.tasks) {
    await click(`[data-consent-task="${t.id}"]`);
    await input(`[data-consent-original="${t.id}"]`, "1");
    await input(`[data-consent-adjusted="${t.id}"]`, "1");
  }
  await input('[data-consent="anchor"]', f.tasks[1].id);
  await input('[data-consent="minimumSessions"]', "2");
  const fields = {
    id: "final-demo-policy",
    version: "v1",
    reference: "explicit academic demo policy",
    basis: "ADJUSTED",
    basicReps: "MINIMUM",
    basicLoad: "AT_LEAST_TARGET",
    readinessReps: "UPPER_BOUND",
    readinessLoad: "AT_LEAST_TARGET",
    rpeMin: "6",
    rpeMax: "8",
    criterion: "BASIC",
    mode: "ACCUMULATED",
    sameDate: "DISTINCT_SESSIONS",
    settingRpeUse: "REQUIRE_INTERVAL",
    review: "NOT_REQUIRED_EXPLICIT",
    incrementMode: "ABSOLUTE",
    step: "2.5",
    origin: "0",
    gridSource: "explicit academic demo plates",
    closed: "true",
  };
  for (const [key, value] of Object.entries(fields))
    await input(`[data-consent-policy="${key}"]`, value);
  await click('[data-consent="declaration"]');
  const {
    rows: [dates],
  } = await sql.query(
    "SELECT to_char(clock_timestamp()-interval '1 hour','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS start,to_char(clock_timestamp()+interval '30 days','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS end",
  );
  for (const [k, v] of Object.entries({
    maximumAbsoluteIncrement: "2.5",
    maximumPercentIncrement: "5",
    maximumLoad: "200.000001",
    maximumApplicationsPerWeek: "1",
    historyWindowDays: "28",
    weekStartsOn: "1",
    startsAt: dates.start,
    endsAt: dates.end,
    timeZone: "UTC",
    termsVersion: "explicit-fixture-terms-v1",
    reference: "Browser configuration request, not acceptance",
  }))
    await input(`[data-consent="${k}"]`, v);
  await click('[data-testid="consentPreview"]');
  await until(
    () => execute("return !!store?.preview||!!store?.error"),
    "preview",
  );
  assert.equal(await execute("return store.error?.code??null"), null);
  assert.equal(
    await sync(
      'return document.querySelector("[data-testid=createConsent]").disabled',
    ),
    true,
  );
}

async function prepareProposal(f) {
  await go("/app/progression/new");
  for (const [name, value] of [
    ["plan", f.plan.id],
    ["week", f.week.id],
    ["day", f.day.id],
    ["prescription", f.p.id],
    ["start", isoDay(0)],
    ["endExclusive", isoDay(7)],
    ["cutoffOn", isoDay(6)],
    ["from", isoDay(-7)],
    ["timeZone", "UTC"],
    ["weekStartsOn", "1"],
  ])
    await input(`[data-testid="${name}"]`, value);
  await click('[data-testid="context"]');
  await until(
    () => sync('return !!document.querySelector("[data-task]")'),
    "context historical tasks",
  );
  for (const t of f.tasks) {
    await click(`[data-task="${t.id}"]`);
    await input(`[data-original="${t.id}"]`, "1");
    await input(`[data-adjusted="${t.id}"]`, "1");
  }
  await input('[data-testid="anchor"]', f.tasks[1].id);
  await input(
    '[data-testid="protocol"]',
    "browser explicit comparable protocol",
  );
  await input('[data-testid="equipment"]', "browser explicit barbell");
  await click('[data-testid="loadDeclaration"]');
  const fields = {
    id: "final-demo-policy",
    version: "v1",
    reference: "explicit academic demo policy",
    basis: "ADJUSTED",
    basicReps: "MINIMUM",
    basicLoad: "AT_LEAST_TARGET",
    readinessReps: "UPPER_BOUND",
    readinessLoad: "AT_LEAST_TARGET",
    rpeMin: "6",
    rpeMax: "8",
    criterion: "BASIC",
    mode: "ACCUMULATED",
    sameDate: "DISTINCT_SESSIONS",
    settingRpeUse: "REQUIRE_INTERVAL",
    review: "NOT_REQUIRED_EXPLICIT",
    incrementMode: "ABSOLUTE",
    unit: "KG",
    step: "2.5",
    origin: "0",
    gridSource: "explicit academic demo plates",
    closed: "true",
  };
  for (const [key, value] of Object.entries(fields))
    await input(`[data-policy="${key}"]`, value);
  await click('[data-testid="generate"]');
  await until(
    () => execute("return !!progress?.preview||!!progress?.error"),
    "preview response",
  );
  assert.equal(await execute("return progress?.error?.code??null"), null);
  assert.equal(await execute("return progress.preview.decision"), "INCREASE");
  await click('[data-testid="save"]');
  await until(
    () => sync('return !!document.querySelector("[data-testid=savedDetail]")'),
    "saved proposal",
  );
  const id = await execute("return progress.proposal.id");
  return id;
}
async function immutableHistory() {
  const output = {};
  for (const table of [
    "workout_sessions",
    "workout_exercises",
    "set_records",
    "one_rm_estimates",
  ])
    output[table] = (
      await sql.query(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${table} t`,
      )
    ).rows[0].hash;
  return output;
}
try {
  if (process.argv.includes("--fixture")) {
    const f = await fixture("PULSO demostración académica");
    f.password = password;
    await writeFile(cfg.credentialFile, JSON.stringify(f, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    assert.equal((await stat(cfg.credentialFile)).mode & 0o777, 0o600);
    console.log(
      "Coherent demo fixture ready; random credentials written privately.",
    );
  } else {
    const f = JSON.parse(await readFile(cfg.credentialFile, "utf8")),
      before = await immutableHistory();
    sid = (
      await wd("/session", "POST", {
        capabilities: {
          alwaysMatch: {
            browserName: "firefox",
            "moz:firefoxOptions": {
              binary: "/snap/firefox/current/usr/lib/firefox/firefox",
              args: ["-headless"],
            },
          },
        },
      })
    ).sessionId;
    await command("/timeouts", "POST", { script: 25000, pageLoad: 25000 });
    await check("F01 real login and authenticated home", () => login(f));
    for (const [name, path] of [
      ["profile", "/app/profile"],
      ["exercises", "/app/exercises"],
      ["plan", "/app/training-plans/" + f.plan.id],
      ["settings", "/app/progression/settings"],
    ])
      await check("F02 " + name, async () => {
        await go(path);
        assert.equal(await sync("return location.pathname"), path);
        assert.equal(
          await sync('return !!document.querySelector("vite-error-overlay")'),
          false,
        );
      });
    let recommendationId, consentId;
    await check(
      "F03 real form generates and saves neutral recommendation",
      async () => {
        recommendationId = await prepareProposal(f);
        await click('[data-testid="savedDetail"]');
        await until(
          () =>
            sync(
              'return !!document.querySelector("[data-testid=acceptPolicy]")',
            ),
          "recommendation evidence",
        );
        assert.equal(
          (
            await db.progressionRecommendation.findUniqueOrThrow({
              where: { id: recommendationId },
            })
          ).status,
          "PENDING",
        );
        await screenshot("neutral-proposal");
      },
    );
    await check("F04 request form creates scoped pending consent", async () => {
      await prepareConsent(f);
      await click('[data-testid="confirmConsentRequest"]');
      await click('[data-testid="createConsent"]');
      await until(
        () => execute("return !!store.receipt&&!store.busy"),
        "consent receipt",
      );
      consentId = await execute("return store.receipt.consentId");
      await go("/app/progression/automation/" + consentId);
      await until(() => execute("return !!store.detail"), "consent detail");
      assert.equal(
        await execute("return store.detail.state"),
        "PENDING_CONFIRMATION",
      );
    });
    await check(
      "F05 explicit challenge acceptance remains operationally inactive",
      async () => {
        await click('[data-testid="requestAcceptanceChallenge"]');
        await until(() => execute("return !!store.challenge"), "challenge");
        for (const name of [
          "Policy",
          "Limits",
          "Destinations",
          "Validity",
          "Revocation",
        ]) {
          assert.equal(
            await sync("return document.querySelector(arguments[0]).checked", [
              '[data-testid="accept' + name + '"]',
            ]),
            false,
          );
          await click('[data-testid="accept' + name + '"]');
        }
        await click('[data-testid="confirmHumanAcceptance"]');
        await until(
          () =>
            execute(
              "return !store.busy&&store.detail?.state==='ACCEPTED_INACTIVE'",
            ),
          "human acceptance",
        );
        await until(
          () => execute("return !!operational?.status&&!operational.busy"),
          "operational inactive",
        );
        assert.equal(
          await execute("return operational.status.executionAuthorized"),
          false,
        );
        assert.equal(await db.progressionApplication.count(), 0);
      },
    );
    await check(
      "F06 separate unchecked activation explicitly starts grant",
      async () => {
        assert.equal(
          await sync(
            'return document.querySelector("[data-testid=confirmOperationalActivation]").checked',
          ),
          false,
        );
        assert.equal(
          await sync(
            'return document.querySelector("[data-testid=activateOperationalGrant]").disabled',
          ),
          true,
        );
        await click('[data-testid="confirmOperationalActivation"]');
        await click('[data-testid="activateOperationalGrant"]');
        await until(
          () =>
            execute(
              "return !operational.busy&&operational.status?.executionAuthorized===true",
            ),
          "active grant",
        );
        if (!cfg.periodic)
          assert.equal(await db.progressionApplication.count(), 0);
        await screenshot("active-grant");
      },
    );
    const initialVersion = f.plan.version;
    let processInput;
    await check(
      cfg.periodic
        ? "F07 real periodic timer applies before any authenticated processing request"
        : "F07 same internal engine applies once with automatic receipt",
      async () => {
        if (cfg.periodic) {
          await until(
            async () =>
              (await db.progressionApplication.count({
                where: { recommendationId },
              })) === 1,
            "real periodic timer application",
          );
          console.log(
            "PASS real interval application confirmed before one-shot HTTP request",
          );
        }
        await execute(
          "const original=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){if(typeof body==='string'){try{const v=JSON.parse(body);if(v.intentId&&Object.keys(v).length===1)window.__processInput=v}catch{}}return original.apply(this,arguments)}",
        );
        await click('[data-testid="processAutomaticRecommendations"]');
        await until(
          () =>
            execute(
              "return !operational.busy&&(operational.receipt?.action==='CHECK'||!!operational.error)",
            ),
          "process receipt",
        );
        assert.equal(await execute("return operational.error"), null);
        processInput = await sync("return window.__processInput");
        const application = await db.progressionApplication.findFirstOrThrow({
          where: { recommendationId },
        });
        assert.equal(application.origin, "AUTOMATIC");
        const prescription = await db.planExercise.findUniqueOrThrow({
          where: { id: f.p.id },
        });
        assert.equal(prescription.targetLoad.toFixed(3), "82.500");
        assert.equal(
          (
            await db.trainingPlan.findUniqueOrThrow({
              where: { id: f.plan.id },
            })
          ).version,
          initialVersion + 1,
        );
        assert.deepEqual(await immutableHistory(), before);
        await until(
          () =>
            sync(
              'return !!document.querySelector("[data-testid=automaticRun]")',
            ),
          "automatic history",
        );
        assert.match(
          await sync(
            'return document.querySelector("#automatic-history").textContent',
          ),
          /APPLIED/,
        );
        await screenshot("automatic-receipt");
      },
    );
    await check(
      "F08 identical intent replay returns original receipt without second application",
      async () => {
        assert.ok(processInput?.intentId);
        const result = await execute(
          "const r=await fetch('/api/v1/progression/automatic/consents/'+arguments[0]+'/process',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.accessToken},body:JSON.stringify(arguments[1])});return {status:r.status,body:await r.json()}",
          [consentId, processInput],
        );
        assert.ok([200, 201].includes(result.status), JSON.stringify(result));
        assert.equal(
          await db.progressionApplication.count({
            where: { recommendationId },
          }),
          1,
        );
        assert.equal(
          (
            await db.trainingPlan.findUniqueOrThrow({
              where: { id: f.plan.id },
            })
          ).version,
          initialVersion + 1,
        );
      },
    );
    await check(
      "F09 recommendation detail exposes confirmed automatic application",
      async () => {
        await go("/app/progression/recommendations/" + recommendationId);
        await until(
          () =>
            sync(
              'return !!document.querySelector("[data-testid=automaticApplicationReceipt]")',
            ),
          "automatic recommendation receipt",
        );
        await screenshot("recommendation-applied");
      },
    );
    await check(
      "F10 explicit grant revocation prevents further processing",
      async () => {
        await go("/app/progression/automation/" + consentId);
        await until(
          () => execute("return !!operational?.status&&!operational.busy"),
          "active status",
        );
        assert.equal(
          await sync(
            'return document.querySelector("[data-testid=confirmOperationalRevoke]").checked',
          ),
          false,
        );
        await click('[data-testid="confirmOperationalRevoke"]');
        await click('[data-testid="revokeOperationalGrant"]');
        await until(
          () =>
            execute(
              "return !operational.busy&&operational.status?.grant?.state==='REVOKED'",
            ),
          "revoked grant",
        );
        assert.equal(
          await sync(
            'return document.querySelector("[data-testid=processAutomaticRecommendations]").disabled',
          ),
          true,
        );
        assert.equal(
          await db.progressionApplication.count({
            where: { recommendationId },
          }),
          1,
        );
        assert.deepEqual(await immutableHistory(), before);
      },
    );
    await check("F11 mobile conditions and real keyboard focus", async () => {
      await command("/window/rect", "POST", { width: 500, height: 850 });
      assert.equal(
        await sync("return document.documentElement.scrollWidth<=innerWidth+1"),
        true,
      );
      await command("/actions", "POST", {
        actions: [
          {
            type: "key",
            id: "keyboard",
            actions: [
              { type: "keyDown", value: "\uE004" },
              { type: "keyUp", value: "\uE004" },
            ],
          },
        ],
      });
      assert.equal(
        await sync("return document.activeElement!==document.body"),
        true,
      );
      await screenshot("revoked-mobile");
    });
  }
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
  if (sid)
    try {
      await screenshot("failure");
    } catch {}
} finally {
  if (sid)
    try {
      await wd("/session/" + sid, "DELETE");
    } catch {}
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("Firefox evidence: " + evidence);
  console.log(
    `Firefox: ${results.filter((v) => v.status === "PASS").length} passed; ${results.filter((v) => v.status === "FAIL").length} failed; ${results.length} distinct checks.`,
  );
  await db.$disconnect();
  await sql.end();
}
