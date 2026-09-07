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
