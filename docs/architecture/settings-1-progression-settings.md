# SETTINGS-1 — Gestión HTTP y Vue de configuraciones de progresión

Fecha de verificación: 12 de noviembre de 2026 (America/Bogota). Alcance: configuración persistida, resolución contextual y edición humana; sin nuevas políticas matemáticas, automatización ni borrado.

## A. Estado inicial y Git

Rama `feature`, HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`. El árbol ya contenía cambios tracked y numerosos archivos untracked de etapas anteriores. Se conservaron; no se hicieron commits, push, reset, clean, rebase, cambios de rama ni worktrees. El diff contra HEAD incluye trabajo anterior y no representa exclusivamente SETTINGS-1.

En la auditoría inicial de esta tarea se ejecutaron backend (655 pruebas) y frontend (178 pruebas), ambos aprobados. Los valores anteriores de PostgreSQL y Firefox se tomaron inicialmente como referencia; posteriormente se repitieron sus runners completos. La verificación final figura en R–T. No se modificaron `.env`, autenticación, fórmulas, datos de desarrollo, migraciones anteriores ni registros históricos.

## B. Auditoría de ProgressionSetting

Modelo existente, conservado:

| Campo                          | Tipo / significado                                    |
| ------------------------------ | ----------------------------------------------------- |
| `id`, `athleteId`              | UUID, propiedad del atleta                            |
| `exerciseId`, `trainingPlanId` | UUID nullable, ámbito; un plan requiere ejercicio     |
| `minSuccessfulSessions`        | Int, default técnico Prisma 3                         |
| `targetRpeMin`, `targetRpeMax` | Decimal(3,1), intervalo RPE                           |
| `incrementPercent`             | Decimal(6,3), nullable                                |
| `incrementAbsolute`            | Decimal(8,3), nullable                                |
| `maxIncrementPercent`          | Decimal(6,3)                                          |
| `maxLoad`                      | Decimal(8,3), nullable                                |
| `autoApplyAuthorized`          | Boolean, default técnico false; preferencia histórica |
| `createdAt`, `updatedAt`       | Timestamptz(6); updatedAt es dependencia semántica    |

FKs a atleta y ejercicio; FK compuesta `(trainingPlanId, athleteId)` al plan propio, con `RESTRICT`. Los índices únicos parciales SQL preexistentes impiden duplicar el ámbito general, ejercicio o ejercicio/plan. Se preservan los checks, índices y precisiones originales. No existe columna de unidad en este modelo ni una política aprobada de eliminación/desactivación.

Se inspeccionaron `resolveEffectiveSettings`, PROG-4A/4B, `recommendationDependencyKeys`, `settingsBindingKey`, fuentes de consentimiento y desafíos de aceptación. La presencia de una fila no basta para generar una recomendación: siguen siendo necesarios política explícita, unidad/rejilla, selección de evidencia y demás requisitos del motor.

## C. Arquitectura MVC

Recorrido real: `ProgressionSettingsController → ProgressionSettingsService → ProgressionRepository / PrismaProgressionRepository → persistence → políticas existentes`, con `ProgressionSettingsPresenter` para JSON público. Se reutiliza el módulo y cliente Prisma actuales.

| Capa        | Estado del alcance | Evidencia                                                                     |
| ----------- | ------------------ | ----------------------------------------------------------------------------- |
| Modelo      | Verificado         | Contratos internos, política de parámetros, resolución existente y PostgreSQL |
| Vista       | Verificado         | Presenter explícito, HTTP real y parseo Zod/Axios                             |
| Controlador | Verificado         | Registro único, DI, guards, DTO, pruebas arquitectónicas y HTTP               |

No hay Prisma en el controller, persistencia en el presenter ni cálculos oficiales en Vue. Esta clasificación corresponde a SETTINGS-1, no es certificación global ni productiva.

## D. Precedencia

Se reutiliza sin modificar `resolveEffectiveSettings`: **EXERCISE_PLAN > EXERCISE > ATHLETE**, seleccionando una fila completa. No se mezclan parámetros. Una fila específica incompleta continúa sombreando la general; no se introduce fallback para ocultar sus carencias. Se verificaron los tres ámbitos y el legado incompleto tanto en PostgreSQL como en Firefox.

## E. Configuración efectiva

La consulta entrega ejercicio/plan solicitados, fila seleccionada o null, ámbito, revisión opaca, fecha, parámetros exactos, procedencia por parámetro, estado del resolver y motivos estables. Se separan `settingReasons` de `externalRequirements`. La interfaz distingue ausencia de fila, ámbito general/específico, parámetros incompletos e incompatibilidades de política.

El contexto comprueba ejercicio visible/activo, plan propio y relación efectiva plan–ejercicio. No selecciona el primer ejercicio ni interpreta un plan null como todos los planes. La lectura de una fila histórica no inventa unidad, procedencia de entrada ni aprobación científica.

## F. Validaciones

Creación y sustitución requieren los siete parámetros completos; los opcionales usan null explícito. No hay PATCH parcial. La política de entrada verifica forma exacta, UUID, entero de sesiones entre 1 y el límite Int PostgreSQL, RPE 0–10 con mínimo ≤ máximo, signos, escala/rango Decimal y combinaciones interpretables por el motor existente.

Los incrementos no nulos deben ser positivos, debe existir al menos uno, el porcentual no puede exceder su límite y la carga máxima no nula debe ser positiva. Un límite porcentual cero sigue siendo compatible con incremento absoluto. Se permite guardar ambos incrementos, pero la política explícita debe seleccionar el modo: no se decide por el atleta. Se rechaza precisión no representable; no se redondea para hacer válido un valor.

La compatibilidad contextual reutiliza el resolver y sus validaciones de RPE, mínimo, modo, unidad, rejilla y política. Los DTO validan transporte, no implementan fórmulas.

## G. Defaults y procedencia

Los formularios nuevos abren vacíos, sin ámbito ni ejercicio elegidos y sin valores de entrenamiento. Se informa el default técnico 3, pero el usuario debe introducirlo explícitamente si lo desea. Los decimales de edición proceden de la fila persistida, no de ejemplos de prueba. Cada parámetro indica el ID de la fila de origen.

`originalEntryMethod: NOT_DETERMINED_BY_THIS_READ` evita afirmar que un valor antiguo vino de una declaración humana o de un default cuando no puede acreditarse. Los recibos nuevos sí registran actor, sesión e intención internamente. No se convierte esa auditoría en consentimiento.

## H. API y DTO

Prefijo global existente `/api/v1`; recurso `/progression/settings`:

| Método | Ruta relativa           | Resultado                                                 |
| ------ | ----------------------- | --------------------------------------------------------- |
| GET    | `/`                     | Listado propio paginado                                   |
| GET    | `/:id`                  | Fila propia, parámetros y revisión                        |
| POST   | `/effective`            | Resolución del contexto y política opcional, HTTP 200     |
| POST   | `/`                     | Crear ámbito completo, HTTP 201                           |
| POST   | `/:id/impact`           | Inspección previa a sustitución, HTTP 200                 |
| PUT    | `/:id`                  | Sustitución completa con revisión esperada y confirmación |
| GET    | `/operations/:intentId` | Recibo de la intención propia                             |

Errores tipados: `INVALID_SETTING` 422, conflictos de ámbito/revisión/intención 409, fuente ajena/no disponible 404, sesión no válida 401, origen no autorizado 403; DTO inválido 400. No hay DELETE, actualización genérica ni campo writable de autorización. Las respuestas públicas seleccionan campos y usan `Cache-Control: no-store`.

## I. Seguridad

Se conservan `AccessTokenGuard`, `AuthOriginGuard`, bearer, identidad autenticada y autenticación existente. Cada operación verifica en PostgreSQL cuenta activa, sesión no revocada y no vencida, atleta y propiedad. No se acepta un athleteId de Vue. Los POST/PUT reutilizan protección de origen; no se inventan encabezados CSRF ni se cambian cookies/interceptores.

El presenter excluye atleta interno, actor, sesión, requestKey, tokens y entidades Prisma completas. La revisión pública es un control de concurrencia necesario, no una credencial. Cambiar cuenta o generación de sesión limpia estados privados y descarta respuestas tardías; refresh legítimo conserva el contexto según AUTH-HARDEN-1.

## J. Concurrencia

Lecturas coherentes con transacción de solo lectura Repeatable Read y UTC local. Cada fila y su revisión salen del mismo SELECT SQL, evitando devolver parámetros de una versión y una revisión posterior.

Escrituras READ COMMITTED, UTC local, fences persistidos compatibles con los flujos existentes: usuario/sesión, atleta, ejercicio, setting y plan, con NOWAIT y reintentos acotados. Se revalida la sesión después de los locks. Se verifica contexto, alcance y revisión bajo lock antes del UPDATE.

CAS utiliza SHA-256 versionado de la fila SQL completa, incluidos microsegundos reales de updatedAt. No se añadió una revisión al setting porque cambiaría dependencias SQL de consentimiento. El UPDATE vuelve a comprobar la huella y avanza updatedAt al menos 1 ms, incluso en una sustitución sin cambios de parámetros. Las restricciones únicas PostgreSQL siguen siendo la autoridad para ámbitos. No hay locks Node ni aislamiento nuevo en PROG-5B.

Pruebas: dos ediciones, creaciones simultáneas idénticas/diferentes, timestamp con microsegundos que JS no distingue, fences durante revocación, desafío anterior a un cambio de configuración, rollback y reintento obsoleto.

## K. Idempotencia

`ProgressionSettingMutation` conserva intención estable, comando normalizado, revisión anterior/posterior, resultado y resolución histórica, actor/sesión y fecha del servidor. UNIQUE(atleta, intención), FKs y trigger de inmutabilidad. Un reintento idéntico devuelve el recibo original; contenido distinto con la misma intención produce conflicto. No cambia nuevamente la fila ni sobrescribe una edición posterior.

Vue guarda únicamente identificadores acotados a cuenta/contexto, acción y fecha, TTL 30 minutos. No guarda configuraciones privadas, políticas, revisión esperada ni credenciales en sessionStorage. El cuerpo para reintento exacto solo permanece en memoria. Tras recargar se consulta el resultado; no se reconstruye ni reenvía un comando privado automáticamente.

El recibo confirmado se conserva antes de leer la fila vigente. Si esa lectura falla se indica incertidumbre de lectura, no rechazo de una escritura confirmada. La resolución del recibo es histórica: la interfaz consulta la actual o exige una consulta contextual explícita. Se reprodujeron y corrigieron dos defectos de este código nuevo, con regresiones que ahora exigen ambas garantías.

## L. Impacto en recomendaciones

No se reescriben snapshots, evidence, reviews, applications ni estados. La inspección identifica referencias modernas a la fila seleccionada; las dependencias originales continúan revalidándose con sus claves reales. updatedAt puede volver obsoleta una recomendación aun sin cambios decisorios. No se marca indiscriminadamente EXPIRED ni se recalculan propuestas antiguas.

La inspección informa cobertura (hasta 200 recomendaciones y 200 consentimientos); una respuesta TRUNCATED no representa impacto exhaustivo. El listado/resolver tiene un límite técnico explícito de 1.000 filas por atleta, con error de cobertura al superarlo. Ninguno es un umbral de entrenamiento.

## M. Impacto en consentimientos

Se utiliza `settingsBindingKey` sobre el contrato original del motor, excluyendo metadata añadida de presentación. Este detalle tiene regresión: revisión, nombres y createdAt no deben contaminar las huellas de consentimiento. El comparador original distingue cambios decisorios de updatedAt/autoApplyAuthorized.

Una edición de fila sombreada puede dejar igual la compatibilidad del consentimiento y volver obsoleto un desafío, porque este captura también las filas aplicables. Se muestra esa diferencia. No se actualizan capturas aceptadas, destinos, límites, versiones, eventos ni aceptaciones. `ACCEPTED_INACTIVE` sigue siendo aceptación registrada sin ejecución; todas las respuestas nuevas mantienen `executionAuthorized:false`.

## N. Modelo y persistencia

Se añadió únicamente el modelo de recibos `ProgressionSettingMutation` y sus relaciones inversas. No se añadieron campos, unidades ni estados a ProgressionSetting. Nueva migración18: `20261112000000_progression_setting_mutations`, con tabla, FKs RESTRICT, unicidad, función de revisión y trigger que comprueba correspondencia con la fila propia y sesión activa, exige el protocolo transaccional e impide UPDATE/DELETE de recibos.

No hay backfills ni conversión de legado. Desde el esquema de 17 migraciones se insertaron fixtures representativos (incluido mínimo por default, nulos, cero y preferencia histórica), se aplicó18 y se compararon filas, índices y relaciones; los recibos iniciales permanecen vacíos. No se atribuye consentimiento al pasado.

## O. Frontend

Rutas protegidas `/app/progression/settings`, `/new`, `/:id`. Lista con ámbito, nombre, parámetros, fecha y estado contextual; inspector efectivo; formulario nuevo/edición; impacto y confirmación desmarcada; recuperación de resultados. Se reutilizan ExercisePicker, servicios de planes, estilos, layout, router y guard existentes.

Arquitectura complementaria conservada: config proporciona la configuración del Axios existente, layouts sigue envolviendo las páginas, schemas valida los contratos, types deriva Zod, utils concentra helpers puros. Components, composables, router, services, stores, views y assets conservan sus funciones; no se vaciaron carpetas ni se creó otro cliente HTTP.

Los decimales se transportan como strings, sin cálculos oficiales ni conversión KG/LB. La unidad de carga del setting debe proceder de la política explícita y ser compatible con su rejilla. autoApplyAuthorized aparece únicamente como información histórica de solo lectura.

## P. Integración PROG-6A

El bloqueo real por falta de setting ofrece acceso a configuración. Plan, semana, día, prescripción, período y borrador privado se conservan solo en memoria de la store original y se borran al cambiar sesión/cuenta. Al volver se restauran las selecciones, pero la declaración comienza otra vez desmarcada, se descartan contexto/vista previa anteriores y el usuario debe consultar y generar explícitamente.

Guardar parámetros no elimina requisitos de política, unidad, cohorte, RPE o evidencia. El formulario y los errores los distinguen. No se reanuda automáticamente una propuesta obsoleta ni se garantiza que cualquier CONFIGURATION_REQUIRED se resuelva creando una fila.

## Q. PostgreSQL

Solo clústeres nuevos bajo `/tmp`, creados por los runners y destruidos por ellos. Se verifican URL efectiva, host localhost, puerto aleatorio, base esperada, realpath de data_directory y entorno; se aplican migraciones únicamente allí, sin seeds. Progresión: `pulso_prog1b_test`; sesiones/planificación: `pulso_f06_test`; Firefox: bases desechables `pulso_prog6a_browser_test` / `pulso_prog6b_browser_test`.

18 migraciones desplegadas en los entornos temporales, `migrate status` al día y `migrate diff --exit-code` sin deriva. Las 17 anteriores se conservan. La migración18 **no se aplicó en desarrollo**, tampoco las pendientes anteriores. Su aplicación real requiere el procedimiento de despliegue separado.

## R. Pruebas

Comandos desde backend/frontend según corresponda; no se ejecutaron suites generales E2E con una URL de desarrollo.

| Comando                                                 | Resultado final                               | Persistencia                                       |
| ------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| backend `npm test -- --runInBand`                       | 674/674, 61 suites                            | Unitarias/arquitectura, dobles según suite         |
| backend `node test/run-progression-isolated.mjs --api`  | 430/430, 19 suites                            | PostgreSQL real, HTTP, migraciones, Axios/Zod real |
| backend `node test/run-workouts-mvc-isolated.mjs`       | 27/27                                         | HTTP/PostgreSQL temporal                           |
| backend `node test/run-planning-mvc-isolated.mjs`       | 26/26                                         | HTTP/PostgreSQL temporal                           |
| frontend `npm test`                                     | 189/189                                       | Node, Vue renderer/SSR, Pinia, contratos y router  |
| frontend `npm run build`                                | Aprobado                                      | vue-tsc y Vite                                     |
| backend `npm run build`                                 | Aprobado, ejecución directa y runners Firefox | Prisma generate y Nest build                       |
| backend `node node_modules/typescript/bin/tsc --noEmit` | Aprobado                                      | Sin persistencia                                   |
| backend `npm run lint`                                  | Aprobado                                      | Oxlint type-aware                                  |
| backend `npm run prisma:validate`                       | Aprobado                                      | Validación de esquema, sin escritura DB            |
| Formato de archivos del alcance y `git diff --check`    | Aprobados al cierre                           | Sin DB                                             |

**1.346 pruebas automatizadas distintas**: 674 + 430 + 27 + 26 + 189. Incluyen las regresiones anteriores; no se suman ejecuciones focalizadas/repetidas. SETTINGS-1 añade 19 pruebas backend, 39 PostgreSQL/HTTP/migración y 11 frontend: 69 nuevas frente a la referencia 1.277. Las comprobaciones Firefox se cuentan aparte.

Durante desarrollo se observaron fallos nuevos: validaciones síncronas frente al contrato Promise del servicio, metadata de UI entrando en un binding de consentimiento, recuperación de recibos y resolución histórica. Se corrigieron y se repitieron las pruebas. Otros fallos fueron fixtures del runner (null, período semanal, escala pública de Decimal y timestamp de revocación bajo CHECK histórico), corregidos sin debilitar aserciones del producto. No quedan regresiones conocidas de SETTINGS-1 en las baterías ejecutadas.

Advertencias no bloqueantes: Node experimental VM/loader y deprecación de consultas concurrentes en un cliente pg, observada también en suites previas. No se cambiaron paquetes ni autenticación para ocultarlas. No hay script frontend lint; no se inventó uno.

## S. Firefox

Herramienta Browser plugin no disponible en la sesión. Se reutilizaron Firefox/Geckodriver reales y runners locales existentes, como solicita el usuario; no se instalaron Playwright ni navegadores nuevos. Se consultó además frontend-testing-debugging para el cierre visual; la elección de Firefox procede del requisito explícito y de la infraestructura existente.

| Runner                                                     | Resultado distinto |
| ---------------------------------------------------------- | ------------------ |
| `run-automation-consent-browser-isolated.mjs --settings`   | 20 aprobadas       |
| `run-progression-browser-isolated.mjs`                     | 19 aprobadas       |
| `run-automation-consent-browser-isolated.mjs --acceptance` | 25 aprobadas       |

**64 comprobaciones Firefox distintas**, sin sumar repeticiones. SETTINGS-1 verifica login real, navegación/layout único, ausencia de setting, retorno PROG-6A, tres ámbitos/precedencia, parámetros exactos, edición confirmada, stale CAS, duplicados, precisión, configuración incompleta, unidad incompatible real, contexto ajeno, pérdida post-COMMIT de PUT y CREATE, doble clic, recuperación tras recarga, aislamiento entre cuentas, sesión revocada y comparación persistida de historia/ausencia de automatización.

Captura escritorio 1366×682. En el modo compacto se solicitó ventana390×844, pero Firefox headless impone un mínimo: la captura efectiva es500×758 CSS en esta ejecución; no se presenta como prueba de un dispositivo físico390px. Se comprobó ausencia de overflow horizontal, labels y foco; el cierre añade avance real mediante Tab y verificación de :focus-visible. No es una auditoría WCAG completa ni una prueba de otros navegadores o de todos los tamaños. Se comprobó contenido útil y ausencia de overlay Vite; no se afirma una auditoría exhaustiva de logs de consola.

Evidencia en [evidence/settings-1](evidence/settings-1/), con logs, resultados y capturas de fixtures exclusivamente temporales.

## T. Regresiones

Las 430 PostgreSQL incluyen PROG-1B/2/3/4B/5A/5B/5C-A/6A/6B/6B-B y SETTINGS-1 con migraciones históricas. Las 674 backend incluyen el núcleo PROG-1A, políticas, arquitectura y módulos existentes. Las 189 frontend incluyen autenticación, Axios, stores, formularios y router previos. Los runners de sesiones y planificación comprueban contratos y conservación histórica. Los recorridos Firefox anteriores siguen verificando aplicación **manual** autorizada y aceptación recurrente **inactiva**, respectivamente.

Estos son los alcances ejecutados; no se afirma haber repetido todas las pruebas posibles de producción, infraestructura externa o seguridad canónica.

## U. Archivos y herramientas

Archivos nuevos principales:

- `backend/src/models/progression/progression-setting.model.ts`.
- `backend/src/domain/progression/progression-settings.policy.ts` y `.spec.ts`.
- `backend/src/progression/progression-settings.service.ts`, `.persistence.ts`, `.architecture.spec.ts`.
- `backend/src/progression/dto/progression-settings.dto.ts`.
- `backend/src/controllers/progression/progression-settings.controller.ts`.
- `backend/src/views/progression/progression-settings.presenter.ts`.
- `backend/prisma/migrations/20261112000000_progression_setting_mutations/migration.sql`.
- `backend/test/progression-settings.e2e-spec.ts`, `progression-settings-http.e2e-spec.ts`, `progression-settings-migration.e2e-spec.ts`.
- `frontend/src/schemas/progression-settings.schema.ts`, `types/progression-settings.ts`, `services/progression-settings.service.ts`, `stores/progression-settings.store.ts`.
- `frontend/src/utils/setting-form.ts`, `setting-intents.ts`.
- `frontend/src/components/progression/SettingForm.vue`, `SettingStatus.vue`.
- `frontend/src/views/ProgressionSettingsView.vue`, `ProgressionSettingEditorView.vue`.
- `frontend/tests/progression-settings.test.mjs`, `progression-settings-views.test.mjs`, `progression-settings.http.mjs`, `progression-settings.browser.mjs`.
- Plan y este informe/evidencia.

Integraciones mínimas: schema Prisma (recibos/relaciones), repositorio/interfaz/módulo progresión, filtro HTTP, expectativas arquitectónicas de registro, runners aislados, router Vue, ProgressionView/NewProgressionView/ProgressionForm/ProgressionStatus, store/tipos progresión para borrador en memoria. Los archivos de auth, layouts, planificación y otros cambios acumulados que aparecen en Git ya existían; no se atribuyen a esta implementación.

Skills consultadas: pulso-architecture-review y referencia MVC, pulso-domain-integrity, pulso-integration-testing, pulso-prisma-migrations, pulso-frontend-ux; guías Vue/Pinia/router/testing y referencias pertinentes; Superpowers para diseño/plan, TDD, depuración, revisión y verificación; guías de consistencia visual existentes. Se usaron herramientas de shell, Jest, Node test, Prisma, PostgreSQL, Vite/Vue y Firefox/Geckodriver. No Graphify, paquetes nuevos ni escaneo canónico Codex Security en SETTINGS-1; no se atribuye su uso.

Revisión independiente focalizada de solo lectura: la primera detectó los dos defectos de recuperación, reproducidos y corregidos. Un intento adicional quedó limitado por cuota; tras reanudar, una nueva revisión terminó sin hallazgos verificables en backend, migración y frontend del alcance. Confirmó el contrato `engineRows`, fences/CAS, FK de propiedad e inactividad operativa. No ejecutó tests por su cuenta ni revisó todo el acumulado dirty; la evidencia dinámica procede de los runners descritos arriba.

## V. Limitaciones y estado final

SETTINGS-1 implementado y verificado en su alcance HTTP/Vue y PostgreSQL temporal. Sin bloqueantes conocidos en las verificaciones ejecutadas. La configuración efectiva no equivale a disponer de toda la evidencia/política para recomendar. La unidad sigue siendo externa al setting, según el contrato existente; no se infiere ni migra.

Pendientes separados: desplegar las migraciones por un procedimiento autorizado fuera de esta tarea; política de eliminación/desactivación; posible evolución futura de unidades si se aprueba; revisión del uso concurrente de pg antes de actualizar a pg9; accesibilidad y navegadores/tamaños adicionales; revisión de seguridad canónica del nuevo cambio si se requiere para liberación. No se declara preparación para producción ni se habilita automatización.

| Concepto                  | Responsabilidad conservada                                        |
| ------------------------- | ----------------------------------------------------------------- |
| Configuración persistida  | Parámetros completos de una fila propia                           |
| Política matemática       | Reglas explícitas existentes, externas al setting                 |
| Configuración efectiva    | Fila seleccionada y validada para contexto/política               |
| Recomendación calculada   | Resultado/evidencia versionada; no se reescribe al editar         |
| Aceptación manual         | Revisión humana de una propuesta concreta                         |
| Consentimiento recurrente | Contrato/aceptación histórica independiente                       |
| Autorización operativa    | No concedida por editar parámetros ni por ACCEPTED_INACTIVE       |
| Aplicación                | Operación manual autorizada existente; no invocada por SETTINGS-1 |

## W. Diseño de continuación

1. Revisar esta integración y desplegar migración18 únicamente mediante procedimiento autorizado, con respaldo y comprobación de entorno.
2. Mantener la revalidación explícita de recomendaciones y desafíos después de editar. Si faltan política, cohortes, interpretación/unidades o evidencia, completar su contrato por separado; no rellenarlos con defaults.
3. Definir por decisión de dominio cualquier borrado/desactivación y su efecto de fallback antes de implementarlo.
4. PROG-5C-B sigue fuera de alcance: requerirá principal operativo, autorización independiente, transacción/idempotencia, fences, límites/vigencia/destinos y auditoría por ejecución. No reutilizar sesiones humanas ni transformar autoApplyAuthorized/ACCEPTED_INACTIVE en permiso de ejecución.
