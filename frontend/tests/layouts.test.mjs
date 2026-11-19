import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { resolve } from 'node:path'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { RouterView } from 'vue-router'
import { createServer } from 'vite'

let server
before(async () => {
  server = await createServer({
    configFile: resolve('vite.config.ts'), appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error',
    plugins: [{
      name: 'test-memory-history', enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/src/router/index.ts')) return code.replaceAll('createWebHistory', 'createMemoryHistory')
      },
    }],
  })
})
after(async () => { await server?.close() })

test('el layout compone el contenedor existente y las páginas del router real sin duplicar el encabezado', async () => {
  const { default: layout } = await server.ssrLoadModule('/src/layouts/AppLayout.vue')
  const { router } = await server.ssrLoadModule('/src/router/index.ts')
  const { pinia } = await server.ssrLoadModule('/src/stores/pinia.ts')
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/auth.store.ts')
  const auth = useAuthStore(pinia)
  auth.status = 'authenticated'
  auth.accessToken = 'memory-only-fixture'
  auth.user = { id: 'fixture', email: 'layout@example.test' }

  for (const [path, title] of [['/app/profile', 'Mi perfil'], ['/app/measurements', 'Medidas corporales'], ['/app/history', 'Historial']]) {
    await router.push(path)
    assert.equal(router.currentRoute.value.path, path)
    assert.equal(router.currentRoute.value.matched[0].components.default, layout)
    const app = createSSRApp({ render: () => h(RouterView) })
    app.use(pinia); app.use(router)
    const html = await renderToString(app)
    assert.equal((html.match(/class="app-header"/g) ?? []).length, 1)
    assert.equal((html.match(/class="app-main"/g) ?? []).length, 1)
    assert.match(html, /PULSO<span/)
    assert.match(html, /aria-label="Navegación principal"/)
    assert.match(html, new RegExp(title))
    assert.match(html, /Cerrar todas las sesiones/)
    assert.match(html, /layout@example.test/)
  }
})

test('el router conserva las URLs y guards privados y públicos al incorporar layouts', async () => {
  const { router } = await server.ssrLoadModule('/src/router/index.ts')
  const { pinia } = await server.ssrLoadModule('/src/stores/pinia.ts')
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/auth.store.ts')
  const auth = useAuthStore(pinia)
  for (const path of ['/app', '/app/history', '/app/profile', '/app/measurements', '/app/exercises',
    '/app/exercises/fixture', '/app/training-plans', '/app/training-plans/fixture',
    '/app/workouts', '/app/workouts/fixture', '/app/routine/p/weeks/w/days/d']) {
    const target = router.resolve(path)
    assert.equal(target.path, path)
    assert.equal(target.meta.requiresAuth, true)
  }
  assert.equal(router.resolve('/login').meta.guestOnly, true)
  assert.equal(router.resolve('/register').meta.guestOnly, true)
  auth.clearSession()
  await router.push('/app/profile')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.redirect, '/app/profile')
  auth.accessToken = 'memory-only-fixture'; auth.user = { id: 'fixture' }; auth.status = 'authenticated'
  await router.push('/register')
  assert.equal(router.currentRoute.value.name, 'home')
})


test('la navegación activa identifica Progresión y sus detalles sin marcar Mi rutina',async()=>{
 const {router}=await server.ssrLoadModule('/src/router/index.ts'),{pinia}=await server.ssrLoadModule('/src/stores/pinia.ts'),{useAuthStore}=await server.ssrLoadModule('/src/stores/auth.store.ts'),{default:Layout}=await server.ssrLoadModule('/src/components/AuthenticatedLayout.vue');
 const auth=useAuthStore(pinia);auth.status='authenticated';auth.accessToken='memory-only-test';auth.user={id:'fixture',email:'navigation@example.test'};
 for(const path of ['/app/progression','/app/progression/new','/app/progression/recommendations/10000000-0000-4000-8000-000000000001']){
  await router.push(path);const app=createSSRApp(Layout);app.use(pinia);app.use(router);const html=await renderToString(app);
  const links=[...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*class="([^"]*)"[^>]*>/g)];
  assert.ok(links.find(v=>v[1]==='/app/progression'&&v[2].includes('app-nav__link--active')));
  assert.ok(links.find(v=>v[1]==='/app'&&!v[2].includes('app-nav__link--active')));
 }
});
