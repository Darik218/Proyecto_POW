# PROG-5C-A — Consentimiento recurrente interno, pendiente y auditable

Verificación: 2026-11-11. Esta etapa no habilita aplicación automática, consentimiento humano ni endpoints.

## A. Estado inicial

Rama `feature`, HEAD `cbd5d3bea27fd38052b37e4adcf0d6d95e5aff98`, conservados. El repositorio contenía trabajo acumulado sin commit de PROG-3 a PROG-5B. Se registró el status y un inventario SHA-256 inicial en `/tmp/pulso-prog5ca-before.json`. La comparación posterior encontró únicamente los seis archivos de integración enumerados en S modificados, ningún archivo anterior eliminado y las catorce migraciones anteriores intactas.

Línea base nuevamente ejecutada antes de implementar: **575 pruebas unitarias/arquitectónicas y 267 pruebas PostgreSQL de progresión aprobadas**. Las 27 de sesiones y 26 de planificación del informe anterior se volvieron a ejecutar durante la regresión final; no se asumieron aprobadas por referencia.

## B. Auditoría

- `ProgressionSetting.autoApplyAuthorized` es un booleano histórico sin alcance, política aceptada, vigencia, intención ni evento de consentimiento. No se convierte ni copia como permiso.
- PROG-4A aporta política explícita, configuración efectiva, evidencia reproducible, incrementos Decimal, semanas deportivas y dependencias.
- PROG-4B persiste propuestas neutrales con semántica/ciclo/reserva; no concede autorización.
- `RecommendationReview` acredita exclusivamente `THIS_PROPOSAL_ONLY`; PROG-5A no representa consentimiento recurrente.
- `ProgressionApplication` y PROG-5B aplican manualmente una propuesta específica con sesión vigente, origen MANUAL, auditoría, revalidación y destino futuro exacto. No se alteraron esos flujos.
- `AuthenticatedIdentity` identifica usuario y sesión. El repositorio comprueba realmente usuario ACTIVE, propiedad del atleta y sesión persistida no revocada ni expirada, ordinaria o absolutamente.
- Las prescripciones pertenecen a día/semana/plan; el calendario no sustituye una prescripción. Planes con historial/sesiones, días retirados y unidades incompatibles no son candidatos admitidos por esta primera infraestructura.

## C. Arquitectura

```text
Identidad autenticada + comando interno
 → AutomationConsentService
 → ProgressionRepository existente / PrismaProgressionRepository
 → automation-consent.persistence (UTC local + transacción + propiedad)
 → políticas puras / configuración efectiva existente
 → consentimiento + evento exacto de versión
 → recibo histórico o inspección informativa
```

El modelo representa contratos, estado, captura, recibos y resultados; Domain valida y evalúa sin I/O; Service identifica y coordina; Repository bloquea y persiste. Se agregó un servicio al `ProgressionModule` existente, ya importado por AppModule. No se duplican módulos, clientes de producción, repositorios, RecommendationService ni motores.

No se agregan Controlador/Vista: no hay consumidor HTTP autorizado. Modelo, dominio, servicio y persistencia participan en casos internos reales y pruebas PostgreSQL con resolución NestJS. La arquitectura MVC existente se conserva; no se declara MVC público para este caso ni cumplimiento global adicional.

## D. Modelo de consentimiento

Se añadieron dos modelos:

**ProgressionAutomationConsent**: ID, atleta, actor solicitante, ejercicio, plan opcional, estado, versión, huella de contrato/captura, JSONB versionado, inicio/fin de vigencia, creación, modificación y revocación. FKs reales a atleta, usuario, ejercicio y plan/atleta. Los instantes son timestamptz(6).

**ProgressionAutomationConsentEvent**: ID, consentimiento/atleta, actor, acción, intención, huella del comando, versión y estado anteriores/posteriores, huella de contrato, captura íntegra, instante del servidor y razón de revocación. Son únicos (athleteId,intentId) y (consentId,version).

`automation-consent-snapshot-v1` contiene el contrato normalizado, versiones reales del motor de recomendaciones y política numérica, destinos comprobados y configuración efectiva por plan. Siempre conserva `humanAcceptance: NOT_RECORDED` y `operationalAuthorization: NOT_AVAILABLE_IN_PROG_5C_A`.

