# PROG-6B — Gestión humana de solicitudes de consentimiento recurrente

**Fecha:** 2026-11-11. **Resultado:** Fase A implementada y verificada. Fase B bloqueada por ausencia de una transición operativa de aceptación especificada. No se habilitó ejecución automática.

## A. Estado inicial y Git

Se trabajó en `feature`, HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`. Había numerosos cambios y archivos sin seguimiento de etapas anteriores, incluidos PROG-5C-A y PROG-6A. Se conservaron; la comparación de esta etapa utiliza un manifiesto SHA-256 inicial de 449 archivos existentes, además de `git status`, para distinguir trabajo previo del realizado ahora. No hubo commits, push, reset, clean, cambios de rama ni worktrees.

Línea base ejecutada: **640 pruebas backend y 154 frontend aprobadas**. Las cifras previas de PostgreSQL y Firefox se tomaron como referencia hasta repetir sus runners.

Versiones instaladas verificadas: NestJS common 12.1.3, Prisma 7.10.1, TypeScript backend 6.0.3; Vue 3.5.44, Pinia 4.1.0, Vue Router 5.4.0, Axios 1.20.0, Zod 4.6.7 y Vite 8.3.4. No se instalaron dependencias ni se cambiaron manifests o `.env`.

## B. Auditoría de consentimiento

Se revisaron `ProgressionAutomationConsent`, `ProgressionAutomationConsentEvent`, `AutomationConsentService`, políticas de consentimiento/elegibilidad, settings, recomendaciones, revisiones, aplicaciones, guards, presenters, cliente Axios, auth store, router y pantallas de progresión. Se consultaron los informes PROG-5C-A y PROG-6A y sus implementaciones.

La infraestructura real admite únicamente:

- `CREATE`: solicitud `PENDING_CONFIRMATION`, versión inicial y evento.
- `REVISE`: nueva versión pendiente y evento; no sobrescribe la captura anterior.
- `REVOKE`: `REVOKED`, terminal, con evento.

Los contratos conservan `humanAcceptance: NOT_RECORDED`, `operationalAuthorization: NOT_AVAILABLE_IN_PROG_5C_A` y `executionAuthorized: false`. `recurring-consent-acceptance-v1` describe un requisito futuro; no proporciona hoy un comando de aceptación, un desafío operativo ni una transición SQL autorizada. La aprobación individual `THIS_PROPOSAL_ONLY` tampoco acredita permiso recurrente.

## C. Arquitectura MVC y frontend

Recorrido real:

```text
Vue → servicio Axios existente → DTO/AutomationConsentController
    → AutomationConsentService → ProgressionRepository
    → transacción/consultas PostgreSQL → modelos internos
    → AutomationConsentPresenter → Zod → Pinia → vistas/componentes
