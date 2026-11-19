# Validación local — 2026-11-19

## Seguimiento desde la sesión nueva de Codex

La llamada directa solicitada usó `timeout 35s gemini-api generate` con
`gemini-3.8-flash`, `--stream=false`, `--output-format json` y el mensaje
«Responde únicamente: OK». La variable de autenticación estaba presente en el
entorno de ejecución. Se registraron tiempos y categorías de error sin guardar
la clave ni volcar diagnósticos crudos.

| Prueba | Resultado |
| --- | --- |
| Llamada mínima dentro del sandbox | Salida 1 en 0,052 s. `CLI_CONNECTION`: el sandbox bloqueó el socket DNS. Sin respuesta. |
| Llamada mínima con red autorizada | Salida 124 en 35,038 s. Stdout y stderr vacíos. Sin respuesta. |
| HTTPS al endpoint de Interactions sin autenticación, con red autorizada | HTTP 403 en 0,247 s. Se completaron DNS, TCP y TLS. |
| CLI sin entrada interactiva y con límite HTTP de 12 s | Salida 1 en 12,064 s. Expiró el plazo HTTP. |
| CLI mínima con streaming | Salida 1 en 0,765 s. `rate_limit_error`, sin contenido generado. |
| POST autenticado mínimo al mismo endpoint, fuera de la CLI | `TimeoutError` en 12,143 s. Sin respuesta. |

El bloqueo DNS está confirmado dentro del sandbox. Con red autorizada se
reprodujo la espera con una petición mínima tanto en la CLI como por HTTPS
directo. También se observó un límite de solicitudes en una ejecución. Queda
indeterminado qué provocó cada timeout previo y qué límite aplicó el servicio
en la ejecución con streaming. El resultado no confirma indisponibilidad del
modelo. La presencia y herencia de la variable no prueban por sí solas que el
servicio acepte la autenticación.

El Worker nativo confirmó que `subprocess.run` hereda el entorno, alimenta y
cierra stdin, captura ambas salidas y empieza a validar JSON tras una salida 0
de la CLI. La petición mínima no usa archivos, stdin ni el esquema de revisión.
La CLI sin interacción y la petición HTTPS directa reprodujeron la espera, por
lo que cambiar el wrapper no resolvería el bloqueo observado.

La herramienta de esta sesión cargó `worker` y `explorer`. Ambos completaron
delegaciones reales de solo lectura con su `agent_type`. Explorer revisó
`one-rm.ts` y ejecutó las **28 pruebas** de su spec. Verificó Epley y Brzycki
para 100 kg × 5: 116,666667 y 112,500000 kg. La política calcula estimaciones
descriptivas para cargas positivas en KG/LB y de 1 a 10 repeticiones enteras.
La elegibilidad histórica se evalúa por separado.

Las **27 pruebas de integración** pasaron, incluida la prueba que exige código
8 al vencer el plazo del wrapper. `install_codex.py --check` devolvió
`pending: []`. El análisis de Codex se completó por su cuenta. Los perfiles
Gemini matemático y técnico quedaron pendientes porque la llamada mínima no
respondió. No hubo informe externo ni conclusión conjunta.

## Estado inicial y preservación

- Rama `feature`: 69 entradas pendientes de UX-6/PROG-7 antes de esta tarea.
  No existía `AGENTS.md` en el repositorio; el global estaba vacío.
- Codex CLI `0.170.0`, `gemini-api 0.4.6`, Python `3.14.4`.
  `GEMINI_API_KEY` disponible en el proceso; su valor no se mostró ni se guardó.
- La configuración global existente se conservó. Se crearon exclusivamente
  `.codex/config.toml`, `.codex/agents/worker.toml`, `.codex/agents/explorer.toml`
  y el `AGENTS.md` local. Estos archivos ya están ignorados por Git.
- Comparación final: diff preexistente idéntico byte a byte y hashes SHA-256 de
  626 archivos de backend/frontend sin diferencias. No se ejecutaron DB,
  migraciones, seeds, commits, push, merge ni despliegues.

## Integración y subagentes

- `install_codex.py --check`: TOML válido, destinos idénticos a plantillas,
  `pending: []`. Codex pudo cargar la configuración con `codex features list`.
- `doctor.py`: CLI Codex/Gemini y clave disponibles, perfiles instalados,
  `agents.enabled=true`, tres subagentes simultáneos como máximo.
