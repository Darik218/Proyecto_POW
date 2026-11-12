# PROG-6A — Integración HTTP y Vue del flujo manual

Fecha de verificación: 2026-11-11. Alcance: propuesta descriptiva, persistencia, revisión humana específica, aplicación manual y recuperación. Sin automatización ni activación de consentimiento recurrente.

## A. Estado inicial

- Rama `feature`; HEAD inicial y final comprobado `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`. No se hicieron commits, pushes, cambios de rama, resets ni worktrees.
- Existían modificaciones y archivos sin seguimiento de PROG-3 a PROG-5C-A. Se conservaron; el inventario SHA-256 inicial permite distinguirlos de los cambios de esta etapa.
- Línea base ejecutada: backend **633 pruebas / 54 suites**, frontend **131 pruebas**, aprobadas. Los 319 casos PostgreSQL anteriores eran referencia, no una nueva ejecución de línea base.
- Versiones declaradas en el repositorio: NestJS 12, Prisma 7.10, Vue 3.5, Pinia 4.1, Vue Router 5.4, Axios 1.20, Zod 4.6, TypeScript 6 y Vite 8.3. No se instalaron dependencias.

## B. Arquitectura

```text
Vue Router protegido → vistas y componentes → store Pinia
  → servicio Axios existente → esquemas Zod
  → ProgressionController → RecommendationService existente
  → dominio PROG-4A/5A/5B y modelos internos
  → ProgressionRepository / PrismaProgressionRepository → PostgreSQL
  → ProgressionPresenter → JSON público
```

El controlador no consulta Prisma ni decide incrementos. El presenter selecciona campos y conserva cadenas decimales. Las transacciones, bloqueos, versiones y aplicación exacta siguen en los repositorios existentes. La comprobación de aplicabilidad es de solo lectura y reutiliza `authorizeApplication`/`assertFutureTarget`; la aplicación vuelve a validar dentro de su propia transacción.

Las carpetas frontend obligatorias siguen activas: `config/api.config.ts` configura el cliente compartido; `layouts/AppLayout.vue` compone el contenedor autenticado y RouterView; los nuevos contratos están en `schemas/`, los tipos se infieren en `types/` y los constructores de entradas e identificadores temporales están en `utils/`. Se conservaron `components`, `composables`, `services`, `stores`, `router`, `views` y `assets`, sin movimientos masivos ni carpetas vaciadas.

## C. API

Prefijo `/api/v1/progression`. Autenticación bearer real en todas las rutas. Los POST también exigen el guard de origen existente.

| Método | Ruta relativa                                | Resultado                                                                  |
| ------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| POST   | `/context`                                   | Configuración efectiva, destino e historial propio acotado                 |
| POST   | `/preview`                                   | Propuesta sin persistencia ni autorización                                 |
| POST   | `/recommendations`                           | Guardado idempotente de propuesta válida y parámetros de revalidación, 201 |
| GET    | `/recommendations`                           | Lista paginada; filtros por ejercicio, estado y huella semántica           |
| GET    | `/recommendations/:id`                       | Propuesta propia; captura pública o legado desconocido                     |
| GET    | `/recommendations/:id/request`               | Parámetros guardados de revalidación, o null si no existen                 |
| POST   | `/recommendations/:id/inspection`            | Evidencia, vigencia, compatibilidad, bloqueos, eventos y desafío real      |
| POST   | `/recommendations/:id/validity`              | Revalidación; requiere parámetros conservados o explícitos                 |
| POST   | `/recommendations/:id/reviews`               | APPROVE o REJECT por PROG-5A, intención estable, 201                       |
| POST   | `/recommendations/:id/application-readiness` | Comprobación de destino/actividad y comando condicionado; no escritura     |
| POST   | `/recommendations/:id/application`           | Aplicación manual PROG-5B, 201; nunca actualización genérica               |
| GET    | `/recommendations/:id/application`           | Recibo confirmado; 404 si no existe o no es accesible                      |

Los POST de consulta devuelven 200. Las respuestas, incluidos errores del límite HTTP, usan `Cache-Control: no-store`. No se añadieron rutas de consentimiento recurrente, modificaciones genéricas de estado, configuración de autoaplicación ni edición arbitraria de snapshots.