```

El controlador recibe HTTP, recupera identidad y delega. El servicio existente coordina casos de uso y valida contratos. El repositorio conserva persistencia, propiedad, transacciones y concurrencia. El Modelo representa contratos, capturas y lecturas internas. La Vista selecciona campos públicos explícitamente. No se crearon servicios duplicados ni controladores para ejecutar progresión.

En Vue se conservaron `config`, `layouts`, `schemas`, `types`, `utils`, `components`, `composables`, `router`, `services`, `stores`, `views` y `assets`. El cliente Axios, los layouts y los guards existentes siguen utilizándose. Ninguna carpeta funcional fue vaciada o reemplazada.

## D. Modelo y contratos

Se reutilizan `automation-consent-contract-v1` y `automation-consent-snapshot-v1`: ejercicio, plan opcional, allowlist exacta, política completa, límites, rejilla, configuración efectiva, versiones de motor, destinos/versiones, vigencia y procedencia de solicitud interna.

Se añadieron contratos internos para listado paginado, candidatos, previsualización e inspección de condiciones actuales. La captura persistida sigue siendo la autoridad histórica; `currentSnapshot` es una lectura separada. `conditionChanges` explica cambios de motor, configuración y destinos sin modificar la versión original.

Los presentadores excluyen `athleteId`, actores internos, `requestKey`, hashes de contrato/configuración y propiedades arbitrarias de objetos de persistencia. Se mantienen los identificadores de recursos necesarios para inspección y recuperación. No se devuelven entidades Prisma completas.

## E. API y DTO

Prefijo real: `/api/v1/progression/automation-consents`.

| Método y sufijo             | Operación                                                    | Éxito |
| --------------------------- | ------------------------------------------------------------ | ----- |
| GET `/`                     | Listado propio, filtros de estado y paginación               | 200   |
| GET `/candidates`           | Prescripciones/configuración/referencias propias disponibles | 200   |
| GET `/operations/:intentId` | Recibo de una intención propia                               | 200   |
| POST `/preview`             | Previsualizar contrato con configuración real                | 200   |
| POST `/`                    | Crear solicitud pendiente                                    | 201   |
| GET `/:id`                  | Captura exacta, condiciones actuales y auditoría             | 200   |
| GET `/:id/events`           | Eventos propios con sus capturas                             | 200   |
| POST `/:id/revisions`       | Revisar mediante versión esperada e intención                | 201   |
| POST `/:id/revocations`     | Revocar mediante versión esperada e intención                | 201   |

Los DTO validan objetos anidados, UUID, estados permitidos, paginación, allowlist explícita, cadenas decimales, límites enteros, versión esperada y motivo de revocación. Las políticas existentes realizan la validación semántica completa. La validación global rechaza campos adicionales como estado activo, snapshot o propietario enviados por el cliente.

No existen endpoints de aceptación, actualización arbitraria del estado, ejecución ni aplicación automática. Los errores conservan códigos tipados: autenticación 401, recursos inaccesibles 404, conflicto/versión/solapamiento 409, contrato inválido 422 y ocupación transitoria 503; los fallos inesperados se presentan sin detalles privados.

## F. Autenticación y protección de origen

Se reutilizan `AccessTokenGuard`, `CurrentAuth` y `AuthOriginGuard` en todos los POST, incluido preview. Las lecturas y respuestas son privadas con `Cache-Control: no-store`. Las consultas vuelven a comprobar en PostgreSQL cuenta activa, sesión vigente/no revocada y atleta asociado. No se recibe `athleteId` desde Vue.

Las operaciones de negocio usan bearer y origen conforme a PROG-6A. No se inventó un encabezado CSRF para este recurso ni se alteraron cookies, refresh, CSRF de autenticación o interceptores. Los resultados tardíos de otra cuenta/contexto/generación se descartan en Pinia y formularios.

## G. Configuración de políticas

El formulario permite introducir identificador y versión de política, base de objetivos, cumplimiento, readiness, RPE, conteo mínimo, señales, modo de incremento, rejilla, ventana histórica y referencias de objetivos originales/ajustados requeridas por el contrato actual. Reutiliza los campos y construcción de política de PROG-6A; no incorpora matemática oficial en Vue.

La configuración guardada se muestra con su procedencia y selección efectiva. No se elige una configuración más permisiva ni se rellenan parámetros decisorios con fixtures o valores arbitrarios. Los campos de cohorte ausentes se muestran vacíos; no se fabrican referencias históricas. Preview es informativo, no reserva ni autoriza; la escritura vuelve a validar bajo las barreras existentes.

**Límite real:** el contrato actual requiere configuración compatible y referencias históricas explícitas. Un atleta que carece de ellas no obtiene un consentimiento válido mediante valores inventados. La selección de cohortes futuras para una autorización efectiva sigue siendo una decisión pendiente.

## H. Límites y unidades

Se configuran máximo incremento absoluto, máximo porcentual, carga máxima, KG/LB, rejilla, máximo semanal, inicio de semana y ventana histórica. Los decimales oficiales viajan como cadenas. El formulario conserva sus valores exactos; no usa Number para calcular cargas/incrementos, no redondea condiciones ni cambia unidades automáticamente.

La presentación muestra unidad junto a las cargas y todos los límites/políticas. La declaración `EXTERNAL_TOTAL` pertenece al contrato solicitado; no reinterpreta cargas históricas ni modifica su registro.

## I. Selección de destinos

El selector conserva `EXACT_PRESCRIPTION_ALLOWLIST`; exige elegir destinos explícitos. Un plan nulo significa alcance determinado por esos IDs, no todos los planes. No se preselecciona el primer ejercicio o destino ni se añaden prescripciones futuras o duplicadas a una autorización anterior.

Candidatos y construcción de captura comparten las restricciones estructurales existentes: propiedad, ejercicio accesible/activo, plan DRAFT, jerarquía día/semana/plan coherente, día no retirado, carga positiva/unidad compatible y ausencia de referencias históricas que impidan editar. La escritura vuelve a comprobar versiones y compatibilidad. Los candidatos no acreditan por sí solos una fecha futura aplicable ni autorización de ejecución.

La consulta está paginada; `hasMore` permite continuar incluso si una página cruda queda vacía tras filtrar elegibilidad. Las referencias históricas se acotan y anuncian truncamiento; no se sustituyen silenciosamente por una cohorte diferente.

## J. Vigencia temporal

Se mantiene `[startsAt, endsAt)`. El usuario introduce instantes ISO con offset y zona IANA explícita; Vue no interpreta fechas civiles deportivas usando la zona del navegador. La normalización UTC del servidor preserva los instantes; la zona declarada queda en el contrato.

Se conserva `SET LOCAL TIME ZONE 'UTC'` en las transacciones pertinentes, sin modificar la configuración global de PostgreSQL. Las condiciones originales no se recalculan retrospectivamente.

## K. Estados

| Dimensión               | Estado real de esta etapa                                |
| ----------------------- | -------------------------------------------------------- |
| Gestión de solicitudes  | `PENDING_CONFIRMATION` o `REVOKED`, versionados          |
| Vigencia efectiva       | Lectura separada de período/estado; no crea autorización |
| Aceptación recurrente   | `NOT_RECORDED`, no disponible                            |
| Elegibilidad matemática | Evaluación independiente; no equivale a permiso          |
| Autorización operativa  | No disponible                                            |
| Ejecución automática    | Deshabilitada, `executionAuthorized: false`              |

No se añadió `ACTIVE` a TypeScript, Prisma o SQL. No se activaron solicitudes antiguas por inferencia.

## L. Aceptación humana

**No implementada como aceptación recurrente efectiva.** La Fase B se bloqueó deliberadamente conforme al alcance condicional de PROG-6B. Faltan definición aprobada del comando/desafío, estado resultante, evento y prueba de condiciones presentadas, invalidación por cambios de política/motor/configuración/destinos, reglas posteriores a aceptación y principal operativo futuro. Requiere una migración y protocolo transaccional propios.

La interfaz lo explica y el backend devuelve `acceptance.available: false` con motivo `RECURRENT_ACCEPTANCE_TRANSITION_UNDEFINED`. Las casillas inicialmente desmarcadas confirman crear o revisar **una solicitud pendiente**; no afirman comprensión humana ni aceptación recurrente, y no reutilizan `THIS_PROPOSAL_ONLY`.

Cambiar formulario/versión invalida el preview y la confirmación anterior; cambiar cuenta/contexto desmonta la instancia y descarta resultados tardíos. No se ofrece un desafío ficticio ni un botón de aceptación que carezca de transición persistente.

## M. Revisión y revocación

La revisión se limita a solicitudes pendientes y crea versión/evento nuevos mediante intención y versión esperada. Se muestran contrato original y configuración vigente por separado. La casilla de confirmación comienza desmarcada para cada preview.

La revocación requiere confirmación explícita, sesión válida, propiedad, `expectedVersion`, intención estable y motivo `OWNER_REQUEST`. Es terminal: no elimina agregado/eventos y un reintento antiguo no revive la solicitud. Un recibo CREATE antiguo se presenta como recibo histórico; el estado visible se obtiene de la inspección vigente.

## N. Auditoría

El detalle presenta eventos CREATE/REVISE/REVOKE, versiones, fechas, motivos, intención y captura pública de cada evento. Se preservaron los mecanismos SQL de integridad e inmutabilidad existentes. Los tests comparan capturas anteriores después de revisar y revocar, y verifican que el historial de entrenamiento permanece intacto.

## O. Idempotencia y respuestas perdidas

Se reutiliza la intención única por atleta del protocolo existente; no se redefine su identidad semántica. Doble clic se bloquea en UI y la unicidad/transacción del servidor sigue siendo la autoridad.

El cuerpo exacto permanece únicamente en memoria. `sessionStorage` conserva un registro acotado de identificadores: cuenta, contexto real de sesión, intención, consentimiento si se conoce, acción y fecha; TTL de 30 minutos. No almacena snapshot, política, credenciales ni tokens. Se elimina/ignora ante cambio de cuenta/contexto, caducidad o datos inválidos.

Una respuesta perdida mantiene el resultado incierto. Se consulta `/operations/:intentId` y después el estado actual; no se crea automáticamente otra solicitud/revocación. Tras recargar no se reconstruye ni reenvía un contrato privado: primero se consulta el recibo y el usuario debe reconfirmar si no pudo confirmarse.

**Defecto corregido por revisión:** una escritura confirmada cuyo inspect posterior falla no debe perder su recibo/intención por tratar ese error de lectura como rechazo de escritura. Se conserva el recibo antes de inspeccionar. Se añadió la misma protección mínima al store PROG-6A y una regresión específica.

## P. Concurrencia

Se conservaron el orden de locks, comprobaciones de sesión/propiedad, versión esperada, unicidad, detección de solapamientos, reintentos y transacciones de PROG-5C-A. No se añadieron transacciones de escritura nuevas al protocolo ni se reescribieron consultas por estilo. Las nuevas lecturas usan transacciones coherentes de solo lectura y UTC local.

PostgreSQL real verificó creaciones/revocaciones idénticas concurrentes, revisiones competidoras, reutilización de intención, solapamiento, estado terminal y rollback ante fallo de inserción del evento. Vue presenta conflictos sin combinar límites o elegir la autorización más permisiva.

## Q. PostgreSQL y migraciones

**No se creó ninguna migración.** Se conservaron las 16 migraciones existentes, su SQL y `schema.prisma` byte a byte respecto del inicio de esta tarea. Las migraciones pendientes de desarrollo continúan sin aplicar.

Se inspeccionaron y reutilizaron runners aislados; se amplió el patrón `--api` para incluir la nueva suite HTTP. Cada runner crea su propio clúster temporal, comprueba host/puerto/base/URL efectiva y `data_directory`, aplica las migraciones existentes, verifica estado/deriva y elimina únicamente su runtime. No usa seeds de desarrollo.

Ejemplos de ejecuciones verificadas:

| Runner                    | Destino temporal observado                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Progresión                | `/tmp/pulso-prog1b-qK2sOV/data`, `127.0.0.1:42181/pulso_prog1b_test`                          |
| Firefox PROG-6B           | `/tmp/pulso-prog6b-browser-*`, base `pulso_prog6b_browser_test` y puerto aleatorio comprobado |
| Regresión Firefox PROG-6A | `/tmp/pulso-prog6a-browser-5Up9hr/data`, `127.0.0.1:38929/pulso_prog6a_browser_test`          |

Los runners de sesiones y planificación también comprobaron sus clústeres propios. Todos finalizaron con limpieza; la comprobación de deriva no detectó diferencias. No hubo conexiones de escritura a `proyecto_pow_dev` ni cambios globales de PostgreSQL.

## R. Frontend

Rutas protegidas integradas con el router/layout actuales:

- `/app/progression/automation`: lista, estado, vigencia, última revisión y acceso al detalle.
- `/app/progression/automation/new`: alcance, política, límites, destinos, vigencia, preview y confirmación de solicitud pendiente.
- `/app/progression/automation/:id`: captura/versiones, diferencias de configuración, eventos, revisión y revocación.

`automation-consent.service.ts` usa la única instancia Axios existente. Zod valida respuestas y entradas; los tipos se infieren de esos esquemas. Pinia gestiona operaciones/recuperación y descarta resultados de contextos anteriores. Helpers puros construyen campos/formularios y manejan identificadores temporales.

Se reutilizaron selector de ejercicios, estilos de progresión y navegación. No hubo rediseño ni nuevo encabezado. Se verificaron renderizado SFC real mediante Vite, formularios, estados terminales, precisión, Router y condiciones. Firefox verificó escritorio, móvil de 500×850, ausencia de desbordamiento y foco mediante teclado. Esto no constituye una auditoría exhaustiva de accesibilidad o de todos los dispositivos.

## S. Pruebas y Firefox

Desde `backend/`, salvo indicación:

| Comando                                                 | Resultado final                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm test -- --runInBand`                               | **646 pruebas / 58 suites**, aprobadas                            |
| `node test/run-progression-isolated.mjs --api`          | **359 pruebas / 14 suites**, PostgreSQL real, aprobadas           |
| `node test/run-workouts-mvc-isolated.mjs`               | **27 pruebas / 3 suites**, PostgreSQL real, aprobadas             |
| `node test/run-planning-mvc-isolated.mjs`               | **26 pruebas / 4 suites**, PostgreSQL real, aprobadas             |
| `npm test`, desde `frontend/`                           | **172 pruebas**, aprobadas                                        |
| `node test/run-automation-consent-browser-isolated.mjs` | **16 comprobaciones Firefox**, aprobadas                          |
| `node test/run-progression-browser-isolated.mjs`        | **19 regresiones Firefox PROG-6A**, aprobadas                     |
| `npm run build`, backend                                | Prisma generate local + compilación, aprobado                     |
| `./node_modules/.bin/tsc --noEmit`                      | Aprobado                                                          |
| `npm run lint`                                          | Oxlint type-aware, sin errores ni advertencias en ejecución final |
| `npx prisma validate`                                   | Aprobado; no escribe en PostgreSQL                                |
| `npm run build`, frontend                               | vue-tsc + Vite, aprobado                                          |
| Prettier acotado                                        | Backend y archivos frontend de etapa aprobados con su estilo      |
| `git diff --check`                                      | Aprobado                                                          |

