# OP-05 — estado (dueño E, Sonnet)

- Worktree: `/Users/brito/development/lila-wt-e-paneles`
- Rama: `codex/op-e-paneles`
- HEAD al iniciar: `71e653e` (docs(plan): checkpoint común operativo 2026-09-06)
- Incremento: 1

## Plan

1. Merge (no cherry-pick) de `lila-63-compare-view` (SHA 7b6acec) para traer `CompareView.tsx` y sus tests del PR #209.
2. Verificar `npx vitest run apps/web/src/CompareView` en verde antes de tocar nada.
3. Añadir `apps/web/src/compareWarnings.ts` + test: helper puro `compareWarnings(runs)` y `runMetaFrom(...)`.
4. Ampliar `CompareView` con `runs?: readonly CompareRunMeta[]`, panel de avisos, reglas de costo no comparable y significancia bloqueada.
5. Tests de aceptación (a)-(e) del ticket.
6. `npm run typecheck -w @lila/web`.
7. Actualizar este archivo con SHA final, decisiones, resultados, límites e interfaz para A. Commit.

## Archivos previstos

- `apps/web/src/CompareView.tsx`
- `apps/web/src/CompareView.test.tsx`
- `apps/web/src/CompareView.qa.test.tsx` (si aplica)
- `apps/web/src/compareWarnings.ts` (nuevo)
- `apps/web/src/compareWarnings.test.ts` (nuevo)
- `docs/plan-operativo-2026-09-06/estado/OP-05-claude.md` (este archivo)

## Próximo comando

```
cd /Users/brito/development/lila-wt-e-paneles && git merge --no-edit lila-63-compare-view
```
