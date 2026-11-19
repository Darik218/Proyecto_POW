import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
let server;
before(async () => {
  server = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
  });
});
after(async () => {
  await server?.close();
});
test("plan week starts on its actual civil date and distinguishes fixed distribution from scheduled rest", async () => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/RoutineWeekStrip.vue",
    )
  ).default;
  const html = await renderToString(
    createSSRApp(Component, {
      startsOn: "2026-11-17",
      referenceDate: "2026-11-17",
      selectedDate: "2026-11-19",
      days: [{ id: "upper", name: "Upper A", weekday: 4 }],
      activities: [
        {
          id: "rest",
          scheduledOn: "2026-11-18T00:00:00Z",
          status: "REST",
          title: "Descanso",
          workouts: [],
        },
      ],
    }),
  );
  assert.equal((html.match(/type="button"/g) || []).length, 7);
  assert.match(html, /2026-11-17/);
  assert.match(html, /2026-11-23/);
  assert.match(html, /Upper A/);
  assert.match(html, /Descanso/);
  assert.match(html, /Distribución/);
  assert.match(html, /aria-pressed="true"/);
});
test("actual rescheduled dates take precedence and do not invent a session on the original day", async () => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/RoutineWeekStrip.vue",
    )
  ).default;
  const html = await renderToString(
    createSSRApp(Component, {
      startsOn: "2026-11-16",
      referenceDate: "2026-11-16",
      selectedDate: "",
      days: [{ id: "upper", name: "Upper A", weekday: 1 }],
      activities: [
        {
          id: "activity",
          planDayId: "upper",
          scheduledOn: "2026-11-20T00:00:00Z",
          status: "RESCHEDULED",
          title: "Upper A",
          workouts: [],
        },
      ],
    }),
  );
  assert.equal((html.match(/<strong[^>]*>Upper A<\/strong>/g) || []).length, 1);
  assert.match(html, /Reprogramado/);
});
