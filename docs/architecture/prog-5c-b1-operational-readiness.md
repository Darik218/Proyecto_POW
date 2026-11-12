# PROG-5C-B1 — Contrato y evaluación previa no operativa

Verificación: 12 de noviembre de 2026, America/Bogota. B1 implementa contratos internos y evaluación pura. **No concede permiso, no ofrece ejecución automática y no implementa B2.**

## A. Estado inicial

Rama `feature`, HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`, con 163 entradas de status acumuladas al inicio. Se conservan cambios tracked/untracked y las 18 migraciones. Se guardaron status y SHA-256 de 543 archivos anteriores, incluidos schema, migraciones, fuentes, pruebas, documentación previa y `.env` (solo hashes). La comparación final identifica cualquier modificación previa; los nuevos archivos B1 se enumeran en U.

Línea base ejecutada antes de producto: backend 674, PostgreSQL 430 y frontend 189, aprobados. Las 27 pruebas de sesiones, 26 de planificación y 64 comprobaciones Firefox se repitieron como regresión posterior, sin atribuirles aprobación por el informe anterior. Sin commits, push, reset, clean, rebase, cambio de rama o worktree. Sin modificaciones `.env`, esquema, migraciones, autenticación, frontend ni escritores de entrenamiento.

## B. Auditoría

| Componente real             | Datos y límites relevantes                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProgressionRecommendation` | Captura/effectiveSettings, semanticKey, dependencyKeys, cycleKey, cycleSlot único, versión de revisión, estado y procedencia moderna/legada                                         |
| `RecommendationReview`      | Actor humano, intención, versión, transición APPROVE/REJECT, aceptación THIS_PROPOSAL_ONLY y evidencia; no permiso recurrente                                                       |
| `ProgressionApplication`    | Una por recomendación; modernos con ciclo único, atleta/intención, revisión única, prescripción, actividad, cargas y auditoría; origen MANUAL obligatorio en la rama moderna actual |
| Consentimiento/eventos      | PENDING_CONFIRMATION, ACCEPTED_INACTIVE o REVOKED; snapshot, huella, versiones, fechas y eventos inmutables                                                                         |
| `ProgressionSetting`        | Precedencia de fila completa, parámetros Decimal, updatedAt semántico, preferencia histórica autoApplyAuthorized; sin unidad propia                                                 |
| Planificación               | TrainingPlan→PlanWeek→PlanDay→PlanExercise; plan con versión, días retirables, carga Decimal(8,3) y unidad nullable                                                                 |
| Calendario                  | ScheduledActivity tiene estado/fecha civil/zona/versión y jerarquía; una actividad no acredita ejecución                                                                            |
| Historial                   | WorkoutSession conserva estado, vínculos opcionales, fecha/zona y capturas; ejecución→ejercicios→series no se reconstruye desde el plan                                             |

La aprobación manual y las condiciones SQL de aplicación no admiten un principal de servicio. Existen tipos/orígenes históricos AUTOMATIC, pero no un ejecutor moderno autorizado que pueda crearlos. Una tabla o un enum no acredita implementación.

Se contrastaron los informes PROG-5B,5C-A,6B-B, SETTINGS-1, esquema, políticas, servicios, lectores y SQL. El documento general `data-model.md` contiene contexto histórico que no sustituye estos contratos actuales.

## C. Arquitectura

Nueva ruta interna de cálculo:

```text
Observaciones explícitas de un lector interno autorizado (no HTTP)
  → evaluateOperationalReadiness(input)
  → evaluateAutomationConsent existente
  → enlace estructural ACCEPT + selección/reserva + bloqueos de diseño
  → resultado versionado / proyección NOT_GRANTED_IN_B1
```

No se añadieron consultas, servicio duplicado, repositorio, cliente Prisma, endpoint, controller o presenter sin consumidor. No se amplió la inspección SQL: carecería de decisiones aprobadas de cohorte/frecuencia y no sería correcto componer transacciones independientes aparentando una captura coherente.

La inspección existente de consentimiento es READ ONLY/Repeatable Read/UTC, con identidad persistida y propiedad. Su `buildConsentSnapshot` valida configurabilidad y puede rechazar destinos que ya tienen recomendaciones; no sustituye al lector `target(..., locking=false)` y `assertFutureTarget` de aplicación. `target` está exportado, pero recibe el contrato manual ApplyOperation y no resuelve un principal automático. Se deja su reutilización/adaptación para un consumidor B2 real.

