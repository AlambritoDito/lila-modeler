# OP-10 — checkpoint Codex

- Dueño: agente D (`codex/op-d-engine`).
- Base: `07e9e6e81056dec240badb6e9f3aa05ab921cec0`.
- Archivos previstos: `packages/engine/src/core/metrics.ts`, `packages/engine/src/core/run.ts`, `packages/engine/src/core/calendar.ts` o `sim.ts` solo si la reproducción lo exige, pruebas pequeñas del motor y documentación semántica relevante. Se excluyen App, paneles, Modeler y formato de UI.
- Objetivo: integrar `65560c7`, fijar la semántica de utilización para warmup y bajadas de capacidad sin clamp, corregir `meanBottlenecks.utilization` cuando una tarea no aparece en todas las réplicas, y publicar límites/avisos de contrato.
- Próximo comando: `git merge --no-ff 65560c7`.
