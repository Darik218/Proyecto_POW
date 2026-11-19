# PULSO: Codex + Gemini API CLI

Codex principal planifica, asigna archivos/tareas, integra revisiones, decide la
implementación y verifica el resultado. Los revisores no aplican cambios.

| Rol | Responsabilidad | Mecanismo |
| --- | --- | --- |
| Codex principal | Orquestación, implementación decidida e integración final | Sesión principal y `AGENTS.md` |
| Codex Worker | NestJS, Vue 3, integración, pruebas y correcciones | Subagente nativo `worker` |
| Codex Explorer | Código, dependencias, contratos y riesgos | Subagente nativo `explorer`, instrucciones de solo lectura |
| Gemini matemático | Progresión, Epley/Brzycki, RPE/RIR, comparabilidad, carga/reps | `--role math` y `profiles/math.md` |
| Gemini técnico | MVC, frontend/backend, seguridad, contratos y regresiones | `--role technical` y `profiles/technical.md` |

## Diseño y secuencia de trabajo

1. Revisar Git, instrucciones y contexto relevante; conservar cambios pendientes.
2. Explorer identifica el flujo, contratos y riesgos cuando se necesite exploración.
3. Codex asigna al Worker un alcance con archivos propios y criterios verificables.
   Las tareas independientes pueden ejecutarse en paralelo; dos escritores no
   deben editar el mismo archivo simultáneamente.
4. Codex puede pedir una revisión independiente a Gemini con archivos explícitos.
   Los perfiles no comparten conversación ni se ejecutan como agentes administrados.
5. Codex contrasta hallazgos con el código y pruebas, resuelve discrepancias y
   comunica qué se verificó realmente. Gemini no autoriza implementación ni merge.

La integración usa Python estándar, stdin JSON y `gemini-api generate`. No añade
SDK, servicios persistentes, MCP, agentes remotos, migraciones ni dependencias npm.

## Requisitos y configuración

Python 3.11+, `gemini-api` en `PATH`, `GEMINI_API_KEY` exportada en el proceso.
No se lee ni se escribe `.env`; no se imprime la clave. Modelo por defecto:
`gemini-3.8-flash`; se puede seleccionar otro mediante `--model`.

Desde cualquier directorio, usando la ruta del script:

```bash
python3 scripts/ai/doctor.py
python3 scripts/ai/install_codex.py --check
python3 scripts/ai/install_codex.py
```

El instalador copia las plantillas de `codex/` a `.codex/config.toml` y
`.codex/agents/{worker,explorer}.toml`. Valida TOML y todos los destinos antes de
crear archivos de forma exclusiva. Si hay un archivo distinto, termina con código
9 sin modificar configuraciones existentes. Repetirlo con archivos idénticos es
seguro. No modifica `~/.codex`, modelos, proveedores, permisos ni sandbox.

Las plantillas corresponden a Codex CLI 0.170 y la configuración actual documentada:
`agents.enabled = true`, máximo tres subagentes simultáneos además del principal y
perfiles TOML independientes con `name`, `description`, `developer_instructions`.
Los modelos y esfuerzo se heredan. Explorer hereda los permisos del padre; su modo
de solo lectura es una instrucción, no un sandbox independiente.

Abre una sesión nueva para que Codex descubra los perfiles recién instalados.
Si la herramienta nativa de la sesión permite seleccionar `agent_type`, usa
`worker` o `explorer`. Si solo permite tareas/mensajes, pasa explícitamente las
instrucciones del perfil y el alcance al subagente. La existencia del CLI no
demuestra disponibilidad de subagentes: comprueba las herramientas de la sesión.

`AGENTS.md` y `.codex/` ya están ignorados por el `.gitignore` del proyecto. Esta
instalación es local. Las plantillas y scripts en `scripts/ai/` permiten reproducir
la configuración; no se cambió esa decisión existente de Git. Para trasladar las
instrucciones de orquestación, conserva también el `AGENTS.md` local.

## Revisiones

Las rutas de `--file` se resuelven respecto a la raíz del repositorio, aunque
invoques el script desde otro directorio. No se añade contexto automáticamente.

