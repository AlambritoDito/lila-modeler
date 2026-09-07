# OP-10 — checkpoint Codex

- Dueño: agente D (`codex/op-d-engine`).
- Base: `07e9e6e81056dec240badb6e9f3aa05ab921cec0`.
- Integración comprobada antes de este reporte: `3d43c98db677e009fbbf99fce39e220866934d38`.
- Archivos propios: `packages/engine/src/core/metrics.ts`, `packages/engine/src/core/run.ts`, pruebas pequeñas y `docs/SEMANTICS.md`/`docs/RESULTS_FORMAT.md`. No fue necesario editar `calendar.ts` ni `sim.ts`; no se tocaron App, paneles, Modeler ni formato de UI.
- Objetivo cumplido: integrar `65560c7`, fijar la semántica de utilización para warmup y bajadas de capacidad sin clamp, emitir diagnóstico de sobrecapacidad y corregir `meanBottlenecks.utilization` cuando una tarea no aparece en todas las réplicas.

## Decisiones de contrato

- `utilization` es atribuible a la cohorte medida. `busyTime` excluye casos nacidos antes de `warmup`; el denominador conserva toda la capacidad disponible de `[warmup, t_stop]`. Por eso puede valer 0 aunque trabajo de calentamiento ocupe físicamente el pool.
- Con capacidad por turnos y sin apropiación, una tarea sigue tras una bajada. Si `busyTime / sum(capacity_i * openTime_i) > 1`, el motor conserva el valor; no aplica clamp a 1.
- Un exceso mayor que la tolerancia de coma flotante emite `W-UTILIZACION-MAYOR-UNO` una vez por pool y réplica. El texto es estable para que la agregación de réplicas lo deduplique.
- En `meanBottlenecks`, `resourceWaitTotal` se promedia sobre todas las réplicas, usando 0 cuando el elemento no esperó. `utilization` se promedia solo sobre las réplicas donde el elemento apareció en el ranking; una ausencia no se convierte en utilización 0.

## Reproducciones y pruebas

- Caso manual warmup: tarea pre-warmup ocupa `[10, 20]` físicamente, pero la cohorte medida produce `busyTime = 0`, denominador 10 y `utilization = 0`.
- Caso manual de bajada: dos tareas de 7200 s arrancan con capacidad 2 y cruzan una bajada a 1. `busyTime = 14400`, disponibilidad integrada `10800`, utilización exacta `4/3` y aviso presente.
- Caso de ranking: dos réplicas deterministas (`seed = 1`), el elemento aparece en una y desaparece en otra; espera total queda dividida entre 2 y utilización queda en 1, no 0,5.
- `npx vitest run` dirigido a métricas, costos, warmup, replicaciones, capacidad fija/variable y calendarios: 13 archivos, 179 pruebas, todas verdes.
- `npm run build --workspace @lila/engine`: TypeScript del motor verde.
- `git diff --check`: verde. No se ejecutó la suite completa ni se actualizaron goldens; A serializa la suite integrada.

## Commits y pendientes

- Integración de `65560c7`: `c924736`.
- Implementación y pruebas: `36e0b03`.
- Contrato semántico: `3d43c98`.
- Pendientes explícitos de #236 fuera de este incremento: unificar/documentar los textos de `E-REC-CAPACIDAD`, anotar la limitación de R16 en JSON Schema y medir `waitsOnPool` antes de optimizarlo.
- Pendientes explícitos de #228 fuera del alcance exclusivo del motor: columnas/nombres compartidos de CLI, CSV y web, y la decisión visual de mostrar la tarjeta sin pools. El contrato de datos de `meanBottlenecks` ya queda listo para esos consumidores.
- Próximo comando para A: `git merge --no-ff codex/op-d-engine`.
