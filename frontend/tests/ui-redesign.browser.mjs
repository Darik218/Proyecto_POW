// Real Firefox + real isolated FINAL-MVP database. UI survey performs no business writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, realpath, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
const require = createRequire(resolve("../backend/package.json"));
const { Client } = require("pg");
let raw = "";
for await (const part of process.stdin) raw += part;
const cfg = JSON.parse(raw),
  url = new URL(cfg.databaseUrl);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/pulso_final_mvp_demo");
assert.ok(cfg.dataDirectory.startsWith("/tmp/pulso-final-mvp-demo-"));
const sql = new Client({ connectionString: cfg.databaseUrl });
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
const f = JSON.parse(await readFile(cfg.credentialFile, "utf8"));
const evidence = await mkdtemp(join(tmpdir(), "pulso-ui-evidence-")),
  results = [];
const port = await new Promise((resolvePort) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
const driver = spawn(
  "/snap/firefox/current/usr/lib/firefox/geckodriver",
  ["--host", "127.0.0.1", "--port", String(port)],
  { stdio: "ignore" },
);
const driverUrl = `http://127.0.0.1:${port}`;
let sid;
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
      "WebDriver " +
        (result.value?.error ?? response.status) +
        ": " +
        (result.value?.message ?? ""),
    );
  return result.value;
}
const command = (path, method = "GET", body) =>
  wd("/session/" + sid + path, method, body);
