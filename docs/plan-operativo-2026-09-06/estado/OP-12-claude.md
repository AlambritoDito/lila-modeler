# OP-12 — Claude E (transferido por F)

Estado: entregado. Issues #72 y #73 cerrados por este paquete (empaquetado macOS local
verificado, matriz de CI preparada); #76 (icono propio) queda pendiente, ver limitaciones.
Dueño: Claude E (Sonnet), por transferencia explícita del coordinador F.
Rama: `codex/op-e-empaquetado`. Worktree: `/Users/brito/development/lila-wt-e-paneles`.
Base: `codex/claude-entrega-20260906` @ `97dabb0`.
SHA final: `f0ba8ed94bfe4aa70296c0bf1674f48c26730122`.

## Commits

1. `31a682f` docs(plan): OP-12 estado inicial
2. `fa2287e` build(desktop): añade electron-builder 26.15.3 y scripts pack:mac/dist:mac (#72)
3. `f55a701` build(desktop): configura electron-builder para macOS/Windows/Linux (#72, #73)
4. `9668df8` build(desktop): registra SHA de origen en el artefacto dist:mac (#72)
5. `1fff5af` fix(desktop): captura de smoke fuera de app.asar en el artefacto empaquetado (#72)
6. `f0ba8ed` ci(desktop): matriz de empaquetado macOS/Windows/Linux por commit (#73)

## Archivos tocados

- `apps/desktop/electron-builder.yml` (nuevo)
- `apps/desktop/package.json`: devDependency `electron-builder` exacta `26.15.3`, scripts
  `pack:mac` y `dist:mac` añadidos al final del bloque `scripts` (sin reordenar ni reformatear
  el resto — B edita este archivo en paralelo).
- `package-lock.json`: delta de la instalación (260 paquetes).
- `apps/desktop/.gitignore`: añadida `release/`.
- `apps/desktop/scripts/origen.mjs` (nuevo, 13 líneas): escribe `release/ORIGEN.txt` con SHA,
  fecha ISO y `uname -m`, invocado al final de `dist:mac`.
- `.github/workflows/desktop.yml` (nuevo): `workflow_dispatch` + `push` a `codex/**`; matriz
  `macos-latest`/`windows-latest`/`ubuntu-latest` con `--mac`/`--win`/`--linux`; pasos `npm ci`,
  build de `@lila/engine`, `@lila/web`, `@lila/desktop`, luego `npx electron-builder <flag>
  --publish never` desde `apps/desktop`; `actions/upload-artifact@v4` con nombre
  `lila-desktop-${{ matrix.os }}-${{ github.sha }}`. No se ejecutó (solo preparado, tal como
  se pidió).
- `apps/desktop/src/main.ts`: única línea tocada, dentro de `runSmoke`. Antes:
  `path.join(app.getAppPath(), 'smoke')`. Ahora:
  `process.env.LILA_SMOKE_DIR ?? path.join(app.getPath('temp'), 'lila-smoke')` — necesario
  porque en la app empaquetada `getAppPath()` cae dentro de `app.asar` (solo lectura) y el
  smoke no podía escribir la captura ahí.

## Decisiones y notas

- `apps/desktop/package.json` traía `version: 0.0.1` (no `0.0.0`), así que no se tocó la
  versión — el nombre de artefacto quedó `Lila Modeler-0.0.1-mac-arm64.dmg`.
- Sin icono propio: electron-builder usa el icono por defecto de Electron
  (`default Electron icon is used  reason=application icon is not set` en el log). Pendiente
  de #76.
- Orden exacto de build usado en verificación: `npm run build -w @lila/web` (que a su vez
  corre `build -w @lila/engine`) antes de `npm run pack:mac -w @lila/desktop` / `dist:mac`;
  el script `build` de `@lila/desktop` (`tsc --build && node scripts/copy-web.mjs`) ya está
  encadenado dentro de `pack:mac`/`dist:mac` vía `npm run build &&`.

## Verificación (todas en orden, con Vite apagado salvo lo anotado)

1. `npm run build -w @lila/web` y `npm run pack:mac -w @lila/desktop` → OK.
   `apps/desktop/release/mac-arm64/Lila Modeler.app` existe.
2. Antes de correr el smoke se comprobó `lsof -i :5173 -i :5174 -i :5177 -i :5178`: había un
   proceso `node` de otro trabajador escuchando en `:5173` (dueño del proceso: "Codex", no
   iniciado por mí) — no se tocó, y no afecta porque el binario de producción carga vía
   protocolo `lila://`, no `LILA_DEV_URL`.
   `LILA_SMOKE=1 "apps/desktop/release/mac-arm64/Lila Modeler.app/Contents/MacOS/Lila Modeler"`
   imprimió `{"lienzo":true,"tema":true,"fuente":true,"puente":true,"consoleErrors":[],"loadFailure":null,"ok":true}`
   y salió con código 0. La captura se escribió en `$TMPDIR/lila-smoke/captura.png`; se revisó
   con Read y muestra el diagrama BPMN completo (dos pools, gateways, tema oscuro aplicado).
3. Se copió la `.app` a `$TMPDIR/Prueba canción/` (ruta con espacio y tilde) y se repitió el
   smoke desde ahí: mismo resultado `"ok":true`, salida 0.
4. `npm run dist:mac -w @lila/desktop` → DMG generado:
   - Ruta: `/Users/brito/development/lila-wt-e-paneles/apps/desktop/release/Lila Modeler-0.0.1-mac-arm64.dmg`
   - Tamaño: 128204821 bytes (~122 MiB)
   - `release/ORIGEN.txt`: `sha=f0ba8ed94bfe4aa70296c0bf1674f48c26730122`,
     `fecha=2026-09-07T05:09:44.940Z`, `arch=arm64`
   - `hdiutil attach -nobrowse -readonly` montó el DMG en
     `/Volumes/Lila Modeler 0.0.1-arm64`; contenía `Lila Modeler.app` y el symlink
     `Applications`; se desmontó con `hdiutil detach`.
5. `npx vitest run apps/desktop` → 1 archivo, 24 tests, todos verdes.
   `npm run typecheck -w @lila/desktop` → sin salida, sin errores.

## Limitaciones

- Sin firma ni notarización (beta local, `identity: null`): para abrir el `.app` o el `.dmg`
  hay que usar clic derecho → Abrir la primera vez, o `xattr -d com.apple.quarantine
  "Lila Modeler.app"`.
- Sin icono propio (pendiente #76): usa el icono por defecto de Electron.
- Windows (NSIS) y Linux (AppImage+deb) solo están configurados en `electron-builder.yml` y en
  la matriz de CI; no se compilaron ni se probaron en esta sesión (requieren el runner
  correspondiente). No declarar el issue #73 cerrado del todo hasta que se corran esos
  artefactos.
- El workflow `.github/workflows/desktop.yml` no se ejecutó — queda preparado para
  `workflow_dispatch` o un push a `codex/**`.
- Artefactos (`release/`, `dist/`) no se versionan (ver `.gitignore`); quedaron en el
  worktree local para que A/QA los revisen si hace falta, pero no están en ningún commit.

## Delta de dependencias

`electron-builder@26.15.3` (exacta) como devDependency de `@lila/desktop`, con su árbol de
~260 paquetes reflejado en `package-lock.json`. Ninguna otra dependencia añadida.
