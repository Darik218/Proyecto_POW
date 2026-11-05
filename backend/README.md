# Backend y base de datos

Backend NestJS con TypeScript estricto y Prisma ORM 7. El esquema de PostgreSQL vive en `prisma/schema.prisma`; Prisma Client se genera en `src/generated/prisma` y utiliza el adaptador oficial `@prisma/adapter-pg` sobre `pg`.

## Requisitos

- Node.js 20.19 o posterior (recomendado Node 22 LTS; las herramientas Nest 12 instaladas piden Node 22.22.3 o posterior).
- npm.
- PostgreSQL 14 o posterior.
- Prisma CLI y Prisma Client 7.10.x (instalados mediante `npm install`).

## Configuración local

1. Instala dependencias desde `backend/` con `npm install`.
2. Copia `.env.example` como `.env` y define `DATABASE_URL` con una base local de desarrollo que hayas creado e identificado. El formato es `postgresql://usuario:contraseña@localhost:5432/proyecto_pow_dev?schema=public`. Codifica los caracteres especiales de la contraseña como URL. Nunca guardes `.env` en Git.
3. Comprueba que el servicio PostgreSQL esté activo y que el usuario pueda conectarse a esa base. No apuntes a bases de datos desconocidas.

En este entorno no se encontró PostgreSQL, `psql` ni Docker/Compose. Para preparar PostgreSQL local instala PostgreSQL desde el instalador oficial de tu plataforma, crea manualmente una base vacía dedicada (por ejemplo `proyecto_pow_dev`) y un usuario local con permisos sobre ella, y coloca esos datos solo en `.env`. No se incluyeron credenciales ni se iniciaron servicios automáticamente.

## Prisma

El generador `prisma-client` produce los módulos tipados bajo `src/generated/prisma`. `prisma.config.ts` carga `.env` y obtiene `DATABASE_URL`; el adaptador PostgreSQL es obligatorio para conexiones directas con Prisma 7.

```sh
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:migrate:status
```

Las migraciones iniciales ya están versionadas; `migrate deploy` las aplica sin crear una migración nueva. Para cambios posteriores al esquema, crea una migración con `npm run prisma:migrate:dev -- --name nombre_descriptivo` y revisa/versiona siempre el SQL generado.

## Esquema e integridad

El modelo contiene usuarios, perfiles de deportista, sesiones de autenticación (solo hash de refresh), mediciones, catálogo de ejercicios, planes/semanas/prescripciones, entrenamientos/ejercicios/series, estimaciones de 1RM versionadas, evaluación de sesión, configuración de progresión, recomendaciones con evidencia y aplicaciones. La prescripción (`PlanExercise`) se mantiene separada del registro ejecutado (`WorkoutExercise` / `SetRecord`). La sesión admite entrenamiento libre. La fatiga es un decimal informado, sin fórmula de cálculo.

Enums controlan estados, unidades, fórmulas, roles de evidencia y origen de aplicación. Las tablas usan UUID, fechas de instantes en `timestamptz`, fechas civiles en `date` y decimales con precisión explícita. Hay índices y restricciones únicas para correo, perfil, semana, posiciones, orden de ejercicios, series, feedback de sesión, una evidencia por sesión/recomendación y una aplicación por recomendación.

Se reservan restricciones SQL versionadas posteriores para checks numéricos y temporales, alcances válidos y unicidad parcial de configuración (general, por ejercicio, por ejercicio/plan), porque PostgreSQL permite múltiples `NULL` en índices únicos convencionales. La prioridad que deberán aplicar futuros servicios es: ejercicio dentro del plan, ejercicio general, configuración general del deportista y valores predeterminados del sistema.

Las claves compuestas de la estructura soportan la pertenencia de una sesión a plan/semana, que el ejercicio prescrito coincida con el ejecutado y que un plan en configuración corresponda al deportista. Las reglas que cruzan más contextos deberán validarse dentro de una transacción en servicios futuros: pertenencia de semana y prescripción a sesión/recomendación, atleta y ejercicio de fuente, contexto de sesiones de evidencia, estados de recomendación y autorización/expiración/límites justo antes de una aplicación automática. La aplicación automática aún no está implementada.

## Ejecutar y comprobar el backend

```sh
npm run start:dev
npm run build
npm run test
npm run test:e2e
```

La conexión de `PrismaService` se inicializa al registrarlo en un módulo Nest; `PrismaModule` está preparado pero no se importa en `AppModule`, para que la infraestructura de datos no active conexiones hasta que una etapa posterior la integre.

## Estado inicial de migraciones

Las migraciones contienen DDL y no datos de prueba. No se aplican migraciones automáticamente al arrancar la aplicación. Si no hay base de desarrollo configurada, valida y genera cliente localmente; aplica migraciones solo tras confirmar que `DATABASE_URL` apunta a la base vacía de desarrollo correcta.