Modelo y dominio B1: **Verificados** por pruebas/imports. Vistas/controllers nuevos: no corresponden a este alcance interno. Los contratos MVC existentes se conservaron y sus regresiones aprobaron; no se declara una API automática ni un cumplimiento global nuevo por crear tipos.

## D. Modelo de autorización

Tres dimensiones independientes:

1. **Compatibilidad de reglas:** `policyEligibility`, tomada del evaluador existente; incluye matemática, configuración y límites contractuales, y puede ser favorable aun con lifecycle pendiente/revocado.
2. **Aceptación humana histórica:** vínculo con evento ACCEPT de una captura exacta, según las comprobaciones de F. No implica que el permiso siga vigente.
3. **Capacidad operativa:** no disponible en B1. Siempre `operationalAuthorization: NOT_AVAILABLE_IN_B1` y `executionAuthorized:false`.

`OperationalAuthorizationDesign` es una proyección versionada **NOT_GRANTED_IN_B1**: beneficiario, consentimiento/estado/versión, versión aceptada y del evento, eventId, contractKey, acceptanceKey/conditionsKey, política/huella, motores, ejercicio/plan/allowlist, bindings de configuración, límites exactos, vigencia/zona, máximo histórico, términos y descriptor de principal. Declara issuer no definido y reglas de frecuencia/cohorte no aprobadas. No es grant, token, recibo ni fila persistida.

**Autorización adicional propuesta para B2, pendiente de aprobación:** habilitación explícita y auditable de ejecución, otorgada por un emisor confiable a una capacidad de servicio y a un beneficiario/contrato precisos. Recomiendo un acto separado de activación con condiciones operativas versionadas presentadas al propietario y política del sistema aprobada, conservando el evento anterior. Alternativa: una nueva aceptación integral que incluya esas condiciones y emita el grant en la misma transacción. La elección, quién puede emitirlo y qué nuevas condiciones humanas exige son decisiones de producto/seguridad; ninguna quedó aprobada por B1. Un operador técnico no debe ampliar límites unilateralmente.

## E. Principal de servicio

Implementado únicamente `ServiceProgressionPrincipalDesign`: schema versionada, `SERVICE_DESIGN_ONLY`, principalId, capabilityVersion y beneficiario. Valida forma, campos exactos y coincidencia del beneficiario; no autentica la identidad ni habilita la capacidad. Un descriptor humano, un beneficiario diferente o un campo `enabled:true` se rechazan como descriptor inválido.

Contrato futuro propuesto, no ejecutable:

```typescript
interface ServiceProgressionExecutionDraft {
  schemaVersion: "service-progression-execution-proposal-v1";
  principalId: string;
  capabilityVersion: string;
  operationalGrantId: string;
  expectedGrantVersion: number;
  beneficiaryAthleteId: string;
  consentId: string;
  expectedConsentVersion: number;
  acceptanceEventId: string;
  acceptedContractKey: string;
  recommendationId: string;
  semanticKey: string;
  cycleKey: string;
  destination: {
    planId: string;
    weekId: string;
    dayId: string;
    prescriptionId: string;
  };
  expectedPlanVersion: number;
  activityId: string;
  expectedActivityVersion: number;
  operationIntentId: string;
  executorAuditVersion: string;
}
```

El adaptador futuro debe verificar identidad de workload (alternativas: mTLS/identidad de plataforma/token de servicio con audiencia restringida), registro de principal/capacidad vigente y grant limitado. No basta recibir este objeto. El beneficiario se resuelve desde el grant protegido y se compara con el comando, nunca desde un athleteId arbitrario. Permisos mínimos sobre fuentes y destino exacto; sin acceso general a otros atletas, emisión de grants o ampliación de allowlists. Sin JWT/refresh/sesión humana simulada, credenciales reales, roles o configuración nuevos en B1.

## F. Aceptación

El snapshot conserva legítimamente `humanAcceptance:NOT_RECORDED`: no se reescribe. La evidencia está en `ConsentReceipt.acceptanceEvidence` del evento ACCEPT y en las restricciones SQL existentes.

Para una aceptación pendiente de versión v:

- Evento: fromVersion=v, version=v+1, PENDING_CONFIRMATION→ACCEPTED_INACTIVE.
- Evidencia: acceptedVersion=v, presentación `recurring-consent-presentation-v1`, términos, conditions/context/acceptanceKey, acción explícita y cinco reconocimientos.
- Agregado aceptado: version=v+1. No se compara acceptedVersion directamente con esa versión.
- Agregado revocado: version=evento ACCEPT.version+1; conserva la aceptación histórica, pero bloquea operación. No hay revisión ni reactivación después de aceptar/revocar.