**Total automatizado distinto: 1.230** = 646 + 359 + 27 + 26 + 172. **Navegador: 35 comprobaciones distintas** = 16 nuevas + 19 regresiones. No se suman ejecuciones repetidas, RED, reintentos o subprocessos Axios ya incluidos en las suites.

Las 18 nuevas pruebas HTTP/PostgreSQL cubren contratos, cliente Axios/Zod real, autenticación/origen, sesión revocada/expirada, cuenta suspendida, propiedad, candidatos/planes/ejercicios privados, configuración/fechas/unidades/límites, estado inyectado, auditoría, revisión, revocación, conflictos concurrentes, reintentos y rollback. Las suites existentes de migración y consentimiento se volvieron a ejecutar dentro de las 359.

Se conservaron las aserciones anteriores. Hubo RED deliberados de presenter/modelo y reproducción del defecto de carga de planes: dos peticiones de naturaleza distinta compartían un contador y podían descartar una respuesta válida. Se separó el control de vida del componente de la secuencia de candidatos y se añadió regresión.

La primera repetición Firefox PROG-6A falló en P08 porque esperaba que mostrar el recibo implicase que ya terminó la inspección. Tras publicar el recibo temprano para proteger respuestas de lectura perdidas, esas etapas son separadas. Se añadió espera de finalización de inspección; se conservaron las aserciones `APPLIED`, carga exacta y única aplicación. La repetición final aprobó 19/19. El fallo intermedio no se cuenta como aprobado ni se oculta.

