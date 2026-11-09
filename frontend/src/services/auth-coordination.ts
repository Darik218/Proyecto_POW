// Cookie mutations are browser-wide, whereas Pinia and access tokens are local
// to a tab. Locks cover the response (including Set-Cookie), not just dispatch.
export function createAuthCoordination(onBoundary: () => void, onRotation: () => void) {
  const browser = typeof window !== 'undefined'
  const channel = browser && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('pulso-auth-events') : undefined
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data === 'boundary') onBoundary()
    else if (event.data === 'rotation') onRotation()
  }

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    // Non-browser consumers (tests/SSR) have no shared browser cookie jar.
    if (!browser) return operation()
    if (!navigator.locks) {
      throw new Error('Este navegador no permite coordinar la sesión de forma segura. Usa un navegador actualizado y HTTPS.')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      return await navigator.locks.request('pulso-auth-cookies', { signal: controller.signal }, async () => {
        clearTimeout(timer)
        return operation()
      })
    } finally { clearTimeout(timer) }
  }

  return {
    run,
    boundary: () => channel?.postMessage('boundary'),
    rotation: () => channel?.postMessage('rotation'),
    close: () => channel?.close(),
  }
}
