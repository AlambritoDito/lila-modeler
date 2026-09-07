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

## Recorrido con seam E2E sobre la `.app` de 1e136e3 (2026-09-07 00:10–00:15, Vite detenido)
Artefacto `pack:mac` de 1e136e3. App lanzada con `LILA_E2E_FOLDER`, `LILA_E2E_LOG`, `LILA_E2E_CLOSE` y `--remote-debugging-port`; recorrido por `scratchpad/op18.mjs` (CDP). Carpetas con espacio y tilde.
| Paso | Resultado |
|---|---|
| Nuevo proyecto → carpeta `OP-18 canción` | PASS: `model.bpmn`, `as-is.scenario.json`, `to-be.scenario.json`, `lila-project.json`; barra «Mi proyecto · Guardado» |
| Editar `replications` 30→7 en AS-IS, Guardar | PASS: JSON en disco con 7 |
| Cerrar y reabrir (Abrir proyecto) | PASS: dos escenarios, réplicas 7 conservadas |
| Simular AS-IS y TO-BE, Comparar, Exportar CSV presente | PASS (proyecto nuevo mínimo: cycleTime 1, costo 0) |
| Cambios sin guardar + Salir con «Guardar» | PASS: `writeProject ok`, `closeRequested saved:true`, app cerrada, `seed` 99 en disco |
| Cambios sin guardar + Salir con «Descartar» | PASS: app cerrada, disco intacto |
| Cambios sin guardar + Salir con «Cancelar» | PASS: app sigue abierta, disco intacto |
| `roto.scenario.json` con JSON inválido | PASS parcial: el proyecto abre y los demás escenarios cargan; **la UI no muestra el problema** (`problems` no propagado hasta el incremento 4 de B; A debe mostrarlo) |
| Carpeta `chmod 500` + Guardar | PASS: alerta `E-DESTINO-INVALIDO`, barra sigue «Sin guardar», archivo previo intacto, sin `.tmp-*`. Cosmético: la alerta muestra «Error invoking remote method…» (A) |
| Escenario con id ajeno (`Task_NoExiste`) sobre `examples/pedido` | PASS: «Validación (1 error)» y al simular «No se pudo simular» sin corrida. Cosmético: el mensaje es el JSON crudo de zod (A/D) |
| Editar BPMN desde la app empaquetada | NO AUTOMATIZADO: la selección en el lienzo no se pudo accionar por DOM; queda cubierto por el QA de A en navegador (65560c7) y pendiente de prueba manual |
| Abrir `.bpmn` por doble clic (asociación) | NO PROBADO en esta sesión (B lo verificó por argv con `LILA_DEBUG=1`) |
Nota: `window.close()` desde la página no pasa por el diálogo de cierre (Chromium lo ignora para la ventana principal); el cierre real (Salir/Cmd+Q, botón rojo) sí. Se probó con `osascript … quit`.