## D. DTO y contratos

DTO con `class-validator`/`class-transformer` y el ValidationPipe existente: UUID v4, fechas ISO, versiones enteras, paginación 1–100, contextos/comparaciones hasta 100, longitudes acotadas, objetos anidados y huellas hexadecimales de 64 caracteres. Las validaciones semánticas de períodos, zonas IANA, políticas, cargas y relaciones reutilizan el dominio. Los parámetros de política incompletos pueden producir `CONFIGURATION_REQUIRED`; no se completan por defecto.

Las cargas oficiales se transportan como cadenas. Zod distingue configuración, vista previa, propuesta persistida, inspección, revisión, aplicabilidad y recibo. Las exclusiones públicas usan `{taskId, reasons: string[]}`. Las fechas civiles no se reinterpretan como hora local del navegador.

## E. Autenticación

Se reutilizan `AccessTokenGuard`, identidad autenticada, sesiones reales y comprobaciones transaccionales existentes. No se admite `athleteId` del cliente para atribuir propiedad. Se verifican cadenas de origen y recursos privados; las respuestas a recursos ajenos no exponen sus datos.

Únicos ajustes de integración de autenticación: exportar `AuthOriginGuard` y su `AuthConfig` desde AuthModule para resolver la inyección Nest, y exponer un getter de solo lectura del identificador opaco de contexto ya existente en la store. No cambiaron expiraciones, cookies, guards, rotación, hashing, CSRF ni interceptores.

## F. CSRF y recuperación

El contrato existente concentra la autenticación por cookies y `CsrfGuard` bajo `/api/v1/auth`; esas cookies tienen ese ámbito de ruta. Las nuevas operaciones de negocio requieren **bearer explícito y origen permitido**, y no aceptan la cookie como autenticación suficiente. No se envía un encabezado CSRF ficticio a rutas donde su cookie no existe, ni se amplía el ámbito de las cookies.

Las pruebas comprueban rechazo de negocio sin bearer, solo con cookies, sin Origin o con Origin ajeno. También comprueban que refresh siga rechazando CSRF ausente e incorrecto. El interceptor AUTH-HARDEN-1 existente conserva renovación acotada y aislamiento por generación de sesión.

## G. Generación

La interfaz selecciona plan → semana → día → ejercicio/prescripción. Consulta la carga exacta del destino en la nueva API, sin reutilizar los números redondeados de presentación de otros módulos. Solicita fechas deportivas y zona IANA explícitas, selección de evidencia, referencia, posiciones de series y declaraciones posteriores de carga externa total/protocolo/equipo.

La política se introduce mediante controles de formulario: identificación/versión/referencia, objetivos originales o ajustados, cumplimiento, readiness, RPE, conteo, revisión por señales, incremento, unidad y rejilla. Los parámetros de señales/persistencia aparecen cuando corresponden. No hay política de entrenamiento preseleccionada. El mínimo de sesiones proviene de la configuración registrada; no se sustituye por un número inventado.

Esta pantalla fija y explica las responsabilidades de este recorrido: base de carga en prescripción de destino, cohorte explícita, cobertura de todas las posiciones requeridas, 1RM solo descriptivo, conocimiento de registros actuales al corte y rejilla con FLOOR. No duplica el motor en JavaScript.

## H. Persistencia e idempotencia

`saveMyProposal` conserva el comportamiento interno previo por defecto. El consumidor HTTP solicita capturar también el comando validado dentro de la **misma transacción** del guardado. Una restricción única y el tratamiento de concurrencia existentes conservan la idempotencia de la recomendación. La receta es inmutable y tiene su propia huella; no altera la huella de generación ni la evidencia original.

Se añadió la migración **16** `20261111001000_manual_revalidation_requests`, justificada porque la captura anterior no conservaba todos los parámetros necesarios para revalidar (límite de lectura, declaraciones/protocolo/equipo, comparaciones, etc.). Reconstruirlos desde el plan o inventarlos al recargar sería incorrecto.

