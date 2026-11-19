# PROG-4B — Persistencia neutral de propuestas semanales

## A. Estado inicial y alcance

Trabajo sobre `feature`, HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`, conservado. El repositorio ya contenía modificaciones y archivos sin seguimiento de PROG-3/PROG-4A. Se conservaron; la comparación adicional mediante SHA-256 de 394 archivos distingue los cambios de esta etapa del trabajo acumulado. No se ejecutaron commits, push, cambios de rama, worktrees, resets ni seeds.

La línea base ejecutada fue **521 pruebas unitarias/arquitectónicas backend, 48 suites**, todas aprobadas. Los números reportados por etapas anteriores se trataron como referencias y se volvieron a ejecutar las regresiones pertinentes.

Una consulta de inventario **READ ONLY**, con `default_transaction_read_only=on`, transacción de solo lectura, timeout y rollback, obtuvo **cero recomendaciones existentes** en desarrollo en el momento de la auditoría. Solo consultó cantidades por estado. No se presupuso que el legado estuviera vacío: la migración se prueba con fixtures de los seis estados. No se migró ni escribió en `proyecto_pow_dev`.

Alcance: guardar y consultar propuestas internas neutrales. Sin endpoints, vistas públicas, frontend, revisión operativa, aplicación de cargas ni nuevas políticas matemáticas.

## B. Auditoría Prisma y comportamiento existente

| Modelo | Estado verificado y efecto relevante |
| --- | --- |
| `ProgressionRecommendation` | Ya existía: atleta, ejercicio, semana/prescripción opcionales, cargas `Decimal(8,3)`, justificación, versión, configuración JSONB, estado y fechas. Faltaban unidades, captura completa, identidades y dependencias. |
| `RecommendationEvidence` | Relación recomendación/sesión, rol, fecha; unicidad por ambos IDs y FKs RESTRICT. Roles reales: `SATISFACTORY`, `UNSATISFACTORY`, `CONTEXT`. |
| `ProgressionSetting` | Ámbitos atleta, ejercicio, ejercicio/plan mediante índices únicos condicionales. Mínimo de sesiones, intervalo RPE, incremento absoluto/porcentual, límites, `updatedAt` y `autoApplyAuthorized`. Este booleano no acredita consentimiento operativo. |
| `ProgressionApplication` | Estructura existente, relación única con recomendación y carga aplicada `Decimal(8,3)`. Esta etapa no la crea ni modifica. |
| `OneRmEstimate` | Persistencia descriptiva PROG-1B, fórmulas separadas, versiones, unidades, claves y snapshots protegidos. Reutilizada únicamente como contexto descriptivo. |
| `TrainingPlan` / `PlanWeek` / `PlanDay` / `PlanExercise` | Propiedad, versión, estado, jerarquía diaria, retiro y protecciones históricas existentes. Las relaciones de recomendaciones con semana/prescripción influyen en dichas protecciones. |
| `WorkoutSession` / `WorkoutExercise` / `SetRecord` | Propiedad por sesión, estados, fecha deportiva/zona, versiones, objetivos originales/ajustados, cargas y resultados. Se leen y bloquean temporalmente para coherencia; no se actualizan. |

Estados reales de recomendación: `PENDING`, `APPROVED`, `REJECTED`, `APPLIED`, `BLOCKED`, `EXPIRED`. No se encontraron servicios operativos que definan un flujo autorizado de transición/aplicación. No se dedujo por el nombre del enum qué estados permiten sustituir una propuesta.

## C. Diseño mínimo de persistencia

Se reutiliza `ProgressionRecommendation`; no hay segunda tabla ni segundo módulo/cliente Prisma.

| Campo | Finalidad |
| --- | --- |
| `previousLoad`, `recommendedLoad` | Ampliados a `Decimal(24,6)`; conservan el valor nativo. |
| `loadUnit` | Unidad nativa explícita KG/LB para propuestas modernas. |
| `previousLoadKg`, `recommendedLoadKg` | Proyección canónica a seis decimales, también `Decimal(24,6)`. |
| `semanticKey` | Huella PROG-4A única, nullable para legado. |
| `cycleKey` | Identidad lógica estable, indexada con atleta y sin unicidad permanente. |
| `cycleSlot` | Reserva única nullable del ciclo, liberable unilateralmente en una futura operación autorizada. |
| `requestKey` | Huella de intención efectiva del comando, para validar reintentos sin releer fuentes cambiadas. |
| `snapshot` | Captura JSONB `recommendation-evidence-v1`, sin un segundo formato de evidencia. |
| `dependencyKeys` | Huellas de configuración, período, destino y evidencia existentes en PROG-4A. |
| `proposalKind` | `NEUTRAL_INTERNAL` explícito; no se deduce autorización del estado persistido. |

Período, zona, corte, rejilla, incremento, límites, procedencia y versiones detalladas permanecen en el snapshot. `effectiveSettings` existente conserva exactamente su proyección `configuration`, comprobada contra el snapshot.

## D. Migración y legado

Nueva migración: `20261109001000_neutral_weekly_recommendations/migration.sql`.

- Amplía dos columnas, añade campos nullable, índices y comprobaciones. No actualiza filas antiguas ni migra identidades/unidades por inferencia.
- Cada fila anterior conserva ID, valores, versiones, fechas, estado, referencias y evidencia. Los nuevos campos quedan todos NULL.
- CHECK distingue legado completo de metadata moderna completa; valida versión, clasificación neutral, propiedad declarada, estructura básica de captura/dependencias, proyección de cargas, conversión y FKs de planificación nulas.
- Triggers impiden editar/borrar la generación moderna y sus enlaces de evidencia. Las filas antiguas mantienen su comportamiento anterior; no pueden adquirir retrospectivamente una identidad moderna fabricada.
- Campos operativos separados: `status`, `reviewedAt`, `expiresAt`, `cycleSlot`. Se dejan disponibles para servicios autorizados futuros; esta etapa no implementa sus transiciones. La reserva solo puede liberarse, nunca reasignarse ni recuperarse silenciosamente.
- Un constraint trigger diferido verifica al COMMIT que las sesiones capturadas y los enlaces de evidencia coincidan exactamente.

La prueba de migración crea otra base desechable dentro del clúster temporal, aplica las once migraciones anteriores, inserta seis recomendaciones históricas y sus relaciones, aplica la nueva y compara valores decimales, fechas con microsegundos, IDs, FKs, enlaces y nuevos NULL. También comprueba precisión e índices. No modifica migraciones anteriores.

Riesgo de despliegue futuro: ALTER TYPE y creación de índices requieren locks y pueden reescribir una tabla poblada. La aplicación en desarrollo/producción queda pendiente de una tarea de despliegue autorizada con backup y evaluación de volumen; no se ejecutó aquí.

## E. Precisión y unidades

Se reutilizan `calculateIncrement`, `interpretLoad` y `assertPersistableDecimal`. No se cambian Epley, Brzycki, conversiones, rejilla ni precedencias.

Los cuatro valores proyectados se validan positivos, finitos y exactamente representables con escala máxima 6 y hasta 18 dígitos enteros. Máximo: `999999999999999999.999999`. Un exceso devuelve `DECIMAL_NOT_PERSISTABLE` antes de escribir; no se recorta ni redondea para acomodar la columna. Los límites/deltas de mayor escala permanecen como cadenas exactas en JSONB.

La carga nativa permanece en KG o LB; no se infiere desde preferencias. La conversión canónica usa la política existente de seis decimales HALF_UP y factor exacto `0.45359237`. La rejilla nativa sigue FLOOR. Puede existir un microincremento LB positivo cuya proyección KG redondeada sea igual a la anterior: se conserva correctamente sin inventar una diferencia canónica.

Se probaron KG, LB, valores de seis decimales y una carga propuesta `199999.998000` fuera del antiguo `Decimal(8,3)`.

## F. Evidencia, procedencia y reproducibilidad

Solo es persistible una decisión **INCREASE completa**, generada de nuevo por el motor dentro de una lectura autorizada. `MAINTAIN`, `REVIEW_REQUIRED`, datos insuficientes, configuración faltante o ausencia de incremento representable no producen una recomendación nueva.

`inspectGeneration` comprueba estructura/versiones, período semanal y zona, ventana/corte, destino discriminado, fuentes e identificadores, relaciones internas, configuración efectiva recalculada, decisión e incremento reproducido con la política PROG-4A. Recalcula huellas semánticas y dependencias. El repositorio verifica además columnas, unidades, identidad del ciclo, estado neutral y enlaces antes de devolver la fila. Un cliente no puede suministrar un snapshot para persistirlo.

El snapshot conserva información de configuración/procedencia explícita, objetivos originales/ajustados, resultados, cohorte, RPE, conteos/readiness, señales, cobertura, exclusiones, estimaciones 1RM descriptivas, período y destino previsto. No se consulta un plan actual para reconstruir objetivos originales ni se copian filas Prisma completas.

Los snapshots son evidencia versionada de generación, no autorización. La clave de request es una huella de intención, no un formato alternativo de captura.

## G. Identidad semántica

Se utiliza sin cambios la canonicalización `prog-4a-semantic-v1`. La única extracción de PROG-4A fue compartir el cálculo existente de `dependencyKeys`; no se modifica su álgebra. Se conserva orden independiente de colecciones definido por PROG-4A y normalización decimal existente.

`semanticKey` tiene UNIQUE efectivo en PostgreSQL y admite NULL para legado. No contiene reloj, aleatoriedad ni timestamps de consulta; las revisiones efectivas registradas sí forman parte de la evidencia.

## H. Identidad lógica del ciclo

`weekly-recommendation-cycle-v1` utiliza la misma canonicalización con un envoltorio versionado. Incluye atleta, ejercicio, inicio/fin deportivo y destino estable:

- Si existe prescripción: plan/semana/día/prescripción. Tareas distintas de esa misma prescripción no crean ciclos independientes.
- Si no existe: tarea ejecutada fuente.

El ámbito estable proviene del destino del plan; no del ID/revisión de una fila mutable de configuración. Cambiar evidencia, incremento, política, versión del plan o configuración más específica no permite eludir el conflicto. Se excluyen corte y zona de la reserva para bloquear conservadoramente revisiones del mismo intervalo civil/destino.

No existe unicidad permanente sobre `cycleKey`: se permiten revisiones históricas futuras. UNIQUE sobre `cycleSlot` impide reservas duplicadas. **PROG-4B bloquea conservadoramente cualquier competidor del ciclo, en cualquier estado e incluso si la reserva fue liberada por un operador**. No inventa una política de sustitución a partir del enum. PROG-5 deberá definirla y volver a validar el ciclo.

## I. Idempotencia

Se valida identidad activa/privacidad y luego se busca la clave semántica. Si existe:

1. Se valida propiedad, snapshot, cargas, claves y evidencia almacenada.
2. Se contrasta intención efectiva y dependencias esperadas.
3. Se devuelve ID, fecha, captura, enlaces y **estado actual**, sin regenerar ni sobrescribir la evidencia histórica.

`requestKey` usa comando validado con contextos/comparaciones filtrados a las tareas capturadas, tal como PROG-4A descarta contexto fuera de cohorte. Se normaliza la representación JSON antes de la huella. Una política efectiva distinta con clave anterior produce `REQUEST_MISMATCH`; agregar un contexto irrelevante no rompe el reintento. Los demás parámetros explícitos del comando forman parte de esa intención, aunque un cambio de consulta pueda resultar incidentalmente en la misma evidencia.

La nueva inserción se apoya en UNIQUE y transacción, no solo en un SELECT previo. Las pruebas desde conexiones Prisma distintas confirman un solo ID y dos enlaces de evidencia ante reintentos simultáneos.

## J. Estados y autorización

`INCREASE` es una decisión de dominio. Se almacena como `PENDING` + `NEUTRAL_INTERNAL`, con `generationAuthorization=NOT_GRANTED`. No se convierte en `APPROVED` ni `APPLIED`.

No se asigna expiración arbitraria: `expiresAt` y `reviewedAt` comienzan NULL. Obsolescencia, caducidad y rechazo son dimensiones distintas. Un reintento preserva cualquiera de los seis estados reales, incluso terminales. Un registro antiguo sin metadata se devuelve como `LEGACY_UNKNOWN`; no se acredita su unidad, vigencia ni autorización.

La configuración `autoApplyAuthorized=true` queda capturada como dato, sin producir aplicación ni consentimiento. Las políticas de fixtures `EXPLICIT_INTERNAL_POLICY` no activan una política operativa de producción.

## K. Obsolescencia y revalidación

El comando de guardado recibe la clave semántica y las cuatro dependencias esperadas. En una primera inserción se releen contexto y fuentes, se invoca nuevamente `deriveRecommendation` y se compara con `compareDrafts`. Se rechaza tanto el cambio semántico como cualquier discrepancia en las dependencias esperadas (`STALE_PROPOSAL`, con dependencias modificadas).

`checkMyProposal` es de solo lectura: compara una generación guardada con un nuevo cálculo explícito y devuelve `UNCHANGED` u `OBSOLETE`, sin cambiar estado ni caducidad. El consumidor interno aporta el comando de revalidación; no hay job automático. Si no puede resolverse una fuente autorizada/destino, se propaga el error tipado de fuente y no se afirma vigencia. El legado permanece `LEGACY_UNKNOWN`.

Se probaron modificaciones de incremento, límite, ámbito, revisión, política, cohorte, período, versión del plan, carga prescrita y retiro del día; también entrenamiento retrospectivo. Las capturas anteriores permanecen intactas. La identidad de un reintento deliberadamente idéntico no se confunde con una nueva evaluación de vigencia.

## L. Integridad histórica y planificación

Las nuevas propuestas dejan **`planWeekId=NULL` y `planExerciseId=NULL`**, comprobado por aplicación y SQL. El destino previsto permanece en el snapshot. No se rellena un destino efectivamente aplicado.

Una prueba usa el repositorio real `PrismaDailyPlanningRepository` para editar una prescripción DRAFT después de guardar su propuesta: sigue siendo editable y la captura permanece inmutable. Las protecciones históricas previas de prescripciones vinculadas a sesiones/recomendaciones antiguas permanecen intactas; no se eliminaron guards ni se modificaron repositorios de planificación.

Los enlaces de evidencia utilizan sesiones completadas; su FK RESTRICT conserva trazabilidad. No se actualizan sesiones, tareas, series, objetivos, planes ni calendario. No se crea `ProgressionApplication`.

## M. Seguridad

Propiedad resuelta desde `AuthenticatedIdentity.account.id`; atleta con cuenta ACTIVE, ejercicio GLOBAL o PERSONAL del mismo usuario, destino dentro de su jerarquía y fuentes filtradas por atleta/ejercicio. La lectura no devuelve recomendaciones ajenas y rechaza relaciones históricas cruzadas en evidencia. No se acepta un propietario arbitrario del comando.

Solo se serializan estructuras internas seleccionadas, sin contraseñas, cookies, tokens ni objetos Prisma completos. Las consultas de locks parametrizan IDs/UUIDs. No hay cambio en autenticación, frontend, CSRF ni rutas públicas.

Se realizaron revisión independiente y pruebas de aislamiento. No se ejecutó un nuevo escaneo canónico de Codex Security en esta etapa y no se le atribuye ningún resultado. No hay certificación de producción.

## N. PostgreSQL, atomicidad y migración

Se reutiliza `test/run-progression-isolated.mjs`, ampliado con `--recommendations`; el comportamiento previo se conserva. Crea un clúster propio `initdb` bajo `/tmp/pulso-prog1b-*`, puerto aleatorio loopback, base `pulso_prog1b_test`, URL efectiva de pruebas y verificación de `data_directory`, puerto y nombre tanto por runner como por helper. Aplica las doce migraciones, comprueba estado y deriva y ejecuta fixtures propios sin seeds. Se detiene/elimina únicamente el clúster creado por ese runner, también ante fallos.

Última ejecución de progresión: `/tmp/pulso-prog4b-pg.log` (artefacto local temporal). Las rutas/puertos son efímeros; el runner imprime los verificados. Regresiones separadas usan los runners MVC de sesiones y planificación, también temporales.

Recomendación y todos sus enlaces se escriben dentro de una misma transacción. Se probaron fallo inyectado antes de evidencia, evidencia incompleta detectada por aplicación y, **mediante una conexión pg real**, rechazo por constraint diferido al COMMIT cuando se omite un enlace necesario. Se verifica ausencia de filas parciales y recuperación posterior.

## O. Concurrencia y rendimiento

La primera inserción usa `SERIALIZABLE`; los cálculos de consulta PROG-4A conservan `REPEATABLE READ READ ONLY`. Se comparte un método interno de lectura sin transacciones anidadas. Un callback de aplicación recibe únicamente datos de contexto, nunca cliente Prisma ni operaciones de repositorio.

Fences acotadas, sin actualizar fuentes: usuario SHARE, atleta UPDATE, sesiones fuente SHARE ordenadas, plan SHARE, ejercicio SHARE, settings SHARE, tareas y series UPDATE ordenadas. Se respeta la dirección padre/hijo y se usa NOWAIT para evitar esperas/interbloqueos con escritores existentes. La fence del atleta bloquea nuevas referencias vía FK; las de tareas/series estabilizan hijos y nuevas estimaciones. Se relee el contexto antes del cálculo definitivo dentro del mismo snapshot. Un advisory lock transaccional no bloqueante coordina el ciclo; UNIQUE sigue siendo la garantía final.

Se reintentan serialización, deadlocks, NOWAIT y carreras de unicidad, como máximo cinco intentos, con backoff 20/40/80/160 ms; la contención agotada devuelve `SOURCE_BUSY`. Timeout por transacción: 15 s. No hay bucles ilimitados. Las lecturas siguen los límites PROG-2 (100 tareas, 1000 series, 2000 estimaciones); se rechaza cobertura truncada. La reserva única y el índice atleta/ciclo evitan recorrer todo el historial de recomendaciones.

**Límite preciso:** se garantiza una generación coherente con un snapshot serializable y las fences descritas, no frescura eterna ni exclusión universal de cualquier SQL externo al protocolo. Cambios en sesiones no seleccionadas o escritores que evadan locks de sus padres pueden serializarse después de la propuesta. Un entrenamiento retrospectivo posterior puede hacerla obsoleta. Antes de aplicar, PROG-5 deberá releer evidencia y revalidar con los mismos protocolos. No se promete “último dato mundial al instante de COMMIT” para escritores arbitrarios.

## P. Pruebas y verificación

Comandos ejecutados desde `backend/`, excepto Git:

| Comando | Resultado final |
| --- | --- |
| `npm test -- --runInBand` | **539 pruebas, 49 suites aprobadas**; incluye PROG-1A/1B/2/3/4A y 18 nuevas de política de persistencia. |
| `node test/run-progression-isolated.mjs --recommendations` | **139 pruebas, 5 suites aprobadas**: 92 regresiones previas + 46 pruebas/casos de persistencia + 1 migración histórica. PostgreSQL real. |
| `node test/run-workouts-mvc-isolated.mjs all` | **27 pruebas, 3 suites aprobadas**, HTTP/PostgreSQL. |
| `node test/run-planning-mvc-isolated.mjs all` | **26 pruebas, 4 suites aprobadas**, HTTP/PostgreSQL. |
| `npx tsc --noEmit` | Aprobado. |
| `npm run lint` | Aprobado, sin warnings finales propios. |
| `npm run build` | Prisma generate y Nest build aprobados. |
| `npm run prisma:validate` | Aprobado. |
| `prisma migrate status` + `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | Ejecutados por runner temporal: doce migraciones al día, sin diferencia detectada. |
| `npx prettier --check` (once archivos TypeScript tocados) | Aprobado. |
| `git diff --check` | Aprobado. |

