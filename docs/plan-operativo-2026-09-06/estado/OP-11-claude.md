# OP-11 — estado (agente E, Sonnet)

- Rama: `codex/op-e-paneles`.
- HEAD al empezar: `c69a984` (merge fast-forward de `codex/claude-entrega-20260906`, que ya
  traía OP-12, el checkpoint OP-13 de A con `App.tsx` conectado y `capacity` por turno del motor
  de OP-04). El merge no tuvo conflictos.
- Incremento 1: capacidad Fija/Por turno en `resources[pool].capacity` + eliminación explícita de
  reservados heredados con `null` (`priority`/`preempt`) + etiquetas humanas de id en el panel.
- Archivos previstos: `apps/web/src/ScenarioPanel.tsx`, `apps/web/src/ScenarioPanel.test.tsx`.
- Próximo comando: `npx vitest run apps/web/src/ScenarioPanel.test.tsx apps/web/src/ScenarioPanel.qa.test.tsx`.
