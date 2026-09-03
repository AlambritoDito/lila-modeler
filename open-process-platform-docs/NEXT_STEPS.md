# Next Steps

## Paso 1 — Crear repositorio

Estructura sugerida:

```text
open-process-platform/
│
├── docs/
│   ├── PRODUCT_VISION.md
│   ├── ARCHITECTURE.md
│   ├── SIMULATION_ENGINE.md
│   ├── DEPENDENCY_STRATEGY.md
│   ├── AGENT_API_MCP.md
│   ├── ROADMAP.md
│   └── DECISIONS.md
│
├── engine/
├── web/
├── packages/
├── examples/
└── tests/
```

## Paso 2 — Crear proceso benchmark

Necesitamos un BPMN pequeño que usaremos para comparar motores.

Debe incluir:

- Start.
- 3-5 tasks.
- XOR.
- Parallel gateway.
- Resource limitado.
- Queue.
- Probabilities.
- Distinct durations.

Guardar:

```text
examples/benchmark-process.bpmn
examples/benchmark-scenario.json
```

## Paso 3 — Spike de bpmn-js

Objetivo:

En menos código posible comprobar:

- Load BPMN.
- Save BPMN.
- Create task.
- Rename without default friction.
- Add custom properties.
- Read/write extension values.

No diseñar todavía el producto final.

## Paso 4 — Spike de simulación

Comparar dos rutas:

### Route A

Motor BPMN existente.

### Route B

BPMN parser + DES general.

Mismo benchmark.

## Paso 5 — Elegir motor

Preguntas:

- ¿Quién interpreta BPMN?
- ¿Quién controla queues?
- ¿Quién controla resources?
- ¿Cómo se manejan parallel joins?
- ¿Podemos generar event logs?
- ¿Podemos reproducir resultados por seed?
- ¿Es fácil agregar nuevos elementos BPMN?
- ¿Podemos mantenerlo nosotros?

## Paso 6 — Implementar CLI V0

Meta:

```bash
process-sim validate process.bpmn
process-sim run process.bpmn scenario.json
```

## Paso 7 — Conectar primera UI

Sólo después de que el motor funcione.

La primera UI de simulación puede ser simple:

```text
Process
Scenario
Run

Results:
Cycle time
Waiting
Utilization
Throughput
Bottleneck
```

## Regla

Evitar construir funciones de roadmap antes de que la simulación base produzca resultados confiables.