**731 pruebas distintas** en los cuatro grupos finales; no se suman ejecuciones focalizadas/repetidas ni las 58 pruebas que el revisor ejecutó independientemente. **65 pruebas nuevas** de esta etapa (18 unitarias y 47 PostgreSQL).

La fase roja de TDD detectó 10 fallos/13 pruebas frente a stubs antes de implementar. Las posteriores ampliaciones y revisión detectaron y corrigieron tres defectos: request demasiado amplio para reintentos, dependencias esperadas inconsistentes y esquema de captura incompleto. Las pruebas finales exigen el comportamiento correcto.

Durante la construcción de fixtures hubo dos errores de datos de prueba: retiro sin `retiredFromOn` y serie moderna sin unidad. Se ajustaron los fixtures a las restricciones existentes, sin debilitarlas. También se corrigió una colisión de nombre de grupo muscular en fixtures. No quedan fallos conocidos de esas ejecuciones.

Advertencias observadas: Node VM Modules experimental; pg advierte de consultas concurrentes sobre un cliente y futura incompatibilidad con pg 9. Esa advertencia también aparece en suites de sesiones/planificación no modificadas; no se cambió el adapter ni dependencias. Los warnings de reutilización de refresh de la batería unitaria son salidas de escenarios negativos de autenticación existentes.