Las columnas de fechas/propiedad permiten FK, consultas e integridad; la captura conserva las condiciones exactas de cada versión. No se descompone cada parámetro en columnas redundantes.

## E. Alcances

Ejercicio obligatorio; plan puede ser un UUID propio o NULL **explícito**. NULL significa únicamente las prescripciones enumeradas, potencialmente de varios planes propios, nunca cualquier plan. No hay autorización global implícita.

Selector único admitido: `EXACT_PRESCRIPTION_ALLOWLIST`, 1–100 IDs distintos, `futureOnly: true`, `planState: DRAFT`, `versionPolicy: READ_CURRENT_AND_CAS`. No elige el primer destino ni selecciona uno automáticamente. La jerarquía, propiedad, ejercicio, unidad y editabilidad de cada candidato se verifican al solicitar/revisar.

La versión de plan capturada acredita lo observado al solicitar; no congela la plantilla ni autoriza ignorar versiones futuras. La ejecución futura deberá recuperar la versión actual, comprobar recomendación/destino y aplicar CAS. Una copia o prescripción diferente queda fuera de la lista y requiere nueva configuración/aceptación.

Las referencias JSON a los destinos se verifican por relación real y conjuntos exactos, sin crear una tabla hija que replique historial. Pueden quedar obsoletas si cambia posteriormente la planificación; eso no habilita ejecución y requiere nueva evaluación.

## F. Políticas

El contrato guarda política completa proyectada con ID, versión, procedencia explícita, base ORIGINAL/ADJUSTED, baseline, cohorte, cumplimiento, readiness, conteo, RPE, señales, incremento, rejilla y temporalidad. Se reutiliza `policyProjection` y `resolveEffectiveSettings`; la única modificación a la política anterior fue exportar su proyección existente, sin cambiar su comportamiento.

La configuración se resuelve separadamente por cada plan enumerado, conservando la precedencia existente global → ejercicio → ejercicio/plan. Cada binding fija ID/alcance del registro seleccionado y parámetros decisorios normalizados. Su huella excluye únicamente `updatedAt`, la preferencia `autoApplyAuthorized` y el atleta redundante; propiedad se comprueba por separado. La captura histórica conserva también esos datos informativos.

Cambios de política, versión, límites, selección efectiva, unidad o parámetros decisorios no se aceptan automáticamente. La inspección muestra MATCH/CHANGED/UNAVAILABLE; la revisión explícita crea otra versión pendiente. Cambiar ejercicio o ámbito de plan requiere una nueva solicitud, no cambiar la identidad del agregado.

La captura también vincula `RECOMMENDATION_ENGINE_VERSION` y `LOAD_INCREMENT_NUMERIC_POLICY.version`. El evaluador rechaza recomendaciones de otras versiones. No se reescribe una captura anterior cuando cambia el motor, y su auditoría sigue siendo legible.

**No hay una política operativa aprobada por defecto.** Referencias de fixtures son de pruebas y no aprobación productiva. Una cohorte explícita capturada no se amplía sola a nuevas tareas/semanas. El diseño de plantillas de políticas recurrentes aprobadas corresponde a las etapas posteriores.

## G. Límites

Son obligatorios: incremento absoluto máximo, incremento porcentual máximo, carga máxima, unidad KG/LB, significado `EXTERNAL_TOTAL`, cantidad máxima de aplicaciones por semana y primer día ISO de la semana. Se declara también ventana histórica máxima en días; no se deriva de los entrenamientos realizados.

Las cargas/límites se conservan como cadenas decimales normalizadas, hasta seis decimales y menos de 10^18; SQL valida numeric, positividad, escala y rango, sin Number como fuente de valores oficiales. No se convierte entre unidades ni se modifica la escala 3 de planificación/PROG-5B. Enteros de frecuencia y fechas no se confunden con cargas.

La rejilla y los incrementos se validan con las políticas existentes; solo se admite el redondeo FLOOR actual. Ningún límite faltante recibe un valor predeterminado: `CONSENT_CONFIGURATION_REQUIRED`. Los límites de cardinalidad (100 destinos, 1000 configuraciones bloqueadas) y ventana de hasta 3660 días son límites técnicos de cobertura, no recomendaciones de entrenamiento.

