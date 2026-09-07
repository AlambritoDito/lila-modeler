# OP-17 — arranque (incremento 1, dueño E Claude Sonnet 5)

- Rama: `codex/op-e-paneles`. Worktree: `/Users/brito/development/lila-wt-e-paneles`.
- Merge `codex/claude-entrega-20260906` → fast-forward, sin conflicto.
- HEAD tras el merge: `287e3e2`.
- Incremento: 1 de OP-17 (guía de uso + licencias; la parte MCP #56/#48 no entra aquí).
- Issues de este incremento: #55, #75, #76, #77.

## Archivos previstos

- `docs/GUIA-BETA-MAC.md` (nuevo)
- `THIRD_PARTY_LICENSES.md` (nuevo, raíz)
- `README.md` — sección corta nueva «Beta de escritorio (macOS)», solo añadir
- `docs/plan-operativo-2026-09-06/estado/OP-17-claude.md` (este archivo)

## Verificado antes de escribir

- `apps/web/src/App.tsx`: textos reales de botones/modos confirmados (`Nuevo proyecto`,
  `Abrir proyecto`, `Guardar proyecto`, `Guardar como`, `Abrir .bpmn`, `Exportar .bpmn`,
  modos `Modelar`/`Simular`/`Resultados`/`Comparar`).
- `apps/web/src/main.tsx`: sigue eligiendo `BrowserStore` en duro (comentario propio: "Único
  punto de elección BrowserStore/DesktopStore (OP-01)") — confirma que la persistencia en
  carpeta real del bootstrap de A sigue pendiente en 287e3e2.
- `apps/desktop/release/`: DMG de OP-12 ya presente (`Lila Modeler-0.0.1-mac-arm64.dmg`,
  ~122 MiB, `ORIGEN.txt` con sha `f0ba8ed`). No se regenera en este incremento (no hay cambio
  de código); se reutiliza como artefacto de referencia de la guía.
- `npm run build -w @lila/engine`, `npm run build -w @lila/web`, `npm run build -w @lila/desktop`
  ejecutados en este worktree para confirmar la cadena de comandos de la guía: los tres OK.
- Dependencias runtime del bundle web confirmadas por lectura de `node_modules/*/package.json`
  (react, react-dom, bpmn-js y todo su árbol: diagram-js, bpmn-moddle, moddle, moddle-xml,
  min-dash, min-dom, didi, tiny-svg, path-intersection, object-refs, ids, inherits-browser,
  saxen, @bpmn-io/diagram-js-ui, clsx, htm, preact) y de `packages/engine` (zod, bpmn-moddle).
  `zod` confirmado dentro del bundle final con `grep -c zod apps/web/dist/assets/index-*.js` (5
  ocurrencias). Chromium/Node embebidos en Electron 44.2.0: confirmado vía DEPS de
  `electron/electron` en GitHub (Chromium 152.0.7977.76, Node v24.20.0).

## Próximo comando

Escribir `THIRD_PARTY_LICENSES.md`, luego `docs/GUIA-BETA-MAC.md`, luego la sección corta en
`README.md`. Commits separados por entregable, mensaje `docs: OP-17 …` con los issues
correspondientes.

---

## Estado final (incremento 1 entregado)

- SHA base: `287e3e2` (tras el merge). SHA final: `f552cce`.
- Commits: `a7d45cc` (estado inicial), `3b08446` (`THIRD_PARTY_LICENSES.md`, #77), `79d071f`
  (`docs/GUIA-BETA-MAC.md`, #55/#75/#76), `f552cce` (sección en `README.md`, #55).
- No se tocó código ni `docs/MCP.md`; solo los cuatro archivos previstos.

### Qué se verificó ejecutando

- `npm run build -w @lila/engine` — OK, sin salida (tsc limpio).
- `npm run build -w @lila/web` — OK; build de Vite genera `apps/web/dist` (bundle principal
  968.73 kB / 283.24 kB gzip, aviso de tamaño preexistente de Vite, no de este ticket).
- `npm run build -w @lila/desktop` — OK; `tsc --build` + `copy-web.mjs` copian
  `apps/web/dist` → `apps/desktop/dist/web`.
- `grep -c zod apps/web/dist/assets/index-*.js` → 5 coincidencias: confirma que `zod` (de
  `@lila/engine`, no solo de la CLI) queda dentro del bundle que carga la ventana de Electron,
  no solo en `node_modules`.
- `python3 -c "import json; ..."` sobre cada `node_modules/<paquete>/package.json` del árbol de
  `bpmn-js` (18 paquetes transitivos) y de las dependencias directas (`react`, `react-dom`,
  `zod`, `electron`) — versión y licencia leídas del propio manifiesto instalado, no de memoria.
- `curl` a `raw.githubusercontent.com/electron/electron/v44.2.0/DEPS` — confirma Chromium
  `152.0.7977.76` y Node `v24.20.0` embebidos en Electron `44.2.0` (la versión exacta que usa
  `apps/desktop/package.json`); no se adivinó ninguna de las dos.
- `lsof -i :5173 …` antes de tocar nada de build: hay un proceso de otro trabajador ("Codex")
  escuchando en `:5173`; no se tocó, no afecta a los builds de producción de este ticket.
- `xattr` sobre el `.app` existente en `apps/desktop/release/mac-arm64/`: solo trae
  `com.apple.provenance` (build local), no `com.apple.quarantine` — coherente con que es un
  artefacto compilado en esta máquina, no descargado; la guía describe el caso de descarga real
  (quarantine sí presente) que es el que le va a pasar a quien reciba el `.dmg`.

### Qué NO se verificó (y por qué, o dónde queda anotado)

- **No se regeneró el DMG** (`npm run dist:mac -w @lila/desktop`): el de OP-12
  (`apps/desktop/release/Lila Modeler-0.0.1-mac-arm64.dmg`, sha `f0ba8ed`) sigue siendo válido
  porque no hay cambio de código en este incremento (solo documentación); regenerarlo habría sido
  trabajo redundante. Los tres comandos de build que sí componen `dist:mac` (`build -w
  @lila/engine`, `build -w @lila/web`, `build -w @lila/desktop`) se verificaron por separado.
- **No se probó interactivamente el flujo real de "Guardar proyecto" en la app empaquetada**
  (a qué carpeta cae la descarga del `.lila.json` dentro de Electron): no hay entorno para
  simular el clic de un diálogo nativo desde este agente, mismo límite que ya documentó B en
  OP-02. La guía lo dice explícitamente en vez de inventar una ruta de descarga.
- **No se ejecutó `npm ci`**: no hizo falta (ninguna dependencia nueva en este incremento, todo
  documental); el comando queda en la guía como primer paso para quien clona limpio.
- Windows/Linux: no compilados ni probados (ya documentado como limitación por OP-12; este
  incremento no cambia ese estado, solo lo repite en la guía de usuario).

### Limitaciones documentadas en la guía (resumen; ver `docs/GUIA-BETA-MAC.md` para el detalle)

Sin firma/notarización, sin icono propio (#76), solo macOS arm64 probado, persistencia en carpeta
de proyecto pendiente del bootstrap de A (`main.tsx` sigue con `BrowserStore`: "Guardar proyecto"
hoy descarga un `.lila.json` suelto, no escribe `model.bpmn`/`*.scenario.json`/
`lila-project.json`/`runs/` aunque ese código ya exista en `apps/desktop/src/projectIO.ts` y
`DesktopStore`), editor visual de calendarios pospuesto, diálogos nativos no probados
interactivamente.

### Pendientes del ticket OP-17 (no entran en este incremento)

- **Incremento 2 (MCP, issues #56/#48)**: cadena `run_simulation`/`compare_scenarios` por stdio,
  y lo que exige la preparación de publicación npm (#223) — explícitamente fuera de alcance según
  la instrucción recibida para esta sesión; no se tocó `docs/MCP.md`.
- **Guía definitiva tras el bootstrap de A**: en cuanto `main.tsx` instancie `DesktopStore` (ver
  petición de B en `estado/OP-08-claude.md`), la sección "Guardar y recuperar" de
  `docs/GUIA-BETA-MAC.md` queda desactualizada por diseño (describe el estado de `287e3e2`) y hay
  que reescribirla para documentar el flujo real de carpeta de proyecto.
- No se declara aquí ningún issue (#55/#75/#76/#77) como cerrado del todo: este paquete cumple su
  parte de la aceptación de OP-17 (guía que no describe nada inexistente, licencias con la marca
  de bpmn.io), pero el cierre de cada issue depende de que se cumplan también sus criterios en
  otros paquetes (p. ej. #76 icono propio es de F/empaquetado, no de este incremento).

Sesión trabajadora: cerrada para este incremento. Cesión a otro equipo: no.

---

## Incremento 2 — guía actualizada al artefacto final (issues #55, #75)

Nota de nombres: esto **no** es el "incremento 2 (MCP, #56/#48)" que anticipaba la sección
anterior — ese trabajo de MCP sigue sin tocarse. Este es un segundo incremento de la parte de guía
del mismo ticket OP-17, pedido para poner `docs/GUIA-BETA-MAC.md` al día con el SHA final de la
beta (`DesktopStore` ya conectado por A, con guardado transaccional, cierre seguro, recientes y
seam E2E de B).

- Rama: `codex/op-e-paneles`. Worktree: `/Users/brito/development/lila-wt-e-paneles`.
- `git merge --no-edit codex/claude-entrega-20260906` → **fast-forward**, sin conflicto.
- SHA base (antes del merge): `aa60dd1`. SHA tras el merge: `89f82bd`.
- Commit de este incremento: `87537ce` — `docs: OP-17 guía de la beta Mac sobre el artefacto
  final (#55, #75)`.

### Qué se verificó antes de escribir

- `docs/plan-operativo-2026-09-06/estado/OP-18-claude.md`: tabla de PASS/limitaciones del
  recorrido real sobre la `.app` empaquetada de `1e136e3` con el seam E2E (`LILA_E2E_FOLDER`,
  `LILA_E2E_LOG`, `LILA_E2E_CLOSE`), y el recorrido preliminar sobre `d536b75`.
- `docs/plan-operativo-2026-09-06/estado/OP-14-claude.md`: los cuatro incrementos de B — guardia
  de symlinks/origen de mensajes/CSP/identidad/cierre (1), recientes/ventana/`E-CAMBIO-EXTERNO`/
  apertura de `.bpmn` (2), guardado transaccional con rollback + seam E2E (3), y los tres P0 que
  reprodujo A y B cerró (4), incluido que `problems` ahora sí viaja dentro de `ProjectDocument`.
- `docs/plan-operativo-2026-09-06/estado/OP-08-claude.md`: disposición de la carpeta de proyecto
  (`model.bpmn`, `*.scenario.json`, `lila-project.json`, `runs/`) y las decisiones de B sobre
  `problems`/errores por IPC.
- `apps/web/src/App.tsx` (ya fusionado): confirmado en el propio código, no de memoria —
  - `doc.problems` **sí se pinta** en la UI: `App.tsx` líneas 196-197 hacen
    `setProjectProblems(doc.problems ?? [])` y, si hay alguno,
    `setIoError(doc.problems.map(...).join(' · '))`, que se muestra con `role="alert"`.
  - No existe ningún botón "Sobrescribir": el único control tras un fallo de guardado (incluido
    `E-CAMBIO-EXTERNO`) es "Guardar como" en la barra superior — confirmado por ausencia de
    `overwrite`/"Sobrescribir" en todo `App.tsx`.
  - `apps/web/src/main.tsx` ya construye `DesktopStore` cuando `window.lila` existe (`const
    desktop = typeof window.lila !== 'undefined'`), reemplazando la elección fija de
    `BrowserStore` que documentaba el incremento 1.
  - `bpmnFilesEnabled={!desktop}`: el botón "Abrir .bpmn" de la barra superior **no aparece** en
    la app de escritorio (solo en modo navegador) — corregido en la guía, que antes lo daba por
    presente en ambos modos.
  - "Comparar" no tiene botón "Exportar CSV" (solo "Resultados") — confirmado por ausencia de esa
    cadena en la sección de Comparar.
  - `apps/desktop/package.json`: versión `0.0.1`, usada para corregir la ruta del DMG en "Cómo
    reconstruir" (antes sin ruta completa).

### Qué se cambió en `docs/GUIA-BETA-MAC.md`

- Cabecera: SHA/fecha actualizados a `89f82bd`/2026-09-07 y nota de que `DesktopStore` ya está
  conectado.
- «Modelar»: corregida la mención de "Abrir .bpmn" (ya no existe en el build de escritorio).
- «Guardar y recuperar»: reescrita como funcionalidad real — Nuevo proyecto/Abrir proyecto/
  Guardar/Guardar como, `E-CARPETA-OCUPADA`, indicador Guardado/Sin guardar, cierre con diálogo
  nativo Guardar/Descartar/Cancelar (30 s de espera), archivos de la carpeta, escenario roto en
  `problems` (con confirmación de que sí se muestra), `E-DESTINO-INVALIDO` al guardar sin
  permisos, `E-CAMBIO-EXTERNO` sin botón "Sobrescribir" (salida: Guardar como).
- Nueva sección «Recientes y ventana»: ruta de `estado.json`, recientes sin menú en la UI.
- «Limitaciones de esta beta»: actualizada al SHA/fecha final; añadidas edición de BPMN no
  automatizada en la app empaquetada, asociación `.bpmn` por doble clic no probada, mensajes de
  error crudos (zod / "Error invoking remote method"), sin menú de recientes, `Exportar CSV` solo
  en Resultados. Se quitó la limitación ya resuelta ("persistencia en carpeta pendiente del
  bootstrap").
- «Cómo reconstruir»: ruta completa del DMG y `ORIGEN.txt` bajo `apps/desktop/release/`, con la
  versión real (`0.0.1`) leída de `apps/desktop/package.json`.
- Nueva sección «Para agentes/QA: seam E2E»: `LILA_E2E_FOLDER`, `LILA_E2E_CLOSE`, `LILA_E2E_LOG`,
  con la advertencia de que son solo para pruebas automatizadas.

No se regeneró el DMG (el coordinador lo está generando en otro worktree, según la instrucción
recibida); no se tocaron `THIRD_PARTY_LICENSES.md` ni `docs/MCP.md`; no se corrió ningún build ni
test (cambio puramente de documentación, sin código tocado).

### Pendientes

- **MCP (issues #56/#48)**: sigue sin empezar, tal como ya anotaba el incremento 1 — `docs/MCP.md`
  no se tocó.
- El icono propio (#76) y la firma/notarización siguen fuera de este incremento (empaquetado,
  no documentación).
- Si el coordinador decide conectar `listRecents()`/`openRecent()` en la UI o añadir un botón
  "Sobrescribir" para `E-CAMBIO-EXTERNO`, la sección «Guardar y recuperar»/«Recientes y ventana»
  de la guía vuelve a quedar desactualizada por diseño y hay que revisarla otra vez.

Sesión trabajadora: cerrada para este incremento. Cesión a otro equipo: no.