B1 comprueba propietario/actor esperados, identidades, estados/versiones, términos/presentación/reconocimientos, instante del evento no posterior al de evaluación, hashes de ambos snapshots y las huellas esperadas. Rechaza evento ausente, diferente, futuro o contradictorio. No reproduce la canonicalización JSONB de `automation_acceptance_evidence_key`; **integrity: REQUIRES_TRUSTED_PERSISTENCE_SOURCE** es explícito. Un objeto con cadenas hexadecimales válidas no prueba por sí mismo una interacción humana persistida. Estos inputs deberán proceder del ledger protegido y sus relaciones SQL.

El evento acredita una interacción autenticada conforme al contrato, no que la persona haya leído/comprendido todas las condiciones. Un JWT válido, un booleano, un fixture o THIS_PROPOSAL_ONLY no lo sustituyen.

## G. Estados

Se conserva la máquina actual:

```text
PENDING_CONFIRMATION --REVISE--> PENDING_CONFIRMATION (otra versión)
PENDING_CONFIRMATION --ACCEPT--> ACCEPTED_INACTIVE
PENDING_CONFIRMATION --REVOKE--> REVOKED
ACCEPTED_INACTIVE    --REVOKE--> REVOKED (terminal)
```

No se introduce ACTIVE. Estados desconocidos y saltos incompatibles son no evaluables. La proyección NOT_GRANTED_IN_B1 no es un estado Prisma ni una transición del consentimiento. Estados futuros de grant/emisión/revocación requerirán una especificación/migración separada; no convertirán consentimientos existentes por backfill.

## H. Políticas

Se reutiliza `evaluateAutomationConsent`: identidad/evidencia PROG-4A, motor/versión numérica, configuración efectiva, política aceptada, alcance, unidades, precisión, límites, destino, ciclo y frecuencia de las observaciones proporcionadas. No se copian fórmulas ni se recalculan incrementos con Number.

SETTINGS-1 conserva la precedencia por fila, bindings reales y diferencias entre metadata de revisión y parámetros decisorios. Cambiar configuración exige revalidación; no edita evidencia o consentimiento histórico. `autoApplyAuthorized` continúa siendo preferencia histórica, no grant ni consentimiento. Límites/decimales en la proyección se clonan exactamente, sin convertir unidad ni redondear condiciones.

## I. Cohortes

PROG-4A recibe período deportivo, corte, consulta histórica, cohorte y política de cumplimiento/readiness/RPE explícitos; coordina PROG-2/3 mediante `deriveRecommendation`. No existe un selector recurrente aprobado de nuevas sesiones/slots/comparaciones/referencias.

B1 verifica únicamente `ACCEPTED_EXPLICIT_SET_NO_EXPANSION`: IDs de tareas de la captura dentro del conjunto aceptado. Para considerar completo ese conjunto exige igualdad de conjuntos, no un subconjunto ni duplicados. La ausencia de selección, una expansión a IDs futuros o cobertura parcial produce razones tipadas. Incluso coincidiendo, **COHORT_SELECTOR_NOT_APPROVED** permanece: observar el conjunto histórico no autoriza a seleccionar automáticamente el próximo.

`historyWindowDays` es un máximo, no una ventana implícita de 7 días. Faltan por aprobar selector de nuevos registros, fechas, corte, exclusiones, posiciones, manejo de sesiones incompletas/cobertura/RPE ausente y estabilidad de objetivos originales/ajustados. Se reutilizarán las políticas actuales, sin inferir cumplimiento ni interpretar ausencia de RPE como dato medido.

## J. Recomendaciones

Hoy `RecommendationService.proposeMyExercise` recibe identidad humana y comando explícito; PROG-4B guarda propuestas neutrales INCREASE reproducibles, en PENDING y con reserva. PROG-5A produce APPROVE específico; PROG-5B exige esa revisión y SQL de rama MANUAL.

No existe iniciador automático ni regla para escoger semana, cohorte, corte o propuesta. B1 devuelve **AUTOMATIC_RECOMMENDATION_ROUTE_UNDEFINED**. B2 deberá decidir:

- Generar una propuesta nueva desde un comando reproducible de servicio o consumir una existente con procedencia verificable.
- Cómo fijar período/corte/cohorte sin reutilizar declaraciones viejas como permisos futuros.
- Qué hacer ante reserva manual pendiente/rechazada/aplicada; recomendación conservadora: bloquear y pedir resolución explícita, sin apropiarse de ella.
- Qué evento propio acredita autorización automática y cómo se relaciona con el estado final de recomendación.