const sync = (script, args = []) =>
  command("/execute/sync", "POST", { script, args });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error("Timeout " + label);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", detail });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.log("FAIL " + name + ": " + error.message);
  }
}
async function go(path) {
  await command("/execute/async", "POST", {
    script: `const done=arguments[arguments.length-1];document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(arguments[0]).then(()=>done(true),e=>done({error:e.message}))`,
    args: [path],
  });
  await until(
    () =>
      sync(
        'return location.pathname===arguments[0]&&!document.querySelector("vite-error-overlay")',
        [path],
      ),
    "route " + path,
  );
  await until(
    () =>
      sync(
        'return ![...document.querySelectorAll("main [role=status]")].some(e=>/Cargando|Actualizando/.test(e.textContent))',
      ),
    "settled " + path,
  );
  await pause(160);
  await until(
    () =>
      sync(
        'return [...document.querySelectorAll("h1")].filter(e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)).length===1',
      ),
    "settled page heading " + path,
  );
}
async function viewport(width, height) {
  await command("/moz/context", "POST", { context: "chrome" });
  await sync(
    "document.documentElement.style.minWidth='0px';document.documentElement.style.minHeight='0px';document.querySelector('#navigator-toolbox')?.style.setProperty('min-width','0px');",
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
  assert.equal(await sync("return innerHeight"), height);
}
async function screenshot(name) {
  await sync(
    `document.querySelectorAll('*').forEach(el=>{if(el.children.length===0&&el.textContent.includes(arguments[0])){el.dataset.uiPrivacy='true';el.style.filter='blur(9px)'}})`,
    [f.user.email],
  );
  await writeFile(
    join(evidence, name + ".png"),
    Buffer.from(await command("/screenshot"), "base64"),
  );
  await sync(
    `document.querySelectorAll('[data-ui-privacy]').forEach(el=>{el.style.filter='';delete el.dataset.uiPrivacy})`,
  );
}
async function survey(name, path, size) {
  await go(path);
  if (name === "workout-detail")
    await until(
      () => sync('return !!document.querySelector(".workout-exercise-card")'),
      "loaded workout exercises (an error state is not a verified session)",
    );
  await screenshot(size + "-" + name);
  const state = await sync(
    `const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);return {path:location.pathname,width:innerWidth,h1:[...document.querySelectorAll('h1')].filter(visible).map(e=>e.textContent),headers:document.querySelectorAll('.app-header').length,overflow:document.documentElement.scrollWidth-innerWidth,errors:window.__uiErrors??[],loading:!!document.querySelector('vite-error-overlay'),offenders:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,8).map(e=>e.tagName+'.'+e.className)}`,
  );
  assert.equal(
    state.h1.length,
    1,
    "single page title: " + state.h1.join(" | "),
  );
  assert.equal(
    state.headers,
    path.startsWith("/app") ? 1 : 0,
    "single shell header",
  );
  assert.ok(
    state.overflow <= 1,
    "horizontal overflow: " + JSON.stringify(state.offenders),
  );
  assert.equal(state.loading, false);
  assert.deepEqual(state.errors, [], "runtime/console errors");
  await screenshot(size + "-" + name);
  return state;
}
try {
  await until(async () => {
    try {
      return !!(await wd("/status"));
    } catch {
      return false;
    }
  }, "driver");
  if (process.argv.includes("--prepare")) {
    await new Promise((resolvePrepare, rejectPrepare) => {
      const child = spawn(
        process.execPath,
        ["tests/final-mvp.browser.mjs", "--verify"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      child.stdin.end(JSON.stringify({ ...cfg, driver: driverUrl }));
      child.stdout.on("data", (chunk) => process.stdout.write(chunk));
      child.stderr.on("data", (chunk) => process.stderr.write(chunk));
      child.on("error", rejectPrepare);
      child.on("exit", (code) =>
        code === 0
          ? resolvePrepare()
          : rejectPrepare(Error("FINAL-MVP verifier exited " + code)),
      );
    });
  }
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
  await command("/url", "POST", { url: cfg.origin + "/login" });
  await until(
    () => sync('return !!document.querySelector("#email")'),
    "login form",
  );
  await sync(
    `window.__uiErrors=[];window.addEventListener('error',e=>window.__uiErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__uiErrors.push(String(e.reason?.message??e.reason)));const previous=console.error;console.error=function(...args){window.__uiErrors.push(args.map(v=>String(v)).join(' '));previous.apply(console,args)}`,
  );
  for (const [size, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 1024, 900],
    ["mobile", 390, 844],
  ]) {
    await viewport(width, height);
    for (const [name, path] of [
      ["login", "/login"],
      ["register", "/register"],
    ])
      await check(size + " " + name, () => survey(name, path, size));
  }
  await go("/login");
  await sync(
    `for(const [selector,value]of [['#email',arguments[0]],['#password',arguments[1]]]){const e=document.querySelector(selector);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('form').requestSubmit()`,
    [f.user.email, f.password],
  );
  await until(
    () => sync("return location.pathname==='/app'"),
    "authenticated login",
  );
  await until(
    () =>
      sync(
        "return !!document.querySelector('.app-header')&&[...document.querySelectorAll('h1')].some(e=>e.textContent.includes('Mi rutina'))&&!document.querySelector('#password')",
      ),
    "authenticated shell mounted",
  );
  await pause(300);
  const rows = async (table) =>
    (
      await sql.query(
        `SELECT id FROM ${table} WHERE athlete_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [f.athleteId],
      )
    ).rows[0]?.id;
  const recommendation = await rows("progression_recommendations"),
    consent = await rows("progression_automation_consents"),
    setting = await rows("progression_settings");
  const session = (
    await sql.query(
      "SELECT id FROM workout_sessions WHERE athlete_id=$1 AND status='COMPLETED' ORDER BY created_at DESC LIMIT 1",
      [f.athleteId],
    )
  ).rows[0]?.id;
  assert.ok(recommendation, "Real recommendation fixture required");
  assert.ok(consent, "Real consent fixture required");
  assert.ok(setting);
  assert.ok(session);
  const routes = [
    ["dashboard", "/app/overview"],
    ["routine", "/app"],
    [
      "routine-day",
      `/app/routine/${f.plan.id}/weeks/${f.week.id}/days/${f.day.id}`,
    ],
    ["profile", "/app/profile"],
    ["measurements", "/app/measurements"],
    ["exercises", "/app/exercises"],
    ["exercise-detail", "/app/exercises/" + f.exercise.id],
    ["plans", "/app/training-plans"],
    ["plan-detail", "/app/training-plans/" + f.plan.id],
    ["workouts", "/app/workouts"],
    ["workout-detail", "/app/workouts/" + session],
    ["history", "/app/history"],
    ["progression", "/app/progression"],
    ["progression-new", "/app/progression/new"],
    [
      "progression-detail",
      "/app/progression/recommendations/" + recommendation,
    ],
    ["settings", "/app/progression/settings"],
    ["setting-edit", "/app/progression/settings/" + setting],
    ["setting-new", "/app/progression/settings/new"],
    ["consents", "/app/progression/automation"],
    ["consent-new", "/app/progression/automation/new"],
    ["consent-detail", "/app/progression/automation/" + consent],
  ];
  for (const [size, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 1024, 900],
    ["mobile", 390, 844],
  ]) {
    await viewport(width, height);
    for (const [name, path] of routes.filter(
      ([name]) =>
        !process.argv.includes("--focus") ||
        ["settings", "setting-edit", "setting-new"].includes(name),
    ))
      await check(size + " " + name, () => survey(name, path, size));
  }
  await check("mobile drawer keyboard focus and inert", async () => {
    await go("/app");
    assert.equal(
      await sync('return document.querySelector("#pulso-navigation").inert'),
      true,
    );
    await sync('document.querySelector(".mobile-menu-button").click()');
    await until(
      () =>
        sync(
          'return document.querySelector("#pulso-navigation").getAttribute("role")==="dialog"',
        ),
      "drawer open",
    );
    assert.equal(
      await sync(
        'return document.querySelector("#pulso-navigation").contains(document.activeElement)',
      ),
      true,
    );
    await screenshot("mobile-drawer");
    await sync(
      'document.querySelector("#pulso-navigation details").open=false;document.querySelector("#pulso-navigation details summary").focus()',
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
      await sync(
        'return document.activeElement.matches(".mobile-sidebar-close")',
      ),
      true,
      "Tab loops from collapsed session summary to close: " +
        JSON.stringify(
          await sync(
            'return {active:document.activeElement.tagName+"."+document.activeElement.className,list:[...document.querySelectorAll("#pulso-navigation a[href], #pulso-navigation button:not([disabled]), #pulso-navigation summary")].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,cls:e.className,closed:!!e.closest("details:not([open])")}))}',
          ),
        ),
    );
    await command("/actions", "POST", {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: "\uE008" },
            { type: "keyDown", value: "\uE004" },
            { type: "keyUp", value: "\uE004" },
            { type: "keyUp", value: "\uE008" },
          ],
        },
      ],
    });
    assert.equal(
      await sync(
        'return document.activeElement.matches("#pulso-navigation details summary")',
      ),
      true,
      "Shift+Tab loops to visible summary",
    );
    await command("/actions", "POST", {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: "\uE00C" },
            { type: "keyUp", value: "\uE00C" },
          ],
        },
      ],
    });
    await until(
      () => sync('return document.querySelector("#pulso-navigation").inert'),
      "drawer closed",
    );
    assert.equal(
      await sync(
        'return document.activeElement.matches(".mobile-menu-button")',
      ),
      true,
    );
  });
  await check("reduced motion applies", async () => {
    assert.equal(
      await sync(
        "return matchMedia('(prefers-reduced-motion: reduce)').matches",
      ),
      true,
    );
    const state = await sync(
      `return [...document.querySelectorAll('body *')].filter(e=>parseFloat(getComputedStyle(e).animationDuration)>0.01).length`,
    );
    assert.equal(state, 0);
  });
} catch (error) {
  results.push({
    name: "survey setup/runtime",
    status: "FAIL",
    error: error.message,
  });
  console.log("FAIL setup/runtime: " + error.message);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify({ origin: cfg.origin, results }, null, 2),
  );
  if (sid)
    try {
      await wd("/session/" + sid, "DELETE");
    } catch {}
  driver.kill();
  await sql.end();
  console.log("UI evidence: " + evidence);
  console.log(
    `${results.filter((x) => x.status === "PASS").length} passed; ${results.filter((x) => x.status === "FAIL").length} failed`,
  );
  if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
}