No hay script de lint frontend; se ejecutaron los scripts reales disponibles. Se preservó el formato anterior de los consumidores `AuthenticatedLayout.vue` y `router/index.ts` para evitar reformateos amplios: no se declara un formateo integral del frontend. El resto de archivos frontend de etapa pasó Prettier con `--no-semi --single-quote`; backend y documentación usan el formato del proyecto.

Avisos observados: las suites existentes emiten advertencias experimentales de Node y deprecación del uso concurrente de `pg.Client.query`; no provocaron fallos y no se modificaron módulos externos para silenciarlas.

Evidencias conservadas:

- [Inventario de cambios respecto del inicio](evidence/prog-6b/change-inventory.json).
- [16 resultados Firefox PROG-6B](evidence/prog-6b/firefox-results.json).
- [19 resultados de regresión Firefox PROG-6A](evidence/prog-6b/firefox-prog6a-regression-results.json).
- [Solicitud en escritorio](evidence/prog-6b/request-desktop.png).
- [Revocación en móvil](evidence/prog-6b/revoked-mobile.png).

Los logs completos de esta sesión están bajo `/tmp/pulso-prog6b-*.log`; son evidencia temporal, no un requisito de ejecución futura. Los runners y tests quedan en el repositorio para reproducirlos. La regresión Firefox PROG-6A aplica una recomendación manual **solo a su fixture aislado**; el recorrido PROG-6B comprueba que no crea aplicaciones ni cambia planes/sesiones.