Nueva tabla `ProgressionRevalidationRequest`: recommendationId UUID PK/FK RESTRICT, requestKey/commandKey CHAR(64), schemaVersion, command JSONB, provenance y recordedAt TIMESTAMPTZ(6). CHECK y trigger impiden formas inválidas, asociación a otra propuesta y actualizaciones/eliminaciones. La huella utiliza canonicalización/versionado existentes. Sin cambios de precisión de cargas ni de tablas históricas.

Alternativas evaluadas: reconstruir desde snapshot (insuficiente), pedir todos los parámetros en cada recarga (sin recuperación fiel del recorrido) o añadir columnas escalares al modelo anterior (afecta los lectores/fixtures de esquemas predecesores). La relación opcional separada preserva esos lectores.

No hay backfill. `HTTP_SAVE_REQUEST` acredita captura al guardar por HTTP. `MATCHING_REPLAY_REQUEST` acredita parámetros aportados posteriormente en un reintento semánticamente coincidente; no afirma que fueron registrados históricamente. Las quince migraciones previas se conservaron y la migración nueva se aplicó **solo** a bases temporales.

## I. Evidencia

Se muestran por separado objetivos originales, objetivos ajustados y series realmente ejecutadas, con fechas, unidades, repeticiones y RPE ausente o presente. También política y referencia, criterio de conteo, sesiones satisfactorias, readiness, cobertura/truncamiento, exclusiones y señales.

1RM se etiqueta descriptivo, sin afirmación de máximo real ni evidencia oficial. Las señales heurísticas no se presentan como diagnóstico de fatiga. Los datos desconocidos siguen desconocidos; no se reconstruyen desde la planificación actual.

## J. Revisión

Las casillas de política y evidencia comienzan desmarcadas. Se invalidan al cambiar propuesta, inspección o sesión. La aprobación envía el desafío real del servidor, revisión esperada, claves, intención UUID y alcance `THIS_PROPOSAL_ONLY`. El rechazo solicita justificación y no crea una aceptación.

El sistema registra las afirmaciones expresas y su evento de auditoría; **no demuestra comprensión humana**. APPROVED no significa APPLIED ni garantiza aplicabilidad futura. No se ofrece una segunda revisión cuando el contrato la prohíbe.

## K. Aplicación

Tras aprobar, el usuario consulta actividades de destino y selecciona una explícitamente. El servidor devuelve aplicabilidad y el comando exacto con cargas, unidad, destino, versiones, fecha y zona. Se exige otra casilla inicialmente desmarcada y otro botón para aplicar.

El endpoint llama a `applyMyApprovedRecommendation`. La autorización, protección histórica, unidad, precisión Decimal(8,3), fechas futuras, versiones y concurrencia se vuelven a comprobar en la transacción original PROG-5B. No hay redondeo para evitar incompatibilidades, copia silenciosa de destinos ni escrituras desde el controlador.

El recibo muestra aplicación/auditoría, propuesta, intención, carga anterior/aplicada, unidad, prescripción, actividad, fecha y versiones de plan antes/después. Solo se presenta éxito confirmado por el servidor.

## L. Frontend

- Vistas: `ProgressionView`, `NewProgressionView`, `ProgressionDetailView`.
- Componentes: formulario de contexto/política, evidencia, revisión específica, aplicación manual, estado/recuperación y recibo.
- Store: datos privados acotados a la sesión, estado de carga, secuencias de consulta, intenciones y confirmación del resultado real.
- Servicio: reutiliza exclusivamente `api`, con validación Zod de contratos. No crea otra instancia Axios ni modifica interceptores.
- Utils: construcción de entradas y posiciones explícitas; caché temporal exclusivamente de identificadores. No contienen fórmulas oficiales.
- Estilos: activos locales reutilizando tokens y clases existentes; sin rediseño global.

## M. Navegación

Rutas protegidas nuevas: `/app/progression`, `/app/progression/new`, `/app/progression/recommendations/:id`. El detalle combina evidencia, revisión, aplicación y recibo para mantener separadas las acciones sin multiplicar pantallas. Se añadió el acceso Progresión a la navegación existente y su marcado activo en las tres rutas nuevas, conservando el comportamiento de las rutas anteriores. Los guards, URLs anteriores, AppLayout y AuthenticatedLayout se conservaron.