No se ejecutaron frontend, Firefox, carga/benchmark de producción ni un nuevo escáner canónico: no se modificaron sus superficies. Las pruebas de esta etapa son internas y PostgreSQL; no se atribuye una API HTTP nueva ni verificación visual.

## Q. Regresiones y revisión independiente

Se mantienen fórmulas y elegibilidad PROG-1A; inmutabilidad/idempotencia de estimaciones PROG-1B; comparabilidad y límites PROG-2; cumplimiento/readiness/RPE PROG-3; semana/cohorte/precedencia/incrementos/huellas/solo lectura PROG-4A. Las regresiones reales de sesiones y planificación conservan contratos HTTP, propiedad y restricciones históricas.

Un segundo agente revisó en modo lectura esquema, SQL, precisión, claves, locks, propiedad, fuentes y neutralidad. Reprodujo tres defectos antes de su corrección y revisó los cambios finales; ejecutó independientemente 58 pruebas de políticas, todas aprobadas. No encontró bloqueos adicionales para este alcance interno. Su revisión no sustituye las pruebas PostgreSQL ejecutadas por el agente principal.

## R. Archivos de esta etapa

### Creados

- `backend/prisma/migrations/20261109001000_neutral_weekly_recommendations/migration.sql`: evolución compatible, restricciones, índices e inmutabilidad.
- `backend/src/models/progression/persisted-recommendation.model.ts`: contratos internos de guardado/lectura y errores tipados.
- `backend/src/domain/progression/recommendation-persistence.policy.ts`: persistibilidad, validación/captura, expectativa, intención y ciclo.
- `backend/src/domain/progression/recommendation-persistence.policy.spec.ts`: 18 pruebas puras.
- `backend/src/progression/recommendation.persistence.ts`: implementación de persistencia/lectura del repositorio existente; transacciones, ownership, locks y mapeos.
- `backend/test/recommendation.e2e-spec.ts`: 46 casos reales de integración de persistencia, concurrencia, restricciones y compatibilidad.
- `backend/test/recommendation-migration.e2e-spec.ts`: fixture de esquema anterior y conservación histórica.
- `docs/architecture/prog-4b-persistence.md`: informe y diseño de continuación.

