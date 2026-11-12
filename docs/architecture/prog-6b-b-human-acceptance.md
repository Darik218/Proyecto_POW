# PROG-6B-B — Aceptación humana recurrente inactiva

## A. Estado inicial

Trabajo en `feature`, HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`, con cambios acumulados sin commit. Se tomaron `git status` y un manifiesto SHA-256 inicial; no se descartó ningún archivo anterior. Línea base ejecutada: **646 pruebas backend y 172 frontend aprobadas**. Las cifras PostgreSQL/Firefox anteriores se trataron como referencia hasta repetir los runners.

No hubo commits, push, cambio de rama, worktrees, reset, clean, rebase, instalaciones o modificaciones de `.env`. No se migró ni escribió `proyecto_pow_dev`.

## B. Auditoría de contratos

Se revisaron modelos Prisma, migraciones, servicio/repositorio/políticas de consentimiento y elegibilidad, controlador/presenter/DTO, guards, contratos Zod, Pinia, componentes y runners, junto con los informes PROG-5C-A y PROG-6B.

Los estados iniciales reales eran `PENDING_CONFIRMATION` y `REVOKED`; acciones CREATE/REVISE/REVOKE. Las marcas históricas `humanAcceptance: NOT_RECORDED`, `operationalAuthorization: NOT_AVAILABLE_IN_PROG_5C_A` y `executionAuthorized: false` se verificaron en código y SQL.

La propuesta `ACCEPTED_INACTIVE` resultó compatible como evolución **no operativa**: cabe en VARCHAR(24) y Prisma utiliza String. Requería ampliar CHECK, triggers, CAS, solapamientos y proyecciones; no bastaba con añadir una constante TypeScript. No se añadieron reglas matemáticas de entrenamiento.

## C. Arquitectura MVC

```text
Vue → Axios existente → AccessTokenGuard/AuthOriginGuard/DTO
    → AutomationConsentController → AutomationConsentService
    → ProgressionRepository → transacción READ COMMITTED/PostgreSQL
    → modelos internos → AutomationConsentPresenter → Zod/Pinia/Vue
