# Convenciones y decisiones del contrato REST

**Estado del contrato:** propuesta para revisión. El repositorio no contenía contrato previo, DTO de dominio ni rutas implementadas aparte del controlador Nest de ejemplo. Las rutas de `openapi.yaml` son concretas para revisión, pero no se consideran aprobadas ni implementadas. Los puntos sin decisión se identifican aquí; no se deben inferir permisos o comportamiento de negocio a partir de la especificación.

## Base, versión e intercambio

- Base propuesta: `/api/v1`, consistente con `VITE_API_BASE_URL=/api/v1`.
- JSON UTF-8; nombres de campos `camelCase`; identificadores UUID en formato string.
- `Accept` y `Content-Type`: `application/json` salvo respuestas sin cuerpo (`204`). No se devuelve el modelo Prisma directamente.
- Fecha/hora de un instante: RFC 3339 con offset, preferentemente UTC (`2026-04-05T14:30:00Z`). Fecha civil de plan o nacimiento: `YYYY-MM-DD`. La API no acepta fechas sin zona cuando representan instantes.
- Propuesta para mantener precisión de PostgreSQL `Decimal`: cargas, pesos, RPE y estimaciones se serializan como decimal JSON string (por ejemplo `"82.500"`). La aceptación de strings decimales debe ratificarse con frontend/API; no convertir a punto flotante para redondear silenciosamente.
- `RPE` de serie, `globalRpe` y `fatigueScore` son campos diferentes. No hay fórmula ni rango definido para `fatigueScore`.

## Autenticación, CSRF y sesiones

- API protegida con access token Bearer de vida corta. El frontend debe conservarlo solo en memoria; no en `localStorage`, `sessionStorage`, URLs ni logs. Cada arranque de página requiere recuperar sesión mediante el flujo de refresh.
- Login/refresh establecen una cookie de refresh `HttpOnly`, `Secure` en HTTPS, `SameSite` apropiado y con `Path` limitado a los endpoints de auth. El refresh token no aparece en el cuerpo JSON; persistencia guarda solo su hash y familia.
- Refresh rota el token en cada uso. La reutilización de un token ya rotado debe revocar la familia comprometida. Logout revoca la sesión/familia representada por la cookie y limpia la cookie. La duración de access/refresh, el nombre/path exacto de cookie, la respuesta a reutilización y revocación de todas las sesiones necesitan ratificación.
- Cookie autenticada implica riesgo CSRF. `POST /auth/refresh` y `POST /auth/logout` requieren protección CSRF (propuesta: token anti-CSRF ligado a sesión y enviado en `X-CSRF-Token`) además de comprobación `Origin`/`Referer`; `SameSite` es defensa adicional, no reemplazo. El mecanismo exacto y bootstrap del token CSRF están pendientes. No se modela endpoint de CSRF aún.
- Passwords se reciben solo por TLS, se almacenan como hash de contraseña y nunca se devuelven. No se define algoritmo ni política de contraseña en este contrato.
- Recursos de dominio exigen access token salvo endpoints públicos marcados en OpenAPI. Un token inválido/ausente devuelve `401`; el objeto ajeno se responde `404` para no revelar su existencia; `403` se reserva a una acción prohibida sobre un recurso visible.

## Propiedad y autorización

- El atleta asociado al usuario autenticado determina el ámbito de planes, entrenamientos, mediciones, feedback, estimaciones y progresión. Los DTO ignoran o rechazan `athleteId` suministrado por cliente; nunca se confía en ownership enviado en body/query.
- Cada ID de una ruta anidada se resuelve y verifica bajo el mismo atleta autenticado. También se comprueba pertenencia plan-semana, plan-prescripción, sesión-semana y ejercicio-prescrito-ejecutado.
- El modelo no define roles administrativos. Las operaciones de catálogo `exercises` se proponen solo de lectura hasta acordar quién puede administrarlo.
- No hay permiso para modificar otra persona mediante ID. Endpoints globales, soporte multiusuario y administración quedan fuera hasta definir roles.

## Respuestas, errores y correlación

