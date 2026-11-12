// One-command visual QA. Reuses the existing guarded FINAL-MVP runtime; never uses development.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { realpath } from "node:fs/promises";
const frontend = fileURLToPath(new URL("..", import.meta.url));
const backend = resolve(frontend, "../backend");
const runtime = spawn(process.execPath, ["test/run-final-mvp-demo.mjs"], {
  cwd: backend,
  env: { ...process.env, PULSO_AUTOMATION_ENABLED: "false" },
  stdio: ["ignore", "pipe", "inherit"],
});
let browser;
const stop = () => {
  if (browser?.exitCode === null) browser.kill("SIGTERM");
  if (runtime.exitCode === null) runtime.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const configuration = await new Promise((accept, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(Error("Isolated runtime startup timed out"));
    }, 120000);
    runtime.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    runtime.on("exit", (code) => {
      clearTimeout(timeout);
      reject(Error("Isolated runtime exited before verification: " + code));
    });
    runtime.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output = (output + chunk).slice(-65536);
      if (!output.includes("Ready for the academic walkthrough.")) return;
      const cluster = output.match(
        /Verified private cluster (.+?); database pulso_final_mvp_demo; localhost port (\d+)\./,
      );
      const origin = output.match(/Demo frontend: (http:\/\/127\.0\.0\.1:\d+)/);
      const credential = output.match(
        /Private random login credentials \(0600\): (.+)/,
      );
      clearTimeout(timeout);
      if (!cluster || !origin || !credential)
        return reject(Error("Runtime metadata incomplete"));
      accept({
        root: cluster[1],
        port: Number(cluster[2]),
        origin: origin[1],
        credentialFile: credential[1].trim(),
      });
    });
  });
  const { root, port, origin, credentialFile } = configuration;
  if (
    !root.startsWith(join(tmpdir(), "pulso-final-mvp-demo-")) ||
    (await realpath(root)) !== root ||
    port === 5432 ||
    !Number.isInteger(port) ||
    port < 1024 ||
    credentialFile !== join(root, "credentials.json")
  )
    throw Error("Unverified disposable runtime");
  const config = {
    origin,
    credentialFile,
    dataDirectory: join(root, "data"),
    databaseUrl: `postgresql://pulso_test@127.0.0.1:${port}/pulso_final_mvp_demo`,
    periodic: false,
  };
  browser = spawn(
    process.execPath,
    process.argv.includes("--functional")
      ? ["tests/final-ux.browser.mjs"]
      : ["tests/ui-redesign.browser.mjs", "--prepare"],
    { cwd: frontend, stdio: ["pipe", "inherit", "inherit"] },
  );
  browser.stdin.end(JSON.stringify(config));
  const [code] = await once(browser, "exit");
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
  if (runtime.exitCode === null) {
    let timer;
    await Promise.race([
      once(runtime, "exit"),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 20000);
      }),
    ]);
    clearTimeout(timer);
  }
  if (runtime.exitCode === null) {
    console.error(
      "Private runtime shutdown pending; inspect its printed directory.",
    );
    process.exitCode = 1;
  }
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