## T. Seguridad y revisión independiente

Se realizó revisión independiente focalizada de contrato, propiedad, sesión, origen, captura, límites, precisión, concurrencia, idempotencia, recuperación y Vue, incluyendo la integración PROG-6A. Se corrigieron y verificaron:

1. Pérdida del recibo confirmado ante fallo posterior de inspección, también en PROG-6A.
2. Key de formulario basada en una generación no reactiva: ahora depende además de usuario/estado y se comprueba contexto al resolver async.
3. Referencias históricas parciales que podían romper el formulario: se dejan vacías y pendientes de entrada explícita.
4. Contador compartido de peticiones que descartaba el listado de planes al cambiar filtros de candidatos.

Las regresiones prueban aislamiento y no exposición de datos. Los tests HTTP confirman 401/404 sin acceso a recursos ajenos y rechazan origen no autorizado. La comparación de históricos en Firefox comprueba planes/semanas/días/prescripciones, sesiones/ejercicios/series, estimaciones, actividades, recomendaciones, revisiones y aplicaciones.

**No se ejecutó un nuevo informe canónico de Codex Security en esta etapa.** La revisión independiente, los tests de seguridad y la validación Firefox no sustituyen ese escaneo ni certifican producción. No se cambiaron permisos ni configuraciones de Codex.

