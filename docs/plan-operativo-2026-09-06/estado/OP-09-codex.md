# OP-09 — Estado de ejecución (Codex)

- Dueño: agente C / Codex.
- Rama: `codex/op-c-bpmn`.
- HEAD/base previa al despacho: `4e26fc48d78a594ae4f6445854a696a7cad5c1db`.
- Checkpoint integrado: `98a2fe3`; commit de merge `2d54fbd`.
- Commit del incremento: `0f5c4c7` (`fix(web): make BPMN import transactional`).
- Archivos modificados: `apps/web/src/Modeler.tsx`, `apps/web/src/modelerXml.ts`,
  `apps/web/src/exportar.test.ts` y `docs/BPMN_EXTENSION.md`.

## Resultado

- Cada apertura sanea con `sanitizeXmlIds` del motor e importa en un Modeler candidato oculto.
  Solo después del éxito intercambia la instancia activa; un fallo conserva el XML, servicios,
  selección, suscripciones e historial anteriores.
- El mapa `idSanitizado -> idOriginal` pertenece a la instancia activa. La exportación restaura
  declaraciones, referencias topológicas, referencias textuales y BPMNDI, y escribe
  `exporter="Lila Modeler"` / `exporterVersion="0.0.0"` desde la versión del paquete web.
- Los avisos que implican pérdida se conservan. Antes de exportarlos se muestra una confirmación
  con su detalle e ids; cancelar rechaza la exportación y evita producir un archivo engañoso.
- `onListo` se publica únicamente tras importar el XML inicial. Las suscripciones externas se
  vuelven a enlazar al sustituir instancia y nunca observan el `commandStack.changed` del import.
- Se conservaron `abrir`, `exportar`, `ajustar`, `servicios`, `suscribir` y `cuellos`; se añadieron
  `deshacer?`, `rehacer?` y `seleccionar?`. La selección acepta ids internos saneados u originales.

## Verificación

- `npm run typecheck --workspace @lila/web`: aprobado.
- `npx vitest run apps/web/src/exportar.test.ts`: 1 archivo, 22 pruebas aprobadas.
- El roundtrip dirigido cubre `id="9Task bad.x"` con ambas clases de comillas, dos flujos, BPMNDI,
  documentación, `lila:responsibility`, metadatos de exportador, reapertura y recuperación del id
  original. También cubre candidato fallido y `default` roto real con id explícito.
- `git diff --check`: aprobado antes del commit.

## Límites

- No se ejecutó la suite completa; A la serializa.
- La prueba transaccional ejercita el helper con candidato controlado y el roundtrip usa
  `bpmn-moddle` real. El intercambio visual entre instancias de bpmn-js requiere QA en navegador
  con SVG real; jsdom no implementa sus primitivas geométricas.
- La decisión visible de pérdida usa `window.confirm`; si se cancela, `exportar()` rechaza. El shell
  puede capturar ese rechazo para evitar ruido de consola al añadir su flujo final de guardado.
- No se tocó `PropertiesPanel` ni se afirma cerrados #214, #216 o #217 fuera de este checkpoint.