## N. Errores

Contrato público `{code, reasons, message}`, sin errores SQL/Prisma ni trazas. Se distinguen autenticación, origen, recurso inaccesible, parámetros faltantes, validación, evidencia/política, conflicto, intención reutilizada, contención, destino protegido y fallo interno. El frontend traduce los códigos principales y muestra razones de dominio.

Una pérdida de red, un contrato de respuesta imposible después de escribir o un 5xx ambiguo mantienen el resultado pendiente. `SOURCE_BUSY` explícito representa el rechazo transaccional conocido. No se interpreta un fallo de comunicación como rechazo definitivo ni como aplicación exitosa.

## O. Reintentos y respuestas perdidas

El envío exacto permanece en memoria, con su intención original. Doble clic no produce otra escritura. Puede consultarse el recibo/evento o reenviarse exactamente la misma intención; el servidor sigue siendo la autoridad idempotente.

`sessionStorage` contiene únicamente cuenta, identificador opaco real de sesión, tipo de operación, ID de recomendación/intención, huella semántica y fecha local de retención. Caduca a los 30 minutos. No conserva política, evidencia, snapshot, aceptación ni credenciales. Tras recargar solo se consultan resultados; no se reconstruye ni reenvía una aceptación.

La recuperación usa el contexto real de `/auth/context`, no un contador susceptible de repetirse después de recargar. Cambiar cuenta o iniciar otra sesión de la misma cuenta invalida el registro. Las respuestas tardías no sustituyen datos nuevos. Si una consulta no confirma la operación y ya no existe su envío en memoria, se ofrece retirar expresamente el identificador local y volver a inspeccionar/confirmar; esto no se presenta como cancelación del servidor.

## P. Seguridad y revisión independiente

Pruebas de bearer, origen, CSRF de autenticación, sesión revocada/expirada, cuenta suspendida, propiedad de propuestas/planes/ejercicios, aceptación ausente/falsa, huellas manipuladas, cargas/destinos modificados, concurrencia, idempotencia y errores sanitizados.

La revisión independiente de código identificó cuatro defectos reproducibles durante el desarrollo: contador de campos de caché, bloqueo busy tras invalidación, contrato de exclusiones y pérdida de intención ante 504. Se corrigieron y se añadieron pruebas. También se corrigió el estado APPROVED residual al recuperar un recibo. La segunda pasada independiente no pudo completarse por límite de uso del agente; las correcciones se verificaron mediante pruebas propias y Firefox. No se ejecutó un nuevo escaneo canónico Codex Security ni se afirma una certificación de producción.

## Q. PostgreSQL y migración

Runners de progresión, sesiones, planificación y Firefox verifican localhost, puerto aleatorio, nombre de base y directorio de clúster dentro de `/tmp`, antes de migrar o escribir. Se ejecutan migraciones existentes y nueva únicamente allí, sin seeds, y se detienen/eliminan solo los clústeres que creó cada runner.

La prueba de migración reproduce realmente el esquema de quince migraciones, inserta fixtures con auditoría histórica/aplicación, aplica la dieciseisava y compara todas las filas anteriores byte a byte mediante su representación JSON. La tabla nueva permanece vacía para el legado. También se comprueba inmutabilidad de la receta y rollback del guardado si falla su escritura.

No se consultó ni migró `proyecto_pow_dev`. La instalación local necesita una revisión y aplicación separada de migraciones antes de habilitar la nueva API contra una base que no las tenga.

## R. Pruebas y comandos

Ejecutar desde el directorio indicado, nunca sustituir la URL por desarrollo:

