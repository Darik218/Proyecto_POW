# PROG-4A — Motor interno de propuestas semanales

## A. Estado inicial

Fecha de verificación: 9 de noviembre de 2026. Rama `feature`, HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`. Se conservaron los cambios acumulados de PROG-3, incluidos archivos no rastreados. El informe `prog-3-assessment.md` no estaba disponible al comenzar; se contrastaron directamente código, modelos y pruebas actuales. No se reconstruyó ese documento ni se descartó trabajo anterior.

Línea base ejecutada desde backend: `npm test -- --runInBand`: **425 pruebas en 43 suites aprobadas**. Se registraron hashes de 379 archivos existentes para verificar la conservación del alcance al finalizar.

## B. Auditoría de configuración y persistencia

`ProgressionSetting` existe y permite tres alcances, protegidos por índices únicos parciales SQL: atleta general, atleta/ejercicio, atleta/ejercicio/plan. La FK compuesta de plan y atleta conserva pertenencia. El CHECK de alcance impide plan sin ejercicio.

| Campo persistido | Tipo / semántica observada |
|---|---|
| id, athleteId, exerciseId?, trainingPlanId? | UUID y referencias; se resuelven por propiedad. |
| minSuccessfulSessions | Int positivo, default SQL/Prisma 3; no acredita una política completa. |
| targetRpeMin / targetRpeMax | Decimal(3,1), intervalo 0–10 válido. |
| incrementAbsolute? | Decimal(8,3), no contiene unidad. |
| incrementPercent? | Decimal(6,3), limitado por maxIncrementPercent. |
| maxIncrementPercent | Decimal(6,3), no negativo. |
| maxLoad? | Decimal(8,3), positivo cuando existe; tampoco contiene unidad. |
| autoApplyAuthorized | Boolean; no autoriza aplicar durante PROG-4A. |
| updatedAt | Revisión disponible de la configuración, conservada en evidencia. |

SQL admite ambos incrementos, ninguno o cero. El motor debe resolver esos casos: no están solucionados por existir la tabla.

`ProgressionRecommendation`, `RecommendationEvidence` y `ProgressionApplication` también existen, pero PROG-4A no las escribe. La recomendación actual carece de unidad explícita, identidad semántica única y snapshot completo dedicado; sus cargas son Decimal(8,3). Evidence permite una fila por recomendación/sesión, sin detalle por tarea. Application tiene una relación única con recomendación y carga Decimal(8,3).

## C. Arquitectura

```text
RecommendationService.proposeMyExercise(identity, command)
  → validateRecommendationCommand: validación, allowlist y copia antes de await
  → ProgressionRepository.readRecommendationContext(userId, query, destination)
      una transacción REPEATABLE READ + SET TRANSACTION READ ONLY
      cuenta/atleta/ejercicio → destino → filas de configuración → historia
  → prepareRecommendation: configuración, cohorte, analyzePerformance existente
  → assessHistory existente: la misma coordinación utilizada por AssessmentService
  → decideRecommendation: decisión pura y cálculo de incremento
  → evidencia JSON, claves de dependencias e identidad semántica