- Éxito usa el estado HTTP semántico: `200` lectura/actualización, `201` creación con `Location` cuando aplique, `204` operación exitosa sin cuerpo.
- Colecciones devuelven `data` y `page` (forma propuesta), no arrays ambiguos. Enlaces no implican que exista una página HTML.
- Error uniforme basado en RFC 9457: `type`, `title`, `status`, `detail`, `instance`, `code`, `requestId`, y opcional `errors` para errores de campo. No incluir stack trace, SQL, secretos ni existencia de recursos ajenos.
- `400` formato/parámetros inválidos; `401` autenticación; `403` permiso insuficiente; `404` recurso ausente o fuera de propiedad; `409` conflicto de estado/duplicado; `422` regla de validación semántica; `429` límite de peticiones; `500` error interno genérico.
- `X-Request-Id`: el cliente puede enviar un UUID de correlación; si falta, el servidor genera uno. La respuesta lo devuelve y el error lo incluye como `requestId`. Validación/rechazo de valores no UUID queda por decidir. Nunca usarlo como autorización.
- Las respuestas de token y cookies deben excluirse de logs. Cuerpo y query sensibles deben redactarse.

## Paginación (propuesta no ratificada)

Listados usan `limit` (predeterminado 25, máximo 100) y `cursor` opaco. Respuesta: `page.nextCursor` nulo cuando no hay siguiente página; orden estable por `createdAt` descendente y UUID como desempate, salvo que un recurso documente otro orden. No se promete total exacto. Nombres, límites, orden y cursor requieren aceptación del consumidor.

## Separación de planificado y ejecutado

`PlanExercise` y sus DTO `PlanExercise` son prescripciones: series/repeticiones/RPE/carga objetivo y posición. `WorkoutExercise` más `SetRecord` registran ejecución: ejercicios y series reales. Una ejecución puede apuntar a `planExerciseId` para trazabilidad, pero no muta la prescripción. Sesiones libres no tienen plan ni semana. Crear o editar un plan no crea registros de ejecución.

## Progresión y aplicación automática

- Prioridad de configuración efectiva: ejercicio dentro del plan, ejercicio general del atleta, general del atleta, valores predeterminados del sistema. El cliente puede escribir solo un alcance válido: general (sin ejercicio/plan), ejercicio (ejercicio y sin plan), ejercicio/plan (ambos); plan sin ejercicio es inválido.
- La recomendación registra snapshot de ajustes y versión algorítmica; cambiar la configuración después no modifica recomendaciones históricas.
- Esta documentación no especifica cómo contar una sesión satisfactoria ni cómo calcular fatiga, recomendación o carga. No se debe inferir fórmula alguna.
- La aplicación automática no se expone como endpoint invocable por cliente. Solo sería posible cuando `autoApplyAuthorized=true`, la recomendación siga pendiente/aprobada según transición por definir, no haya expirado, el límite máximo y carga máxima sigan cumpliéndose y la actualización sea atómica con auditoría de `ProgressionApplication` de origen `AUTOMATIC`. Se vuelve a validar consentimiento, vigencia y límites inmediatamente antes de modificar el plan. Hasta acordar transiciones y gatillo, la ruta automática no está definida.
- `POST /progression/recommendations/{recommendationId}/apply` en OpenAPI representa una aplicación manual propuesta, no permite elegir origen `AUTOMATIC` ni saltar revisión/validación.

## Decisiones que requieren confirmación

1. Aprobar base `/api/v1`, rutas/métodos/DTO y operaciones de escritura propuestos.
2. Definir registro público, validación de email, políticas de contraseña y respuesta para refresh reutilizado.
3. Fijar duraciones/nombres/path de cookies y el mecanismo/bootstrap CSRF.
4. Aprobar convención de decimales como strings y paginación por cursor.
5. Definir acceso administrativo al catálogo y transiciones de plan, sesión y recomendación.
6. Definir escala de fatiga, reglas para sesiones satisfactorias y algoritmo/versionado de recomendación/1RM en API.
7. Definir el evento que podría disparar aplicación automática, límites de carga/unidad, auditoría y recuperación ante fallo.
