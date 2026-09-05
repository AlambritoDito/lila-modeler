# Lila Modeler

Modelador y simulador de procesos BPMN, open source (Apache-2.0), con paridad de funciones con
Bizagi Modeler y su simulador de cuatro niveles.

Estado: en construcción. El motor de niveles 1–2 y los comandos `validate` y `run` ya son
ejecutables; recursos y calendarios llegan en M2/M3.

## Qué es

- Un **motor de simulación de eventos discretos** (`packages/engine`) escrito en TypeScript, sin
  dependencias en su núcleo, que corre igual en la CLI, en un Web Worker del navegador y detrás de
  un servidor MCP.
- Una **CLI** (`npx lila validate | run`) para validar un `.bpmn` y simular un escenario. La
  comparación AS-IS contra TO-BE llega en M3.
- Más adelante, una **app web y de escritorio** para modelar y ver resultados.

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

Simular un escenario de nivel 1–2, mostrar las tablas Bizagi y escribir JSON + cinco CSV:

```bash
npx lila run \
  examples/bizagi-levels/level-2/model.bpmn \
  examples/bizagi-levels/level-2/scenario.json \
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
como primer argumento debe coincidir con `scenario.model`. En M1, un escenario con `resources` o
`calendars` se rechaza explícitamente en vez de simularlo como si esos parámetros no existieran.

## Documentación

- `LILA_MODELER_ESTRUCTURA.md` — decisiones (ADR), diseño del motor, hitos.
- `BACKLOG.md` — desglose del trabajo. Los tickets viven en GitHub Issues (`LILA-026` = `#26`).
- `docs/` — semántica del motor, formato de escenario, formato de resultados, namespace `lila:`.

## Licencia

Apache-2.0. Ver `LICENSE`.

El editor de la app web usa [bpmn-js](https://github.com/bpmn-io/bpmn-js), cuya licencia exige que
la marca de agua de bpmn.io sea visible y no se pueda ocultar. Lila Modeler la respeta.
