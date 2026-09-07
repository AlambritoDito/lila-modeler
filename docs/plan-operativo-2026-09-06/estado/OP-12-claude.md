# OP-12 — Claude E (transferido por F)

Estado: en curso.
Dueño: Claude E (Sonnet), por transferencia explícita del coordinador F. Rama: `codex/op-e-empaquetado`.
Worktree: `/Users/brito/development/lila-wt-e-paneles`.
Base: `codex/claude-entrega-20260906` @ `97dabb0` (ya incluye `apps/desktop` de B, OP-05 de E y el checkpoint de A).

## Archivos previstos

- `apps/desktop/electron-builder.yml` (nuevo)
- `apps/desktop/package.json` (solo: devDependency `electron-builder@26.15.3` exacta + scripts `pack:mac`/`dist:mac`)
- `package-lock.json` (delta de la instalación)
- `apps/desktop/.gitignore` (añadir carpeta de salida `release/`)
- `.github/workflows/desktop.yml` (nuevo)
- `docs/plan-operativo-2026-09-06/estado/OP-12-claude.md` (este archivo)
- `apps/desktop/src/main.ts`: una sola línea en `runSmoke`, la carpeta de captura pasa de
  `path.join(app.getAppPath(), 'smoke')` a
  `process.env.LILA_SMOKE_DIR ?? path.join(app.getPath('temp'), 'lila-smoke')`.

No se toca nada más de `apps/desktop/src/**` (B lo está editando en paralelo).

## Próximo comando

`npm install --save-dev --save-exact electron-builder@26.15.3 -w @lila/desktop` desde la raíz del
worktree.