Una recomendación no puede consumir dos veces su ciclo lógico. El evaluador exige la clave de ciclo real de PROG-4B y evidencia de uso/frecuencia explícita; no acepta una huella meramente sintáctica como sustituto del ciclo.

## H. Vigencia

Intervalo de instantes **[startsAt, endsAt)** con zona IANA explícita. Entrada RFC3339 con offset y hasta milisegundos; se rechazan fechas inexistentes y se normaliza el instante UTC. El final debe ser posterior al inicio. Las solicitudes nuevas/revisiones con final ya vencido se rechazan.

La fecha del servidor se obtiene de PostgreSQL; toda transacción nueva comienza con `SET LOCAL TIME ZONE 'UTC'`. No cambia la zona del servidor/pool, fechas deportivas ni datos históricos.

La inspección deriva EXPIRED o NOT_YET_VALID sin escribir un evento falso ni activar tareas de vencimiento. REVOKED prevalece como decisión terminal. El corte deportivo de una recomendación no define la vigencia del consentimiento.

## I. Estados

Solo se pueden persistir:

```text
CREATE → PENDING_CONFIRMATION v1
PENDING_CONFIRMATION vN → REVISE → PENDING_CONFIRMATION vN+1
PENDING_CONFIRMATION vN → REVOKE → REVOKED vN+1
```

REVOKED no se modifica ni reactiva. Se puede presentar una nueva solicitud explícita que no hereda aceptación. No existen ACTIVE, ACCEPT, ejecución ni transición operativa. SQL también los rechaza: un flag interno o un fixture no puede activar esta infraestructura.

## J. Aceptación

`recurring-consent-acceptance-v1` describe un desafío futuro con scope RECURRING_BOUNDED, ID, versión, contractKey y versión de condiciones. Su huella vincula el snapshot íntegro: atleta, ejercicio, plan, política/motores, límites, frecuencia, selector, vigencia y procedencia. Incluye `humanAcceptance: NOT_RECORDED`.

Esto **no es una aceptación registrada** ni afirma que se hayan mostrado condiciones. PROG-6B deberá renderizar la versión exacta, requerir una acción humana explícita no preseleccionada, comprobar sesión/origen/CSRF conforme al contrato real y acreditar un evento nuevo de aceptación. Ni el desafío, ni un JWT, ni 5A, ni autoApplyAuthorized pueden sustituir ese paso.

## K. Auditoría

CREATE, REVISE y REVOKE generan eventos distintos, inmutables por UPDATE/DELETE. Cada uno contiene el resultado histórico íntegro, no una referencia al estado mutable actual. El actor y atleta coinciden con la propiedad; no se guardan tokens, hashes de contraseña ni sesiones simuladas.

La transición y su evento deben confirmar juntos. El trigger diferido comprueba **cada NEW.version capturada**, aunque otra versión se escriba después en la misma transacción. El evento v>1 exige su predecesor v-1, estado/versión de origen correctos y cronología. No se puede omitir CREATE y fabricar únicamente un evento final. Revocar conserva exactamente la captura de configuración previa.

## L. Idempotencia

Cada comando tiene intención estable del consumidor. Su hash canónico versionado incluye acción, recurso, expectativas y contrato/razón normalizados; no incluye el reloj ni aleatoriedad del servidor. Se normalizan UUID a minúsculas, decimales e instantes; las propiedades JSON y destinos ordenados no producen identidades accidentales.

Un reintento devuelve el evento/recibo confirmado, incluso si luego hubo revisiones o revocación. No amplía vigencia, cambia límites ni crea otro evento. Mismo intent con otro contenido/acción falla INTENT_REUSED. Una intención nueva sobre estado revocado falla CONSENT_REVOKED. Toda devolución exige identidad/sesión vigentes y propiedad.

## M. Concurrencia

Escrituras READ COMMITTED con relecturas después de fences, coherentes con PROG-5B:

