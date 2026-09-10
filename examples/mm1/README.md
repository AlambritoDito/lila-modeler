# M/M/1 and M/M/3 analytical oracles

LILA-011. These two queueing cases have closed-form Erlang C solutions and validate the DES
engine numerically. Each folder contains a one-task BPMN model, a scenario and an `expected.json`
with theoretical values. The stable path is `StartEvent_Llegadas` → `Task_Servicio` → `EndEvent_Fin`.

## Parameters

| Case | Arrival rate λ (1/s) | Interarrival mean | Service rate μ per server (1/s) | Service mean | Servers c | ρ = λ/(cμ) |
|---|---|---|---|---|---|---|
| `mm1-rho08` | 1/375 ≈ 0.002667 | 375 s | 1/300 ≈ 0.003333 | 300 s | 1 | 0.8 |
| `mm3` | 1/125 = 0.008 | 125 s | 1/300 ≈ 0.003333 | 300 s | 3 | 0.8 |

Both durations use exponential distributions, with `mean = 1/rate` in seconds. The resource key
`servidor` is unchanged. See [the scenario format](../../docs/SCENARIO_FORMAT.md).

## Reproduce the expected values

`tools/oracles/erlang_c.ts` implements Erlang C for M/M/c without additional dependencies. It
reduces to M/M/1 when c = 1. From the repository root:

```bash
npx tsx tools/oracles/generate-mm-expected.ts
```

`packages/engine/test/mm1.test.ts` recomputes the values and compares them with the committed
files, detecting parameter changes without regeneration. Simulation validation uses a 3%
tolerance in CI.

| Case | Utilization | Wq (s) | Lq | L | W (s) |
|---|---|---|---|---|---|
| `mm1-rho08` | 0.80 | 1200.0 | 3.20 | 4.00 | 1500.0 |
| `mm3` | 0.80 | 323.60 | 2.589 | 4.989 | 623.60 |

The full-precision values are in each `expected.json`.
