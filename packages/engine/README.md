# @lila/engine

Motor de simulación de eventos discretos (DES) para BPMN, con paridad de funciones con el
simulador de cuatro niveles de Bizagi Modeler. Sin dependencias en su núcleo (`core/`); corre
igual en la CLI, en un Web Worker de navegador y detrás de un servidor MCP.

Parte de [Lila Modeler](https://github.com/AlambritoDito/lila-modeler), un modelador/simulador
BPMN open source (Apache-2.0).

## Uso

```bash
npx @lila/engine validate mi-modelo.bpmn
npx @lila/engine run mi-modelo.bpmn mi-escenario.json --seed 42 --json
```

Como librería:

```ts
import { simulate } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import { validateScenario } from '@lila/engine/schema';
```

## Documentación

El formato de escenario, de resultados y la semántica exacta del motor (XOR/OR/AND, calendarios,
costos, distribuciones) están en `docs/` del repositorio: `SCENARIO_FORMAT.md`, `RESULTS_FORMAT.md`,
`SEMANTICS.md`.

## Licencia

Apache-2.0.