## U. Archivos y herramientas

El inventario siguiente distingue archivos de esta etapa frente al manifiesto inicial, aunque algunos ya eran untracked en Git por tareas anteriores.

### Archivos existentes modificados

| Archivo                                                         | Justificación                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `backend/src/progression/automation-consent.persistence.ts`     | Comparte builder, captura vigente y predicados estructurales; conserva protocolo de escritura. |
| `backend/src/progression/prisma-progression.repository.ts`      | Delegaciones a consultas privadas de consentimiento.                                           |
| `backend/src/progression/automation-consent.service.ts`         | Casos de uso explícitos de lista, candidatos, preview y recibo.                                |
| `backend/src/progression/progression-http.boundary.ts`          | Mapeo seguro de errores de consentimiento.                                                     |
| `backend/src/progression/progression.repository.ts`             | Contratos de lectura adicionales.                                                              |
| `backend/src/progression/progression-http.architecture.spec.ts` | Registro esperado de los dos controladores de progresión.                                      |
| `backend/src/progression/progression.module.ts`                 | Registro único del controlador y presenter.                                                    |
| `backend/src/models/progression/automation-consent.model.ts`    | Modelos internos de consulta e inspección actual.                                              |
| `backend/src/domain/progression/automation-consent.policy.ts`   | Comparación pura de condiciones capturadas y vigentes.                                         |
| `backend/test/run-progression-isolated.mjs`                     | Incluye la suite HTTP de consentimiento sin cambiar aislamiento.                               |
| `frontend/src/components/AuthenticatedLayout.vue`               | Reconoce las rutas de consentimiento en la navegación existente.                               |
| `frontend/src/utils/progression-inputs.ts`                      | Tipo del campo de configuración realmente utilizado; no cambia cálculo.                        |
| `frontend/src/router/index.ts`                                  | Tres rutas protegidas con los guards actuales.                                                 |
| `frontend/src/views/ProgressionView.vue`                        | Acceso a gestión recurrente desde progresión.                                                  |
| `frontend/src/stores/progression.store.ts`                      | Conserva recibo e intención ante fallo de lectura posterior a escritura confirmada.            |
| `frontend/tests/progression.test.mjs`                           | Regresión de escritura confirmada e inspección fallida.                                        |
| `frontend/tests/progression.browser.mjs`                        | Espera inspección tras recibo temprano; conserva aserciones funcionales.                       |

