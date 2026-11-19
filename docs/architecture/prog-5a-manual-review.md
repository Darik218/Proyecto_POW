# PROG-5A — Revisión manual y auditoría de propuestas

## A. Estado inicial

Rama comprobada: `feature`. HEAD conservado: `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`. El repositorio tenía trabajo acumulado de PROG-3/4A/4B sin commit; se preservó. Se tomó un inventario SHA-256 adicional antes de editar para distinguir esta etapa de las modificaciones previas.

Línea base ejecutada: **539 pruebas unitarias/arquitectónicas, 49 suites**, todas aprobadas. Las regresiones previas de PostgreSQL se volvieron a ejecutar con la migración nueva; no se asumieron por informes anteriores.

Una consulta **READ ONLY**, con conexión forzada a solo lectura, timeout, `BEGIN READ ONLY` y rollback, comprobó once migraciones completadas en la base configurada de desarrollo. Permanecen pendientes allí `20261109001000_neutral_weekly_recommendations` y `20261110000000_manual_recommendation_reviews`. No se aplicaron. No se escribió en desarrollo ni se modificaron `.env`, seeds o migraciones anteriores.

## B. Auditoría de estados y restricciones

Enum real sin cambios: `PENDING`, `APPROVED`, `REJECTED`, `APPLIED`, `BLOCKED`, `EXPIRED`.

PROG-4B ya permitía actualizar `status`, `reviewedAt`, `expiresAt` y `cycleSlot` como campos operativos, preservando la generación moderna y sus enlaces. No existía un caso de uso autorizado de revisión ni actor/auditoría persistente. `reviewedAt` por sí solo no identificaba quién decidió ni qué aceptó.

Una propuesta moderna se reconoce mediante su metadata completa `NEUTRAL_INTERNAL`, claves, captura y proyecciones verificadas. El legado sin esa información continúa `LEGACY_UNKNOWN`.

La nueva columna nullable `reviewVersion` distingue una revisión PROG-5A acreditada de un estado anterior sin procedencia verificable. **NULL no significa que nunca hubo una revisión histórica: significa que no existe una revisión PROG-5A acreditada.** No se rellenan actores ni eventos retrospectivos.

## C. Arquitectura

Se mantienen `ProgressionModule`, `RecommendationService`, `ProgressionRepository` y `PrismaProgressionRepository`. No se añaden proveedores, repositorios o clientes paralelos.

Recorrido interno:

```text
AuthenticatedIdentity + comando explícito
→ RecommendationService (captura identidad y valida comando)
→ ProgressionRepository / PrismaProgressionRepository
→ transacción: sesión/propiedad, propuesta, fuentes, locks
→ deriveRecommendation PROG-4A + política pura de revisión
→ evento + CAS del estado dentro de la misma transacción
→ modelo interno de decisión o inspección
```

`recommendation-review.policy.ts` contiene validación, compatibilidad, huellas y matriz. `recommendation-review.model.ts` representa contratos internos. `recommendation-review.persistence.ts` es una implementación auxiliar del repositorio existente; recibe el mismo PrismaService y un lector transaccional interno, sin crear otro repositorio.

Se extrajeron las fences de fuentes de PROG-4B a una función compartida, conservando su orden y comportamiento. El callback de aplicación recibe datos de contexto, nunca operaciones Prisma o un repositorio concreto.

MVC se conserva: Modelo y dominio participan realmente; servicios coordinan; repositorios persisten. No hay superficie HTTP nueva, por lo que no se crean controladores o presentadores decorativos. No se amplía la declaración de MVC global a partir de estas pruebas internas.

## D. Inspección interna

Nuevos métodos del servicio existente:

- `inspectMyProposal(identity, id, command?)`: inspección coherente de solo lectura.
- `reviewMyProposal(identity, input)`: decisión explícita con auditoría transaccional.

Se conservan `proposeMyExercise`, `saveMyProposal`, `getMyProposal` y `checkMyProposal`. Se reutilizan `deriveRecommendation`, `compareDrafts`, claves y captura de PROG-4A/4B. La inspección nueva evita usar las dos transacciones separadas de `checkMyProposal` como garantía de atomicidad: lee propuesta, eventos, contexto y destino en **una transacción REPEATABLE READ READ ONLY**.

