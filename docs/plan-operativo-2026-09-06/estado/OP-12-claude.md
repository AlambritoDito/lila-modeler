# OP-12 — Claude F
Estado: pendiente de la entrada de producción de B (OP-02).
Dueño: Claude F. Rama: codex/claude-entrega-20260906. Worktree: /Users/brito/development/lila-wt-claude.
Base: 71e653e.
Archivos previstos: apps/desktop/electron-builder.yml (o campo `build` en apps/desktop/package.json), resources/icons, .github/workflows/desktop.yml.
Objetivo: DMG/app macOS arm64 sin firma; verificar editor, tema, iconos y Worker sin Vite.
Próximo comando: `npx electron-builder --mac --arm64 --dir` desde apps/desktop una vez exista main/preload compilados.
