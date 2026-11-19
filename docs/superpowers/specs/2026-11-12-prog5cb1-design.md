# PROG-5C-B1 — Diseño no operativo

Se implementa exclusivamente evaluación pura y contratos internos. La petición autoriza esta infraestructura y excluye toda concesión operativa. No hay política aprobada para emitir grants, seleccionar cohortes futuras, resolver reservas manuales o imputar frecuencia; esas decisiones se documentan como pendientes y no se rellenan.

## Alternativas y selección técnica

1. Ampliar B1 con una nueva inspección PostgreSQL completa: descartada en esta etapa porque no existen selectores recurrentes/cohortes ni política de contadores aprobados. Reutilizar buildConsentSnapshot tampoco acredita un destino después de reservar una recomendación, y extraer el lector de aplicación implica adaptación al actor manual. Combinar transacciones separadas no daría una captura coherente.
2. Contrato interno + evaluador puro compuesto sobre evaluateAutomationConsent: seleccionado. Aporta comprobaciones reales de aceptación/versiones, alcance, selección y bloqueos de servicio, sin duplicar matemáticas ni inventar autorización. Los inputs deben venir de lectores internos autorizados; una estructura tipada no acredita por sí sola persistencia o autenticidad.
3. Crear estado/grant persistido sin emisor operativo: descartado; fabricaría una capacidad que todavía no se puede conceder.

## Semántica

- Compatibilidad de reglas, aceptación histórica y permiso son dimensiones separadas. executionAuthorized es false literal siempre.
- Evento ACCEPT: fromVersion es la versión aceptada, version=fromVersion+1; la versión del agregado aceptado coincide con la del evento, no con acceptedVersion. Revocación posterior conserva el evento pero impide nueva operación.
- El snapshot histórico sigue NOT_RECORDED. La evidencia procede del evento y SQL existente; B1 verifica su enlace estructural y no replica la canonicalización JSONB de la huella SQL.
- Cohorte evaluable limitada a IDs ya aceptados explícitamente. No hay selección de nuevas sesiones ni ventana inventada.
- Cero candidatos, cobertura incompleta o varios candidatos son bloqueos explícitos. Una observación favorable no reemplaza assertFutureTarget ni fuentes/locks de B2.
- Reserva de ciclo distinta de aplicación consumida. No se reutiliza aprobación manual para automatizar.
- Contador recibido es observación interna; B1 no acredita consulta PostgreSQL ni aprueba su ámbito/fecha de imputación.
- Principal descriptivo DESIGN_ONLY sin credenciales/capacidad habilitada; grant NOT_GRANTED_IN_B1, sin tabla ni transición.

## Cambios previstos

Modelos y política/spec bajo models/progression y domain/progression; prueba arquitectónica de independencia/inactividad; fixtures de prueba propios; plan, informe A–W y evidencia. Ninguna modificación de esquemas, migraciones, autenticación, UI, servicios/repositorios productivos, fórmulas o escritores manuales.

## Verificación

Línea base backend674, frontend189 y PostgreSQL430 comprobada antes de producto. RED/GREEN de pruebas deterministas; regresiones backend/PG/sesiones/planificación/frontend/Firefox, types/lint/build/Prisma/drift/formato/diff. Revisar aceptación/versiones, motivos, datos malformados, no mutación, límites Decimal, separación de permisos y decisiones B2. Revisión independiente estática además de los runners, sin certificación.