La respuesta interna contiene propuesta y evidencia propias, cargas y unidades, período deportivo, destino previsto, política/configuración/versiones de la captura, fecha original, eventos, vigencia, dependencias modificadas, compatibilidad del destino, reserva/conflicto de ciclo, bloqueos y desafío de aceptación cuando corresponde.

No devuelve contraseñas, hashes de refresh, cookies, tokens, sesiones internas de autenticación ni datos de otros atletas. Los UUID de actor/evento son referencias necesarias de auditoría. Los datos de ejecución de la captura pertenecen al atleta; si el catálogo/destino actual deja de ser accesible, se informa esa condición sin consultar ni mostrar datos privados actuales de otro usuario.

## E. Política matemática y aceptación específica

Una política `EXPLICIT_INTERNAL_POLICY` acredita procedencia de cálculo, no aprobación operativa, presencia humana ni consentimiento. `INCREASE`, persistencia `PENDING`, parámetros completos y `autoApplyAuthorized=true` tampoco son aceptación.

PROG-5A implementa **aceptación manual por caso mediante un contrato interno autenticado**, autorizado expresamente por el alcance de esta etapa. El consumidor debe enviar acción `APPROVE` y un objeto de aceptación con:

- `schemaVersion: manual-proposal-acceptance-v1`.
- `scope: THIS_PROPOSAL_ONLY`.
- Huella de autorización y huella de política/configuración coincidentes.
- `acceptPolicy: true` y `acceptEvidence: true` expresamente aportados por ese consumidor.

La inspección proporciona las huellas y el alcance; **no genera los reconocimientos afirmativos**. La huella vincula ID de propuesta, atleta, revisión esperada, semanticKey, ciclo/reserva, dependencias, configuración/política completa y procedencia, destino y versión, carga propuesta y unidad. No es un secreto, token de acceso ni autorización para futuras propuestas.

**Límite de confianza:** `AuthService.authenticate` es el mecanismo existente que valida JWT y produce `AuthenticatedIdentity`. El servicio interno requiere un llamador confiable que haya obtenido esa identidad y recogido la decisión explícita; además comprueba en PostgreSQL que su `sessionId` es real, propio, vigente y no revocado. El digest acredita coincidencia del contenido aceptado, no demuestra que una persona lo leyó ni que estuvo presente. No hay interfaz humana o endpoint de consentimiento implementados; esa integración pertenece a PROG-6. No se presenta este contrato interno como un flujo público completo.

## F. Vigencia

Se distinguen:

| Resultado | Significado |
| --- | --- |
| `CURRENT` | Coinciden generación y recálculo autorizado dentro de la ventana/política explícitas. |
| `OBSOLETE` | Cambió la huella semántica o sus dependencias. |
| `NOT_EVALUABLE` | No se proporcionó un comando de revalidación suficiente. |
| `SOURCE_INACCESSIBLE` | Ya no se puede resolver una fuente autorizada; no se afirma vigencia. |
| `CONFIGURATION_INCOMPATIBLE` | El motor actual informa configuración requerida/incompatible. |
| `DESTINATION_MODIFIED` | Cambió la dependencia de destino/versiones. |
| `DESTINATION_RETIRED` | El destino actual está retirado. |
| `LEGACY_UNKNOWN` | Faltan capturas/unidades/procedencia modernas; no se reconstruyen. |

Los cambios pueden afectar configuración, ámbito, política, cohorte, resultados, RPE, conteos, readiness, período, plan/prescripción y versiones. Captura íntegra y estado PENDING no implican vigencia. La consulta no modifica estados ni asigna expiración.

La aprobación vuelve a leer y calcular dentro de SERIALIZABLE; no confía en una inspección anterior. Una aceptación obtenida antes de un cambio deja de ser suficiente. La vigencia se refiere a las dependencias y ventana declaradas; no existe una duración de validez operativa arbitraria ni una política automática de recencia. PROG-5B tendrá que definir y comprobar el período efectivo de aplicación.

Si la captura está malformada o su versión no se reconoce, la validación de PROG-4B falla de forma tipada; no se reconstruye ni se declara vigente. Una inspección sin comando permanece no evaluable y no produce desafío de aprobación.

## G. Matriz de transiciones