No se hace PENDING→APPROVED artificial, no se escribe APPROVE y no se llama a aplicación manual fingiendo identidad. Una transición automática futura debe tener SQL/auditoría diferenciados y aprobación previa.

## K. Destinos

Se conserva EXACT_PRESCRIPTION_ALLOWLIST. B1 recibe IDs candidatos ya obtenidos/filtrados por un lector interno protegido; no acredita su procedencia ni cobertura por sí mismo. Cero candidatos: unavailable; varios: ambiguous; repetidos: selección inválida; cobertura incompleta: bloqueo; uno diferente del destino evaluado: no autorizado. No se elige el primero ni se normalizan duplicados contradictorios.

La evaluación existente comprueba pertenencia al contrato/jerarquía, ejercicio/plan, carga/unidad/versiones, DRAFT, retiro/protección y fecha futura. Un resultado favorable sigue incluyendo **FULL_DESTINATION_REVALIDATION_REQUIRED**: B2 deberá reutilizar el lector completo y `assertFutureTarget` para actividades de todo el día, límites del plan, historial/sesiones y precisión. La versión de plan capturada en el consentimiento es procedencia, no un sustituto del CAS actual ni permiso para incluir copias nuevas. No se amplía un plan null a cualquier plan ni se copian permisos al duplicar rutinas.

## L. Límites

Se evalúan los límites aceptados exactos: incremento absoluto, porcentaje, carga máxima, unidad/rejilla, máximo semanal, primer día ISO y ventana máxima histórica. La comparación Decimal existente rechaza valores no evaluables, incoherencia con carga actual, diferencias de unidad, incremento/carga excesivos y valores no persistibles. No se agregan permisos de consentimientos distintos ni se selecciona el más permisivo.

La frecuencia queda **FREQUENCY_POLICY_UNAPPROVED**. El contador recibido no acredita una consulta SQL; INCOMPLETE produce FREQUENCY_NOT_EVALUABLE. B2 debe aprobar ámbito (ejercicio global / ejercicio-plan / prescripción) y fecha de imputación (instante de aplicación / período deportivo). Recomiendo evaluar globalmente atleta+ejercicio y ambos orígenes para evitar reinicios por plan/consentimiento, pero es una propuesta pendiente, no política aplicada por B1.

## M. Ciclo

`recommendationCycleKey` existente deriva de atleta, ejercicio, inicio/fin del período deportivo y destino (jerarquía/prescripción o tarea); excluye revisión/configuración. Por ello no equivale a una única operación por ejercicio y semana.

`cycleSlot=cycleKey` reserva la propuesta moderna. La aplicación tiene unicidad de recomendación/ciclo y no libera la reserva. B1 distingue reserva propia, competidora, ausencia de reserva, datos legados no evaluables y consumo ya observado. No borra propuestas ni cambia estados para liberar espacio. Un consentimiento nuevo no reinicia estas identidades.

La observación `recommendationId→semanticKey/cycleKey/cycleSlot` también requiere lector protegido: B1 compara los valores, no demuestra que esa fila exista en PostgreSQL. El contador semanal es una dimensión adicional al ciclo y no lo reemplaza.

## N. Vigencia

Se conserva `[startsAt, endsAt)`, offsets/zona explícitos y reloj proporcionado como entrada. B1 no lee reloj del sistema. Rechaza vencimiento, no vigencia todavía y evento de aceptación futuro; una revocación conserva aceptación histórica pero bloquea cualquier operación posterior.

La futura aplicación debe volver a leer consentimiento, evento, grant, capacidad, configuración y destinos después de adquirir fences. Una inspección anterior no es permiso permanente. Instante decisivo/effectiveAt y requisito temporal exacto de COMMIT deben aprobarse para B2; propuesta compatible con el mecanismo manual: reloj SQL en la validación decisiva bajo locks, auditado como effectiveAt, con última verificación antes de escribir. Si se exige validez temporal hasta el COMMIT, se necesitará además especificación/pruebas del control diferido; no se promete esa garantía en B1.

## O. Concurrencia

No hay locks ni transacciones nuevas B1. La siguiente es una **propuesta de protocolo B2**, no una garantía ejecutada:

1. Verificar identidad de workload fuera de la operación de negocio; dentro de READ COMMITTED, UTC local, bloquear registro de principal/capacidad para impedir revocación concurrente.
2. Bloquear usuario beneficiario SHARE y atleta UPDATE, resolviendo su relación desde PostgreSQL. No crear ni usar AuthSession humana del ejecutor.
3. Bloquear grant y consentimiento en orden estable; releer estado/versión/evento/alcance/huellas. Los emisores y revocadores nuevos deberán respetar ese orden.
4. Tras la fence del atleta, repetir consulta de recibo; bloquear fuentes mutables usando la secuencia existente: sesiones/configuración, plan/ejercicio/tareas/series y jerarquía, con órdenes por ID/NOWAIT/reintentos acotados compatibles con PROG-5B.
5. Bloquear recomendación, adquirir advisory lock transaccional del cycleKey, bloquear actividades y realizar lecturas definitivas. Recontar consumo/frecuencia bajo la misma fence.
6. Revalidar permiso y reloj decisivo antes de aplicar, mantener locks hasta COMMIT.

El prefijo adicional principal/capacidad deberá ser común a sus nuevos revocadores; ninguna ruta podrá invertirlo adquiriendo primero atleta y luego principal. Los flujos humanos existentes siguen usuario/sesión→atleta→consentimiento/destinos, sin tener que pedir una capacidad de servicio. Evitar esperar en orden inverso mediante NOWAIT/reintento acotado, no mediante locks en memoria.

Si REVOKE confirma primero, la relectura decisiva observa REVOKED y rechaza. Si una aplicación válida confirma primero, REVOKE posterior no revierte la historia y bloquea operaciones siguientes. La serialización se apoya en la misma fence del atleta y la fila de consentimiento/grant mantenidas hasta COMMIT, no en un resultado B1 guardado. Este nuevo protocolo completo requiere pruebas con conexiones independientes en B2.

## P. Idempotencia

B1 no registra intenciones ni consume ciclos. Mismas entradas/versiones/instante producen mismo resultado y no mutan inputs. La proyección no puede canjearse como token.

Para B2, la intención persistida deberá fijar principal/capability, grant/version, beneficiario, consentimiento/evento/huella, recomendación/semanticKey/cycleKey/dependencies, destino y versiones de plan/actividad, cargas/unidad, política/cohorte/frecuencia y versión de auditoría. Huella canónica versionada, Decimal textual y distinción null/ausencia/cero, sin aleatoriedad o reloj de consulta en identidad semántica.

Reintento idéntico: recuperar recibo sin nuevo incremento/cambio de fecha/destino. Misma intención con contenido distinto: conflicto tipado. UNIQUE de ciclo/recomendación/intención como autoridad, no un preflight. Reconsulta bajo fences para el perdedor de concurrencia. Un recibo histórico después de revocación describe lo ya ocurrido y nunca habilita una aplicación adicional. Cambio de principal/cuenta o capacidad requiere verificar autorización de lectura del recibo, sin reinterpretar su actor.

## Q. Modelo interno implementado

- `operational-readiness-input-v1`: observaciones explícitas, expectativa de aceptación, dueño, descriptor y cobertura/selección/reserva.
- `operational-readiness-design-v1`: resultado tipado con policyEvaluation/policyEligibility, aceptación MISSING/INVALID/BOUND_RECORDED_EVENT, principal MISSING/INVALID/DESIGN_ONLY y blockers estables.
- `progression-operational-authorization-design-v1`: condiciones vinculadas, NOT_GRANTED_IN_B1, sin emisor ni selector/capacidad aprobados.
- `evaluateOperationalReadiness`: compone el evaluador actual, preserva resultados separados y false literal en todos los caminos, incluso input nulo/malformado.

Bloqueos permanentes B1: OPERATIONAL_AUTHORIZATION_MISSING, EXECUTOR_CAPABILITY_UNAVAILABLE, COHORT_SELECTOR_NOT_APPROVED, FREQUENCY_POLICY_UNAPPROVED, AUTOMATIC_RECOMMENDATION_ROUTE_UNDEFINED, TRANSACTIONAL_REVALIDATION_REQUIRED y FULL_DESTINATION_REVALIDATION_REQUIRED. Los problemas observados añaden motivos de consentimiento, aceptación, ámbito, cobertura, destino o ciclo; los motivos matemáticos existentes se conservan anidados sin crear otro motor.

No se implementó `inspectAutomaticProgressionReadiness` productivo: no hay lector/servicio nuevo cuya consistencia o autorización pueda afirmarse. Eso no impide usar el evaluador puro, pero sí impide declarar lista la inspección transaccional o ejecución futura. No se devuelven entidades a un endpoint nuevo.