```

Se conserva ProgressionModule, un repositorio y el cliente Prisma existente. RecommendationService se registra y exporta junto a OneRmService, PerformanceService y AssessmentService.

Para compartir snapshot, el cuerpo de lectura de historia se extrajo a `readHistoryWithin(tx, ...)`. Tanto la lectura anterior como la nueva lo usan sin transacciones anidadas. No se cambiaron sus filtros, orden, límites ni conversión de datos. Los métodos de persistencia PROG-1B no se modificaron.

Las matemáticas y decisiones permanecen en Domain. El servicio coordina lecturas y las evaluaciones existentes; el dominio no depende en ejecución de servicios NestJS. Los modelos son contratos internos realmente consumidos. No se crearon controladores o presentadores sin consumidor HTTP. Las rutas y vistas MVC existentes se conservan.

## D. Configuración efectiva

Precedencia de fila completa:

1. Atleta + ejercicio + plan.
2. Atleta + ejercicio.
3. Atleta general.

Primero se selecciona la fila; después se valida. Una fila específica incompleta bloquea la operación: nunca se rellenan sus huecos con otra menos específica. Duplicados del mismo alcance producen AMBIGUOUS_SETTING_SCOPE. La fila seleccionada, alcance, revisión y razones se conservan.

`RecommendationPolicy` aporta explícitamente ID, versión y referencia de procedencia `EXPLICIT_INTERNAL_POLICY`. Es una declaración del consumidor interno para realizar este análisis; no constituye una autorización de aplicación ni una política operativa aprobada por los tests.

Son necesarios: base de objetivos, fuente de carga inicial, cohorte, reglas PROG-3 básicas y readiness, posiciones/interpretación de objetivos, conteo, mínimo coincidente con la fila seleccionada, tratamiento RPE y revisión, ventana, rejilla y conocimiento temporal.

Cuando coexisten ambos incrementos se exige incrementMode. Sin un incremento seleccionado positivo se devuelve configuración requerida. Unidad de valores absolutos y maxLoad procede de `settingLoadUnit`, declarada externamente, nunca de preferredUnit ni inferida de un valor antiguo.

`settingRpeUse=REQUIRE_INTERVAL` comprueba que la regla readiness utiliza el intervalo de la fila seleccionada. `CONTEXT_ONLY_EXPLICIT` conserva esos límites como contexto y aplica las reglas externas declaradas; no los presenta como límites decisorios utilizados. autoApplyAuthorized permanece en el snapshot, pero toda salida tiene `applicationAuthorization: NOT_GRANTED`.

Las configuraciones incompletas, ambiguas o incompatibles se explican con códigos estables. Entradas de recursos/fechas malformadas se rechazan con errores internos tipados. No hay defaults de rejilla, unidad, período, referencia, umbral RPE o modo de conteo.

## E. Semana deportiva

Entrada obligatoria: start inclusivo, endExclusive, timeZone, cutoffOn deportivo inclusivo y weekStartsOn ISO 1–7. Se comprueban fechas reales, siete fechas civiles, día inicial coherente, zona válida y corte dentro de la semana.

La consulta histórica usa from explícito y to igual a cutoffOn; from debe incluir como mínimo el inicio semanal. Se permite una ventana histórica anterior explícita para reunir referencias y sesiones. La zona de historia debe coincidir con la semanal.

Una semana que cruza DST sigue representando siete fechas civiles. No se deduce de weekNumber ni de createdAt. El ancla debe haberse ejecutado dentro de la semana hasta el corte. No se inventa orden entre sesiones de una misma fecha.

`requireClosedWeek` es obligatorio: si es true y el corte no alcanza el último día, el resultado es insuficiencia. Si es false, el consumidor ha solicitado explícitamente analizar la semana hasta el corte. No hay reloj del sistema dentro del cálculo.

**Límite temporal:** `CURRENT_RECORDS_FOR_SPORTING_CUTOFF` significa que se usan registros actualmente disponibles cuyas fechas deportivas están en la ventana. Incluye registros retrospectivos cargados después. No reconstruye qué sabía la base en una fecha histórica; los timestamps de auditoría se conservan sin convertirlos en fechas de entrenamiento. El consumidor debe suministrar un corte legítimo; no se introduce una comprobación de “hoy” no determinista.

## F. Identidad y destino

Dos destinos internos:

- PRESCRIPTION: se verifica plan → semana → día opcional → prescripción → ejercicio y atleta. Se conservan plan.version y snapshot explícito de los targets actuales del destino. Una prescripción semanal antigua sin día exige revisión.
- WORKOUT_TASK: se comprueba propiedad de tarea/sesión/ejercicio. Si existe planExerciseId, se resuelve su plan real, semana, día y versión, verificando propietario; así se selecciona también la configuración ejercicio/plan. Sus objetivos históricos siguen viniendo de snapshots y campos de la tarea, no del plan actual.

Una asociación posterior de sesión libre no se usa para reconstruir prescripciones ni inventar un origen. Para señalar un destino de planificación concreto se utiliza el selector PRESCRIPTION.

La cohorte exige SAME_PRESCRIPTION o EXPLICIT_TASK_SET. La primera utiliza el ID real de prescripción, no solo exerciseId. La segunda declara expresamente qué tareas se pueden comparar, incluso si proceden de distintas prescripciones; todavía deben cumplir comparabilidad y objetivos equivalentes. Los IDs excluidos y sus razones quedan en evidencia.

La fuente de carga inicial es explícita: destino prescrito, objetivo original del ancla u objetivo ajustado del ancla. Una base ADJUSTED no puede incrementar desde ANCHOR_ORIGINAL divergente, ni al revés. Si los targets vivos del destino PRESCRIPTION divergen de los objetivos evaluados, se exige revisión, sin imponer un orden universal ni transferir cumplimiento automáticamente.

## G. Cumplimiento y mínimo

Se reutiliza `assessHistory`, la coordinación exportada utilizada por AssessmentService, sin reimplementar cumplimiento, conteos, medianas o comparabilidad.

La política selecciona ORIGINAL o ADJUSTED. Ambas evaluaciones permanecen en evidencia. La combinación “ambos” no se infiere: requiere una futura política definida; una base desconocida se rechaza.

El mínimo debe coincidir con minSuccessfulSessions de la fila efectiva y venir acompañado de modo acumulado/consecutivo, criterio BASIC/READINESS, ventana, ancla y tratamiento de fechas iguales. Se usan qualifyingCount, countUnit, estado y cobertura, no solamente meetsMinimum.

Un conteo PARTIAL no autoriza incremento, aunque contenga un mínimo numéricamente alcanzado. Una observación de cumplimiento PARTIAL con evidencia completa puede, en cambio, acreditar incumplimiento parcial: conduce a MAINTAIN cuando no cumple mínimo/readiness, no se convierte automáticamente en falta de datos. INSUFFICIENT_SLOT_EVIDENCE, posiciones ausentes o contradicciones conservan la insuficiencia.

Readiness del ancla debe estar acreditado por una regla explícita. No basta COMPLETED, ni cumplir solo el básico, ni disponer de una estimación de 1RM. Varias series y fórmulas de una sesión no multiplican sesiones.

## H. RPE y señales

Se mantienen STRICT_PROG2 y MATCHED_LOAD_DESCRIPTIVE separados. No se infiere RIR, esfuerzo máximo ni fatiga fisiológica. La cobertura y referencias son las calculadas por PROG-3 bajo la política declarada.

La política debe seleccionar:

- NOT_REQUIRED_EXPLICIT: no exige señales como condición de incremento.
- ANY_SIGNAL: necesita una observación AVAILABLE del ancla y evaluaciones requeridas disponibles. Una señal verdadera exige revisión.
- TEMPORAL_SIGNAL: necesita política k/m explícita, evaluación temporal disponible y una ventana que termine en el ancla. No se aprueba una tarea actual usando solamente señales de tareas anteriores.

La ausencia de comparaciones, umbrales, cobertura o referencia no equivale a ausencia de señal cuando la evaluación es obligatoria. No existe deload automático: REVIEW_REQUIRED no contiene una carga reducida.

## I. 1RM

Se consumen únicamente estimaciones existentes que PROG-2 valida y presenta. Epley, Brzycki, versiones matemáticas, elegibilidad, unidad y procedencia permanecen separados. No se calcula una media, máximo o fórmula principal implícita.

Se conservan puntos y diferencias comparables como contexto descriptivo; estimaciones legadas no verificables quedan excluidas con razones. NOT_ASSESSED no se convierte en evidencia oficial. DECISION_CRITERION produce ONE_RM_DECISION_POLICY_REQUIRED: faltan políticas aprobadas de fórmula, selección de evidencia y condición decisoria. No se recalculan ni persisten estimaciones.

## J. Decisiones

| Resultado | Condición |
|---|---|
| CONFIGURATION_REQUIRED | Política incompleta/ambigua, unidad o rejilla incompatible, criterio no soportado. |
| INSUFFICIENT_DATA | Evidencia ausente, contradictoria, truncada, no comparable, readiness desconocido o señal obligatoria no evaluable. |
| REVIEW_REQUIRED | Señal bloqueante acreditada, cambio de versión/destino, destino retirado/divergente o carga ya superior al límite. |
| MAINTAIN | La evidencia permite evaluar, pero mínimo/readiness no se cumplen. |
| NO_REPRESENTABLE_INCREMENT | Criterios satisfechos, sin un punto de rejilla estrictamente mayor dentro de los límites. |
| INCREASE | Configuración completa, evidencia suficiente, mínimo/readiness acreditados y carga realizable dentro de todos los límites. |

Estas decisiones son internas; no son nuevos estados Prisma. No se guardan recomendaciones ni se modifican sesiones o prescripciones. No certifican capacidad física futura ni autorización de aplicación.

## K. Matemática de cargas

Cálculos en unidad nativa explícita, con Decimal local de precisión 384. Se reutiliza el parser acotado PROG-1A; no se cambia la configuración Decimal global. Los factores de conversión no se duplican: la representación canónica se obtiene con interpretLoad existente.

```text
Δsolicitado = incremento absoluto
            o L0 × porcentaje / 100
