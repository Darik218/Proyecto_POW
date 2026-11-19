# FINAL-MVP — demostración local

La aplicación automática procesa recomendaciones modernas **ya generadas y guardadas**. No genera cohortes. Aceptar el consentimiento y activar su grant son acciones distintas. El contrato histórico B1 conserva `executionAuthorized: false`; el recurso operativo nuevo informa su autorización vigente.

## Iniciar la demostración

Desde una terminal del usuario local, con las dependencias ya instaladas:

```bash
cd /home/darik/Proyecto_POW/Proyecto_POW/backend
PULSO_AUTOMATION_ENABLED=true PULSO_AUTOMATION_INTERVAL_MS=1000 node test/run-final-mvp-demo.mjs
```

Un solo comando levanta PostgreSQL18 privado, aplica las19 migraciones **allí**, comprueba estado/deriva, compila y levanta NestJS y Vite. Muestra las URLs efectivas y la ruta de `credentials.json` privado (0600), con email y contraseña aleatorios para esa ejecución. Abrir la URL `Demo frontend` y consultar ese archivo local para iniciar sesión. No contiene credenciales reales ni se guarda en Git.

Los puertos son libres y se asignan al arrancar; utilizar las URLs impresas, sin sustituirlas por localhost:5432. La base temporal es `pulso_final_mvp_demo`; su directorio es `/tmp/pulso-final-mvp-demo-*`. No utiliza `.env` ni modifica `proyecto_pow_dev`.

Para detener todos los procesos y eliminar únicamente los datos temporales creados por el launcher: **Ctrl+C** en esa terminal. Reiniciar genera una demostración nueva.

## Recorrido académico

1. Iniciar sesión y consultar Perfil, Ejercicios, Mi rutina y Configuración de progresión.
2. En Progresión → Nueva propuesta, seleccionar explícitamente el ejercicio/plan/día/prescripción de la demostración. Los fixtures contienen dos entrenamientos completados de la semana UTC anterior y una prescripción DRAFT futura con80KG. Seleccionar las dos tareas fuente y declarar una serie original/ajustada para cada una; elegir la segunda como ancla y declarar explícitamente el protocolo comparable y carga externa total.
3. Indicar la semana anterior completa UTC, inicio ISO lunes y fecha de corte domingo; ventana desde el lunes de la semana precedente. El runner construye esas fechas a partir del reloj de PostgreSQL.
4. Política explícita de demostración: `final-demo-policy`, versión `v1`, referencia `explicit academic demo policy`; objetivos ADJUSTED, basicReps MINIMUM/basicLoad AT_LEAST_TARGET, readinessReps UPPER_BOUND/readinessLoad AT_LEAST_TARGET, RPE6–8, criterio BASIC, modo ACCUMULATED, sameDate DISTINCT_SESSIONS, settingRpeUse REQUIRE_INTERVAL, review NOT_REQUIRED_EXPLICIT, closed=true. Incremento ABSOLUTE y rejilla KG paso2.5/origen0, fuente `explicit academic demo plates`, base de destino. Estos valores son fixtures académicos explícitos, no defaults del producto. La prueba Firefox rellena el formulario real y sirve como referencia reproducible exacta en `frontend/tests/final-mvp.browser.mjs`.
5. Obtener vista previa INCREASE y guardar la propuesta PENDING; consultar evidencia y configuración efectiva.
6. En Consentimiento automático → Nueva solicitud, seleccionar el mismo destino y política. Límites explícitos:2.5KG absoluto,5% relativo,200.000001KG máximo,1 aplicación semanal, historia28d; vigencia actual hasta30d, zona UTC. Revisar las condiciones exactas.
7. Crear solicitud, obtener desafío y marcar separadamente las cinco confirmaciones. Aceptar: queda `ACCEPTED_INACTIVE`, sin ejecución.
8. En el bloque operativo, revisar las condiciones y marcar la **nueva** confirmación de activación. Activar. El temporizador procesa la propuesta guardada; actualizar el historial o usar la comprobación puntual.
9. Comprobar origen AUTOMATIC, carga82.500KG, versión de plan+1, recibo y evidencia. Reintentar la misma intención conserva el recibo sin nueva aplicación. Las sesiones, series y objetivos históricos no cambian.
10. Revocar el grant mediante su confirmación separada. El estado es terminal y ya no permite procesar.