## R. PostgreSQL

Las 18 migraciones anteriores se aplicaron exclusivamente en los runners temporales existentes, sin seeds. Se comprobaron host/URL/base/puerto y realpath de data_directory propios; migraciones al día, sin deriva y limpieza. Bases: pulso_prog1b_test para progresión y pulso_f06_test para sesiones/planificación; Firefox usa sus bases/puertos/directorios privados. Ninguna escritura a proyecto_pow_dev.

No hay nueva consulta SQL ni escritura productiva B1; por tanto no se presentan tests de mocks como nueva garantía transaccional. Se repiten las 430 pruebas PostgreSQL existentes de PROG-1B a SETTINGS-1 y migraciones, 27 de sesiones y 26 de planificación. Verifican los mecanismos reales que B2 pretende reutilizar, sin implementar la carrera automática futura. Sus fixtures pueden ejecutar el camino **manual** como regresión; B1 no aplica cargas.

Comparación de archivos anteriores conserva schema/migraciones, fuentes históricas, snapshots/SQL y frontend. Las comprobaciones PostgreSQL/Firefox previas de historia, aceptación y ausencia de automatización siguen aprobando; no se agregan backfills, eventos ni datos persistentes de B1.

## S. Regresiones

Comandos reales por directorio:

| Grupo / comando                                                                    | Resultado final                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| backend `npm test -- --runInBand`                                                  | 726 pruebas,63 suites                             |
| backend `node test/run-progression-isolated.mjs --api`                             | 430 pruebas,19 suites PostgreSQL/HTTP/migraciones |
| backend `node test/run-workouts-mvc-isolated.mjs`                                  | 27 pruebas,3 suites                               |
| backend `node test/run-planning-mvc-isolated.mjs`                                  | 26 pruebas,4 suites                               |
| frontend `npm test`                                                                | 189 pruebas                                       |
| backend `npm run build`, `tsc --noEmit`, `npm run lint`, `npm run prisma:validate` | Aprobados al cierre                               |
| frontend `npm run build`                                                           | vue-tsc y Vite aprobados                          |
| Formato scoped, `git diff --check`, comparación SHA-256                            | Aprobados al cierre                               |

**1.398 pruebas automatizadas distintas**, incluidas 52 nuevas B1 (49 de política y 3 de arquitectura). No se suman nuevamente las focalizadas, baseline ni repeticiones. Los 52 casos comprueban aceptación/versiones/huellas/actor, lifecycle, ámbito/política/configuración, unidades/rejilla/límites/carga/frecuencia/ciclo, cohortes parciales/futuras, destinos vacíos/múltiples/repetidos, principal malformado, ausencia de permiso, inmutabilidad y determinismo.

Se observó RED inicial por módulo ausente, un fixture con atleta de tareas distinto (corregido sin tocar el motor) y regresiones RED→GREEN por snapshot actual alterado, hueco de versión revocada, estado inexistente y agregado pendiente incompatible con ACCEPT. No se debilitaron aserciones. Advertencias preexistentes de Node VM/loader experimental y concurrencia pg permanecen documentadas; no se instalaron dependencias para ocultarlas.

Firefox real, sin mocks: `run-progression-browser-isolated.mjs`19, `run-automation-consent-browser-isolated.mjs --acceptance`25 y `--settings`20: **64 comprobaciones distintas**. Son regresiones de los recorridos existentes, no una UI B1. Se mantiene la limitación de viewport compacto CSS500×758 de Firefox headless; no se presenta como dispositivo físico390px ni auditoría completa de accesibilidad/consola. No se modificó frontend ni se crearon pantallas/ejecutores.

## T. Seguridad

Amenazas y controles del alcance:

- Confundir matemática/consentimiento con capacidad: resultados separados y false literal, sin consumidor escritor.
- Fabricar principal/grant: descriptor DESIGN_ONLY, emisor ausente, ningún verificador/credencial operativa nuevo y ningún booleano habilitante.
- Cruce de atleta/actor, aceptación de otra versión o snapshot: comparaciones explícitas con inputs del lector protegido y hashes originales; no confianza en un cliente.
- Reutilizar APPROVE o sesiones humanas: no se importan AuthenticatedIdentity ni aplicación manual en el nuevo dominio; pruebas de frontera impiden esos accesos.
- Destinos ambiguos, cohortes ampliadas o contador incompleto: bloqueo explícito, sin selección silenciosa ni supuestos de cobertura.
- Revocación/ciclo concurrente: documentados como revalidación B2 pendiente, no como seguridad ya resuelta por una inspección.
- Filtración de secretos: sin endpoint nuevo, sin tokens/logs privados ni persistencia nueva.