### Modificados respecto al comienzo de PROG-4B

- `backend/prisma/schema.prisma`: solo `ProgressionRecommendation`.
- `backend/src/domain/progression/recommendation-evidence.policy.ts`: extracción compartida de dependencias; identidad existente sin cambios.
- `backend/src/domain/progression/recommendation.policy.ts`: usa dicha extracción y restringe el tipo de entrada de `compareDrafts` a las claves que ya utilizaba; sin cambiar decisiones.
- `backend/src/progression/recommendation.service.ts`: `saveMyProposal`, `getMyProposal`, `checkMyProposal`; conserva propuesta de solo lectura.
- `backend/src/progression/progression.repository.ts`: contratos internos de guardado/lectura.
- `backend/src/progression/prisma-progression.repository.ts`: extracción de lectura coherente y delegación a la implementación de persistencia; conserva estimaciones/historial.
- `backend/test/run-progression-isolated.mjs`: selector opcional de suites nuevas.

Los demás archivos que aparecen dirty/untracked en Git pertenecen al trabajo previo; no se los atribuye a esta tarea.

## S. Skills y herramientas efectivamente utilizadas

- `pulso-architecture-review` y referencia MVC: límites de responsabilidades y revisión de dependencias.
- `pulso-domain-integrity`: separación planificación/programación/ejecución y protecciones históricas.
- `pulso-integration-testing`: selección de runners y verificación de aislamiento.
- `pulso-prisma-migrations`: evolución nullable, revisión SQL y fixture anterior.
- Superpowers: instrucciones de uso, diseño/planificación, TDD, revisión independiente y verificación antes de completar.
- Git en lectura, herramientas locales TypeScript/Prisma/Jest/Prettier/oxlint, PostgreSQL temporal y revisión por segundo agente.

