import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const release = process.env.RENDER_GIT_COMMIT
  return {
    plugins: [
      vue(),
      {
        name: 'pulso-release',
        apply: 'build',
        transformIndexHtml() {
          if (!release || !/^[a-f0-9]{40}$/i.test(release)) return []
          return [{ tag: 'meta', attrs: { name: 'pulso-release', content: release } }]
        },
      },
    ],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }
})