Revisión independiente estática sobre contratos, principal, evidencia, versiones, SQL existente y frontera B1/B2. El revisor ejecutó49 pruebas focalizadas antes de los tres casos añadidos al cierre; después confirmó los fixes específicos por lectura. Encontró el caso de pending incompatible, reproducido y corregido con regresión. No revisó todo el acumulado dirty ni certifica seguridad productiva. No se ejecutó un escáner canónico Codex Security en esta tarea, ni se modificaron sus permisos/configuración. No se localizó una guía SECURITY.md específica; se aplicaron las instrucciones internas AGENTS/skills y se contrastaron guards/políticas/protocolos reales pertinentes.

## U. Archivos y herramientas

Archivos nuevos de producto:

- `backend/src/models/progression/operational-readiness.model.ts`: contratos/resultados/descriptores no operativos.
- `backend/src/domain/progression/operational-readiness.policy.ts`: evaluación pura y vínculos.

Pruebas nuevas:

- `backend/src/domain/progression/operational-readiness.policy.spec.ts`.
- `backend/src/progression/operational-readiness.architecture.spec.ts`.
- `backend/test/helpers/operational-readiness-fixtures.ts`: datos deterministas de prueba, sin crear sesiones/credenciales o simular un ejecutor humano.

Documentación: spec y plan Superpowers2026-11-12-prog5cb1, este informe y evidencia en `docs/architecture/evidence/prog-5c-b1/`. No se modifica ningún archivo productivo anterior. El diff contra HEAD contiene etapas previas: no atribuirlo entero a B1.

Skills efectivamente consultadas: pulso-architecture-review y referencia MVC, pulso-domain-integrity/data-model, pulso-integration-testing, pulso-prisma-migrations; Superpowers using/brainstorming/writing-plans/TDD y metodología de depuración, revisión y verificación. Restricciones del usuario prevalecen sobre commits/worktrees/aprobaciones operativas sugeridas genéricamente. Herramientas: lectura/rg/Git de solo lectura, Jest, Node test/Vue, TypeScript, Prisma, PostgreSQL temporal, Oxlint, Prettier, Firefox/Geckodriver existentes y revisor independiente. No Graphify, plugins reinstalados, nuevas dependencias o credenciales de servicio.

## V. Estado final

**B1 implementado y verificado en alcance de contrato y evaluación pura no operativa.** Las decisiones pendientes no se sustituyeron por reglas nuevas. Modelo/dominio: verificados; inspección productiva nueva: no implementada por los límites explicados; autorización y ejecutor: no implementados ni concedidos. executionAuthorized permanece false en resultados actuales y nuevos.

No se modificaron planes, prescripciones, calendario, sesiones, series, estimaciones, recomendaciones, revisiones, aplicaciones, consentimientos ni eventos por B1. La regresión manual mantiene sus operaciones en fixtures temporales. Sin migración nueva ni datos de desarrollo modificados, sin commits/push. No se declara producción, automatización disponible ni B2 completado.

## W. PROG-5C-B2 — Propuesta para aprobación, no implementación

### Decisiones que deben resolverse

| Decisión                | Alternativas / implicaciones                                                       | Recomendación pendiente                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Acto/emisor del permiso | Activación separada o nueva aceptación operativa integral; auditoría/UX diferentes | Acto explícito adicional ligado al contrato exacto; nunca backfill de ACCEPTED_INACTIVE |
| Identidad de servicio   | Workload/mTLS/token propio con audiencia; registro y revocación                    | Capacidad mínima verificable y principal separado de usuario/sesión                     |
| Disparador/generación   | Invocación interna, evento o ejecución programada futura                           | Definir contrato reproducible antes del mecanismo de scheduling                         |
| Cohorte/corte           | Lista finita actual frente a selector recurrente versionado; slots/RPE/referencias | Nuevo selector aprobado; mantener bloqueada expansión no especificada                   |
| Propuesta/ciclo manual  | Generar neutral nueva o consumir existente; reservas pueden competir               | No apropiarse de reservas manuales; conflicto explícito hasta definir transición        |
| Destinos                | Selección explícita única o regla determinista aprobada                            | Cero/múltiples bloquean por defecto; no primero/más permisivo                           |
| Frecuencia              | effectiveAt vs semana de evidencia; ámbito ejercicio/plan/prescripción             | Considerar atleta+ejercicio, todos los orígenes; decisión todavía pendiente             |
| Legado                  | Datos atribuibles por FK vs ciclo/unidad/metadatos ausentes                        | Cobertura por dimensión; no asumir cero cuando falta identidad necesaria                |
| Momento decisivo        | Validez al instante auditado vs hasta COMMIT                                       | Especificar y probar ambas fronteras antes de habilitar                                 |
| Estados/SQL automático  | Evento operativo separado y extensión disjunta MANUAL/AUTOMATIC                    | No fabricar APPROVE ni reutilizar el guard manual                                       |