| Directorio | Comando                                        | Resultado final                                                                                                  |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| backend    | `npm test -- --runInBand`                      | 640 pruebas / 56 suites aprobadas                                                                                |
| backend    | `node test/run-progression-isolated.mjs --api` | 341 pruebas / 13 suites aprobadas                                                                                |
| backend    | `node test/run-workouts-mvc-isolated.mjs`      | 27 pruebas / 3 suites aprobadas                                                                                  |
| backend    | `node test/run-planning-mvc-isolated.mjs`      | 26 pruebas / 4 suites aprobadas                                                                                  |
| frontend   | `npm test`                                     | 154 pruebas aprobadas                                                                                            |
| backend    | `./node_modules/.bin/tsc --noEmit`             | Aprobado                                                                                                         |
| backend    | `npm run lint`                                 | Aprobado, sin errores ni advertencias finales                                                                    |
| backend    | `npm run build`                                | Aprobado, también ejecutado por el runner Firefox antes del bootstrap real                                       |
| frontend   | `npm run build`                                | TypeScript y Vite aprobados                                                                                      |
| backend    | `npm run prisma:validate`                      | Aprobado                                                                                                         |
| backend    | migrate deploy/status/diff dentro de runners   | Esquema actualizado en temporal; sin deriva                                                                      |
| raíz       | Prettier sobre archivos de la etapa            | Aprobado en archivos de la etapa; se conservó el formato previo de los consumidores frontend con cambios mínimos |
| raíz       | `git diff --check`                             | Aprobado; se repite al cierre                                                                                    |

Total automatizado, sin contar reejecuciones: **1188 pruebas distintas** (640 + 341 + 27 + 26 + 154). Las 19 comprobaciones Firefox se informan por separado. No se suman las ejecuciones repetidas. El caso Axios/Zod real forma parte de la suite HTTP/PostgreSQL, no se vuelve a contar como prueba frontend. No existe script lint frontend; no se añadió otra herramienta para aparentar esa verificación.

## S. Firefox real

Comando: `node test/run-progression-browser-isolated.mjs` desde backend. **19 comprobaciones distintas aprobadas, 0 fallidas** en la ejecución completa. Evidencia: [resultados Firefox](evidence/prog-6a/firefox-results.json), [escritorio](evidence/prog-6a/proposal-desktop.png) y [recibo móvil](evidence/prog-6a/receipt-mobile.png).

Se verificaron login real, guard, layout único, selección jerárquica, política explícita, vista previa/evidencia/guardado, casillas inicialmente desmarcadas, invalidación de aceptación, aprobación sin escritura de carga, actividad futura/readiness, aplicación y recibo, recarga sin duplicación, propiedad tras cambio de cuenta, rechazo sin aplicación, versión obsoleta y sesión revocada.

El runner usa un proxy HTTP **exclusivo de pruebas**, local y efímero: tras recibir la confirmación 201 real de Nest, oculta ese cuerpo y entrega 504 una sola vez. Firefox conserva la intención, recarga sin conservar secretos, recupera el recibo y PostgreSQL confirma una aplicación y una versión de plan. No se añaden endpoints de fallo a la aplicación.

Responsive comprobado a 500×850 y escritorio, sin desbordamiento horizontal; foco mediante Tab real y etiquetas/roles básicos. No se realizó auditoría completa con lector de pantalla, todos los tamaños/dispositivos o navegadores. Se usa caché Vite privada del runner para evitar interferencias con las pruebas SSR.

Durante el desarrollo se detectó y corrigió un manejador Vue que el formateador convirtió en una expresión inválida. Se añadió transformación Vite para todos los componentes nuevos. Las primeras ejecuciones parciales/fallidas del runner no se consideran aprobadas ni se suman a los 19 casos finales.

## T. Regresiones e historial

PROG-1A a PROG-5C-A siguen incluidos en las suites unitarias/PostgreSQL. Las pruebas adicionales de sesiones y planificación verifican los consumidores existentes y las protecciones de historial. Firefox compara hashes de sesiones, ejercicios ejecutados, series y estimaciones antes/después; no se activan consentimientos ni `autoApplyAuthorized`.

Las cargas oficiales continúan como cadenas; los objetivos originales no se reconstruyen ni cambian. La aplicación legítima modifica exclusivamente la prescripción/versión/eventos autorizados por PROG-5B. Se preservan los quince archivos SQL anteriores, autenticación, catálogo, entrenamiento, calendario y frontend existentes fuera de los ajustes mínimos descritos.

## U. Archivos

