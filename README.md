# Lila Modeler

Modelador y simulador de procesos BPMN, open source (Apache-2.0), con paridad de funciones con
Bizagi Modeler y su simulador de cuatro niveles.

Estado: en construcción. Hoy existe el esqueleto del monorepo; el motor llega en M1.

## Qué es

- Un **motor de simulación de eventos discretos** (`packages/engine`) escrito en TypeScript, sin
  dependencias en su núcleo, que corre igual en la CLI, en un Web Worker del navegador y detrás de
  un servidor MCP.
- Una **CLI** (`npx lila validate | run | compare`) para validar un `.bpmn`, simular un escenario y
  comparar AS-IS contra TO-BE.
- Más adelante, una **app web y de escritorio** para modelar y ver resultados.

Los contratos —el IR del proceso, el formato de escenario y el de resultados— están documentados en
`docs/` antes que el código, y son la parte del proyecto que se mantiene estable.

## Uso

```bash
npm install
npm test
npm run build
```

## Documentación

- `LILA_MODELER_ESTRUCTURA.md` — decisiones (ADR), diseño del motor, hitos.
- `BACKLOG.md` — desglose del trabajo. Los tickets viven en GitHub Issues (`LILA-026` = `#26`).
- `docs/` — semántica del motor, formato de escenario, formato de resultados, namespace `lila:`.

## Licencia

Apache-2.0. Ver `LICENSE`.

El editor de la app web usa [bpmn-js](https://github.com/bpmn-io/bpmn-js), cuya licencia exige que
la marca de agua de bpmn.io sea visible y no se pueda ocultar. Lila Modeler la respeta.