### Archivos creados

- `backend/src/controllers/progression/automation-consent.controller.ts`
- `backend/src/progression/automation-consent-http.architecture.spec.ts`
- `backend/src/progression/automation-consent-queries.persistence.ts`
- `backend/src/progression/dto/automation-consent.dto.ts`
- `backend/src/views/progression/automation-consent.presenter.spec.ts`
- `backend/src/views/progression/automation-consent.presenter.ts`
- `backend/test/automation-consent-http.e2e-spec.ts`
- `backend/test/run-automation-consent-browser-isolated.mjs`
- `docs/superpowers/plans/2026-11-11-prog6b.md`
- `frontend/src/components/automation/ConsentConditions.vue`
- `frontend/src/components/automation/ConsentForm.vue`
- `frontend/src/components/automation/ConsentStatus.vue`
- `frontend/src/schemas/automation-consent.schema.ts`
- `frontend/src/services/automation-consent.service.ts`
- `frontend/src/stores/automation-consent.store.ts`
- `frontend/src/types/automation-consent.ts`
- `frontend/src/utils/consent-form.ts`
- `frontend/src/utils/consent-intents.ts`
- `frontend/src/views/AutomationConsentDetailView.vue`
- `frontend/src/views/AutomationConsentsView.vue`
- `frontend/src/views/NewAutomationConsentView.vue`
- `frontend/tests/automation-consent-views.test.mjs`
- `frontend/tests/automation-consent.browser.mjs`
- `frontend/tests/automation-consent.fixtures.mjs`
- `frontend/tests/automation-consent.http.mjs`
- `frontend/tests/automation-consent.test.mjs`
- `docs/architecture/prog-6b-consent-management.md`: informe y decisiones.
- `docs/architecture/evidence/prog-6b/`: dos resultados JSON, un inventario de cambios y dos capturas de fixtures aislados.

Los nuevos archivos backend separan controlador, DTO, consultas y presenter; sus pruebas demuestran esa separación y los contratos. Los nuevos archivos frontend separan esquemas/tipos, HTTP, estado, helpers, componentes y páginas. Los runners nuevos verifican la integración real y pérdidas de respuesta mediante un proxy de fallos **solo del entorno de pruebas**, sin endpoint de producción.

Herramientas efectivamente utilizadas:

- Skills locales `pulso-architecture-review` y referencia MVC, `pulso-domain-integrity`, `pulso-integration-testing`, `pulso-prisma-migrations`, `pulso-frontend-ux`: alcance, propiedad, integridad, contratos, migraciones y conservación UX.
- Guías Vue, Pinia, Router y testing; referencias locales de Design System/UI UX Pro Max pertinentes para reutilizar componentes y estilos existentes, sin rediseño.
- Superpowers: diseño/plan, TDD, diagnóstico sistemático, revisión independiente y verificación antes de declarar resultados.
- Herramientas de terminal, Jest, Node test runner, Vite/vue-tsc, TypeScript, Oxlint, Prettier, Prisma, PostgreSQL temporal, Firefox y Geckodriver, más inspección de capturas.

No se usaron Graphify —el grafo no justificaba indexación— ni generadores visuales. No había herramienta Browser del plugin disponible; se reutilizó Firefox/Geckodriver ya instalado. No se instalaron herramientas, no se modificaron skills/AGENTS ni configuraciones personales.

## V. Limitaciones y estado final