Para mostrar la vía manual, reiniciar la demo y aprobar/aplicar la propuesta antes de activar automatización. Comparte el núcleo de escritura, pero conserva su aprobación humana individual. Un ciclo aplicado no puede volver a aplicarse automáticamente.

## Verificación reproducible sin interacción

```bash
cd /home/darik/Proyecto_POW/Proyecto_POW/backend
node test/run-final-mvp-demo.mjs --verify
PULSO_AUTOMATION_ENABLED=true PULSO_AUTOMATION_INTERVAL_MS=1000 node test/run-final-mvp-demo.mjs --verify
node test/run-progression-isolated.mjs --api
node test/run-workouts-mvc-isolated.mjs
node test/run-planning-mvc-isolated.mjs
npm test -- --runInBand
npm run lint
npm run build
npm run prisma:validate
```

Los dos primeros comandos usan Firefox real y guardan resultados/capturas en la ruta de evidencia que imprimen; el modo periódico verifica que el temporizador aplique **antes** de cualquier POST de comprobación puntual. Ambos cierran sus recursos al terminar. Los runners PostgreSQL verifican URL, puerto, base y `data_directory`, migraciones y deriva; no ejecutan seeds de desarrollo.

```bash
cd /home/darik/Proyecto_POW/Proyecto_POW/frontend
npm test
npm run build
```

## Límites conservados

Sin grant activo válido, sin destino único, con configuración/evidencia obsoleta, conflicto de ciclo o límite semanal agotado, el motor bloquea con razones y audita. La frecuencia incluye MANUAL y AUTOMATIC para el mismo atleta/ejercicio, por semana civil de la zona aceptada. Las respuestas perdidas recuperan la intención original; un CHECK interrumpido solo se reanuda por acción explícita, sin duplicar aplicaciones.

Las18 migraciones de desarrollo ya están aplicadas según la comprobación del usuario. La19 se prueba exclusivamente en temporal y **no se ha aplicado a desarrollo**. El backend nuevo necesita el esquema19; utilizar este launcher para la entrega. No se declara preparación productiva ni escaneo canónico nuevo.

## Archivos y verificación de entrega

Nuevos backend: modelo `automatic-progression.model.ts`, política pura `automatic-progression.policy.ts`, capacidad `internal-progression-principal.ts`, `AutomaticProgressionService`, persistencia `automatic-progression.persistence.ts`, núcleo compartido `commit-progression-application.ts`, DTO/controller/presenter operativos, migración19 y pruebas de dominio/lifecycle/PostgreSQL/migración. Launcher `backend/test/run-final-mvp-demo.mjs` y recorrido `frontend/tests/final-mvp.browser.mjs`.

Existentes backend adaptados: repositorio/interfaz/módulo de progresión, boundary HTTP, persistencia manual (extracción del commit y selección explícita de columnas anteriores), tipo de expectativa de destino, pruebas arquitectónicas y fixtures históricos. No cambian las fórmulas, autenticación ni políticas matemáticas.

Nuevos frontend: schema/types/service/store/helper de intenciones `operational-progression`, componente `OperationalProgression.vue` y regresiones. Existentes adaptados: `AutomationConsentDetailView.vue`, `ProgressionDetailView.vue`, `ConsentConditions.vue` y la aserción correspondiente de vistas. Se conserva Axios, stores y rutas existentes.

Resultado final:739 pruebas backend +456 PostgreSQL progresión (incluidas26 nuevas) +27 sesiones +26 planificación +208 frontend = **1.456 distintas**, todas aprobadas. TypeScript, lint backend, ambos builds, Prisma validate, deriva19, formato de archivos del alcance y diffcheck aprobados. Firefox:14 comprobaciones del recorrido automático y19 del manual; no se suman escenarios compartidos entre recorridos ni ejecuciones repetidas.

Se corrigieron los dos hallazgos de la única revisión focalizada: paginación circular para que candidatos bloqueados no impidan los siguientes y recuperación explícita de CHECK interrumpido. También se corrigió la carrera del recibo manual después de una respuesta perdida, con regresión determinista y Firefox. Los errores intermedios de fixtures históricos y deserialización de `pg_sleep` quedaron corregidos y la batería completa volvió a aprobar; un frontend concurrente atascado se detuvo y repitió sin otros procesos Vite,208/208. La revisión alternativa quedó limitada por cuota; no se presenta como completada ni como escaneo canónico.
