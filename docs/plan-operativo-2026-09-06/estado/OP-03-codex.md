# OP-03 — Estado de ejecución (Codex)

- Dueño: agente C / Codex
- Rama: `codex/op-c-bpmn`
- HEAD inicial: `71e653edfdaa19943048a352c4ba7df3072eddbd`
- Ref integrado de PR #221: `123570b0b63fb575ae8e4ab2fd6db717147ad425`.
- Commit de merge: `ac535c4` (`git merge --no-ff lila-198-moddle-warnings`).
- Commit del incremento: `bb49c9e` (`fix(bpmn): sanitize ids with mixed XML quotes`).
- Archivos modificados por el incremento: `packages/engine/src/bpmn/ids.ts`,
  `packages/engine/test/bpmn/ids.test.ts` y `packages/engine/test/bpmn/bizagi.test.ts`.

## Decisiones

- `sanitizeXmlIds` reconoce declaraciones `id` con comillas simples o dobles y sustituye las
  referencias de valor completo conservando la comilla de cada atributo.
- El mapa público conserva la dirección `idSanitizado -> idOriginal`; la prueba demuestra que
  es biyectivo e invertible. El helper sigue exportado por `@lila/engine/bpmn` mediante
  `src/bpmn/index.ts`, listo para OP-09, y la prueba lo importa desde ese subpath fuente.
- El fixture tipo Bizagi mezcla comillas entre definiciones y referencias y comprueba tres
  nodos, dos flujos, cero avisos, conectividad y recuperación de ids originales.

## Verificación

- `npm ci`: 144 paquetes instalados, auditoría sin vulnerabilidades.
- `npm test -- --run packages/engine/test/bpmn/ids.test.ts packages/engine/test/bpmn/bizagi.test.ts packages/engine/test/bpmn/parse.test.ts packages/engine/test/bpmn/validate.test.ts packages/engine/test/bpmn/validate-warnings.qa.test.ts`:
  5 archivos y 54 pruebas aprobadas.
- `git diff --check`: aprobado.
- La primera ejecución sin permiso ampliado no pudo crear `packages/engine/dist`; al repetir el
  mismo comando con acceso al worktree aislado, compiló y pasó.

## Estado y pendientes

- Checkpoint entregado: PR #221 integrado e ids robustos para comillas simples, dobles y
  referencias mixtas, con mapa reversible.
- OP-03 permanece parcial. No se declara cerrado #219: faltan los diagnósticos de proceso
  ignorado, referencia `default` rota y metadatos duplicados.
- No se ejecutó la suite completa; el integrador A la serializa.
