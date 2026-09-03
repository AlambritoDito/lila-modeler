# Roadmap

Este roadmap describe orden de construcción, no fechas.

## Phase 0 — Research & Proofs of Concept

Objetivo:

Validar las piezas fundamentales antes de comprometer arquitectura.

### PoC 1 — BPMN Editor

- Import `.bpmn`.
- Render.
- Create task.
- Rename task with improved UX.
- Save `.bpmn`.
- Custom property.
- Custom extension.

### PoC 2 — Existing Simulation Engines

Tomar un mismo proceso de prueba y ejecutarlo en los candidatos.

Evaluar:

- Correctness.
- Performance.
- Maintainability.
- Licensing.
- API.
- Extensibility.

### PoC 3 — DES General Engine

Implementar un flujo pequeño:

```text
Start → Task A → XOR → Task B/C → End
```

con:

- Arrivals.
- Durations.
- Resource.
- Queue.
- Gateway probabilities.

## Phase 1 — Simulation Core

Entregable:

```bash
process-sim run process.bpmn scenario.json
```

Funciones:

- BPMN parser.
- Internal representation.
- Start/End.
- Tasks.
- XOR.
- Parallel gateway.
- Resources.
- Queues.
- Distributions.
- KPIs.
- Event log.
- Deterministic seed.

Esta fase debe ser útil académicamente por sí misma.

## Phase 2 — Simulation UI

- BPMN editor.
- Simulation properties panel.
- Resource editor.
- Calendar editor.
- Run simulation.
- Results dashboard.
- Bottleneck highlighting.
- Scenario comparison.

## Phase 3 — Process Repository

- Processes.
- Folders/tags.
- Versions.
- AS-IS.
- TO-BE.
- Change history.
- Comments.
- Owners.
- Search.

## Phase 4 — Business Architecture

- Roles.
- Systems.
- Documents.
- Inputs/outputs.
- Business rules.
- RACI.
- Risks.
- Controls.
- KPIs.

## Phase 5 — Agent API

- REST coverage.
- MCP server.
- Fine-grained permissions.
- Agent audit log.
- Natural-language actions.

## Phase 6 — AI Assistance

- Process quality review.
- Naming suggestions.
- Missing documentation detection.
- RACI suggestions.
- Bottleneck explanation.
- TO-BE suggestions.
- Automatic simulation scenarios.

## Phase 7 — Interview Agent

- Interview templates.
- Transcription ingestion.
- Information extraction.
- Contradiction detection.
- Draft AS-IS generation.
- Human validation workflow.

## Phase 8 — Process Mining

Integrations:

- ERP.
- CRM.
- Ticket systems.
- Databases.
- Event logs.

Features:

```text
Documented process
        VS
Observed process
```

Detectar:

- Deviations.
- Real cycle times.
- Skipped steps.
- Rework.
- Hidden loops.
- Actual resource utilization.

## Phase 9 — Process Intelligence

Objetivo final:

Un sistema que entienda simultáneamente:

- Cómo se supone que funciona el proceso.
- Cómo está documentado.
- Cómo se ejecuta realmente.
- Qué dicen los participantes.
- Qué muestran los datos.
- Qué cambios mejorarían los KPIs.
