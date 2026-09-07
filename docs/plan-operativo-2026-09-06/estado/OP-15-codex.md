# OP-15 — Estado de ejecución (Codex)

- Dueño: agente C / Codex.
- Rama: `codex/op-c-bpmn`.
- HEAD/base previa al despacho: `32ca47290a42042e8389b8ab4927c006e9d0f6c2`.
- Checkpoint integrado: `25c0cd2`; commit de merge `25c9e8b`.
- Commits: `c289766` (snapshot/export/preflight) y `f73b976` (propiedades básicas).

## Resultado

- `exportar({ interactivo?: boolean })` es no interactivo por defecto: ante pérdidas rechaza con
  ids y detalle sin abrir diálogo. Solo `{ interactivo: true }` permite confirmación explícita.
- `comprobar?(xml)` importa y renderiza en candidato aislado, lo destruye y no toca el activo.
  Aperturas concurrentes solo permiten que la última iniciada sustituya el lienzo.
- La restitución XML preserva entidades y escapa la comilla delimitadora; el caso de id original
  con `"` bajo comilla simple vuelve a producir XML bien formado.
- El panel edita proceso simple desde el fondo y proceso asociado a pool, incluyendo nombre,
  documentación y `lila:versionTag`; TextAnnotation edita `bpmn:text` y conserva su id.
- `ref` y `roleRef` se recortan. La primera extensión crea contenedor e hijo con un solo comando,
  por lo que un undo no deja `extensionElements` vacío.

## Verificación

- `npm run typecheck --workspace @lila/web`: aprobado.
- `npx vitest run apps/web/src/propiedades.test.ts apps/web/src/PropertiesPanel.qa.test.tsx apps/web/src/exportar.test.ts`:
  3 archivos, 45 pruebas aprobadas.
- `git diff --check`: aprobado antes de ambos commits.

## Límites

- No se ejecutó suite completa ni QA empaquetada; A las serializa.
- No se ampliaron extras P1 de pools/lanes, copiar/borrar ni compatibilidad con herramientas
  externas. No se tocó shell ni `PropertiesPanel` fuera del alcance básico descrito.
- A debe pasar `{ interactivo: true }` únicamente desde guardar/exportar explícitos; snapshots y
  simulación conservan el valor por defecto no interactivo.