```

Se reutilizaron controlador, servicio, repositorio y presenter existentes. Los modelos nuevos describen aceptación, desafío y evidencia. La política pura valida el comando y calcula su identidad; no consulta HTTP/Prisma/reloj.

La construcción y lectura de capturas se extrajeron a `automation-consent.sources.ts` para compartirlas entre mutación y emisión de desafío sin ciclos de ejecución. Las consultas y escritura permanecen en persistencia. Los presentadores seleccionan campos públicos y no ejecutan casos de uso ni consultan PostgreSQL.

## D. Máquina de estados

| Estado inicial       | Acción           | Estado final             | Condiciones                                                   |
| -------------------- | ---------------- | ------------------------ | ------------------------------------------------------------- |
| Ausente              | CREATE           | PENDING_CONFIRMATION v1  | Contrato válido y propiedad                                   |
| PENDING_CONFIRMATION | REVISE           | PENDING_CONFIRMATION v+1 | CAS; nueva captura/evento                                     |
| PENDING_CONFIRMATION | ACCEPT           | ACCEPTED_INACTIVE v+1    | Desafío emitido, sesión, condiciones exactas y confirmaciones |
| PENDING_CONFIRMATION | REVOKE           | REVOKED v+1              | Confirmación, intención y CAS                                 |
| ACCEPTED_INACTIVE    | REVOKE           | REVOKED v+1              | Mismo protocolo y auditoría                                   |
| REVOKED              | Nueva transición | Rechazada                | Terminal                                                      |

Una versión aceptada no admite REVISE. Cambiar sus condiciones exige revocar y crear otra solicitud, con otra aceptación. No se emplea ACTIVE ni se convierten solicitudes históricas en aceptadas.

La vigencia efectiva se proyecta aparte: futuro, vigente o vencido, conservando el estado y la aceptación históricos.

## E. Contrato de aceptación

`recurring-consent-acceptance-v1` deja de ser únicamente una referencia futura y dispone de comando efectivo no operativo. Requiere:

- Consentimiento e intención UUID; desafío UUID emitido para esa sesión.
- Versión y estado esperado `PENDING_CONFIRMATION`.
- `contractKey`, `conditionsKey`, contexto de sesión opaco, términos y `recurring-consent-presentation-v1`.
- Declaración `conditionsPresented: true` y cinco reconocimientos explícitos: política, límites, destinos, vigencia y revocación.

No recibe atleta, propietario, snapshot autoritativo, estado aceptado ni autorización de ejecución desde el cliente. El servidor recupera las condiciones guardadas y verifica el vínculo bajo transacción. Los DTO y la política rechazan confirmaciones incompletas, campos adicionales y expectativas inválidas.

## F. Desafío y condiciones

El backend emite un registro inmutable ligado a consentimiento, atleta, usuario, **sesión persistida**, versión, contractKey, términos, presentación y dependencias actuales. Su ID UUID no se deriva de campos públicos. Devuelve las condiciones estructuradas completas, huellas, estado esperado, reconocimientos requeridos y tiempos del servidor.

Caducidad técnica: `min(emisión + 10 minutos, endsAt)`. No modifica expiraciones de autenticación ni la duración del consentimiento. Se puede confirmar un período que aún no comenzó; sigue sin existir capacidad de ejecución. Se rechaza cualquier aceptación tras el fin del período o del desafío.

Se reconstruyen y comparan motor, destinos/versiones y bindings decisorios. Una proyección SQL versionada captura además valores de prescripción —incluida carga sin cambio de versión del plan—, jerarquía/estado, aptitud de acceso y configuración relevante. `autoApplyAuthorized` y `updatedAt` de settings se excluyen por no acreditar consentimiento ni cambiar por sí solos la decisión.

La comprobación definitiva ocurre después de adquirir fences/locks y otra vez en el trigger del evento: modificación, revocación, expiración o sesión inválida impiden escribir. Vue no es la autoridad para decidir vigencia.

## G. Evidencia humana

La pantalla solicita el desafío real, presenta sus condiciones y exige cinco casillas inicialmente desmarcadas. Una confirmación parcial no permite enviar. Renovar desafío, cambiar versión/contexto o caducar el desafío invalida los reconocimientos previos. La acción explícita emite el comando; no se envían afirmaciones al cargar la vista.

La evidencia acredita una **confirmación explícita emitida por un cliente autenticado conforme a este contrato**. No demuestra necesariamente lectura, comprensión, identidad física de quien maneja el dispositivo ni ausencia de automatización del cliente. JWT válido por sí solo no constituye aceptación. No se reutiliza `THIS_PROPOSAL_ONLY`.

## H. Política y procedencia

La aceptación se refiere únicamente a la política, motores, configuración efectiva, límites, unidades, rejilla, frecuencia, vigencia y allowlist concretos mostrados. No acepta políticas futuras de manera general.

Procedencia registrada: `AUTHENTICATED_CONSENT_CONFIRMATION`. El evento conserva el identificador interno de la sesión y su contexto opaco; el presenter no expone el ID interno de sesión. La preferencia `autoApplyAuthorized` no se reinterpreta ni activa.

## I. Versionado

ACCEPT aumenta la versión del agregado para CAS/auditoría, pero mantiene **exactamente** snapshot, contractKey y período previos. La evidencia indica `acceptedVersion`, la versión pendiente que se confirmó; el evento tiene su versión posterior.

`automation-consent-snapshot-v1` permanece intacto, incluyendo su `NOT_RECORDED` histórico. La proyección efectiva recupera aceptación desde el evento ACCEPT, incluso después de revocar. No se reconstruye la evidencia desde la planificación/configuración actual.

## J. Auditoría

Se añadieron al evento campos nullable `acceptance_challenge_id` y `acceptance_evidence`, nulos para todo evento anterior. La evidencia incluye formato, desafío, sesión, versión aceptada, huellas, términos/presentación, confirmaciones y procedencia; la fecha y actor están en el evento existente.

La huella de aceptación usa SHA-256 de un array JSONB de campos **explícitamente ordenados**, codificado UTF-8, con discriminador `recurring-consent-acceptance-fingerprint-v1`. `automation_acceptance_evidence_key` define esa canonicalización SQL; las pruebas la reproducen desde la evidencia persistida. La huella de condiciones tiene su discriminador propio y enlaza contractKey con dependencias. No se confía en el orden incidental de un objeto enviado por Vue.

Los triggers exigen evento de la versión/transición exacta, dueño correcto, desafío de la misma sesión, términos/huellas, período vigente y cinco confirmaciones. Rechazan modificaciones o eliminación de auditoría y desafíos. El constraint trigger diferido obliga a confirmar agregado y evento atómicamente. El timeline Vue permite inspeccionar huellas, reconocimientos, presentación y procedencia, además de las capturas históricas.

Estas restricciones protegen frente a operaciones ordinarias que respetan el esquema; un administrador capaz de desactivar triggers o alterar funciones queda fuera de esta garantía.

## K. Revocación

Se amplió el protocolo existente para admitir revocación desde ACCEPTED_INACTIVE, manteniendo propiedad, sesión, intención, versión esperada, fences y CAS. No hay otro mecanismo paralelo ni borrado físico.

La revocación conserva captura y evento de aceptación. Un reintento exactamente idéntico de ACCEPT puede recuperar su **recibo histórico original** por idempotencia; jamás restablece el estado actual. Una nueva intención que intente aceptar usando un desafío anterior sobre un revocado se rechaza. La recuperación consulta el estado actual para no presentarlo como aceptado vigente.

## L. Idempotencia

Se conserva UNIQUE por atleta/intención y por consentimiento/versión. Cada desafío puede vincularse a un único evento ACCEPT mediante índice UNIQUE nullable.

La identidad canónica del comando incluye todos los valores decisorios y reconocimientos. Reintento idéntico devuelve el evento original, sin cambiar fecha, límites, destinos o vigencia. Reutilizar la intención con contenido distinto produce `INTENT_REUSED`. Otra cuenta/contexto no puede efectuar la transición mediante un desafío ajeno.

El cuerpo exacto y reconocimientos permanecen en memoria. `sessionStorage` conserva únicamente seis identificadores/metadatos temporales permitidos, acotados a cuenta/contexto y TTL existente de 30 minutos. ACCEPT reutiliza la consulta por intención tras timeout/504/recarga; no reconstruye ni reenvía automáticamente afirmaciones perdidas.

## M. Concurrencia

Se mantiene READ COMMITTED, UTC local, orden de fences usuario/sesión/atleta, locks de consentimiento/configuración/jerarquía, CAS, índices y reintentos acotados. No se usan locks en memoria ni una segunda transacción para confirmar el evento. PROG-5B conserva su aislamiento y operaciones.

PostgreSQL real verificó: aceptaciones idénticas concurrentes; intenciones distintas; aceptación frente a revisión/revocación; cambios concurrentes de sesión/configuración/destino; expiración; revocación posterior; intención antigua; rollback ante fallo del evento; auditoría inmutable. Se mantienen aceptados inactivos en la detección de solapamientos, sin sumar permisos.

El punto de confirmación exige sesión y período válidos al registrar el evento; los locks impiden una revocación concurrente incompatible de la sesión durante esa sección. Un cambio posterior de configuración no reescribe la aceptación; tampoco habilita ejecución.

## N. Seguridad

Se reutilizan AccessTokenGuard, AuthOriginGuard, CurrentAuth, validación de cuenta activa y sesión PostgreSQL, control de propietario y respuestas privadas/no-store. Las operaciones de negocio conservan bearer + origen; no se inventó un mecanismo CSRF incompatible ni se cambiaron cookies, refresh, duración, guards o AUTH-HARDEN-1.

La aceptación no llama a PROG-5B, no crea ProgressionApplication, no cambia cargas/planes/entrenamientos, no habilita principal de servicio ni autoApplyAuthorized y no crea scheduler/worker. El evaluador presenta `CONSENT_ACCEPTED_INACTIVE` por separado y mantiene `executionAuthorized: false` en todos los casos.

Un revisor independiente realizó dos pasadas focalizadas, de solo lectura: diseño inicial y revisión de SQL/servidor/Vue/recuperación. No identificaron bloqueantes; se incorporó la observación de mostrar evidencia detallada en UI. Esa revisión estática no equivale a una certificación de seguridad. No se ejecutó un nuevo escaneo canónico de Codex Security en esta etapa ni se modificaron permisos/configuración del plugin.

## O. API

Se extiende `/api/v1/progression/automation-consents`, conservando las rutas de gestión previas:

| Método y ruta adicional           | Resultado                                                         |
| --------------------------------- | ----------------------------------------------------------------- |
| POST `/:id/acceptance-challenges` | 201, desafío persistido; requiere expectedVersion y origen válido |
| POST `/:id/acceptances`           | 201, evento/recibo de aceptación inactiva                         |

Detalle, eventos y `/operations/:intentId` existentes permiten consultar aceptación y estado resultante. No existe PATCH genérico de estado ni endpoint de ejecución.

Errores relevantes: DTO inválido 400, autenticación 401, origen 403, recurso inaccesible 404, desafío inválido/obsoleto, versión, intención o estado incompatible 409 y configuración/expiración semántica 422 según el código existente. No se devuelven detalles SQL o credenciales.

## P. Frontend

Se extendieron Zod, tipos inferidos, servicio Axios y la única store de consentimiento. `ConsentAcceptance.vue` encapsula presentación del desafío, caducidad visual y reconocimientos; la vista detalle coordina gestión, aceptación y auditoría. Lista y filtro incluyen ACCEPTED_INACTIVE, presentado como aceptado sin ejecución.

La store limpia desafío/datos al cambiar identidad/contexto, descarta respuestas tardías y conserva intención/recibo ante resultado incierto o fallo posterior de inspección. Se verifican cuenta, sesión, versión e ID antes de enviar. Los reconocimientos no se guardan en almacenamiento persistente.

Se conserva la arquitectura complementaria `config/layouts/schemas/types/utils` y las carpetas `components/composables/router/services/stores/views/assets`; no hubo rediseño ni otro cliente Axios. Los decimales oficiales siguen como cadenas y el frontend no recalcula progresión.

## Q. Migración

Nueva migración **17**: `20261111002000_inactive_consent_acceptance/migration.sql`. Añade tabla de desafíos, relación a sesión y consentimiento/atleta, evidencia nullable del evento, unicidad y funciones/CHECK/triggers ampliados. No utiliza backfill ni altera estados históricos.

Se mantuvieron byte a byte las 16 migraciones anteriores. Las relaciones nuevas en Prisma incluyen la inversa de desafíos de AuthSession; no cambia la lógica de autenticación. Los índices/FK tienen nombres explícitos para evitar deriva por truncamiento PostgreSQL.

El test de migración crea una base secundaria dentro del clúster temporal, aplica las 16 migraciones anteriores, inserta solicitudes pendientes y una cadena CREATE/REVISE/REVOKE con fixtures mínimas, captura todas las tablas, aplica la migración17 y compara filas, snapshots, IDs, relaciones, versiones y fechas. Los campos nuevos quedan NULL; no se crean desafíos ni aceptaciones retroactivas.

## R. PostgreSQL

Todos los runners de escritura crean y verifican host localhost, puerto aleatorio, nombre de base, URL efectiva y `data_directory` temporal. Aplican migraciones únicamente allí y comprueban estado/deriva; sin seeds de desarrollo. Las bases secundarias de migración se eliminan en finally, igual que los clústeres propios.

Progresión utiliza `pulso_prog1b_test`; navegador `pulso_prog6b_browser_test`; sesiones y planificación sus runners aislados existentes. No se modificó configuración global: `SET LOCAL TIME ZONE 'UTC'` se conserva para las operaciones relevantes. `prisma migrate diff` no detectó deriva en el esquema temporal.

## S. Pruebas y Firefox

Desde backend, salvo indicación:

| Comando                                        | Resultado final                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `npm test -- --runInBand`                      | 655 pruebas / 59 suites aprobadas                                    |
| `node test/run-progression-isolated.mjs --api` | 391 pruebas / 16 suites PostgreSQL aprobadas                         |
| `node test/run-workouts-mvc-isolated.mjs`      | 27 pruebas / 3 suites aprobadas                                      |
| `node test/run-planning-mvc-isolated.mjs`      | 26 pruebas / 4 suites aprobadas                                      |
| `npm test`, frontend                           | 178 pruebas aprobadas                                                |
| `npm run build`, backend                       | Prisma generate local + Nest build aprobados                         |
| `./node_modules/.bin/tsc --noEmit`             | Aprobado                                                             |
| `npm run lint`                                 | Oxlint type-aware aprobado sin advertencias finales                  |
| `npx prisma validate`                          | Aprobado                                                             |
| `npm run build`, frontend                      | vue-tsc + Vite aprobados                                             |
| Firefox gestión + aceptación                   | 25 comprobaciones aprobadas (16 de gestión + 9 nuevas de aceptación) |
| Firefox PROG-6A                                | 19 comprobaciones aprobadas                                          |

**Navegador: 44 comprobaciones distintas**, 25 + 19, sin sumar las repeticiones. Evidencias: [gestión y aceptación](evidence/prog-6b-b/firefox-results.json), [regresión manual](evidence/prog-6b-b/firefox-prog6a-regression-results.json), [escritorio](evidence/prog-6b-b/acceptance-desktop.png) y [móvil aceptado inactivo](evidence/prog-6b-b/accepted-inactive-mobile.png).

**Total automatizado distinto: 1.277**, calculado como 655 + 391 + 27 + 26 + 178. Los 32 nuevos casos PostgreSQL están incluidos en 391: 28 casos de aceptación/migración y 4 HTTP adicionales. Los nueve nuevos casos backend y seis frontend tampoco se suman otra vez.

La inspección móvil también detectó una etiqueta ambigua de NOT_RECORDED. Se añadió una aserción RED, se explicitó que la marca pertenece a la captura histórica y se adelantó el resumen del evento aceptado. Las capturas persistidas permanecen idénticas.

Se ejecutaron comprobaciones acotadas de formato y `git diff --check`; no existe script de lint frontend. Los tests cubren dominio, estados no operativos, DTO/origen/propiedad, proyección pública, comandos/huellas, configuración/destino alterados, sesiones, concurrencia, rollback, legado, Zod/Axios/Pinia y SFC reales mediante Vite.

Las primeras pruebas RED reprodujeron la ausencia del módulo de política, del caso de uso y del esquema Zod. Fallos intermedios documentados: nombres de índices demasiado largos detectados por deriva; fixtures de expiración sin UTC local; fixture de revocación incompatible con su createdAt; sintaxis de ampliación del runner y reintento auxiliar de navegador que importaba otro módulo y no capturaba el cuerpo real. Se corrigieron sin debilitar las aserciones. Las pruebas finales de expiración usan reloj servidor y los rechazos de intención antigua exigen 409; no se considera suficiente un 401/400.

Se observó también un arranque no disponible en una ejecución de navegador con builds paralelos; los recorridos finales se ejecutan secuencialmente para evitar interferencia sobre dist. Las ejecuciones fallidas/repetidas no se cuentan como pruebas distintas ni aprobadas. Se mantienen avisos experimentales de Node y una deprecación de pg en suites existentes, sin ocultarlos ni modificar módulos ajenos para silenciarlos.

## T. Regresiones

PROG-1A a PROG-5C-A, aplicación manual, gestión PROG-6A/6B, migraciones, sesiones, planificación y frontend se verificaron mediante las suites descritas. Las pruebas anteriores que afirmaban ausencia de aceptación se actualizaron a su nueva semántica: aceptación inactiva disponible, sin aceptación grabada hasta la acción y sin ejecución. Se mantienen restricciones contra activación/aplicación automática.

La prueba PostgreSQL confirma igualdad de planificación/prescripciones antes/después. Firefox compara las tablas históricas y comprueba cero aplicaciones automáticas, sin preferencias activadas ni sesiones humanas fabricadas. El recorrido manual PROG-6A aplica su fixture explícita en su propia base; es una regresión de aplicación manual, no ejecución recurrente.

## U. Archivos y herramientas

Cambios de esta etapa respecto del manifiesto inicial; se conserva el trabajo anterior aunque algunos de esos archivos ya eran untracked en Git.

### Existentes modificados

- `backend/src/progression/automation-consent-http.architecture.spec.ts`
- `backend/src/progression/automation-consent.persistence.ts`
- `backend/src/progression/prisma-progression.repository.ts`
- `backend/src/progression/automation-consent.service.ts`
- `backend/src/progression/progression-http.boundary.ts`
- `backend/src/progression/progression.repository.ts`
- `backend/src/progression/automation-consent.architecture.spec.ts`
- `backend/src/models/progression/automation-consent.model.ts`
- `backend/src/views/progression/automation-consent.presenter.ts`
- `backend/src/domain/progression/automation-consent.policy.ts`
- `backend/src/domain/progression/automation-eligibility.policy.spec.ts`
- `backend/src/domain/progression/automation-eligibility.policy.ts`
- `backend/src/controllers/progression/automation-consent.controller.ts`
- `backend/src/progression/dto/automation-consent.dto.ts`
- `backend/test/run-automation-consent-browser-isolated.mjs`
- `backend/test/automation-consent-http.e2e-spec.ts`
- `backend/test/automation-consent-migration.e2e-spec.ts`
- `backend/test/run-progression-isolated.mjs`
- `backend/prisma/schema.prisma`
- `frontend/src/services/automation-consent.service.ts`
- `frontend/src/schemas/automation-consent.schema.ts`
- `frontend/src/utils/consent-intents.ts`
- `frontend/src/components/automation/ConsentConditions.vue`: identifica explícitamente la marca histórica de la captura.
- `frontend/src/views/AutomationConsentDetailView.vue`
- `frontend/src/views/AutomationConsentsView.vue`
- `frontend/src/types/automation-consent.ts`
- `frontend/src/stores/automation-consent.store.ts`
- `frontend/tests/automation-consent.browser.mjs`
- `frontend/tests/automation-consent.http.mjs`
- `frontend/tests/automation-consent-views.test.mjs`

### Creados

- `backend/src/progression/automation-consent.sources.ts`
- `backend/src/progression/consent-acceptance.persistence.ts`
- `backend/src/models/progression/consent-acceptance.model.ts`
- `backend/src/domain/progression/consent-acceptance.policy.ts`
- `backend/src/domain/progression/consent-acceptance.policy.spec.ts`
- `backend/test/automation-consent-acceptance.e2e-spec.ts`
- `backend/test/automation-consent-acceptance-migration.e2e-spec.ts`
- `backend/prisma/migrations/20261111002000_inactive_consent_acceptance/migration.sql`
- `frontend/src/components/automation/ConsentAcceptance.vue`
- `frontend/tests/consent-acceptance.test.mjs`
- `docs/superpowers/plans/2026-11-11-prog6bb.md`
- `docs/architecture/prog-6b-b-human-acceptance.md`: este informe.
- `docs/architecture/evidence/prog-6b-b/`: resultados y capturas de fixtures aislados al completar Firefox.

Justificación de los grupos: evolución aditiva de persistencia/auditoría, contrato y política puros, extracción compartida para evitar ciclos, integración del servicio HTTP y presenter, flujo Vue y recuperación, y pruebas/migración/runners. No hay cambios de comportamiento en autenticación ni módulos de entrenamiento; se comprobó por SHA-256. Las dieciséis migraciones anteriores y los archivos previos permanecen presentes.

Herramientas efectivamente utilizadas: skills locales de arquitectura/MVC, dominio/integridad, migraciones, integración, frontend UX y guías Vue/Pinia/testing; referencia de Design System para conservar componentes. Superpowers para diseño/plan, TDD, diagnóstico, revisión independiente y verificación. Jest, Node test runner, TypeScript, Oxlint, Prettier, Prisma, PostgreSQL temporal, Vite/vue-tsc, Firefox/Geckodriver y revisión de diffs. No se instalaron paquetes ni se cambió Codex/skills/plugins. Graphify no fue necesario; no se ejecutó escaneo canónico nuevo de Codex Security.

## V. Limitaciones y estado final

| Dimensión                | Estado y alcance                                                               |
| ------------------------ | ------------------------------------------------------------------------------ |
| Modelo                   | Verificado en PROG-6B-B mediante dominio, contratos y PostgreSQL               |
| Vista MVC                | Verificada mediante proyección explícita y contratos HTTP/Zod                  |
| Controlador MVC          | Verificado mediante guards, DTO, registro y HTTP real                          |
| Aceptación humana        | Registro explícito, versionado, auditable e inactivo; no demuestra comprensión |
| Propiedad/sesión         | Revalidadas en PostgreSQL y vinculadas al desafío                              |
| Idempotencia/revocación  | Recibos históricos inmutables y estado terminal conservados                    |
| Compatibilidad histórica | Migración17 desde16, sin backfill de aceptación                                |
| Autorización operativa   | No implementada; contrato futuro independiente                                 |
| Elegibilidad matemática  | Conservada y separada de autorización                                          |
| Ejecución automática     | No implementada; `executionAuthorized: false`                                  |
| Producción               | No se declara preparación ni certificación                                     |

La aceptación grabada corresponde a las condiciones mostradas en esa interacción; cambios posteriores pueden invalidar su utilidad para un futuro ejecutor, sin borrar que ocurrió. PROG-5C-B deberá definir explícitamente sus requisitos operativos. No se acepta por inferencia la cohorte futura de entrenamiento ni se convierte una preferencia en permiso.

Pendientes: política de retención y crecimiento de desafíos inmutables; revisión canónica de seguridad si se exige para cierre; accesibilidad/dispositivos más allá del alcance básico de Firefox; seguimiento de advertencias Node/pg; despliegue de la migración de desarrollo/producción fuera de esta tarea y sin ejecución realizada aquí.

Los logs temporales están en `/tmp/pulso-prog6bb-*.log`; los tests y runners quedan en el repositorio para reproducirlos. Se incluyen evidencias seguras de fixtures, sin credenciales. No se declara PROG-5C-B implementado.

## W. Diseño de PROG-5C-B — sin activación

1. Definir un **contrato de autorización operativa independiente**, con principal de servicio verificable, alcance, versión, auditoría y habilitación explícita. ACCEPTED_INACTIVE por sí solo no satisface ese contrato.
2. Evaluar en la misma transacción aceptación y evento exactos, contrato/versión, vigencia, revocación, motor/política/configuración, evidencia de recomendación y allowlist. No usar JWT o sesión humana simulada para un worker.
3. Mantener propietario, jerarquía DRAFT, editabilidad/historial, unidad, carga actual, versiones/CAS y límites/frecuencia/ciclo. Definir qué cambios incompatibles obligan a nueva aceptación; no ampliar alcance ni escoger el permiso más permisivo.
4. Registrar autorización, consumo de ciclo, aplicación y auditoría de manera atómica, con identidad semántica y unicidad PostgreSQL. Reintentos devuelven recibo; conflictos no cambian silenciosamente de destino o consentimiento.
5. Definir orden de locks compatible y punto de ordenación frente a revocación. Un ejecutor no puede autorizarse con una lectura antigua o una aceptación revocada. Preservar inmutabilidad de objetivos/resultados históricos.
6. Probar expiración, cambios de configuración/destino, doble intento, pérdida de respuesta, rollback y carreras de revocación usando PostgreSQL aislado; realizar revisión de seguridad y recorrido humano antes de autorizar scheduling.

No se implementó principal, scheduler, worker, consumo automático ni llamada en segundo plano a PROG-5B. Todas las rutas de esta etapa mantienen `executionAuthorized: false`.
