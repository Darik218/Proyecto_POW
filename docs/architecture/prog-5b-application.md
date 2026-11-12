# PROG-5B — Aplicación manual interna de recomendaciones

Fecha de verificación: 2026-11-11. Alcance: infraestructura interna, sin HTTP, interfaz de consentimiento ni aplicación automática.

## A. Estado inicial

Rama `feature`; HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`, conservados. Había cambios y archivos no rastreados de PROG-3, 4A, 4B y 5A. Se registraron huellas antes de modificar código y se compararon durante la implementación: ningún archivo previo desapareció y solo cambiaron los diez archivos de integración enumerados en S. Ese inventario temporal del primer tramo no sobrevivió a la reanudación del entorno; no se presenta como artefacto disponible. No se descartaron archivos, cambiaron ramas, crearon worktrees ni realizaron commits/pushes.

Línea base ejecutada: `npm test -- --runInBand`, **556 pruebas / 50 suites aprobadas**. Las 805 pruebas del informe anterior eran referencia; los resultados actuales se presentan en R, sin sumar ejecuciones repetidas.

## B. Auditoría de modelos

- `ProgressionRecommendation` moderna conserva cargas nativas y canónicas Decimal(24,6), unidad, captura, configuración, identidades semántica/ciclo/dependencias y reserva `cycleSlot`; la reserva no se libera al aplicar.
- `RecommendationReview` contiene un evento 5A inmutable, actor, intención, versión, aceptación `THIS_PROPOSAL_ONLY` y huella. Una columna `APPROVED` sin ese evento no acredita autorización.
- `RecommendationEvidence` y las capturas de generación/revisión permanecen intactas.
- `ProgressionApplication` tenía únicamente ID, recomendación única, `appliedLoad Decimal(8,3)`, origen y fecha. Faltaban destino, unidad, actor, intención y auditoría acreditada.
- Planificación: `TrainingPlan → PlanWeek → PlanDay → PlanExercise`; el control de versión relevante es `TrainingPlan.version`. La carga de prescripción sigue siendo Decimal(8,3). Las semanas/posiciones no acreditan una fecha futura.
- `ScheduledActivity` aporta fecha civil, zona, estado y versión. Es evidencia temporal del mismo destino, no un destino alternativo ni una sesión ejecutada.
- Sesiones preparadas/en curso/completadas y referencias de ejecución protegen el destino. No se reconstruyen objetivos históricos desde el plan vigente.

## C. Arquitectura

Recorrido interno:

```text
AuthenticatedIdentity + ApplyRecommendationCommand
  → RecommendationService.applyMyApprovedRecommendation
  → ProgressionRepository / PrismaProgressionRepository
  → transacción + fuentes reales
  → derivación PROG-4A + inspección/autorización PROG-5A
  → política de aplicación PROG-5B
  → helper transaccional de planificación
  → ProgressionApplication con auditoría + APPROVED → APPLIED
  → ApplicationReceipt