| Origen | Acción nueva | Destino | Condiciones y efectos |
| --- | --- | --- | --- |
| `PENDING` | `APPROVE` | `APPROVED` | Propiedad/sesión, metadata moderna, expectativas, vigencia, reserva y destino compatible, aceptación específica, evento atómico y revisión 1. No aplica cargas. |
| `PENDING` | `REJECT` | `REJECTED` | Propiedad/sesión, expectativas coincidentes y justificación; puede rechazar evidencia obsoleta, destino retirado/inaccesible o legado identificable. No necesita acreditar vigencia. |
| `APPROVED` | Cualquier revisión nueva | Rechazada | No hay revocación/sustitución ni aplicación implementada en 5A. |
| `REJECTED`, `APPLIED`, `BLOCKED`, `EXPIRED` | Cualquier revisión nueva | Rechazada | No se reinician estados ni se fabrican transiciones. |
| Cualquier estado posterior | Reintento de una intención idéntica existente | Sin transición | Devuelve el evento original, sin actualizar fecha, estado ni consentimiento. |

Una revisión acreditada pasa de `reviewVersion=NULL` a `1`. Cada propuesta admite una única decisión en esta política conservadora; la tabla es append-only y está preparada para una evolución explícita de política, sin implementar revisiones adicionales ahora.

Un `reviewedAt` previo sin revisión acreditada no se sobrescribe mediante una nueva decisión. Las filas históricas con estados distintos de PENDING se conservan sin inventar autorización.

## H. Auditoría persistente

Tabla aditiva `RecommendationReview` / `recommendation_reviews`:

- ID UUID y referencia RESTRICT a recomendación, atleta y usuario actor.
- Intención UUID única por atleta y huella del comando normalizado.
- Versión del formato de evento, acción, estado anterior/posterior, revisión anterior/posterior.
- Claves semántica y de ciclo, dependencias, aceptación mínima explícita y justificación.
- Fecha de decisión generada por el repositorio; no procede del cliente.

No se copia el snapshot completo: el evento referencia la generación inmutable y sus huellas. El SQL comprueba que actor y atleta correspondan y que el estado/versión originales sean compatibles. FK de usuario y atleta separadas no se consideran prueba suficiente de propiedad: el trigger comprueba la relación.

Triggers append-only impiden modificar/borrar eventos. Constraints diferidos verifican **ambos sentidos** al COMMIT: evento sin transición y transición versionada sin evento son inválidos. Fecha de revisión, estado final, claves y revisión deben coincidir. Si una escritura falla, se revierte el conjunto.

La lectura de autorización no se limita a encontrar cualquier evento APPROVE: verifica también las huellas de lo aceptado y su correspondencia con la generación/revisión. Un estado APPROVED sin evento/aceptación acreditados aparece como `UNKNOWN_UNAUDITED`.

## I. Idempotencia

Clave única PostgreSQL `(athleteId, intentId)` y unicidad `(recommendationId, version)`. La huella incluye la acción, propuesta, expectativas, aceptación, justificación y comando validado; no incluye el reloj de ejecución ni aleatoriedad añadida por el servidor.

Tras comprobar usuario/sesión, se busca primero una intención existente. Un reintento idéntico devuelve el mismo evento, ID y fecha aun si las fuentes cambiaron después. No vuelve a autorizar nada. Otra propuesta, decisión, aceptación, expectativa o motivo con el mismo intent produce `INTENT_REUSED`.

Un nuevo intent contra una revisión consumida produce `REVIEW_CONFLICT`. No se confunde reintento de transporte con una segunda decisión. Un rechazo tardío no puede sobrescribir una aprobación ganadora.

## J. Concurrencia y transacciones

Se usa SERIALIZABLE, locks PostgreSQL y CAS de estado/revisión. No hay locks de memoria Node. El orden sigue las fences de PROG-4B: usuario, sesión de autenticación y atleta; fuentes acotadas y plan/ejercicio/settings/tareas/series; para aprobación se añaden locks explícitos sobre día/prescripción, y finalmente propuesta/ciclo. NOWAIT y reintentos acotados evitan esperas cruzadas indefinidas.

Se verifica de nuevo la sesión tras las lecturas; los vencimientos se comparan con el reloj PostgreSQL. El bloqueo SHARE de la sesión impide que revocación concurrente se interprete como autorización vigente sin un orden transaccional válido. También se comprueba expiración de propuesta; el SQL la verifica al crear una aprobación.

