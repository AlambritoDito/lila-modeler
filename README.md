# Lila Modeler

Modelador y simulador de procesos BPMN, open source (Apache-2.0), con paridad de funciones con
Bizagi Modeler y su simulador de cuatro niveles.

Estado: en construcción. El motor de niveles 1–4 (validación, tiempos, recursos y calendarios) y
los comandos `validate`, `run` y `compare` de la CLI ya son ejecutables.

## Qué es

- Un **motor de simulación de eventos discretos** (`packages/engine`) escrito en TypeScript, sin
  dependencias en su núcleo, que corre igual en la CLI, en un Web Worker del navegador y detrás de
  un servidor MCP.
- Una **CLI** (`npx lila validate | run | compare`) para validar un `.bpmn`, simular un escenario y
  comparar dos o más escenarios (AS-IS contra TO-BE) lado a lado.
- Un **servidor MCP** (`packages/mcp`, binario `lila-mcp`) que expone el mismo motor a agentes vía
  el protocolo [MCP](https://modelcontextprotocol.io); ver `docs/MCP.md`.
- Una **app web** (`apps/web`) en construcción para modelar y ver resultados.

Los contratos —el IR del proceso, el formato de escenario y el de resultados— están documentados en
`docs/` antes que el código, y son la parte del proyecto que se mantiene estable.

## Uso

```bash
npm install
npm test
npm run build
npm run bench   # benchmark reproducible: 100 000 casos, 5 tareas lineales
```

Validar un modelo:

```bash
npx lila validate examples/bizagi-levels/level-2/model.bpmn
```

Simular un escenario (niveles 1–4: tiempos, recursos y calendarios), mostrar las tablas Bizagi más
las extras de Lila (cuellos de botella, costo por caso) y escribir JSON + cinco CSV:

```bash
npx lila run \
  examples/pedido/model.bpmn \
  examples/pedido/as-is.scenario.json \
  --seed 42 --replications 3 \
  --json out/result.json --csv out/csv
```

### App web

El editor BPMN (`apps/web`) ya abre, edita y exporta modelos; simular, resultados y comparar
llegan después. Necesita el motor compilado, y su script `dev` lo compila antes de arrancar:

```bash
npm run dev --workspace @lila/web    # http://localhost:5173
```

Arranca con `examples/pedido/model.bpmn` cargado; «Abrir .bpmn» acepta cualquier archivo, y lo
que exporta «Exportar .bpmn» lo acepta `npx lila validate`.

`scenario.model` y `extends` se resuelven respecto al archivo que los declara. El modelo pasado
como primer argumento debe coincidir con `scenario.model`. Un escenario con `resources` o
`calendars` se simula igual que uno sin ellos: no hace falta ningún gate ni bandera aparte.

## Beta de escritorio (macOS)

Hay una beta de `apps/desktop` (Electron, solo macOS arm64, sin firmar) que empaqueta la app web
como `.dmg`. Cómo abrirla sin firma, qué trae la ventana al arrancar, el recorrido de uso con los
textos reales de los botones y las limitaciones conocidas de esta ronda están en
[`docs/GUIA-BETA-MAC.md`](docs/GUIA-BETA-MAC.md). Las licencias de terceros del artefacto
empaquetado (React, bpmn-js y su árbol, Electron/Chromium/Node) están en
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

## Documentación

- `LILA_MODELER_ESTRUCTURA.md` — decisiones (ADR), diseño del motor, hitos.
- `BACKLOG.md` — desglose del trabajo. Los tickets viven en GitHub Issues (`LILA-026` = `#26`).
- `docs/` — semántica del motor, formato de escenario, formato de resultados, namespace `lila:`.

## Licencia

Apache-2.0. Ver `LICENSE`.

El editor de la app web usa [bpmn-js](https://github.com/bpmn-io/bpmn-js), cuya licencia exige que
la marca de agua de bpmn.io sea visible y no se pueda ocultar. Lila Modeler la respeta.