Δpermitido = min(Δsolicitado, L0 × máximoPorcentual / 100)
U = min(L0 + Δpermitido, maxLoad cuando exista)
Lnuevo = origen + paso × floor((U − origen) / paso)
```

Se exige L0 > 0, paso > 0, origen no negativo, unidad conocida y EXTERNAL_TOTAL explícito. No se convierte null en cero. Si L0 supera maxLoad, se pide revisión. Si Lnuevo ≤ L0 no se fuerza una subida.

El origen es un desplazamiento de la rejilla aritmética configurada; no se inventa a partir del peso de una barra o máquina. No implica por sí solo un mínimo físico adicional no suministrado.

**Representación:** carga inicial, paso y origen tienen como máximo seis decimales en este contrato. Rejillas de mayor escala devuelven GRID_SCALE_UNSUPPORTED; no se redondean para aparentar representabilidad. El resultado nativo de seis decimales pertenece exactamente a la rejilla. Los límites y Δ conservan todos los decimales necesarios; solo la carga canónica utiliza el redondeo vigente a seis decimales.

**Unidades mezcladas:** baseline, rejilla y valores absolutos de configuración deben usar la misma unidad declarada. KG y LB están soportadas nativamente. Mezclarlas en una operación devuelve UNIT_POLICY_MISMATCH; no se decide un límite mediante una conversión canónica ya redondeada. Un conversor exacto entre unidades para límites podría añadirse después bajo una política explícita.

Ejemplos comprobados:

| Entrada | Resultado |
|---|---|
| 80 KG + 2,5 KG; q=2,5; origen=0 | 82.500000 KG. |
| 80 KG + 2%; q=2,5; origen=0 | NO_REPRESENTABLE_INCREMENT; 82,5 supera 81,6. |
| 100 KG + 5 KG; maxLoad=102; q=2,5 | NO_REPRESENTABLE_INCREMENT; no se propone 102,5. |
| 100 LB + 2,5 LB; q=2,5 LB | 102.500000 LB, representación canónica 46.493218 KG. |
| Sin unidad, significado o rejilla | Configuración/evidencia requerida; ninguna carga inventada. |

## L. Evidencia

La captura `recommendation-evidence-v1` conserva motor, política, atleta/ejercicio, semana y ventana histórica, corte, conocimiento temporal, destino y versiones disponibles, fila efectiva, procedencia externa, evaluaciones original/ajustada, conteo, señales, referencias, contexto 1RM, fuentes/series y exclusiones, cobertura, carga inicial, incremento, límites, rejilla y decisión.

No se copian filas Prisma completas. Las lecturas seleccionan campos; los objetivos provienen de capturas existentes y campos de la sesión. La entrada aplica allowlists al sobre y a los componentes de política para no arrastrar campos extra del consumidor. Los datos de autenticación no forman parte de estas consultas ni de la evidencia.

Antes de calcular la clave, la captura se convierte en JSON válido: ausencia sigue siendo ausencia, null y cero permanecen distintos. Se probó que persistir/restaurar ese JSON no cambia su identidad. Ninguna captura se escribe durante esta etapa.

## M. Determinismo y obsolescencia

Identidad SHA-256 con prefijo versionado `prog-4a-semantic-v1`. Se ordenan claves de objetos, se normalizan lexemas decimales y se ordenan colecciones sin significado temporal, incluidas posiciones de mapeo. No se normalizan identificadores como si fueran números. Los registros conservan fechas y posiciones que permiten interpretar su orden real; IDs no acreditan orden intradía.

Mismas entradas/políticas/versiones producen misma salida y clave. Cambiar fuente, versión, configuración efectiva, período, destino o política cambia la identidad pertinente. No se incluyen hora de consulta, reloj ni valores aleatorios. Los timestamps de fuentes y revisiones sí identifican evidencia real, no el instante de consulta.

`dependencyKeys` separa configuración, período, destino y evidencia; compareDrafts informa obsolescencia y componentes cambiados. No actualiza estados persistidos. PROG-4B/5 deberán releer dependencias y autorización; la fecha de creación sola no acredita vigencia.

## N. PostgreSQL

Runner reutilizado: `node test/run-progression-isolated.mjs --performance`. Cada ejecución crea un clúster propio bajo `/tmp/pulso-prog1b-*`, verifica host loopback, puerto, base `pulso_prog1b_test` y data_directory, aplica únicamente las 11 migraciones existentes y comprueba status/diff. No ejecuta seeds.

Última batería de progresión: `/tmp/pulso-prog1b-rSWvH2/data`, puerto 36965, detenido y eliminado por el runner. Los runners de sesiones y planificación crean y limpian sus propios clústeres temporales.

El módulo Nest real se ejecutó con un rol CONNECT/USAGE/SELECT exclusivamente. Configuración, destino y fuentes se leen dentro de una única transacción REPEATABLE READ READ ONLY. Una prueba introduce cambios de configuración, versión del plan y serie desde otra conexión entre lecturas: la primera propuesta conserva el snapshot anterior completo y la segunda ve el nuevo.

Huellas SQL exactas antes/después comprobaron ausencia de cambios en planes, semanas, días, prescripciones, sesiones, series, estimaciones, configuraciones, recomendaciones, evidencias y aplicaciones. Los fixtures se crean mediante otra conexión administrativa exclusivamente en el clúster temporal.

## O. Seguridad e integridad histórica

Identidad derivada de identity.account.id; cuenta activa y atleta se verifican en PostgreSQL. No se acepta athleteId como autoridad. Se rechazan planes, tareas y ejercicios privados ajenos; se valida jerarquía completa y pertenencia del origen prescrito al atleta.

No se hacen nuevas relaciones persistentes con PlanExercise. Los repositorios de planificación actuales bloquean edición/eliminación por recomendaciones o ejecuciones existentes; esas restricciones se conservan. La generación lectora no activa nuevos bloqueos históricos.

La revisión independiente fue focalizada. No se ejecutó un nuevo escaneo canónico Codex Security ni una certificación de producción. El futuro acceso HTTP y la autorización de aplicación necesitan sus propios controles y pruebas.

## P. Pruebas

Desde backend, resultados finales:

| Comando | Resultado |
|---|---:|
| `npm test -- --runInBand` | 521 pruebas, 48 suites, aprobadas. |
| `node test/run-progression-isolated.mjs --performance` | 92 pruebas PostgreSQL, 3 suites, aprobadas. |
| `node test/run-workouts-mvc-isolated.mjs all` | 27 pruebas HTTP/PostgreSQL, 3 suites, aprobadas. |
| `node test/run-planning-mvc-isolated.mjs all` | 26 pruebas HTTP/PostgreSQL, 4 suites, aprobadas. |
| `./node_modules/.bin/tsc --noEmit --incremental false` | Aprobado. |
| `npm run lint` | Aprobado. |
| `npm run build` | Prisma generate y Nest build. |
| `npm run prisma:validate` | Validación de esquema. |
| `git diff --check` / Prettier focalizado | Comprobaciones finales del parche y formato. |

**666 pruebas distintas**: 521 + 92 + 27 + 26. Las nuevas son 96 unitarias y 19 PostgreSQL; las repeticiones no se suman. La batería conserva las pruebas anteriores de PROG-1A/B, PROG-2 y PROG-3.

Pruebas nuevas: fila completa y alcances, ambigüedad, mínimo/readiness, señales obligatorias del ancla, períodos/corte/DST, sesiones retrospectivas, unidades/precisión/rejillas/caps, objetivos divergentes, rondas JSON y orden canónico, procedencia 1RM separada, tarea planificada, cuenta suspendida, relaciones privadas y snapshot concurrente.

Durante desarrollo se observaron pruebas rojas de funcionalidades ausentes y regresiones de defectos antes de corregirlos. La primera integración incluía un fixture de cohorte vacía mientras intentaba probar truncamiento: se corrigió el fixture para mantener política válida y activar realmente el límite de lectura. Otra ejecución reprodujo la pérdida de configuración de plan para WORKOUT_TASK; se corrigió resolviendo su referencia real. No se debilitaron aserciones ni restricciones SQL.

## Q. Regresiones y limitaciones verificadas

Sin cambios de schema.prisma, migraciones, seeds, fórmulas PROG-1A, persistencia de estimaciones PROG-1B, políticas PROG-2/3, frontend, autenticación, calendario, sesiones o planificación. Solo se adaptaron las lecturas y registro del módulo de progresión para este caso de uso.

No se ejecutaron navegador/frontend porque no hay nuevas interfaces o contratos públicos. Las pruebas PostgreSQL son reales; no se presentan mocks como evidencia transaccional. Se mantuvieron las advertencias preexistentes de VM Modules, detección de reutilización de refresh en tests y deprecación pg sobre client.query concurrente en runners relacionados.

## R. Archivos de esta etapa

Nuevos:

- `backend/src/models/progression/recommendation-draft.model.ts`: contratos internos de período, destino, configuración y decisión.
- `backend/src/domain/progression/effective-settings.policy.ts` y su spec: precedencia y completitud.
- `backend/src/domain/progression/weekly-period.policy.ts` y su spec: semana/corte deportivos.
- `backend/src/domain/progression/load-increment.policy.ts` y su spec: Decimal, caps y rejilla nativa.
- `backend/src/domain/progression/recommendation.policy.ts` y su spec: preparación/decisión puras, exclusiones y obsolescencia.
- `backend/src/domain/progression/recommendation-query.policy.ts` y su spec: entrada acotada y copia/allowlist.
- `backend/src/domain/progression/recommendation-evidence.policy.ts`: identidad canónica versionada.
- `backend/src/progression/recommendation.service.ts`: coordinación y caso de uso interno.
- `backend/test/helpers/recommendation-fixtures.ts`: fixtures de prueba explícitos, sin defaults de producción.
- Este informe.

Modificados respecto a la línea base de PROG-4A:

- `backend/src/progression/progression.repository.ts`: contrato de lectura coherente.
- `backend/src/progression/prisma-progression.repository.ts`: helper de lectura compartido y consulta de configuración/destino.
- `backend/src/progression/progression.module.ts`: registro/exportación del servicio.
- `backend/test/performance.e2e-spec.ts`: 19 escenarios PostgreSQL reutilizando rol SELECT y fixtures aislados.

Los demás archivos sucios/no rastreados de PROG-3 se conservan y no se atribuyen a PROG-4A.

## S. Skills y herramientas

Se consultaron AGENTS.md, pulso-architecture-review y referencia MVC, pulso-domain-integrity, pulso-integration-testing y pulso-prisma-migrations. Superpowers se utilizó para plan incremental, TDD, diagnóstico, verificación y revisión independiente de solo lectura. Las restricciones explícitas de Git/PostgreSQL prevalecieron sobre procedimientos genéricos de commit o worktree.

Herramientas utilizadas: rg/Git, Jest, TypeScript, oxlint, Prettier, Prisma validate/generate/migrate en entorno temporal, Nest build y PostgreSQL real. No se instalaron dependencias ni se modificaron skills o configuración de herramientas. Graphify y herramientas visuales no fueron necesarios. No se atribuye un escaneo Security no ejecutado.

La revisión independiente identificó y se corrigieron: autocomparación del ancla en consecutividad, omisión del ancla en revisión RPE obligatoria, pérdida de contexto de plan para tarea prescrita, pérdida de identidad al serializar undefined a JSON, orden no canónico de slots y transferencia indebida entre objetivos divergentes. También se distinguió incumplimiento PARTIAL conocido de insuficiencia real.

## T. Decisiones operativas pendientes

La existencia de funciones y fixtures no aprueba una política de entrenamiento. Antes de uso operativo deben acordarse:

1. Política efectiva autorizada y mecanismo que acredita su origen/versiones.
2. ORIGINAL, ADJUSTED o una regla futura explícita para ambos; transferencias entre bases/destinos siguen bloqueadas sin regla.
3. Criterio básico/readiness, mínimo y modo acumulado/consecutivo; una misma fecha como sesión o unidad deportiva.
4. Ventana histórica, semana inicial, corte y semanas parciales. No se dispone de reconstrucción de estado histórico de la base.
5. Intervalo RPE decisorio frente a contextual y revisión obligatoria/temporal; umbrales, cobertura, referencias y k/m requieren valores explícitos.
6. Unidad de incrementos/maxLoad legados, origen de la rejilla y equipamiento real. No se infieren del atleta o máquina.
7. Rejillas mixtas o de más de seis decimales: esta versión las rechaza; una ampliación necesita conversión exacta y pruebas propias.
8. 1RM decisorio: permanece fuera de alcance hasta definir fórmula, versiones, calidad y reglas de evidencia; hoy solo contexto descriptivo.
9. Caducidad de propuestas, condiciones de obsolescencia y validación antes de guardar/aplicar.

## U. Estado final

| Área | Estado |
|---|---|
| Motor de decisión | Implementado y verificado internamente. |
| Configuración | Fila completa, precedencia y requisitos explícitos verificados. |
| Cumplimiento | Reutilización PROG-3 y separación original/ajustado verificadas. |
| RPE | Contexto/señales verificadas con política explícita; sin diagnóstico. |
| Incrementos | KG/LB nativos, Decimal, límites y rejilla hacia abajo verificados. |
| Evidencia | Captura JSON con procedencia y contexto descriptivo 1RM. |
| Determinismo | Versiones, canonicalización, reordenación y cambios de fuente verificados. |
| PostgreSQL | Lectura coherente real, rol SELECT y conservación de filas verificados. |
| Seguridad | Propiedad/cuenta/visibilidad verificadas para el caso de uso interno. |
| Persistencia de recomendaciones | No implementada, expresamente fuera de PROG-4A. |

E4 para este motor interno probado, sin declarar política operativa aprobada, motor integral terminado o certificación de producción. Las capas MVC públicas permanecen intactas; no se crearon rutas o vistas decorativas para este cálculo interno.

## V. Diseño de PROG-4B — Persistencia futura

1. Auditar datos reales de ProgressionRecommendation antes de modificar esquema. Preservar IDs, estados, valores, versiones, relaciones y fechas existentes; no atribuir unidad o procedencia desconocidas al legado.
2. Proponer campos nuevos opcionales para legado: unidad nativa/canónica, precisión de cargas nuevas, semana deportiva, zona, corte, tipo/versión de evidencia, snapshot JSONB, semanticKey único nullable y dependencias. Evaluar Decimal(24,6) según rangos; validar representabilidad exacta antes de escribir.
3. Guardar el JSON exacto validado por PROG-4A y recomprobar su huella. No serializar objetos Prisma completos ni reconstruir entradas desde el plan vivo.
4. Unicidad PostgreSQL de identidad semántica, reintento idéntico devuelve la fila existente, sin sobrescribir snapshot/createdAt. Fórmulas descriptivas no multiplican recomendaciones. Definir también identidad lógica atleta/tarea/semana y política de reemplazo/obsolescencia: diferentes semanticKeys no autorizan aplicar dos veces.
5. RecommendationEvidence mantiene una fila por sesión. Conservar detalle por tarea y series en snapshot; aprobar reglas de mapeo a SATISFACTORY/UNSATISFACTORY/CONTEXT sin convertir no evaluable en insatisfactorio ni perder casos mixtos.
6. Mapear decisiones internas a los estados existentes mediante política explícita. No inventar que INCREASE equivale a APPROVED o APPLIED. Definir caducidad desde parámetros aprobados, no una duración arbitraria.
7. Antes de persistir, releer configuración, destino, fuentes, permisos y versiones en transacción coherente. Comparar dependencyKeys y bloquear evidencia obsoleta. Diseñar unicidad/reintentos concurrentes con rollback verificado.
8. Evaluar el efecto histórico de enlazar planExerciseId/planWeekId: puede proteger inmediatamente esa planificación. Considerar destino descriptivo en snapshot y vínculo autorizado posterior, o una política consciente de protección al generar, antes de introducir FKs nuevas. No retirar restricciones para simplificarlo.
9. PROG-5 deberá comprobar consentimiento actual, vigencia, propiedad, límites y representabilidad en PlanExercise. Sus cargas actuales Decimal(8,3) no admiten todos los resultados nativos de seis decimales; no truncar. Evaluar validación estricta o migración futura compatible, manteniendo snapshots y sesiones anteriores intactos.
10. Pruebas futuras: migración aditiva con fixtures legados, precisión/unidades, duplicados concurrentes, dos fuentes distintas, cambios de versiones/configuración, rollback, aislamiento, inmutabilidad y restricciones históricas. Ejecutarlas exclusivamente en PostgreSQL temporal.

No se implementó PROG-4B ni PROG-5 durante esta entrega. No se realizaron commits, pushes o escrituras en desarrollo.