| Capacidad                         | Clasificación                  | Evidencia o límite                                                        |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Modelo de consentimiento          | Verificado                     | Contratos reales, snapshots y compatibilidad anterior                     |
| Vista MVC                         | Verificado                     | Allowlist de respuesta y tests de privacidad                              |
| Controlador MVC                   | Verificado                     | Registro/guards y HTTP real                                               |
| Gestión de solicitudes pendientes | Verificada                     | Crear/listar/inspeccionar/revisar/auditar/recuperar                       |
| Revocación                        | Verificada                     | Terminal, auditable, idempotente y concurrente                            |
| Aceptación recurrente efectiva    | Bloqueada                      | Falta especificación operativa explícita; no hay transición ACTIVE/ACCEPT |
| Elegibilidad matemática           | Conservada y separada          | No acredita autorización ni ejecución                                     |
| Autorización operativa            | No disponible                  | Contrato previo conservado                                                |
| Ejecución automática              | No implementada/deshabilitada  | Sin scheduler, worker ni aplicaciones recurrentes                         |
| PostgreSQL                        | Verificado en entorno aislado  | 16 migraciones existentes, deriva cero y suites reales                    |
| Navegador                         | Verificado en alcance descrito | 16 casos nuevos y 19 regresiones en Firefox                               |
| Producción                        | No certificada                 | Pruebas locales/aisladas y revisión acotada                               |

Pendientes bloqueantes **para aceptación**, no para gestión pendiente: definir y aprobar el protocolo de aceptación/versionado/invalidación y su migración. No se deben convertir solicitudes previas en activas ni copiar aprobación manual.

Pendientes importantes: diseñar cohortes/evidencia de políticas futuras en lugar de reutilizar fixtures o inventar referencias; definir principal operativo independiente y tratamiento de revisión/revocación durante una aplicación; realizar nueva revisión canónica de seguridad si se requiere cerrar ese control.

Límites no bloqueantes para Fase A: candidatos y referencias son paginados/acotados; accesibilidad comprobada de forma básica; las advertencias Node/pg requieren seguimiento separado. Se preservaron los datos de desarrollo y las migraciones pendientes. No se modificaron autenticación, cargas, entrenamientos ni algoritmos de progresión. No se declara PROG-6B aceptación efectiva completada ni se presenta ejecución automática como disponible.

## W. Diseño de PROG-5C-B — sin implementación

1. **Precondición:** aprobar formalmente la aceptación humana recurrente. Especificar desafío, huella y condiciones exactas presentadas, identidad/sesión, intención, vigencia, evento inmutable, estado operativo y transiciones. Añadir migración compatible; todo consentimiento histórico pendiente conserva su estado. La revisión de términos invalida desafíos anteriores.
2. **Principal operativo:** definir un contrato de autorización específico para el ejecutor; no fabricar sesiones humanas, reutilizar revisiones `THIS_PROPOSAL_ONLY` ni ejecutar el caso manual como sustituto. La identidad del atleta, alcance y atribución deben mantenerse verificables.
3. **Servicio de aplicación separado de cálculo:** resolver recomendación y consentimiento aceptado; comprobar versión, vigencia `[inicio,fin)`, revocación, política/motor/configuración y destinos exactos. La elegibilidad matemática es una entrada, no una autorización.
4. **Transacción y concurrencia:** comprobar dentro de la misma operación estado/versión del consentimiento, estado de recomendación, propiedad, DRAFT, referencias históricas, versiones de prescripción/plan, unidad, carga actual y límites. Mantener orden de locks compatible, CAS y contador semanal de aplicaciones; una revocación concurrente debe tener un resultado definido y auditable.
5. **Identidad de operación:** clave determinista que vincule consentimiento/versión, recomendación/evidencia, destino/versiones y ciclo. Unicidad PostgreSQL; reintentos retornan recibo, conflictos semánticos no sobrescriben la evidencia. No sumar permisos solapados ni elegir el más permisivo.
6. **Escritura autorizada:** usar el mecanismo de actualización de prescripción que preserve historial, registrar aplicación/evento/recibo atómicamente y mantener objetivos/resultados de sesiones intactos. Las fallas revierten toda la operación; no reintentar silenciosamente con otro consentimiento o destino.
7. **Pruebas previas a cualquier scheduling:** escenarios deterministas de autorización, caducidad, nueva versión, cambio de política, límites, doble intento, revocación concurrente, rollback, unidades, auditoría y compatibilidad histórica; PostgreSQL aislado y pruebas HTTP/UI cuando corresponda. Scheduler/worker requiere alcance posterior explícito.

Este diseño no habilita el ejecutor: `executionAuthorized: false` sigue siendo la respuesta de las rutas PROG-6B actuales.