1. UTC local, resolver actor/sesión.
2. Usuario y sesión SHARE NOWAIT; atleta UPDATE NOWAIT; revalidar actor.
3. Consultar recibo de intención; bloquear agregado al revisar/revocar, comprobar versión/estado.
4. Para configurar: ejercicio y todas las configuraciones pertinentes bloqueadas; planes, semanas, días y prescripciones UPDATE en orden; releer destinos y rechazar si cambiaron de ubicación.
5. Resolver configuración efectiva por plan, detectar intersecciones y obtener nuevo instante del servidor.
6. Revalidar sesión, CAS/INSERT del agregado y evento; constraints al COMMIT.

Cinco intentos como máximo con espera 20/40/80/160 ms y timeout transaccional de 15 s; no hay locks en memoria. Contención agotada devuelve SOURCE_BUSY sin registros parciales.

El trigger de escritura exige READ COMMITTED y la fence del atleta: rechaza REPEATABLE READ/SERIALIZABLE para no permitir snapshots anteriores a esa fence. No se cambia el aislamiento ni protocolo de PROG-5B. La inspección usa una transacción READ ONLY/REPEATABLE READ informativa; nunca su resultado como permiso permanente.

Los solapamientos comparan **intersección temporal y prescripciones compartidas**, incluidos alcance sin plan y plan específico; no mezclan límites ni eligen el más permisivo. Intervalos adyacentes y listas disjuntas son compatibles. La revisión excluye su propio agregado. UNIQUE simple no puede representar intersecciones de listas JSON y períodos: el protocolo de dueño y el trigger realizan esa validación; UNIQUE protege intención y versión de auditoría.

## N. Elegibilidad

`evaluateAutomationConsent` es puro: recibe consentimiento/captura, versión esperada, ahora explícito, recomendación, claves actuales de configuración, destino actual, ciclo/frecuencia y competidores aplicables.

Reutiliza `inspectGeneration` de PROG-4B para comprobar evidencia y reproducción. Exige que el incremento exterior sea el mismo que su evidencia firmada y que el registro de configuración de la recomendación coincida con el binding aceptado para el plan. Comprueba motor/política, propietario/ejercicio, jerarquía/versiones, configuración vigente, ventana, cargas/unidad, límites, ciclo, frecuencia y fecha futura/editabilidad del candidato. No infiere RIR, fatiga, unidades ni nuevas reglas matemáticas.

La salida separa:

- `policyEligibility`: ELIGIBLE_UNDER_POLICY / NOT_ELIGIBLE / NOT_EVALUABLE.
- `lifecycle`: pendiente, revocado, vencido, todavía no vigente o ausente.
- Razones estables, por ejemplo CONFIGURATION_CHANGED, POLICY_ENGINE_MISMATCH, SCOPE_MISMATCH, LIMIT_EXCEEDED, CYCLE_CONFLICT y AMBIGUOUS_AUTOMATION_CONSENT.
- **`executionAuthorized: false` literal, en todos los resultados.**

Una coincidencia de reglas no autoriza ejecución. El evaluador no consulta PostgreSQL ni acredita por sí solo los contadores/fechas/destinos recibidos. El futuro ejecutor deberá obtenerlos del repositorio dentro de la transacción decisiva, comprobar consentimiento humano efectivo y aplicar las protecciones completas de PROG-5B, incluidas todas las actividades del día y la cobertura histórica. No basta una fecha propuesta por un cliente.

## O. Seguridad

Identidad y sesión reales; atleta derivado; planes y prescripciones propios; ejercicio GLOBAL o PERSONAL propio y activo. Las FKs y triggers acreditan propiedad/jerarquía, metadata/estados permitidos y correspondencia uno a uno entre selector y captura de destinos. Cuentas suspendidas, sesiones falsas/revocadas/expiradas y recursos ajenos se rechazan.

No se modifica autenticación, CSRF, cookies, generación de JWT, registro de series ni fórmulas. El nuevo servicio nunca invoca `applyMyApprovedRecommendation`, otro mecanismo de aplicación, un scheduler o un job. Las pruebas de arquitectura mantienen explícitamente ese límite.

