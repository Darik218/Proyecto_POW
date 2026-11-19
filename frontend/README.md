# PULSO — frontend

Vue 3 + TypeScript. El flujo principal es Inicio → Mi rutina → Entrenar → Mi progreso.

## Ejecutar

Desde esta carpeta, con las dependencias ya instaladas:

```sh
npm run dev
npm run build
npm test
```

`npm run build` valida TypeScript y genera `dist/`. `npm test` usa Node y los helpers existentes; no necesita PostgreSQL.

Configuración pública: `VITE_API_BASE_URL` (por defecto `/api/v1`). En desarrollo, `VITE_DEV_API_PROXY_TARGET` dirige el proxy de Vite a Nest. No colocar secretos en variables `VITE_*`.

## Producción

Servir `dist/` por HTTPS. El servidor debe resolver las rutas SPA (`/app/*`, `/login`, `/register`) mediante `index.html`, conservando `/api/*` para la API. El proxy de desarrollo de Vite no existe en el build: configurar el proxy inverso `/api/v1` hacia Nest o indicar una URL pública de API al compilar.

En Nest, configurar el origen real mediante `CORS_ORIGINS`, secretos privados de autenticación y cookies seguras según su configuración existente. No ampliar dominios de cookies ni desactivar origen/CSRF para resolver despliegues. Las migraciones se revisan y aplican como una operación de despliegue explícita; ninguna instrucción de este archivo autoriza migrar la base de desarrollo.

## Verificación funcional aislada

Desde `frontend/`, `node tests/run-ui-redesign-isolated.mjs --functional` inicia el entorno privado, compila Nest, aplica las migraciones únicamente al clúster nuevo, verifica el recorrido con Firefox y limpia al terminar. Requiere PostgreSQL y Firefox/Geckodriver disponibles (rutas por defecto del entorno actual).

`backend/test/run-final-mvp-demo.mjs` crea una base desechable y muestra la URL de demostración. `frontend/tests/final-ux.browser.mjs` comprueba el nuevo flujo con Firefox y configuración del runner por entrada estándar; verifica base, puerto y directorio antes de escribir. No usar credenciales ni datos de desarrollo para pruebas.
