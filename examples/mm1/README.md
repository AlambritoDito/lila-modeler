# examples/mm1 — oráculos analíticos M/M/1 y M/M/3

LILA-011. Dos casos de cola con solución cerrada (Erlang C), usados como oráculo
numérico para validar el motor DES (M2, ver `LILA_MODELER_ESTRUCTURA.md` §6,
"Validación numérica", punto 2: tolerancia 3 % en CI).

Cada carpeta tiene un `.bpmn` de una sola tarea (`StartEvent_Llegadas` →
`Task_Servicio` → `EndEvent_Fin`), su `scenario.json` (`docs/SCENARIO_FORMAT.md`)
y su `expected.json` con los valores teóricos.

## Parámetros

| Caso | λ (llegadas/s) | interTriggerTimer.mean | μ (atenciones/s por servidor) | processingTime.mean | c (`resources.servidor.capacity`) | ρ = λ/(c·μ) |
|---|---|---|---|---|---|---|
| `mm1-rho08` | 1/375 ≈ 0.002667 | 375 s | 1/300 ≈ 0.003333 | 300 s | 1 | 0.8 |
| `mm3` | 1/125 = 0.008 | 125 s | 1/300 ≈ 0.003333 | 300 s | 3 | 0.8 |

`interTriggerTimer.mean` y `processingTime.mean` son las medias de sendas
exponenciales, en segundos: `mean = 1/tasa`, tal como pide `SCENARIO_FORMAT.md`
§3 (`mean` es la media, no la tasa λ).

## Cómo se calculan los valores esperados

`tools/oracles/erlang_c.ts` implementa la fórmula de Erlang C para M/M/c
(colapsa a M/M/1 cuando `c = 1`) y no añade dependencias. `expected.json` se
genera (y se puede regenerar) con:

```bash
npx tsx tools/oracles/generate-mm-expected.ts
```

`packages/engine/test/mm1.test.ts` corre el mismo cálculo con los parámetros
de la tabla y compara contra los `expected.json` committeados — si alguien
cambia un parámetro sin regenerar, el test lo detecta.

## Valores esperados (resumen)

| Caso | utilización | Wq (s) | Lq | L | W (s) |
|---|---|---|---|---|---|
| `mm1-rho08` | 0.80 | 1200.0 | 3.20 | 4.00 | 1500.0 |
| `mm3` | 0.80 | 323.60 | 2.589 | 4.989 | 623.60 |

Valores exactos (todas las cifras) en cada `expected.json`.