El apéndice al final distingue los archivos nuevos y los modificados respecto del inventario inicial de esta tarea, no respecto de HEAD (que ya tenía mucho trabajo sin commit).

## V. Skills y herramientas

Consultadas y aplicadas: `pulso-architecture-review` y referencia MVC, `pulso-domain-integrity`, `pulso-integration-testing`, `pulso-prisma-migrations`, `pulso-frontend-ux`, Vue best practices (reactividad/SFC/flujo/composables), Pinia, router y testing. Superpowers se utilizó para plan, pruebas incrementales, diagnóstico, revisión independiente y verificación antes del cierre; no se adoptaron procedimientos incompatibles de commits/worktrees.

Se consultó frontend-testing-debugging de Build Web Apps. No había herramienta Browser disponible; se utilizó Firefox/Geckodriver ya instalado, sin Playwright ni nuevas dependencias. Se reutilizaron tokens/convenciones de diseño existentes tras consultar las guías locales de interfaz. Graphify no fue necesario para este conjunto de dependencias explícitas. No se reinstalaron skills, plugins ni se modificó configuración de Codex.

## W. Limitaciones

- El recorrido completo exige un `ProgressionSetting` persistido aplicable y una política completa explícita. Si falta configuración, se informa `CONFIGURATION_REQUIRED`. No se inventaron incrementos ni se agregó CRUD de settings sin caso de uso autorizado.
- El formulario de esta etapa prepara destino por prescripción futura de un plan. No implementa nuevos flujos de copia ni modifica destinos protegidos. El servidor puede exigir una futura copia editable conforme a PROG-5B.
- Las propuestas anteriores sin parámetros completos siguen siendo legibles; no se reconstruyen para aprobarlas. La interfaz ofrece generar otra propuesta explícita cuando la revalidación no es posible.
- Al recargar se conservan solo identificadores, nunca el consentimiento ni el payload privado. Reenviar un cuerpo perdido en memoria requiere una confirmación nueva después de consultar el estado.
- La base de desarrollo permanece sin migrar por esta tarea. Las verificaciones de persistencia/HTTP/navegador corresponden a bases temporales, no a una instalación de producción.
- No hay nueva auditoría canónica de seguridad, auditoría exhaustiva de accesibilidad ni certificación de producción. La revisión independiente final de las correcciones quedó limitada por cuota; existen pruebas ejecutadas propias y de navegador.

## X. Estado final

| Componente                                 | Clasificación y alcance                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Modelo                                     | Verificado: contratos internos y datos históricos separados                |
| Vista backend                              | Verificada: selección pública, precisión, exclusiones y privacidad         |
| Controlador                                | Verificado: Nest real, DTO, guards y delegación                            |
| API manual / PostgreSQL                    | Verificados en entorno temporal; pendiente despliegue/migración autorizada |
| Vue / Axios / Zod / Pinia                  | Verificados en pruebas automatizadas y recorrido Firefox configurado       |
| Revisión y aplicación                      | Verificadas como operaciones explícitas distintas e idempotentes           |
| Recuperación                               | Verificada con respuesta perdida real del transporte, recarga y recibo     |
| Integridad histórica                       | Verificada en pruebas de migración, persistencia y navegador               |
| Automatización / consentimiento recurrente | Excluidos; sin activación ni cambios de política                           |
| Producción                                 | No certificada ni desplegada                                               |

PROG-6A integra el recorrido manual en su alcance. No implica que todo atleta sin configuración pueda recibir un incremento ni que una aprobación garantice aplicabilidad futura.

## Y. Propuesta PROG-6B — solo diseño

