# Avisos de terceros

Inventario de las dependencias que terminan **en tiempo de ejecución** dentro del artefacto de
escritorio (el `.dmg`/`.app` empaquetado por `apps/desktop`, que embebe el bundle de `apps/web`).
No incluye `devDependencies` que no viajan en el bundle (por ejemplo `vite`, `typescript`,
`vitest`, `electron-builder`).

Generado a mano a partir de `node_modules/<paquete>/package.json` (campo `version` y `license`) el
2026-09-06, sobre el commit base `287e3e2`. Donde un campo faltaba se escribe «verificar» y el
archivo de licencia encontrado en su lugar, en vez de inventar un valor.

## Aviso obligatorio — bpmn.io

El editor BPMN usa [bpmn-js](https://github.com/bpmn-io/bpmn-js). Su licencia (MIT + una cláusula
adicional, ver `node_modules/bpmn-js/LICENSE`) exige que la marca de agua **"Powered by bpmn.io"**
que dibuja el propio bpmn-js sobre el lienzo permanezca visible y sin taparla con otros elementos.
Lila Modeler no la oculta ni la modifica: la esquina inferior derecha de la zona de modelado se
deja libre a propósito (ver comentario en `apps/web/src/App.tsx`, sección de la barra de
herramientas). **No quitar esa marca en ningún fork ni personalización del tema.**

## Dependencias del bundle web (`apps/web`, empaquetado dentro de `apps/desktop`)

### Directas

| Paquete | Versión instalada | Licencia | Enlace |
|---|---|---|---|
| react | 19.2.8 | MIT | https://github.com/facebook/react |
| react-dom | 19.2.8 | MIT | https://github.com/facebook/react |
| bpmn-js | 18.28.0 | MIT + cláusula de marca de agua (ver arriba; `node_modules/bpmn-js/LICENSE`) | https://github.com/bpmn-io/bpmn-js |

`react`/`react-dom` declaran su repositorio como `react/react.git` en su propio `package.json`
(dato tal cual del paquete instalado); el repositorio real y conocido del proyecto es
`facebook/react`, enlazado arriba.

### Transitivas de bpmn-js (confirmadas con `ls node_modules/<paquete>/package.json` y sus
`dependencies`, es decir lo que realmente entra en el bundle vía bpmn-js → diagram-js → …)

| Paquete | Versión instalada | Licencia | Enlace |
|---|---|---|---|
| diagram-js | 15.26.0 | MIT | https://github.com/bpmn-io/diagram-js |
| diagram-js-direct-editing | 3.5.1 | MIT | https://github.com/bpmn-io/diagram-js-direct-editing |
| bpmn-moddle | 10.2.0 | MIT | https://github.com/bpmn-io/bpmn-moddle |
| moddle | 8.2.1 | MIT | https://github.com/bpmn-io/moddle |
| moddle-xml | 12.2.0 | MIT | https://github.com/bpmn-io/moddle-xml |
| min-dash | 5.1.0 | MIT | https://github.com/bpmn-io/min-dash |
| min-dom | 5.3.0 | MIT | https://github.com/bpmn-io/min-dom |
| didi | 11.0.0 | MIT | https://github.com/nikku/didi |
| tiny-svg | 4.1.4 | MIT | https://github.com/bpmn-io/tiny-svg |
| path-intersection | 4.1.0 | MIT | https://github.com/bpmn-io/path-intersection |
| object-refs | 0.4.0 | MIT | https://github.com/bpmn-io/object-refs |
| ids | 3.0.2 | MIT | https://github.com/bpmn-io/ids |
| inherits-browser | 0.1.0 | ISC | https://github.com/nikku/inherits-browser |
| saxen | 11.1.1 | MIT | https://github.com/nikku/saxen |
| @bpmn-io/diagram-js-ui | 0.2.4 | MIT | https://github.com/bpmn-io/diagram-js-ui |
| clsx | 2.1.1 | MIT | https://github.com/lukeed/clsx |
| htm | 3.1.1 | Apache-2.0 | https://github.com/developit/htm |
| preact | 10.29.8 | MIT | https://github.com/preactjs/preact |

`bpmn-moddle` aparece dos veces en el árbol (directa de `@lila/engine` y transitiva de `bpmn-js`);
npm resuelve una sola instancia en `node_modules/bpmn-moddle`, listada una sola vez arriba.

### De `packages/engine` que terminan en el bundle (usadas por el editor/el worker de simulación,
no solo por la CLI)

| Paquete | Versión instalada | Licencia | Enlace |
|---|---|---|---|
| zod | 4.5.4 | MIT | https://github.com/colinhacks/zod |
| bpmn-moddle | 10.2.0 | MIT | (ya listado arriba, mismo paquete) |

Confirmado que `zod` queda dentro del artefacto final, no solo en la CLI de Node: tras
`npm run build -w @lila/web`, `grep -c zod apps/web/dist/assets/index-*.js` devuelve coincidencias
en el bundle principal (el que carga la ventana de Electron).

## Electron y su runtime embebido

| Componente | Versión | Licencia | Enlace |
|---|---|---|---|
| Electron | 44.2.0 | MIT | https://github.com/electron/electron |
| Chromium (embebido en Electron 44.2.0) | 152.0.7977.76 | BSD y otras (proyecto Chromium; ver `https://chromium.googlesource.com/chromium/src/+/152.0.7977.76/LICENSE`) | https://www.chromium.org/ |
| Node.js (embebido en Electron 44.2.0) | v24.20.0 | MIT y otras (proyecto Node.js; ver `https://github.com/nodejs/node/blob/v24.20.0/LICENSE`) | https://nodejs.org/ |

Versiones de Chromium/Node confirmadas contra el archivo `DEPS` del propio repositorio
`electron/electron` en la etiqueta `v44.2.0` (`chromium_version`/`node_version`), no adivinadas.
Electron no reexporta un único archivo de licencia para Chromium/Node dentro del paquete npm
`electron`; el aviso completo de terceros de Chromium/Node (miles de sub-licencias) se genera en
tiempo de build oficial de Electron y no se reproduce aquí — se enlaza a la fuente autorizada de
cada proyecto en vez de copiarla.

## Fuera de este inventario (a propósito)

- Dependencias de desarrollo que no viajan en el `.dmg`: `vite`, `typescript`, `vitest`,
  `electron-builder`, `esbuild`, `tsx`, `jsdom`, `@types/*`.
- La CLI `lila` (`packages/engine/bin/lila.js`) no forma parte del artefacto de escritorio: usa
  Node directamente, no Electron. Sus dependencias son las mismas de `@lila/engine` ya listadas
  arriba (`zod`, `bpmn-moddle` y lo que este último arrastra: `moddle`, `moddle-xml`, `min-dash`,
  `saxen`), sin nada adicional.

## Cómo se generó este archivo

```bash
# Versión y licencia declaradas por cada paquete instalado:
python3 -c "import json; d=json.load(open('node_modules/<paquete>/package.json')); print(d['version'], d.get('license'))"

# Confirmar que un paquete concreto queda dentro del bundle final (no solo en node_modules):
npm run build -w @lila/web
grep -c '<paquete>' apps/web/dist/assets/index-*.js

# Chromium/Node embebidos en la versión exacta de Electron usada por apps/desktop:
curl -s https://raw.githubusercontent.com/electron/electron/v44.2.0/DEPS | grep -A1 -E "chromium_version|node_version"
```

Si `apps/desktop/package.json` sube la versión de `electron`, repetir el último comando con la
etiqueta `vX.Y.Z` nueva antes de dar por buena la tabla de Chromium/Node de este archivo.