Graphify, herramientas visuales, navegador y Codex Security no fueron utilizados en esta etapa. No se reinstalaron herramientas ni modificaron skills/configuración.

## T. Decisiones pendientes

1. Política operativa de producción, validación de sus parámetros y responsables de aprobación.
2. Definición explícita de qué estados permiten revisión, sustitución o liberación del ciclo. PROG-4B bloquea competidores mientras no exista esa política.
3. Consentimiento manual y automatizado, su alcance, vigencia, revocación y auditoría; `autoApplyAuthorized` aislado es insuficiente.
4. Caducidad temporal, si procede; no se asigna una duración arbitraria.
5. Tratamiento de destinos retirados, protegidos o cambiados y creación de copias futuras.
6. PlanExercise conserva su precisión actual; PROG-5 debe validar representabilidad y rejilla del destino, sin truncar una propuesta de seis decimales a tres.
7. Al evolucionar `engineVersion`, conservar un lector/reproductor para cada versión histórica compatible. El lector de esta etapa admite la versión PROG-4A actual y rechaza versiones desconocidas; no debe alterarse esa implementación al introducir V2 sin mantener V1.
8. Despliegue autorizado de migración y evaluación de rendimiento con volúmenes de producción.

## U. Estado final

| Aspecto | Clasificación y evidencia |
| --- | --- |
| Persistencia | Implementada y verificada internamente; INCREASE neutral/PENDING exclusivamente. |
| Evidencia | Verificada: snapshot, versiones, huellas, proyecciones y enlaces atómicos/inmutables. |
| Idempotencia | Verificada por UNIQUE y conexiones independientes; no reinicia estados. |
| Concurrencia | Verificada para snapshot serializable/fences, unicidad, contención, carreras y rollback; límites detallados en O. |
| Obsolescencia | Verificada por dependencias y recálculo explícito; no hay invalidación automática. |
| Integridad histórica | Verificada con migración anterior, capturas y edición real del plan después del guardado. |
| Seguridad | Propiedad/privacidad y neutralidad verificadas en alcance interno; sin nueva certificación canónica. |
| PostgreSQL | Verificado con bases temporales reales, doce migraciones y sin deriva; desarrollo sin migrar. |
| Compatibilidad | Regresiones de progresión, sesiones y planificación aprobadas. |

