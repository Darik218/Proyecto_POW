import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { createPinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { createServer } from "vite";

test("renderiza navegación privada, perfil y estado inicial de medidas", async () => {
  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
  });

  try {
    const pinia = createPinia();
    const { default: layout } = await server.ssrLoadModule(
      "/src/components/AuthenticatedLayout.vue",
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/app/overview",
          name: "dashboard",
          component: { template: "<div>Vista general</div>" },
        },
        {
          path: "/app/progression/settings",
          name: "progression-settings",
          component: { template: "<div>Configuración</div>" },
        },
        {
          path: "/app/progression/automation",
          name: "automation-consents",
          component: { template: "<div>Automatización</div>" },
        },
        {
          path: "/app/progression",
          name: "progression",
          component: { template: "<div>Progresión</div>" },
        },
        {
          path: "/app/history",
          name: "workout-history",
          component: { template: "<div>Historial</div>" },
        },
        {
          path: "/app",
          name: "home",
          component: { template: "<div>Inicio</div>" },
        },
        {
          path: "/app/profile",
          name: "profile",
          component: { template: "<div>Perfil</div>" },
        },
        {
          path: "/app/measurements",
          name: "measurements",
          component: { template: "<div>Medidas</div>" },
        },
        {
          path: "/app/exercises",
          name: "exercise-catalog",
          component: { template: "<div>Ejercicios</div>" },
        },
        {
          path: "/app/training-plans",
          name: "training-plans",
          component: { template: "<div>Planes</div>" },
        },
        {
          path: "/app/workouts",
          name: "workout-sessions",
          component: { template: "<div>Entrenamientos</div>" },
        },
      ],
    });
    const layoutApp = createSSRApp(layout);
    layoutApp.use(pinia);
    layoutApp.use(router);
    await router.push("/app");
    await router.isReady();
    const layoutHtml = await renderToString(layoutApp);
    assert.match(layoutHtml, /PULSO<span/);
    assert.match(layoutHtml, /Navegación principal/);
    assert.match(layoutHtml, /Perfil/);
    assert.match(layoutHtml, /href="\/app\/progression"/);
    assert.match(layoutHtml, /Mi rutina/);
    assert.match(layoutHtml, /Mi progreso/);
    assert.equal(
      (layoutHtml.match(/<a\b[^>]*class="[^"]*\bapp-nav__link\b/g) || [])
        .length,
      6,
    );
    assert.doesNotMatch(
      layoutHtml.match(/<nav[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "",
      /Historial|Automatización|Configuración/,
    );
    assert.doesNotMatch(layoutHtml, /Medidas corporales/);
    assert.match(layoutHtml, /Cerrar sesión/);

    const { default: profileView } = await server.ssrLoadModule(
      "/src/views/ProfileView.vue",
    );
    const profileApp = createSSRApp(profileView);
    profileApp.use(createPinia());
    profileApp.use(router);
    const profileHtml = await renderToString(profileApp);
    assert.match(profileHtml, /Mi perfil/);
    assert.match(profileHtml, /Cargando perfil/);

    const { default: measurementsView } = await server.ssrLoadModule(
      "/src/views/MeasurementsView.vue",
    );
    const measurementsApp = createSSRApp(measurementsView);
    measurementsApp.use(createPinia());
    const measurementsHtml = await renderToString(measurementsApp);
    assert.match(measurementsHtml, /Medidas corporales/);
    assert.match(measurementsHtml, /Cargando mediciones/);
    assert.match(measurementsHtml, /Nueva medición/);
  } finally {
    await server.close();
  }
});