La revisión independiente fue estática y de solo lectura; señaló configuración no vinculada, incremento exterior divergente, rounding no soportado, UUID y fences de destino. Se agregaron regresiones y se corrigieron esos casos. No se ejecutó un nuevo escaneo canónico de Codex Security ni se declara certificación de producción.

## P. Prisma

Migración nueva: `20261111000000_pending_automation_consents/migration.sql`. Crea únicamente las dos tablas, FK, índices, checks y funciones/triggers propios. No modifica las catorce migraciones anteriores ni sus triggers y no altera datos de configuración/recomendaciones/aplicaciones existentes.

Los límites son cadenas en JSONB, validadas con Decimal y numeric; no se generan columnas numéricas redundantes ni se amplía planificación. Índice de propietario/ejercicio/estado/vigencia; unicidad de intención y versión; FK compuesta evento/atleta y plan/atleta.

No hay backfill de consentimientos, límites predeterminados, eventos de aceptación retrospectivos ni conversión de autoApplyAuthorized.

## Q. PostgreSQL

Se reutilizó el runner aislado con opción `--consents`, que incluye PROG-1B a 5C-A y sus migraciones. Verifica URL loopback, puerto aleatorio, base pulso_prog1b_test y data_directory real bajo su mkdtemp propio, aplica migraciones y verifica deriva. No ejecuta seeds y elimina únicamente sus recursos.

La prueba de migración crea otra base temporal, reconstruye las **14 migraciones anteriores**, ejecuta una aplicación real 5B, conserva preferencia=true y compara textualmente todas las filas/tablas previas antes/después de la migración 15. No convierte Decimal o microsegundos históricos a Number. Consentimientos/eventos quedan vacíos y la aplicación manual anterior conserva su recibo idempotente. Después se prueba una solicitud pendiente en el esquema migrado.

Con conexiones independientes se prueban creación/reintentos simultáneos, solapamientos, revisión/revocación CAS, revocación de sesión entre lectura y fences, contención, asociación de una sesión libre antes/después de bloquear destinos y rollback/COMMIT al omitir eventos. Las pruebas de manipulación verifican límites, procedencia, unidad, propiedad y destinos duplicados. Un cliente explícito America/Bogota comprueba instantes físicos UTC y restauración de su default tras commit y rollback.

## R. Regresiones

Resultados finales nuevamente comprobados, todos con salida 0:

| Grupo | Suites | Pruebas distintas | Resultado |
|---|---:|---:|---|
| Backend unitario/arquitectónico, PROG-1A/4A/5C-A incluidos | 54 | 633 | Aprobado |
| PostgreSQL de progresión PROG-1B a 5C-A, incluidas migraciones | 11 | 319 | Aprobado |
| HTTP/PostgreSQL de sesiones e historial | 3 | 27 | Aprobado |
| HTTP/PostgreSQL de planificación | 4 | 26 | Aprobado |
| **Total sin repetir ejecuciones** | **72** | **1005** | **Aprobado** |

Se añaden 58 pruebas unitarias/arquitectónicas y 52 PostgreSQL respecto de las 895 anteriores: 110 nuevas. Las 51 funcionales de consentimiento y una migración están incluidas en las 319, no se suman otra vez. Los rechazos de seguridad y rollback son aserciones aprobadas, no errores ocultos.

TypeScript (`tsc --noEmit`), lint sin advertencias nuevas, build, Prisma validate y Prettier sobre 15 archivos TypeScript afectados aprobaron. Los runners aplicaron las 15 migraciones solamente en temporal, verificaron migrate status y no encontraron deriva. Se confirmó su limpieza. `git diff --check` aprobó, y rama/HEAD siguen intactos.

No quedan pruebas fallidas en la batería final. Permanecen advertencias preexistentes de VM Modules experimental y deprecación de consultas pg concurrentes en runners; no se alteraron dependencias para suprimirlas. El fallo transitorio de TypeScript durante generación se resolvió ejecutando generación/build antes de TypeScript: la verificación final secuencial aprobó.

Comandos reales, desde backend:

```sh
npm test -- --runInBand
node test/run-progression-isolated.mjs --consents
node test/run-workouts-mvc-isolated.mjs all
node test/run-planning-mvc-isolated.mjs all
npm run build
npx tsc --noEmit
npm run lint
npm run prisma:validate
```

