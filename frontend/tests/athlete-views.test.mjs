import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createServer } from 'vite'

test('renderiza navegación privada, perfil y estado inicial de medidas', async () => {
  const server = await createServer({
    configFile: resolve('vite.config.ts'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    logLevel: 'error',
  })

  try {
    const pinia = createPinia()
    const { default: layout } = await server.ssrLoadModule('/src/components/AuthenticatedLayout.vue')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/app', name: 'home', component: { template: '<div>Inicio</div>' } },
        { path: '/app/profile', name: 'profile', component: { template: '<div>Perfil</div>' } },
        { path: '/app/measurements', name: 'measurements', component: { template: '<div>Medidas</div>' } },
        { path: '/app/exercises', name: 'exercise-catalog', component: { template: '<div>Ejercicios</div>' } },
      ],
    })
    const layoutApp = createSSRApp(layout)
    layoutApp.use(pinia)
    layoutApp.use(router)
    await router.push('/app')
    await router.isReady()
    const layoutHtml = await renderToString(layoutApp)
    assert.match(layoutHtml, /PULSO<span/)
    assert.match(layoutHtml, /Navegación principal/)
    assert.match(layoutHtml, /Mi perfil/)
    assert.match(layoutHtml, /Medidas corporales/)
    assert.match(layoutHtml, /Cerrar sesión/)

    const { default: profileView } = await server.ssrLoadModule('/src/views/ProfileView.vue')
    const profileApp = createSSRApp(profileView)
    profileApp.use(createPinia())
    const profileHtml = await renderToString(profileApp)
    assert.match(profileHtml, /Mi perfil/)
    assert.match(profileHtml, /Cargando perfil/)

    const { default: measurementsView } = await server.ssrLoadModule('/src/views/MeasurementsView.vue')
    const measurementsApp = createSSRApp(measurementsView)
    measurementsApp.use(createPinia())
    const measurementsHtml = await renderToString(measurementsApp)
    assert.match(measurementsHtml, /Medidas corporales/)
    assert.match(measurementsHtml, /Cargando mediciones/)
    assert.match(measurementsHtml, /Nueva medición/)
  } finally {
    await server.close()
  }
})