Se conservan hasta cinco intentos y backoff 20/40/80/160 ms del patrón de persistencia existente; contención agotada produce `SOURCE_BUSY`. Timeout por transacción: 15 s. La revalidación mantiene los límites de PROG-2 (100 tareas, 1000 series, 2000 estimaciones); la política actual limita eventos a una revisión por propuesta.

Garantía: snapshot serializable coherente, fences y unicidad/CAS. No se promete frescura eterna ni exclusión universal de escritores externos que evadan protocolos. Una escritura posterior puede volver obsoleta una aprobación; PROG-5B debe volver a validar.

## K. Ciclo semanal

Se conservan semanticKey, cycleKey, cycleSlot y requestKey de PROG-4B. La aprobación exige reserva vigente de esa generación y ausencia de propuestas competidoras. El rechazo también conserva la reserva: **ninguna revisión libera cycleSlot** ni crea otra recomendación.

Sustitución futura pendiente: definir estados sustituibles, relación entre generaciones, liberación autorizada, nueva evidencia y consentimiento nuevo. El reintento no restablece estados terminales ni reutiliza una aceptación para otra versión/destino.

## L. Integridad histórica y destino

La revisión modifica exclusivamente campos operativos autorizados (`status`, `reviewedAt`, `reviewVersion`) y crea un evento. No cambia snapshot, configuración, cargas ni claves; tampoco estimaciones, objetivos, sesiones, series, planes, días, prescripciones o actividades.

Una prescripción DRAFT puede estar protegida por ejecuciones/recomendaciones históricas. La inspección lo comprueba y bloquea `TARGET_HAS_HISTORY`. Solo se puede aprobar un destino **PRESCRIPTION propio, DRAFT, no retirado, sin historial que impida editarlo y explícitamente resuelto**. WORKOUT_TASK sigue siendo inspeccionable/rechazable, sin inferir un destino efectivo desde sus referencias históricas.

Las cargas se validan mediante `assertPersistableDecimal` compartido: `PlanExercise` y `ProgressionApplication` siguen `Decimal(8,3)`, máximo exacto `99999.999`, escala efectiva máxima tres. `82.500000` cabe exactamente; `80.000001` no. Se requiere misma unidad conocida; no se convierte KG/LB ni se redondea/trunca para que quepa.

La generación de una propuesta legada pasa a estar protegida contra modificaciones después de una decisión PROG-5A explícita, para conservar qué se rechazó. El legado anterior sin evento no se congela ni reclasifica retrospectivamente.

## M. Consentimiento disponible y pendiente

`generationAuthorization` de PROG-4B continúa `NOT_GRANTED` o `LEGACY_UNKNOWN`: la generación por sí sola no autoriza.

La inspección añade una dimensión separada `manualAuthorization`:

- `ACCEPTED_FOR_THIS_PROPOSAL`: evento específico acreditado; siempre `requiresRevalidation=true`.
- `NOT_GRANTED`: no hay aceptación manual acreditada.
- `UNKNOWN_UNAUDITED`: estado de aprobación/aplicación sin procedencia válida según este contrato.

APPROVED no significa APPLIED. La aceptación no activa una política reutilizable ni automatización. `autoApplyAuthorized` no se usa como consentimiento. PROG-5C deberá diseñar por separado ámbito, límites, vigencia, revocación y auditoría de automatización.

## N. Prisma y migración

Nueva migración: `20261110000000_manual_recommendation_reviews/migration.sql`.

- Añade `review_version` nullable, sin default ni backfill.
- Crea tabla de eventos, FKs, índices únicos, CHECKs y triggers.
- Reemplaza mediante una **migración nueva** la función de protección de generación para admitir la revisión operativa, conservando los demás campos inmutables. No modifica el SQL anterior.
- Protege contra reset/sobrescritura de revisión y contra eventos sin transición concordante.
- No agrega estados al enum ni cambia columnas Decimal de planificación/aplicación.
- No crea consentimiento automático ni transiciones de aplicación.

**Compatibilidad deliberada:** cambios operativos externos de PROG-4B sobre filas con `reviewVersion=NULL` continúan siendo posibles por SQL privilegiado. No se declara que toda transición SQL histórica exija ahora un evento; sería una reinterpretación incompatible. Esos estados no acreditan autorización manual y el servicio no los adopta/reinicia. Las revisiones nuevas acreditadas sí están sujetas a las garantías bidireccionales. PROG-5B debe exigir el evento, no confiar en status.