Arquitectura: Modelo y dominio funcionales; servicio coordina; repositorio persiste. No se crean controladores ni presentadores decorativos: no hay nuevos recorridos HTTP. Se conserva MVC de los módulos existentes. **PROG-4B queda listo para revisión manual como componente interno; no equivale a autorización de progresión operativa ni preparación para producción.**

## V. Diseño de PROG-5 — Sin implementación

Separar revisión/autorización de la aplicación efectiva:

1. **Revisión manual:** resolver identidad/propiedad, mostrar evidencia neutral, destino previsto, cambios desde generación y decisión explícita. Registrar actor y versión de recomendación revisada. No equiparar PENDING a autorización.
2. **Automatización:** definir consentimiento persistido con atleta, ámbito de ejercicio/plan, política/versiones, límites, período, revocación y auditoría. El booleano actual no basta.
3. **Vigencia:** releer configuración, cohorte, resultados, readiness, destino y versión; comprobar dependencias, estado y ciclo. Ante obsolescencia, detener/revisar; no reemplazar silenciosamente evidencia.
4. **Destino efectivo:** distinguir prescripción fuente, destino previsto, copia futura y prescripción aplicada. Resolver jerarquía y propiedad. Planes activos/históricos utilizan el mecanismo existente de copia futura cuando corresponda; nunca actualizar sesiones ni objetivos capturados.
5. **Precisión:** comprobar `Decimal(8,3)` actual de `PlanExercise`/`ProgressionApplication`, unidad explícita y rejilla. Rechazar una propuesta incompatible; no redondear/truncar para hacerla caber. Cualquier ampliación requiere su propia migración y fixtures.
6. **Transacción:** acordar orden de locks con planificación/sesiones, CAS de versión del destino y recomendación, UNIQUE de aplicación y reserva del ciclo. Aplicación + auditoría + estado deben confirmarse atómicamente.
7. **Idempotencia:** solicitud autorizada con identidad estable; reintento devuelve la aplicación existente, sin aplicar el incremento nuevamente. Una revisión/versión diferente no reutiliza consentimiento anterior.
8. **Revisiones de ciclo:** definir qué terminales permiten sustitución y cuándo liberar `cycleSlot`. Conservar generaciones anteriores, vínculos explícitos y evidencia; volver a validar antes de cada aplicación.
9. **Pruebas:** propiedad, autorización insuficiente/revocada, destinos obsoletos/protegidos, copia futura, decimal/rejilla, aplicación doble simultánea, cambio de versión, rollback, historial inmutable y reintento posterior a respuesta perdida.

No se implementó ninguno de estos flujos en PROG-4B.
