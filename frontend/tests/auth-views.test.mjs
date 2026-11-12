import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { createPinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { createServer } from "vite";

test("renderiza formularios accesibles de login y registro", async () => {
  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
  });
  try {
    for (const [file, title, submitText] of [
      ["LoginView.vue", "Qué bueno verte.", "Iniciar sesión"],
      ["RegisterView.vue", "Tu próximo capítulo.", "Crear cuenta"],
    ]) {
      const { default: view } = await server.ssrLoadModule(
        `/src/views/${file}`,
      );
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", component: view },
          { path: "/login", name: "login", component: { template: "<div />" } },
          {
            path: "/register",
            name: "register",
            component: { template: "<div />" },
          },
        ],
      });
      const app = createSSRApp(view);
      app.use(createPinia());
      app.use(router);
      await router.push("/");
      await router.isReady();
      const html = await renderToString(app);
      assert.match(html, new RegExp(title));
      assert.match(html, /for="email"/);
      assert.match(html, /for="password"/);
      assert.match(html, new RegExp(submitText));
      assert.match(html, /PULSO<span/);
      assert.doesNotMatch(html, /POW/);
    }

    const { default: homeView } = await server.ssrLoadModule(
      "/src/views/HomeView.vue",
    );
    const homeRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/app/progression",
          name: "progression",
          component: { template: "<div/>" },
        },
        {
          path: "/app/exercises",
          name: "exercise-catalog",
          component: { template: "<div/>" },
        },
        {
          path: "/app/workouts",
          name: "workout-sessions",
          component: { template: "<div />" },
        },
        {
          path: "/app/history",
          name: "workout-history",
          component: { template: "<div />" },
        },
        {
          path: "/app/progression/new",
          name: "progression-new",
          component: { template: "<div />" },
        },
        {
          path: "/app/progression/settings",
          name: "progression-settings",
          component: { template: "<div />" },
        },
        {
          path: "/app/training-plans",
          name: "training-plans",
          component: { template: "<div />" },
        },

        { path: "/", name: "home", component: homeView },
        {
          path: "/profile",
          name: "profile",
          component: { template: "<div />" },
        },
        {
          path: "/measurements",
          name: "measurements",
          component: { template: "<div />" },
        },
      ],
    });
    const homeApp = createSSRApp(homeView);
    homeApp.use(createPinia());
    homeApp.use(homeRouter);
    await homeRouter.push("/");
    await homeRouter.isReady();
    const homeHtml = await renderToString(homeApp);
    assert.match(homeHtml, /Tu progreso, medido\./);
    assert.doesNotMatch(homeHtml, /POW/);
  } finally {
    await server.close();
  }
});