### Persistido, derivado y efímero

Persistencia futura solo tras aprobar: principal/capacidad verificables con versión/revocación; grant limitado (beneficiario, consentimiento/evento/huellas, motores/política, bindings, allowlist, límites, vigencia, selector y frecuencia aprobados, procedencia/emisor/acto habilitante); eventos inmutables de emisión/revocación y autorización por aplicación; recibo idempotente enlazado con aplicación. No bastará enabled:true.

Derivado bajo transacción: configuración actual, compatibilidad de huellas, cohorte/readiness/RPE por PROG-2/3/4A, instante/ciclo/frecuencia, elegibilidad completa de destino y ausencia de consumo/reserva competidora. No reconstruir capturas históricas desde el plan actual.

Efímero: credencial workload verificada, correlación del disparador e intento, resultado B1/preflight. Ninguno sustituye un grant persistido ni crea sesiones humanas. No registrar secretos.

### Contadores SQL propuestos

Por ciclo: buscar tanto reserva en recomendaciones como aplicación con cycleKey, después de fence/advisory; separar ambas observaciones. Por ejercicio/semana: consultar aplicaciones de ambos orígenes uniéndolas a recomendación/atleta/ejercicio, sin filtrar por consentimiento. Si se aprueba effectiveAt, convertir ese instante a fecha civil en zona aceptada y usar límites semanales `[inicio,fin)` con primer día ISO; no sumar 168 h ignorando DST. Cambiar consentimiento no reinicia consumo.

Un legado con FK de recomendación y effectiveAt puede aportar algunas dimensiones aun con metadata moderna nula; no se inventan ciclo/unidad ausentes. Lo no atribuible para la regla aprobada impide afirmar cobertura completa. No aceptar conteos de Vue ni sumar permisos de contratos solapados.

### Transacción y reutilización

```text
Identidad/capacidad verificadas + grant explícito
 → fences y relectura de grant/consentimiento/ACCEPT/propietario
 → comando de generación/selección aprobado, evidencia revalidada
 → reserva/ciclo + frecuencia de todos los orígenes pertinentes
 → destino exacto y todas sus actividades, precisión y CAS
 → comprobación decisiva de permiso/vigencia
 → actualización exacta + versión del plan
 → autorización automática auditada + aplicación + estado final + recibo
 → COMMIT único
```

Reutilizar derivación matemática, claves/precisión, fences, `assertFutureTarget` y `applyExactPrescriptionLoad`. Extraer un núcleo transaccional compartido **cuando exista ese consumidor**, con autorización manual y de servicio separadas y pruebas de equivalencia manual. No duplicar cálculos ni llamar `applyMyApprovedRecommendation` desde un worker.

La migración futura debe mantener la unicidad global de ciclo/recomendación y los recibos históricos. Una extensión disjunta de ProgressionApplication permitiría conservar esa unicidad mejor que tablas independientes; requiere campos/fks de principal/grant/evento y checks específicos para AUTOMATIC, preservando la rama MANUAL y el legado. Es propuesta: no se altera el SQL actual, que exige revisión humana moderna. Se debe aprobar la transición de recomendación y su evento propio antes de implementar la rama automática.

Una única transacción confirma conjuntamente autorización decisiva, identidad semántica, consumo, carga/versiones, auditoría, estado y recibo; cualquier fallo revierte todo. No consumir permiso en una transacción previa ni cambiar consentimiento/destino en un reintento. Pruebas B2 obligatorias: dos aplicaciones iguales/distintas, revocación de consentimiento/grant/capacidad, expiración fronteriza, edición de configuración/destino, transición de sesión, reserva manual, legado incierto y fallos antes/después del recibo. El contrato B1 y los contratos actuales conservarán false: B2 deberá crear un recorrido operativo independiente y versionado, no convertir esta proyección en un grant cambiando su booleano. Hasta resolver esas decisiones y verificaciones, la ejecución automática permanece inaccesible.