1. Auditar el contrato actual de consentimiento recurrente y sus estados reales `PENDING_CONFIRMATION`/`REVOKED`; mantener `executionAuthorized: false`.
2. Diseñar una pantalla de alcance, ejercicio/plan, política/versiones, vigencia, límites, exclusiones, revocación y revisión de evidencia, con confirmación explícita no preseleccionada.
3. Definir primero qué acto humano acreditaría aceptación recurrente, su captura inmutable y mecanismos de invalidación al cambiar políticas, cuenta o destino. `THIS_PROPOSAL_ONLY` no puede reutilizarse.
4. Si se propone un estado o permiso adicional, requerir especificación y aprobación separadas, migración compatible e idempotencia. No asumir `ACTIVE` como existente.
5. Probar propiedad, CSRF/origen/bearer según contrato, respuestas perdidas, concurrencia, revocación y sesiones nuevas. Diseñar lectura privada de auditoría con DTO y presenters.
6. Mantener el ejecutor automático y scheduler fuera de esa interfaz hasta que exista una autorización de dominio y alcance técnico separados. No activar `autoApplyAuthorized` como atajo.

## Apéndice — Inventario de esta etapa

### Archivos preexistentes adaptados

- `backend/prisma/schema.prisma`
- `backend/src/auth/auth.module.ts`
- `backend/src/models/progression/persisted-recommendation.model.ts`
- `backend/src/progression/prisma-progression.repository.ts`
- `backend/src/progression/progression.module.ts`
- `backend/src/progression/progression.repository.ts`
- `backend/src/progression/recommendation-application.persistence.ts`
- `backend/src/progression/recommendation.persistence.ts`
- `backend/src/progression/recommendation.service.ts`
- `backend/test/run-progression-isolated.mjs`
- `frontend/src/components/AuthenticatedLayout.vue`
- `frontend/src/router/index.ts`
- `frontend/src/stores/auth.store.ts`
- `frontend/tests/athlete-views.test.mjs`
- `frontend/tests/exercise-views.test.mjs`
- `frontend/tests/layouts.test.mjs`

### Archivos nuevos

- `backend/prisma/migrations/20261111001000_manual_revalidation_requests/migration.sql`
- `backend/src/controllers/progression/progression.controller.ts`
- `backend/src/domain/progression/application-readiness.policy.ts`
- `backend/src/models/progression/progression-http.model.ts`
- `backend/src/progression/dto/progression.dto.ts`
- `backend/src/progression/progression-http.architecture.spec.ts`
- `backend/src/progression/progression-http.boundary.ts`
- `backend/src/progression/progression-queries.persistence.ts`
- `backend/src/progression/revalidation-request.persistence.ts`
- `backend/src/views/progression/progression.presenter.spec.ts`
- `backend/src/views/progression/progression.presenter.ts`
- `backend/test/progression-http.e2e-spec.ts`
- `backend/test/revalidation-migration.e2e-spec.ts`
- `backend/test/run-progression-browser-isolated.mjs`
- `docs/architecture/evidence/prog-6a/firefox-results.json`
- `docs/architecture/evidence/prog-6a/proposal-desktop.png`
- `docs/architecture/evidence/prog-6a/receipt-mobile.png`
- `docs/architecture/prog-6a-manual-http-ui.md`
- `docs/superpowers/plans/2026-11-11-prog6a.md`
- `frontend/src/assets/progression.css`
- `frontend/src/components/progression/ApplicationReceipt.vue`
- `frontend/src/components/progression/ProgressionEvidence.vue`
- `frontend/src/components/progression/ProgressionForm.vue`
- `frontend/src/components/progression/ProgressionStatus.vue`
- `frontend/src/components/progression/RecommendationApply.vue`
- `frontend/src/components/progression/RecommendationReview.vue`
- `frontend/src/schemas/progression.schema.ts`
- `frontend/src/services/progression.service.ts`
- `frontend/src/stores/progression.store.ts`
- `frontend/src/types/progression.ts`
- `frontend/src/utils/progression-inputs.ts`
- `frontend/src/utils/progression-intents.ts`
- `frontend/src/views/NewProgressionView.vue`
- `frontend/src/views/ProgressionDetailView.vue`
- `frontend/src/views/ProgressionView.vue`
- `frontend/tests/progression-views.test.mjs`
- `frontend/tests/progression.browser.mjs`
- `frontend/tests/progression.http.mjs`
- `frontend/tests/progression.test.mjs`

Las modificaciones anteriores ajenas a este inventario se conservaron. No se eliminó ningún archivo presente en el inventario inicial. Los quince SQL previos y su archivo de bloqueo mantuvieron sus SHA-256.