Además: Prettier check de los TypeScript afectados, migrate status/diff dentro de los runners, `git diff --check`, rama/HEAD/status y comparación SHA-256 inicial. Las ejecuciones repetidas no se cuentan otra vez. No se ejecutan tests genéricos contra desarrollo, navegador ni frontend: no hay cambios visuales/API en esta etapa.

Diagnóstico intermedio documentado: nombres de FK/índice truncados produjeron deriva y se fijaron mapas explícitos; un fixture de expiración no respetaba el lifetime de auth y se corrigió sin cambiar autenticación; las validaciones del servicio se normalizaron a rechazo Promise. Las regresiones de revisión reprodujeron los defectos del evaluador antes de corregirlos. TypeScript ejecutado simultáneamente con `prisma generate` vio transitoriamente un cliente incompleto; se volvió a ejecutar una vez completada la generación, sin modificar código ajeno para ocultar errores.

Logs efímeros locales: `/tmp/pulso-prog5ca-{baseline,baseline-pg,red,review-red,focused,unit,pg,planning,workouts,tsc,lint,build,validate,format-check}.log`.

## S. Archivos

Nuevos:

- `backend/src/models/progression/automation-consent.model.ts`.
- `backend/src/domain/progression/automation-consent.policy.ts` y `.spec.ts`.
- `backend/src/domain/progression/automation-eligibility.policy.ts` y `.spec.ts`.
- `backend/src/progression/automation-consent.service.ts`.
- `backend/src/progression/automation-consent.persistence.ts`.
- `backend/src/progression/automation-consent.architecture.spec.ts`.
- `backend/prisma/migrations/20261111000000_pending_automation_consents/migration.sql`.
- `backend/test/helpers/automation-consent-fixtures.ts`.
- `backend/test/automation-consent.e2e-spec.ts` y `automation-consent-migration.e2e-spec.ts`.
- Este informe y `docs/superpowers/plans/2026-11-11-prog5ca.md`.

Seis archivos previos modificados: `backend/prisma/schema.prisma` (dos modelos/relaciones); `recommendation-query.policy.ts` (exportación de proyección existente); `progression.module.ts` (registro/exportación del servicio); `progression.repository.ts` y `prisma-progression.repository.ts` (dos operaciones sobre el repositorio existente); `test/run-progression-isolated.mjs` (selector de pruebas).

Los cambios acumulados visibles frente a HEAD de etapas anteriores no se atribuyen a esta tarea. No se modifica frontend, autenticación, .env, seeds, matemática ni los casos manuales de PROG-5B.

## T. Skills y herramientas

AGENTS.md, pulso-architecture-review y referencia MVC, pulso-domain-integrity, pulso-integration-testing y pulso-prisma-migrations; Superpowers para diseño/plan, pruebas incrementales, diagnóstico, revisión independiente y verificación. Herramientas efectivamente utilizadas: lectura/búsqueda local, Git de solo lectura, Jest, NestJS TestingModule, PostgreSQL temporal, Prisma, TypeScript, oxlint, Prettier y un revisor independiente sin edición ni acceso PG.

Graphify no fue necesario; no se reinstalaron plugins, cambiaron permisos/configuración de Codex ni utilizaron herramientas visuales o navegador.

## U. Limitaciones

- No hay aceptación humana, ACTIVE, ejecutor automático, scheduler, API ni frontend nuevo.
- Las políticas/condiciones operativas necesitan aprobación y presentación humana. Los ejemplos de prueba no establecen políticas productivas.
- Selector finito exacto, exclusivamente candidatos DRAFT sin historial; no resuelve copias futuras, destinos ilimitados ni elección automática.
- La validez actual del calendario, consumo real de ciclos/frecuencia y compatibilidad íntegra de aplicación se deben comprobar transaccionalmente en 5C-B. No se agregan permisos de varias autorizaciones ni se reinician contadores por presentar otro consentimiento.
- La inspección puede reflejar una captura anterior a una modificación concurrente y nunca es un permiso para ejecutar.
- El protocolo de dueño reduce concurrencia y tiene límites de cobertura; necesita revisión si aparecen otros escritores. SQL rechaza aislamientos de escritura incompatibles, pero no se promete seguridad frente a un administrador que desactive triggers o cambie roles/configuración.
- Las migraciones de desarrollo permanecen sin aplicar; no se inspecciona ni modifica su contenido de datos para esta tarea.