- Se ejecutaron subagentes nativos reales, mediante instrucciones explícitas:
  Worker escribió pruebas y revisó el instalador; Explorer trazó PROG-7 en lectura.
  No se simularon esos agentes con llamadas shell a otro Codex.
- Worker reprodujo un caso de ancestro que era archivo, con dos fallos RED:
  `--check` lo aceptaba y la instalación podía quedar parcial. Se corrigió el
  preflight antes de escribir; la regresión pasa.
- Las pruebas de caja negra sustituyen únicamente el ejecutable externo Gemini.
  Comprueban contrato CLI/stdin, ambos perfiles, hashes de contexto, esquema
  recursivo y citas, códigos 2–10, límites, secretos, timeout, salida exclusiva e
  instalación idempotente/sin sobrescritura. No son pruebas reales de la API.

Resultado final: **27 pruebas aprobadas en 4.232 segundos**. Comando reproducible:

```bash
python3 -B -m unittest discover -s scripts/ai -p 'test_*.py' -v
```

## Gemini real: limitación pendiente

La CLI aceptó el cuerpo de petición mediante su propio `--dry-run`. Dentro del
sandbox, la llamada real falló con `CLI_CONNECTION`: socket DNS bloqueado hacia
`generativelanguage.googleapis.com`. Se solicitaron y obtuvieron permisos de red
fuera del sandbox para probar ambos perfiles con `gemini-3.8-flash`.

**Ambas llamadas externas agotaron 180 segundos, código 8 del wrapper.** No se
obtuvo un reporte Gemini real ni se generaron los archivos de salida solicitados.
No se afirma que la conexión probada anteriormente por el usuario haya dejado de
funcionar, ni que se haya validado aquí la respuesta real del modelo. Falta
completar una llamada desde un entorno con conectividad efectiva; puede usarse
`--timeout` hasta 600 segundos. No hubo reintentos automáticos ni cambios de clave,
modelo predeterminado, host o configuración global para intentar resolverlo.

La revisión técnica enviada incluía solo los scripts/perfiles/configuración nueva
y `AGENTS.md`; la matemática incluía únicamente `one-rm.ts`, `eligibility.policy.ts`,
`decimal.ts` y sus pruebas seleccionadas. No se enviaron `.env` ni otros archivos
automáticamente. No se conoce el resultado del lado del proveedor tras el timeout.

## Observaciones independientes del Explorer sobre PROG-7

Se registran como hallazgos de la exploración; no se modificó la aplicación.
El Explorer ejecutó tres suites y **79 pruebas aprobadas**:

```bash
cd backend
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --runInBand --runTestsByPath \
  src/domain/progression/workout-repetition-preview.policy.spec.ts \
  src/domain/progression/workout-guide-comparison.policy.spec.ts \
  src/workout-sessions/workout-progress.spec.ts
```

Además reprodujo dos casos con funciones reales, transpiladas en memoria sin DB:

1. **P2: referencia contextual antigua bloquea evidencia v2 reciente.**
   `workout-guide.policy.ts:198` prioriza el mismo día del plan; v2 selecciona
   evidencia reciente entre semanas (`workout-repetition-preview.policy.ts:246`).
   El bloqueo por antigüedad se aplica igualmente en
   `workout-guide-preparation.policy.ts:88` y `workout-guide.service.ts:197`.
   Con destino 2026-01-14, referencia contextual del 2025-12-20 y evidencia válida
   del 2026-01-05/06, v2 calcula 9 repeticiones pero preparación devuelve
   `REVIEW_REQUIRED`, `draft:null`.
2. **P2: mínimo insuficiente oculta un cambio de prescripción.**
   `workout-repetition-preview.policy.ts:271` devuelve `MINIMUM_NOT_REACHED`
   antes de verificar objetivos/rango en `:310`. Preparación puede usar el
   fallback histórico (`workout-guide-preparation.policy.ts:136`). Con mínimo 2,
   una sesión histórica de rango 15–20 y 80 kg × 20, y destino nuevo de 6–10 sin
   carga prescrita, se obtiene `PLAN_WITH_REFERENCE` con borrador de 20 reps,
   que se precarga fuera del rango nuevo.

Falta cobertura de ambas combinaciones, incluyendo la precarga en UI. Estas
observaciones son independientes de Gemini y requieren una tarea de corrección
aparte. No se ejecutaron E2E, navegador ni una auditoría completa de la aplicación.