```

Dominio valida expectativas y futuro sin I/O; modelos representan comando, recibo, auditoría y errores. El servicio coordina las políticas existentes. El repositorio maneja PostgreSQL. El helper de planificación usa la protección histórica existente y el mismo cliente transaccional, sin transacción anidada ni conversión a Number.

No hay nuevos controllers, presenters, módulos NestJS o clientes de producción. Modelo y caso interno verificados; Vista/Controlador nuevos no corresponden a esta etapa. La resolución real de providers se prueba con `ProgressionModule` en PostgreSQL.

## D. Autorización

Se resuelven usuario y atleta desde la identidad y sesión persistida: usuario ACTIVE, sesión propia no revocada, expiración ordinaria y absoluta válidas según reloj de PostgreSQL. No se admite `athleteId` aportado como autoridad.

Se exige propuesta moderna APPROVED, revisión y versión reales, evento APPROVE del propietario actual, aceptación acotada a esa propuesta, huella original y claves exactas. La inspección 5A verifica el digest con la versión de origen de la aprobación; aplicar no fabrica una aceptación ni modifica el evento de revisión. Los identificadores ajenos, las aprobaciones sin auditoría y los registros legados ambiguos se rechazan.

**Límite:** la identidad y aceptación proceden de contratos internos autenticados; aún no hay consentimiento humano comprobado en una interfaz. Ningún flujo productivo automático se activa.

## E. Vigencia

Dentro de la transacción se vuelve a leer y derivar PROG-4A; se compara la configuración/política, período, cohorte/evidencia y destino contra las cuatro dependencyKeys aceptadas. Se comprueban ciclo, reserva, versión, carga, unidad, rejilla, límites, compatibilidad, expiración explícita y coherencia revisión/aplicación. No se inventa una duración de autorización.

Una dependencia distinta bloquea la aplicación y conserva la propuesta y su evidencia. La consulta histórica con corte deportivo sigue usando su semántica existente; no se convierte ese corte en autorización temporal indefinida.

## F. Destino

El destino efectivo debe ser la misma prescripción PRESCRIPTION del snapshot y la aprobación: plan, semana, día, ejercicio, prescripción y versión. Una tarea WORKOUT_TASK o una copia diferente requieren otra propuesta/autorización, nunca una reasignación implícita.

Se exige una actividad propia PLANNED/RESCHEDULED, vinculada al mismo día/semana, con versión/fecha/zona esperadas. Su fecha debe ser estrictamente posterior a la fecha local actual en su zona persistida. Todas las actividades que usan ese día también deben ser futuras y no ejecutadas. Los límites temporales del plan se respetan cuando existen.

No se deduce futuro del orden de semana, nombre del día, `createdAt` o zona preferida. No se mueve ni reescribe ninguna actividad.

## G. Planificación

Solo DRAFT, día no retirado, sin historial de la prescripción y sin sesiones vinculadas al plan/semana/día. Se reutiliza `protect()` de la persistencia diaria. La operación cambia exclusivamente `PlanExercise.targetLoad`, incrementa `TrainingPlan.version` una vez y deja que su `updatedAt` siga el mecanismo existente.

Los destinos protegidos devuelven razones como `FUTURE_COPY_REQUIRED`; la propuesta se conserva. Las copias de planes/días/semanas ya existentes no cambian. Una copia futura necesitará seleccionarse y autorizarse expresamente en otra etapa.

## H. Precisión

Se mantienen Decimal(8,3) en prescripción/aplicación y Decimal(24,6) en propuestas modernas. No se amplía planificación ni se modifican fórmulas. Las cargas se manejan como cadenas/Decimal, en la misma unidad KG o LB del destino, sin inferir unidades ni convertir el valor autorizado.

`82.500000` y `80.125000` son exactos en escala 3; `80.000001` y `80.000800` no. Se rechazan escala/rango incompatibles, cero, decrementos, unidad distinta o baseline cambiado. No se redondea ni trunca para escribir. PROG-5A ya bloquea la aprobación de propuestas no representables; 5B conserva su propia comprobación.

## I. Transacción y concurrencia

Se evaluó SERIALIZABLE con una regresión real: después de la primera consulta de identidad, otra conexión confirmó una sesión PLANNED del destino. El snapshot anterior no veía esa inserción, aunque se bloquearan sus padres, y la aplicación podía confirmar. La prueba `rejects a prepared session committed between identity lookup and acquisition of source fences` esperaba APPLICATION_BLOCKED pero recibió un recibo confirmado. Esa ejecución RED se observó antes de corregirlo; su log temporal no sobrevivió a la reanudación. La prueba permanece en el repositorio y su ejecución final GREEN se volvió a verificar en PostgreSQL temporal.

Por eso **solo 5B usa READ COMMITTED con fences explícitas y relecturas definitivas**. 4B y 5A conservan sus aislamientos anteriores. Orden:

1. `SET LOCAL TIME ZONE 'UTC'`; identidad vigente y búsqueda rápida de recibo por intención.
2. Usuario/sesión SHARE; atleta UPDATE; nueva validación de identidad e idempotencia.
3. Enumerar y bloquear, en una sentencia ordenada por tabla, todas las sesiones editables del atleta y todas sus configuraciones, SHARE NOWAIT, límite 1001. Más de 1000 bloquea con `SOURCE_COVERAGE_INCOMPLETE`.
4. Leer fuentes y bloquear sesiones históricas, plan UPDATE, ejercicio, configuraciones, tareas/series; semana, día y prescripción. Releer el contexto. Los escritores de sesiones existentes usan la sesión como fence; las inserciones relacionadas quedan ordenadas por sus FK y los padres bloqueados.
5. Bloquear propuesta y ciclo con advisory transaccional de PostgreSQL, no locks en memoria.
6. Leer todas las actividades del día, bloquearlas ordenadamente, releerlas y cargar estado definitivo del destino.
7. Obtener instante del servidor, evaluar políticas y verificar de nuevo la sesión.
8. CAS de carga y versión, insertar recibo/auditoría, CAS APPROVED→APPLIED; confirmar constraints diferidos.

NOWAIT, hasta cinco intentos y esperas 20/40/80/160 ms acotan contención; timeout transaccional 15 s. La prueba de bloqueo mantiene otra transacción abierta, exige SOURCE_BUSY y verifica recuperación después de liberarla.

Garantía basada en el protocolo de escritores actual y constraints; no se promete serialización universal frente a SQL externo que ignore las fences. Bloquear por atleta y cubrir todos los elementos mutables es deliberadamente conservador y puede reducir concurrencia.

## J. Estados y SQL

La nueva migración conserva los checks de 4B/5A y adapta el par revisión/estado para permitir APPLIED solo con aplicación moderna acreditada. El evento APPROVE permanece tal cual.

Triggers y CHECK verifican metadata completa, procedencia, actor/propiedad, revisión, ciclo, cargas/unidad y auditoría, orden temporal, fecha local, destino y versión finales. Constraints diferidos exigen confirmar conjuntamente destino, versión, recibo y APPLIED. Un UPDATE aislado de status falla. Con recibo moderno tampoco se permite volver a APPROVED.

Los checks del destino se ejecutan al insertar/aplicar: no congelan para siempre una plantilla. Ediciones posteriores legítimas pueden cambiar su carga; el recibo conserva lo ocurrido y el reintento devuelve ese recibo. Sus FK impiden borrar recursos referenciados, conforme a los errores de integridad ya tratados por planificación.

## K. Auditoría

`ProgressionApplication.audit` es el evento de aplicación, separado de `RecommendationReview`. Formato `manual-progression-application-v1`: acción/transición, revisión y huella de autorización, claves semántica/ciclo/dependencias, jerarquía/exercicio, versiones antes/después, cargas/unidad, actividad/versión/fecha/zona, instante del servidor, fecha local e IDs de todas las actividades afectadas.

La fila moderna es inmutable por UPDATE/DELETE. Los campos relacionales sirven para FK/unicidad y el JSON conserva la captura explicativa; no se serializan entidades completas ni secretos.

## L. Idempotencia

El consumidor aporta `intentId` estable. `requestKey` usa canonicalización/hash existentes y el formato de aplicación versionado, con carga decimal normalizada y el comando completo validado. No incluye hora de consulta ni aleatoriedad generada por el servidor.

Misma intención/propietario/actor/comando devuelve mismo ID, fecha y auditoría, incluso si después se editó el destino. Intención reutilizada con otra carga/destino/revisión falla `INTENT_REUSED`; otra intención para propuesta aplicada falla `ALREADY_APPLIED`.

Se reconsulta después de adquirir la fence del atleta. Una regresión determinista confirmó que omitir esa segunda comprobación podía devolver ALREADY_APPLIED al perdedor de un reintento idéntico; ahora devuelve el recibo ganador.

## M. Ciclo

Se conserva `cycleSlot`, verifica identidad/reserva y ausencia de competidores, y añade unicidad de ciclo en aplicaciones modernas. La unicidad de recomendación existente se conserva. También son únicos reviewId y (athleteId,intentId). NULL permite conservar registros anteriores sin identidades fabricadas. No se sustituyen propuestas ni se liberan ciclos.

## N. Integridad histórica

Las pruebas comparan huellas exactas de filas de sesiones, ejercicios ejecutados, series, estimaciones, evidencia, revisiones y calendario; también comparan captura/configuración/cargas/versiones de la propuesta, salvo su transición esperada. Solo se escriben carga futura, versión/updatedAt del plan, aplicación/auditoría y status.

No se modifican snapshots originales, objetivos ajustados, resultados, feedback ni relaciones de sesiones. No se convierten unidades desconocidas ni se promueve legado a autorización moderna.

## O. Prisma y migración

Nueva migración: `20261110001000_authorized_progression_applications/migration.sql`. Añade metadata nullable a aplicaciones: atleta, actor, revisión, prescripción, actividad, carga previa, unidad, intención, huella, ciclo y audit JSONB. Añade FK/UNIQUE, inmutabilidad y pares diferidos; ninguna columna histórica se elimina ni se cambia de precisión.

La prueba reconstruye el esquema inmediatamente anterior aplicando sus 13 migraciones en otra base temporal, copia fixtures mínimos con JSON textual de PostgreSQL (sin Number), conserva una propuesta 5A aprobada con su evento/evidencia y aplicaciones antiguas MANUAL/AUTOMATIC con decimales y microsegundos. Aplica la migración 14 y compara valores, IDs, fechas y relaciones; la metadata nueva queda NULL. No se fabrican eventos ni se modifica una migración anterior.

## P. PostgreSQL real

Runner existente ampliado con `--applications`. Cada ejecución crea un clúster propio bajo `/tmp/pulso-prog1b-*`, comprueba loopback, puerto aleatorio, URL/base `pulso_prog1b_test`, `realpath(data_directory)`, aplica migraciones, comprueba status y deriva, y detiene/elimina únicamente sus recursos, también al fallar. No ejecuta seeds.

Se verifican transacciones y constraints con datos persistidos, conexiones independientes y fallos inyectados antes/después de cada escritura. Se omiten intencionadamente las escrituras de destino/versión/status para demostrar rechazo real al COMMIT. Auditorías manipuladas se envían al SQL real y deben revertir todo.

### Compatibilidad temporal comprobada

Se reprodujo un defecto del adaptador pg instalado al interpretar timestamptz con offsets no UTC: hora local conservada con sufijo UTC, desplazando cinco horas. Afectaba igualdad entre el instante de auditoría y el guardado, y huellas basadas en fechas de fuentes.

La corrección mínima fija UTC **localmente al inicio de cada transacción de progresión**, incluidas lecturas; no cambia la zona del pool, servidor, fechas deportivas ni registros existentes. La regresión usa conexiones UTC y America/Bogota, compara semántica/dependencias, aplicación/reintento y timestamps físicos mediante SQL, y comprueba restauración del default tras commit y rollback. Tres fixtures/aserciones anteriores se ajustaron para escribir o comparar el instante UTC físico explícito, conservando los valores esperados.

Capturas previas afectadas por la representación incorrecta pueden resultar obsoletas y deben inspeccionarse/revisarse de nuevo; no se reescriben retrospectivamente. El problema genérico del adaptador fuera de progresión no se refactoriza aquí.

## Q. Seguridad

Rechazos probados: propuesta/sesión/revisión ajenas, sesión revocada/expirada/inexistente, usuario suspendido, aprobación no acreditada, otro destino/generación/unidad, cambios de configuración/evidencia y actividades incompatibles. El actor no puede elegir el atleta propietario.

La revisión independiente fue estática, de solo lectura, centrada en SQL, temporalidad, locks, autorización e idempotencia. Sus observaciones dieron lugar a regresiones y correcciones; la última revisión no encontró bloqueantes adicionales. No se ejecutó un nuevo escaneo canónico Codex Security ni se declara certificación de producción.

## R. Regresiones y resultados

La batería final se volvió a ejecutar después de reanudar el entorno. Todos los comandos terminaron con código 0:

| Grupo | Suites | Pruebas distintas | Resultado |
|---|---:|---:|---|
| Unitarias y arquitectónicas backend, incluyendo PROG-1A/4A y política 5B | 51 | 575 | Aprobadas |
| PostgreSQL de progresión PROG-1B a 5B, migraciones incluidas | 9 | 267 | Aprobadas |
| HTTP/PostgreSQL de sesiones e historial | 3 | 27 | Aprobadas |
| HTTP/PostgreSQL de planificación y rutinas | 4 | 26 | Aprobadas |
| **Total sin repetir ejecuciones** | **67** | **895** | **Aprobadas** |

Respecto de las 805 pruebas previas: 19 nuevas unitarias y 71 nuevas PostgreSQL. Los dos archivos 5B de integración contienen 70 pruebas funcionales y una de migración. Las cantidades no incluyen TypeScript/lint/build como si fueran pruebas ni suman nuevamente las corridas focalizadas.

TypeScript, lint, build, Prisma validate y Prettier sobre los 16 archivos TypeScript afectados aprobaron. Los runners aplicaron las 14 migraciones en temporal, `migrate status` quedó actualizado y `migrate diff --exit-code` no detectó deriva. `git diff --check` aprobó. Se confirmó limpieza de los tres clústeres propios.

Logs de la ejecución final, locales y efímeros: `/tmp/pulso-prog5b-{unit,pg,workouts,planning,tsc,lint,build,validate,format}.log`. El inventario y los resultados históricos del primer tramo se consignan aquí; no se presupone que sus archivos temporales sigan presentes. Las ejecuciones RED y fallidas intermedias son diagnóstico, no pruebas aprobadas adicionales.

Fallos intermedios resueltos: representación temporal del adaptador, snapshot anterior a las fences e idempotencia del perdedor concurrente. Un fixture pretendía almacenar un incremento absoluto inferior a escala 3 y luego aprobar una carga que 5A ya rechaza: se corrigió para comprobar ambas barreras sin debilitar la política. No quedaron pruebas fallidas en la batería final.

Advertencias observadas: VM Modules experimental de Node y deprecación de `client.query()` concurrente de pg en los runners existentes; no impidieron las verificaciones. No se modificaron dependencias para suprimirlas.

Comandos ejecutados desde backend:

```sh
npm test -- --runInBand
node test/run-progression-isolated.mjs --applications
node test/run-workouts-mvc-isolated.mjs all
node test/run-planning-mvc-isolated.mjs all
npx tsc --noEmit
npm run lint
npm run build
npm run prisma:validate
```

Además: Prettier sobre TypeScript afectado, `git diff --check`, status, HEAD y comparación de huellas iniciales en el primer tramo. No se ejecutan runners genéricos contra la configuración de desarrollo. No se verifican navegador/frontend ni HTTP de aplicación porque no hay un recorrido nuevo de ese tipo.

## S. Archivos de esta etapa

Creados:

- `backend/src/models/progression/recommendation-application.model.ts`: comandos, evidencia, recibo y errores internos.
- `backend/src/domain/progression/recommendation-application.policy.ts` y `.spec.ts`: validación, futuro, exactitud y autorización.
- `backend/src/progression/recommendation-application.persistence.ts`: fences, transacción, idempotencia y recibo.
- `backend/src/training-plans/progression-prescription.persistence.ts`: escritura exacta y versión usando protección existente.
- `backend/prisma/migrations/20261110001000_authorized_progression_applications/migration.sql`.
- `backend/test/helpers/recommendation-application-fixtures.ts`.
- `backend/test/recommendation-application.e2e-spec.ts` y `recommendation-application-migration.e2e-spec.ts`.
- Este informe y `docs/superpowers/plans/2026-11-10-prog5b.md`.

Modificados sobre el estado inicial (independientemente del diff acumulado frente a HEAD): schema.prisma; progression.repository.ts, prisma-progression.repository.ts, recommendation.service.ts, recommendation-review.persistence.ts y recommendation.persistence.ts; prisma-daily-planning.repository.ts; test/performance.e2e-spec.ts, test/recommendation-review.e2e-spec.ts y test/run-progression-isolated.mjs.

Los cambios acumulados de PROG-3/4A/4B/5A en otros archivos no son atribuidos a esta etapa. No se modifica frontend, autenticación, fórmulas, .env, seeds ni migraciones anteriores.

## T. Skills y herramientas utilizadas

AGENTS.md, pulso-architecture-review y referencia MVC, pulso-domain-integrity, pulso-integration-testing y pulso-prisma-migrations; Superpowers para planificación, pruebas RED→GREEN, diagnóstico, revisión independiente y verificación antes de completar. Herramientas: lectura/búsqueda local, Git de solo lectura, Jest, Prisma, PostgreSQL temporal, TypeScript, oxlint y Prettier. Subagente independiente únicamente para revisión solicitada, sin edición ni ejecución PG.

Graphify no fue necesario para estos límites ya trazados. No se utilizaron herramientas de navegador, diseño visual, búsquedas externas o modificación de configuración de Codex.

## U. Limitaciones y riesgos

- Sin automatización, API ni consentimiento humano verificable desde UI. Las políticas explícitas de fixtures son de prueba, no autorización productiva.
- Alcance conservador: mismo destino editable y acreditadamente futuro; un plan con sesiones o un día con actividad pasada requiere otro destino/copia y autorización específica.
- Contención por atleta y límites de 1000 elementos; rechazo seguro si no se cubren las fuentes. Ampliación/optimización requiere nuevas pruebas del protocolo de escritores.
- Fechas válidas se comprueban según reloj de PostgreSQL/zona persistida; un cambio de día durante la transacción puede causar rollback correcto.
- Escala 3 limita rejillas más finas; no se amplía automáticamente.
- Las migraciones pendientes de desarrollo no se aplicaron. Su estado actual no se certifica mediante una consulta de escritura ni se interpreta un esquema anterior como regresión.
- Auditoría canónica nueva, comportamiento de producción y escritores SQL externos fuera del protocolo no verificados.

## V. Estado final

**PROG-5B implementado y verificado en su alcance interno conservador.**

| Responsabilidad | Estado | Evidencia |
|---|---|---|
| Modelo/dominio | Verificado | Contratos utilizados y 19 pruebas puras nuevas |
| Servicio y registro NestJS | Verificado | Caso interno real, provider existente y resolución en ProgressionModule |
| Autorización y vigencia | Verificado en alcance interno | Revisión 5A, sesión real, dependencia/destino y rechazos probados |
| Transacción, CAS e idempotencia | Verificado | Conexiones independientes, carreras deterministas, rollback y COMMIT |
| Integridad histórica/migración | Verificado | Huellas de filas, esquema anterior, valores/NULL preservados y deriva limpia |
| Vista/Controlador nuevos | No implementado por alcance | Sin endpoint ni representación pública solicitados |
| Consentimiento humano en UI / aplicación automática | No implementado | Reservados a PROG-6 / diseño PROG-5C |

No se declara MVC global de toda PULSO, automatización, consentimiento visual ni preparación certificada para producción. Desarrollo preservado sin migraciones/escrituras; rama y HEAD conservados, sin commit/push. La siguiente integración requiere revisión manual del usuario y un punto de entrada humano autenticado.

## W. Próxima etapa

**PROG-5C — diseño de automatización autorizada:** especificar consentimiento persistido con alcance/destino/política/versiones/revocación, diferencias entre autorización por propuesta y autorización recurrente, vigencia, límites, exclusión de legado, selección de futuros destinos y auditoría. `autoApplyAuthorized` por sí solo nunca habilita aplicar. No implementado.

**PROG-6 — integración humana y HTTP:** definir DTO/guards/controlador/presenter y esquemas Vue para inspección actualizada, aceptación explícita, selección del mismo destino futuro y aplicación con intención idempotente; errores estructurados, accesibilidad, recuperación tras respuesta perdida, cambios concurrentes y confirmación visible. Probar identidad real, consentimiento, CSRF si corresponde al contrato, aislamiento, PostgreSQL y navegador. No implementar aún ni transferir silenciosamente aceptación a copias.