## V. Estado final

**PROG-5C-A implementado y verificado en su alcance interno.**

| Responsabilidad | Estado | Evidencia |
|---|---|---|
| Modelo y contratos versionados | Verificado | Consumidores reales, normalización, huellas y pruebas |
| Políticas/evaluación | Verificado, no operativo | Propiedad, motor, configuración, límites, ciclo, razones y false literal |
| Servicio y repositorio | Verificado | Registro NestJS y operaciones sobre PostgreSQL real |
| Persistencia/auditoría/revocación | Verificado | Cadena íntegra por versión, terminalidad, rollback y migración desde 14 |
| Idempotencia/concurrencia | Verificado en protocolo delimitado | Conexiones independientes, fences, CAS, intención, conflicto y timeout |
| Vista/Controlador nuevos | No implementado por alcance | No hay endpoint autorizado en esta etapa |
| Consentimiento humano/ACTIVE/ejecutor | No implementado | PROG-6B / PROG-5C-B, deliberadamente inaccesibles ahora |

Los seis archivos previos modificados están acotados a integración; no se perdió trabajo previo. No se escribieron datos ni aplicaron migraciones en desarrollo, no se modificaron .env/autenticación/frontend ni se hicieron commits o push. Esta clasificación no certifica producción, automatización ni consentimiento humano.

## W. Próximas etapas — solo diseño

### PROG-6A: integración humana manual inicial

Endpoints autenticados para propuestas, evidencia, aprobación/rechazo y aplicación manual de 5A/5B; DTO/presenters MVC y contratos Zod; Vue con confirmaciones explícitas, versiones, intención estable y recuperación de respuesta perdida. Probar permisos, origen/CSRF conforme al contrato existente, navegación y navegador real. No implementado aquí.

### PROG-6B: consentimiento recurrente humano

Pantallas de límites, política/motores, destinos, vigencia y términos exactos; aceptación no preseleccionada del snapshot/versión/huella presentada; nueva auditoría inmutable de aceptación, transición ACTIVE mediante migración explícita y punto de entrada confiable. Revocación visible y nueva confirmación cuando cambia una condición decisoria. Nada de esto se infiere de las solicitudes pendientes existentes.

### PROG-5C-B: principal de servicio y ejecución automática

Contrato propuesto para diseño:

```text
ServiceProgressionExecution {
  principalId, capabilityVersion, beneficiaryAthleteId,
  consentId, consentVersion, acceptedContractKey, acceptanceEventId,
  recommendationId, semanticKey, cycleKey,
  destinationIds, expectedPlanVersion,
  operationIntentId, policyVersion, executorAuditVersion
}
```

Principal con capacidad limitada verificable, sin JWT/refresh/sesión humana simulada. Una aceptación humana efectiva y política operativa aprobada son condiciones previas. Selección determinista dentro del selector y rechazo de ambigüedad. Leer contadores/ciclos de todas las aplicaciones pertinentes en PostgreSQL, sin sumar permisos ni eludir un ciclo manual ya consumido.

Adquirir las mismas fences de usuario/atleta/consentimiento y destino en orden compatible; revocación y ejecución se ordenan por la fence del atleta y la fila de consentimiento. Si revocación confirma primero, la siguiente ejecución debe ver REVOKED; no usar una inspección vieja. Si la ejecución obtiene primero el bloqueo y confirma válidamente, la revocación posterior impide ejecuciones siguientes, no reescribe lo ocurrido.

Cuando exista ese consumidor, extraer de 5B una operación transaccional común de destino/precisión/CAS/ciclo/auditoría, conservando su entrada humana manual y pruebas. El camino automático acreditará un principal de servicio y consentimiento efectivo propios; no llamará al servicio manual fingiendo AuthenticatedIdentity. No se implementó anticipadamente esta extracción ni una segunda versión del motor.