```bash
python3 scripts/ai/gemini_review.py \
  --role math \
  --task 'Comprueba fórmulas, dominio, unidades y casos límite con ejemplos numéricos.' \
  --file backend/src/domain/progression/one-rm.ts \
  --file backend/src/domain/progression/eligibility.policy.ts \
  --file backend/src/domain/progression/decimal.ts \
  --file backend/src/domain/progression/one-rm.spec.ts

python3 scripts/ai/gemini_review.py \
  --role technical \
  --task 'Revisa contratos de progreso, MVC, validación y posibles regresiones.' \
  --file backend/src/workout-sessions/workout-progress.service.ts \
  --file backend/src/workout-sessions/dto/workout-progress.dto.ts \
  --file backend/src/views/workout-sessions/workout-progress.presenter.ts \
  --file frontend/src/schemas/workout-progress.schema.ts \
  --file frontend/src/services/workout-progress.service.ts
```

Añade `--dry-run` para inspeccionar la petición exacta sin CLI, clave ni red.
El preview contiene el código seleccionado: decide dónde guardarlo.
`--output /tmp/revision-nueva.json` guarda el mismo JSON de stdout con modo 0600;
el directorio padre debe existir y el archivo debe ser nuevo. No hay sobrescritura
ni reintentos automáticos. `--timeout 180` es el límite por defecto (máximo 600 s).

Se envían exclusivamente la tarea, el perfil y los archivos UTF-8 seleccionados
(hasta 256 KiB en total), con su ruta. Se rechazan rutas fuera del repositorio,
symlinks, archivos `.env`, material de credenciales identificado y texto binario.
No incluyas secretos en la tarea ni en archivos de contexto: la detección local es
una defensa parcial. La clave solo se hereda como autenticación de la CLI.
Se solicita `store:false` a la API; esto no implica una garantía adicional de
retención del proveedor. Las llamadas reales consumen la API configurada.

La respuesta incluye `role`, `model`, fecha UTC, ID de interacción, contexto con
SHA-256 y bytes, y `report`. El reporte se valida recursivamente contra
`review.schema.json`: `summary`, `verdict`, `findings`, `checks`, `limitations`.
Los hallazgos tienen severidad, archivo, línea original (base 1), descripción y
recomendación. Se rechazan citas fuera del contexto o líneas inexistentes, JSON
inválido y respuestas incompletas. `checks` describe razonamientos del revisor;
no equivale a pruebas locales ejecutadas. El orquestador verifica cada conclusión.

## Códigos de salida

| Código | Significado |
| --- | --- |
| 0 | Respuesta válida o preview; puede contener hallazgos |
| 2 | Argumentos inválidos |
| 3 | Clave ausente o CLI devuelve autenticación/autorización (3) |
| 4 | CLI ausente o recursos locales de integración ilegibles |
| 5 | Tarea/contexto inválido, secreto identificado o límite de tamaño |
| 6 | Error al ejecutar la CLI, red o proveedor; incluye usage de la CLI |
| 7 | Respuesta inválida, incompleta, esquema incorrecto o cita no sustentada |
| 8 | Timeout; no se reintenta automáticamente |
| 9 | Salida existente/no escribible o conflicto de configuración al instalar |
| 10 | Reporte válido con hallazgos y opción `--fail-on-findings` |

Los errores del wrapper son JSON en stderr. Los argumentos inválidos usan la
ayuda estándar de argparse. Los diagnósticos crudos del proveedor se suprimen para
evitar que vuelquen credenciales/contexto. El CLI conserva su código original en
el mensaje de error. Un bloqueo de red del sandbox requiere permiso de ejecución
externa del entorno; el script no cambia permisos ni evita restricciones.

## Verificación

```bash
python3 -B -m unittest discover -s scripts/ai -p 'test_*.py' -v
python3 scripts/ai/install_codex.py --check
```

La suite ejecuta el wrapper real con una CLI falsa en el límite externo; no gasta
API. Incluye ambos perfiles, contexto y hashes, esquema y citas, errores 2–10,
secreto en diagnóstico, timeout, tamaño/binario/symlinks y salida/instalación sin
sobrescritura. Las pruebas reales de API se registran en `VALIDATION.md`.

Fuentes de configuración consultadas:

- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://learn.chatgpt.com/docs/config-file/config-reference

Las plantillas no activan la antigua clave `features.multi_agent`: el CLI actual
usa `agents.enabled`. La lista real de herramientas manda sobre una guía antigua.