Para una revisión acreditada, el SQL exige que el estado final permanezca igual al del evento. Se retiró una excepción inicial que anticipaba APPLIED; PROG-5B deberá introducir explícitamente su política/transacción de aplicación y mantener el historial de revisión, sin falsificar un nuevo evento 5A.

## O. PostgreSQL temporal y migración histórica

Se reutiliza `run-progression-isolated.mjs` con selector opcional `--reviews`; los selectores anteriores conservan su alcance. Cada ejecución crea un clúster propio bajo `/tmp/pulso-prog1b-*`, puerto aleatorio loopback y base `pulso_prog1b_test`; runner/helper comprueban URL efectiva, base, puerto y `data_directory`. No se ejecutan seeds. Aplica trece migraciones, comprueba estado y deriva y elimina exclusivamente sus recursos temporales, incluso ante fallos.

La prueba de migración crea otra base temporal dentro de ese clúster, aplica el esquema anterior y copia fixtures propios: seis estados legados y una generación real PROG-4B con captura/evidencia. La copia utiliza JSON como texto PostgreSQL, evitando conversiones de Decimal a Number y preservando microsegundos. Compara datos completos antes/después: todas las revisiones quedan NULL y la tabla de eventos vacía. Los triggers previos de inmutabilidad siguen funcionando.

Las regresiones de sesiones y planificación utilizan sus propios clústeres verificados. Ninguna prueba escribe en `proyecto_pow_dev`.

## P. Pruebas ejecutadas

Desde `backend/`, excepto Git:

| Comando | Resultado final |
| --- | --- |
| `npm test -- --runInBand` | **556 pruebas, 50 suites**, aprobadas: 539 previas + 17 nuevas unitarias de revisión. |
| `node test/run-progression-isolated.mjs --reviews` | **196 pruebas, 7 suites**, aprobadas: 139 previas + 56 casos de revisión + 1 migración nueva. PostgreSQL real. |
| `node test/run-workouts-mvc-isolated.mjs all` | **27 pruebas, 3 suites**, HTTP/PostgreSQL, aprobadas. |
| `node test/run-planning-mvc-isolated.mjs all` | **26 pruebas, 4 suites**, HTTP/PostgreSQL, aprobadas. |
| `npx tsc --noEmit` | Aprobado. |
| `npm run lint` | Aprobado. |
| `npm run build` | Prisma generate y Nest build aprobados. |
| `npm run prisma:validate` | Aprobado. |
| `migrate status` y `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | Ejecutados por runner temporal: trece migraciones al día, sin deriva. |
| `npx prettier --check` sobre los doce archivos TS creados/modificados | Aprobado. |
| `git diff --check` | Aprobado. |

**805 pruebas distintas**, incluidas **74 nuevas** (17 unitarias y 57 PostgreSQL). No se suman ejecuciones repetidas, línea base ni experimentos negativos como pruebas adicionales.

Cobertura: aprobación y rechazo explícitos, sesiones reales vigentes/revocadas/expiradas/ajenas, cuenta inactiva, propietario ajeno, datos legados, expectativas manipuladas, aceptación ausente/incorrecta, precisión, destino protegido/retirado, fuente inaccesible, obsolescencia, carreras settings/plan, decisiones simultáneas idénticas y distintas, respuesta perdida, intención reutilizada, inmutabilidad, actor SQL ajeno, aceptación SQL/JSON NULL, justificación NULL, auditoría huérfana, transición sin evento y rollback de ambos lados.

La fase roja inicial tuvo 16 fallos con la política aún vacía. Una regresión adicional reprodujo la clasificación incorrecta de un evento con digest inválido antes de corregirla. La excepción SQL APPLIED se comprobó mediante una mutación controlada exclusivamente en clúster temporal; se restaura siempre el SQL definitivo antes de la ejecución final.

Fallos intermedios de fixtures: la fecha de expiración de una sesión y una propuesta incumplía sus restricciones de vida existentes. Se ajustaron fixtures/fechas, no constraints ni aserciones. No quedan fallos nuevos conocidos.

Advertencias existentes observadas: Node VM Modules experimental, warning de concurrencia del driver pg hacia pg9 (también en regresiones no modificadas) y mensajes esperados de reutilización de refresh en pruebas negativas de autenticación. No se cambian dependencias ni autenticación para ocultarlos.

No se ejecutó navegador, frontend ni un nuevo escaneo canónico de seguridad. No se modificaron esas superficies ni se atribuye verificación visual/producción a las pruebas internas.

## Q. Regresiones

Se mantienen matemáticas, conversiones, elegibilidad, estimaciones descriptivas, lectura histórica, cumplimiento/RPE, generación, persistencia, claves y protecciones de PROG-1 a PROG-4B. Las 139 pruebas PostgreSQL previas se ejecutan junto a las nuevas. Sesiones y planificación mantienen sus contratos HTTP y restricciones históricas. No se modificó AUTH-HARDEN-1, frontend o calendario.

## R. Archivos de esta etapa

Creados:

- `backend/src/models/progression/recommendation-review.model.ts`: inspección, aceptación, comando, eventos y errores internos.
- `backend/src/domain/progression/recommendation-review.policy.ts`: validación, matriz, compatibilidad y huellas.
- `backend/src/domain/progression/recommendation-review.policy.spec.ts`: pruebas puras.
- `backend/src/progression/recommendation-review.persistence.ts`: implementación transaccional del repositorio existente.
- `backend/prisma/migrations/20261110000000_manual_recommendation_reviews/migration.sql`: evolución compatible y garantías SQL.
- `backend/test/helpers/recommendation-review-fixtures.ts`: fixtures propios con sesiones de autenticación vigentes.
- `backend/test/recommendation-review.e2e-spec.ts`: integración, ataques, concurrencia y rollback.
- `backend/test/recommendation-review-migration.e2e-spec.ts`: conservación de generaciones/estados anteriores.
- `docs/superpowers/plans/2026-11-10-prog5a.md`: plan de implementación.
- `docs/architecture/prog-5a-manual-review.md`: este informe y alcance futuro.

Modificados respecto al comienzo de esta etapa:

- `backend/prisma/schema.prisma`: reviewVersion, tabla y relaciones inversas de auditoría; sin cambiar datos de atletas/usuarios ni la autenticación.
- `backend/src/models/progression/persisted-recommendation.model.ts`: revisión nullable de lectura.
- `backend/src/progression/recommendation.service.ts`: casos internos de inspección y decisión.
- `backend/src/progression/progression.repository.ts`: contratos nuevos internos.
- `backend/src/progression/prisma-progression.repository.ts`: integración con su lector transaccional existente.
- `backend/src/progression/recommendation.persistence.ts`: mapeo de revisión y reutilización de fences/errores existentes.
- `backend/test/run-progression-isolated.mjs`: selector `--reviews`.

Los demás archivos dirty/untracked de Git pertenecen a etapas anteriores; se conservaron. No se hicieron commits ni push.

## S. Skills y herramientas

Utilizadas: `pulso-architecture-review` y referencia MVC, `pulso-domain-integrity`, `pulso-integration-testing`, `pulso-prisma-migrations`; procedimientos Superpowers de exploración/diseño, planificación, TDD, diagnóstico, revisión independiente y verificación. Se adaptaron las instrucciones genéricas de Git a la prohibición expresa de commits/worktrees del proyecto.

Herramientas efectivas: lecturas de código/Git, Prisma/TypeScript/Jest/oxlint/Prettier, PostgreSQL temporal, consulta de migraciones READ ONLY y segundo agente revisor. Este revisor trabajó en solo lectura, sin ejecutar PostgreSQL ni modificar archivos.

No se utilizaron Graphify, herramientas visuales, navegador ni Codex Security. No se instalaron dependencias ni se modificaron skills, permisos o configuración Codex.

## T. Revisión independiente y límites

El revisor comprobó procedencia, propiedad, estados, auditoría, idempotencia, SQL NULL, fences, precisión y separación de aplicación. Sus recomendaciones se atendieron: sesión activa comprobada transaccionalmente, bloqueo de destinos con historial, constraints bidireccionales y retirada de la excepción APPLIED. Se añadieron pruebas reales de carreras de plan y ataques SQL directos. La auditoría no sustituye los tests PostgreSQL.

Límites que deben mantenerse visibles:

1. Aceptación interna por caso, no presencia humana ni interfaz pública de consentimiento.
2. Sin política reutilizable de producción ni automatización; pendientes de PROG-5C.
3. Sin revocación, sustitución o segunda revisión; solo las dos transiciones conservadoras definidas.
4. Destinos activos, protegidos, sin unidad, sin precisión exacta o no resueltos no se autorizan. Copias futuras requieren otro destino y aceptación propia.
5. SQL privilegiado puede mantener estados no acreditados bajo el contrato anterior con reviewVersion NULL; nunca deben usarse como autorización.
6. Mantener lectores de formatos/algoritmos históricos al evolucionar versiones; no cambiar silenciosamente el significado de eventos/capturas V1.
7. Revalidación obligatoria antes de aplicar; una aprobación puede quedar obsoleta después.
8. Despliegue de las dos migraciones pendientes requiere autorización y revisión operativa de locks/backup. Desarrollo sigue intacto.
9. Sin nuevo escaneo canónico ni prueba de producción/carga; no se declara certificación.

## U. Estado final

| Aspecto | Estado |
| --- | --- |
| Inspección | Implementada y verificada internamente, coherente y propia. |
| Vigencia | Verificada respecto a ventana/dependencias declaradas; no equivale a validez eterna. |
| Revisión | Verificada: PENDING→APPROVED/REJECTED y ninguna otra acción del servicio. |
| Autorización manual | Verificada como intención interna explícita por propuesta y actor/sesión; UI/HTTP/presencia humana no implementados. |
| Auditoría | Persistente, append-only y atómica para revisiones acreditadas PROG-5A. |
| Estados | CAS/versión y expectativas verificados; legado no se reinicia ni acredita retrospectivamente. |
| Idempotencia | UNIQUE y concurrencia real verificados; preserva evento/fecha/estado. |
| Concurrencia | Snapshot/fences/CAS/rollback verificados, con límites indicados. |
| Integridad histórica | Verificada; sin modificaciones de planificación, sesiones, series ni generación. |
| PostgreSQL | Migración y regresiones reales verificadas en clústeres desechables; desarrollo sin migrar. |

PROG-5A queda disponible para revisión manual del código como infraestructura interna. No equivale a aplicación de progresión ni a preparación para producción.

## V. PROG-5B — Diseño, sin implementación

1. Resolver actor autenticado y propiedad; exigir evento APPROVE acreditado para esa generación, no solo status/autoApplyAuthorized.
2. Verificar su formato, huellas de aceptación, revisión, alcance, destino y carga exactos; nunca reutilizar una aceptación en otra generación/copia.
3. Releer evidencia/configuración/cohorte/readiness/RPE y comprobar vigencia temporal/destino; bloquear discrepancias, revocaciones o fuentes inaccesibles.
4. Volver a comprobar ciclo y reserva, evitando doble aplicación y revisiones competidoras. La sustitución requiere política explícita y trazabilidad entre generaciones.
5. Diferenciar fuente histórica, destino previsto y destino efectivo. Para programación protegida/activa, evaluar los mecanismos existentes de copia futura; si cambia el destino aceptado, pedir nueva autorización específica.
6. Resolver `TrainingPlan → PlanWeek → PlanDay → PlanExercise` y `ScheduledActivity` propios, futuros y editables. Nunca cambiar actividades/sesiones ya realizadas ni reinterpretar una actividad como ejecución.
7. Validar versiones de plan/día/actividad y consentimiento dentro de la misma transacción. Definir orden de locks compatible con planificación, ejecución, recomendación y auditoría.
8. Comprobar representabilidad exacta en PlanExercise/ProgressionApplication `Decimal(8,3)` y rejilla/unidad. Rechazar incompatibilidad; cualquier ampliación de precisión requiere su propia migración/fixtures, sin truncar ni convertir silenciosamente.
9. Definir comando idempotente de aplicación, UNIQUE de ProgressionApplication y CAS del destino/estado. Reintento devuelve la misma operación, sin incrementar dos veces.
10. Introducir explícitamente la transición APPROVED→APPLIED y su auditoría de aplicación, conservando el evento de revisión. Adaptar los constraints para ese flujo completo; 5A actualmente lo bloquea.
11. Confirmar modificación futura, auditoría, destino efectivo y aplicación de forma atómica. Probar fallo en cada escritura, pérdida de respuesta, aprobación obsoleta, copia concurrente y rollback sin alterar historial.
12. Mantener aplicación automática fuera de PROG-5B hasta diseñar consentimiento delimitado/revocable de PROG-5C. Integración HTTP/UX futura debe autenticar y recoger la decisión humana explícita.

No se implementaron estos flujos en PROG-5A.
