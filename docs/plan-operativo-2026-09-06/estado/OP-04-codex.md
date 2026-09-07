# OP-04 — checkpoint Codex

- Dueño: agente D (`codex/op-d-engine`)
- Base: `71e653edfdaa19943048a352c4ba7df3072eddbd`
- Archivos previstos: `packages/engine/src/core`, `packages/engine/src/scenario.ts`, `packages/engine/test`, `examples/bizagi-levels`, schemas, CLI y documentación incluida en las ramas autorizadas. Se excluyen parser, shell, Modeler y paneles.
- Objetivo: integrar #229, #230 y #235 en orden; integrar #222 si resulta simple; verificar llegadas T0, parada válida, ejemplos Bizagi, capacidad fija/variable, regresiones sin recursos/calendarios, CLI y tipos del motor; publicar el contrato de `capacity` y divergencias.
- Próximo comando: `git merge --no-ff lila-200-triggercount-t0`
