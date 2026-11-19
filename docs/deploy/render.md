# PULSO en Render Free

## Publicación

1. Revisa y publica manualmente la rama que contiene el estado completo de PULSO, incluidos ambos lockfiles, las migraciones, los catálogos y alias Prisma, los recursos de `frontend/public/`, `render.yaml` y `scripts/deploy/`. Mantén fuera los `.env` reales, credenciales, artefactos de pruebas y compilaciones locales.
2. En Render abre **New → Blueprint**, conecta el repositorio y selecciona esa rama. Usa `render.yaml` desde la raíz.
3. Revisa la vista previa. Debe incluir únicamente `pulso-academico` (Node Web Service, Free) y `pulso-academico-db` (PostgreSQL 18, Free), ambos en Oregon. Comprueba que el workspace tenga disponible su base Free y que los dos recursos figuren como gratuitos. Confirma la creación cuando estés listo para publicar.
4. Revisa los logs del primer despliegue y el estado de salud en `/api/v1`. Abre la URL HTTPS asignada por Render y recarga `/app/overview` directamente. Crea una cuenta académica, inicia sesión y comprueba plan, sesión y Progreso.
5. Para publicar una revisión posterior, selecciona manualmente el commit desde **Manual Deploy**. El Blueprint desactiva el despliegue automático del servicio por cambios de código.

## Variables y comandos

| Variable                                                | Origen                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION`, `NODE_ENV`                              | Blueprint, Node 22.22.3 y producción                                                                                                     |
| `PORT`                                                  | Render                                                                                                                                   |
| `RENDER_EXTERNAL_URL`, `RENDER`                         | Render                                                                                                                                   |
| `DATABASE_URL`                                          | Conexión interna de PostgreSQL, mediante `fromDatabase`                                                                                  |
| `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_REFRESH_TOKEN_PEPPER` | Secretos distintos generados por Render                                                                                                  |
| `AUTH_COOKIE_SECURE`                                    | `true`                                                                                                                                   |
| `CORS_ORIGINS`                                          | Por defecto, la URL exacta de `RENDER_EXTERNAL_URL`. Una configuración manual debe ser una lista explícita de orígenes HTTP(S) sin rutas |
| `PULSO_AUTOMATION_ENABLED`                              | `false`                                                                                                                                  |

- Build desde la raíz con `bash scripts/deploy/render-build.sh`. Instala desde ambos lockfiles, genera el cliente Prisma y compila Vue, NestJS y el inicializador de catálogo. El cliente usa `/api/v1` en la URL pública.
- Arranque desde la raíz con `bash scripts/deploy/render-start.sh`. Valida configuración, ejecuta `prisma migrate deploy` y después el seed del catálogo global. El seed serializa inicializaciones y solo añade identidades o alias faltantes y sincroniza el ranking editorial. No contiene cuentas, rutinas ni entrenamientos de ejemplo. Si un paso falla, NestJS no abre el puerto.
- Comprobación local de producción con PostgreSQL 18 temporal y Firefox, tras el build. Desde `frontend/`, ejecuta `node tests/run-ui-redesign-isolated.mjs --ui-final --render-production`.

Render suspende los Web Services Free tras 15 minutos sin tráfico y la base Free vence a los 30 días. Abre el servicio antes de la presentación y exporta los datos que necesites conservar antes del vencimiento. [Límites de Render Free](https://render.com/docs/free)
