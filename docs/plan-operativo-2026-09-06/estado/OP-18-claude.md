# OP-18 — Claude F (plan de aceptación)
Estado: pendiente (preparación). Dueño: Claude F. Rama: codex/claude-entrega-20260906.

## Recorrido Mac (artefacto del SHA final, Vite detenido)
Fixture temporal: copia de `examples/pedido` en `$TMPDIR/lila-op18-<sha>/` con espacios y tilde en el nombre («Prueba OP-18 canción»).
1. Abrir la `.app` (sin terminal). Registrar tiempo hasta lienzo visible.
2. Carpeta nueva → crear/abrir proyecto → importar `model.bpmn` → editar una tarea → Guardar.
3. Crear dos escenarios (AS-IS con seed 42 y 30 réplicas; TO-BE con capacidad distinta) → Guardar.
4. Cerrar la app → reabrir → el proyecto, el BPMN editado y los dos escenarios se recuperan.
5. Simular ambos → Resultados → Comparar (moneda y avisos visibles) → exportar CSV.
6. Cancelación a mitad de corrida; diálogo cancelado sin error; archivo de escenario con ids ajenos → diagnóstico sin perder el escenario anterior; JSON roto → error visible; guardar en carpeta sin permisos (`chmod 500`) → error, sigue dirty, archivo previo intacto; cerrar con cambios → Guardar/Descartar/Cancelar.

## Evidencia
Capturas en `apps/desktop/smoke/` (no versionadas) + `estado/OP-18-claude.md` con SHA, ruta del DMG/app, arquitectura, resultado por paso. Windows/Linux: solo lo que se compile y realmente se pruebe.

## Recorrido preliminar sobre la `.app` de d536b75 (2026-09-06, Vite detenido)
Artefacto: `apps/desktop/release/mac-arm64/Lila Modeler.app` (worktree Claude), `pack:mac` desde d536b75. Smoke → ok. App lanzada con `--remote-debugging-port` y recorrida por CDP (`scratchpad/cdp.mjs`, Node WebSocket nativo) porque el acceso a control de la app fue denegado.
- Arranque: `window.lila` presente, `DesktopStore` activo (bootstrap de A); barra «Pedido de ejemplo · Guardado». Modos Modelar/Simular/Resultados/Comparar y botones Nuevo/Abrir/Guardar/Guardar como visibles.
- Simular AS-IS (seed 42, 30 réplicas) → termina; Resultados muestra «semilla 42 · replicaciones 30 · unidad min · moneda MXN», cuellos de botella, tablas y «Exportar CSV». Indicador pasa a «Sin guardar».
- Selector de escenario → TO-BE 3 cajeros → Simular → Comparar: columnas AS-IS (base) y TO-BE, avisos por corrida (W-MSGFLOW, W-TAREA-SIN-TIEMPO, W-JOIN-BLOQUEADO…), costos con moneda MX$ y marca de significancia (`*`), `cycleTime.mean` 0 % (cajero no es el cuello: Preparar alimento lo es).
- Cancelar durante la corrida: el botón existe y responde.
- **No probado (diálogos nativos)**: Nuevo/Abrir/Guardar como con carpeta real, cerrar con cambios, reabrir. Requiere seam de prueba en main (`LILA_E2E_FOLDER`, `LILA_E2E_CLOSE`) que se pide a B en su siguiente incremento, o control de la app por Brito.
- Observación menor: en Comparar no hay «Exportar CSV» (solo en Resultados). No bloqueante.
