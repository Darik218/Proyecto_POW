import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { createPinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { createServer } from "vite";

test("la navegación agrupada conserva rutina, historial, perfil y acceso al catálogo", async () => {
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
          component: { template: "<div>Catálogo</div>" },
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
        {
          path: "/app/exercises/:exerciseId",
          name: "exercise-detail",
          component: { template: "<div>Detalle</div>" },
        },
      ],
    });
    const layoutApp = createSSRApp(layout);
    layoutApp.use(pinia);
    layoutApp.use(router);
    await router.push("/app");
    await router.isReady();
    const layoutHtml = await renderToString(layoutApp);
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
    assert.match(layoutHtml, /href="\/app\/exercises"/);

    const { default: catalogView } = await server.ssrLoadModule(
      "/src/views/ExercisesView.vue",
    );
    const catalogApp = createSSRApp(catalogView);
    catalogApp.use(createPinia());
    catalogApp.use(router);
    const catalogHtml = await renderToString(catalogApp);
    assert.match(catalogHtml, /Ejercicios/);
    assert.match(catalogHtml, /Cargando ejercicios/);
    assert.match(catalogHtml, /Crear ejercicio/);
    assert.match(catalogHtml, /Catálogo PULSO/);
    assert.match(catalogHtml, /Mis ejercicios/);
    assert.match(catalogHtml, /Filtros del catálogo/);

    const { default: detailView } = await server.ssrLoadModule(
      "/src/views/ExerciseDetailView.vue",
    );
    const detailApp = createSSRApp(detailView);
    detailApp.use(createPinia());
    detailApp.use(router);
    await router.push("/app/exercises/20000000-0000-4000-8000-000000000001");
    await router.isReady();
    const detailHtml = await renderToString(detailApp);
    assert.match(detailHtml, /Volver a ejercicios/);
    assert.match(detailHtml, /Cargando ejercicio/);
  } finally {
    await server.close();
  }
});
