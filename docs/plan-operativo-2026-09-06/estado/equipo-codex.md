# Disponibilidad Codex — estado vigente

A activo en integración canónica `codex/operativo-20260906`, worktree `/Users/brito/development/lila-wt-integracion`. C y D terminaron sus incrementos; ningún trabajador activo. A integra y prueba. Sin cesión de tareas. Saldo 15% restante (consulta tras 74a252c): solo P0 breves, conservar reserva. Tres resets intactos; prohibido consumirlos.

## Commits listos
- Commit común: 71e653e. Contrato publicado: 7550249, `CONTRATO-PROYECTO.md` y `ProjectSessionStore`.
- Último checkpoint COMPLETO VERIFICADO: **1f85b50**, 1140 tests PASS / 1 skipped, `npm run typecheck`, build web, typecheck/build desktop PASS. Logs `/tmp/lila-a-checkpoint3-*.log`.
- **74a252c** LISTO con pruebas dirigidas posteriores: OP10 integrado (2505470, 179 tests propios + build motor); snapshots/dirty/gate de proyecto reforzados (12 tests App + project/gate y tipos web). Aún pendiente siguiente suite completa combinada.
- PR web #215/#209/#227→#234; C #221/ids/OP09; D #229→#230→#235/#222/OP10; E OP05; F desktop OP02/CI integrados. No se cerraron issues originales por incrementos.

## Para Claude/F/B/E — consumir estado actual

**P0 reproducido en OP08 parcial e16ef9a (no integrado):** writeProjectFolder hace renames con Promise.all; con destino `bad.scenario.json` que es un directorio falla EISDIR pero `model.bpmn` YA cambió de MODELO_ANTERIOR a MODELO_NUEVO. Reproducción aislada `/tmp/lila-atomic-review-uRTH8j`, importando la función de B sin editar su worktree. B/F: no entregar como snapshot atómico; añadir preflight de destinos y rollback ante fallo de rename (test de fallo intermedio), o protocolo de generación/journal recuperable. El contrato no permite confirmar/corromper parcialmente un guardado fallido.

1. **Capacity YA CORREGIDO** en 1f85b50: test apunta a `campo-resources.cajero.capacity-valor` (Campo ya tenía ese input). 1140 tests completos verdes, no es un fallo pendiente. E puede añadir etiquetas Fija/Por turno sin reabrir diagnóstico.
2. `ProjectDocument.problems?` añadido en 1f85b50; App lo muestra y preserva al guardar desde 2accace. Parche Vite #225 aplicado en 189f881; fixtures warnings arreglados en dfd4048. Las peticiones 2/3/4 de F están resueltas.
3. App consume createProject/openProject/saveProject/setDirty/onSaveRequested; A conectará DesktopStore al recibir OP08. B mantiene su propiedad. Comparación ya pasa runMetaFrom de E y deshacer/rehacer/seleccionar de C están conectados.
4. P0 B/F: no seguir symlinks fuera de carpeta autorizada; validar senderFrame/navegación IPC; guardado atómico. Abrir/create cancelado o XML rechazado no debe redirigir próximos guardados del proyecto anterior a otra carpeta (mapa por document.id o commit/rollback de selección). C añade preflight opcional comprobar(xml) y A lo usará antes de crear carpeta.
5. F construirá y probará artefacto final desde el SHA integrado final. El DMG OP12 de E todavía es infraestructura, no la beta con recorrido propio aceptado.

## Evidencia y siguiente paso
QA navegador real 65560c7: proyecto propio → ASIS 60s → TOBE 30s → Worker real → comparar -50% → guardar: PASS, consola limpia. QA OP09/15: seleccionar actividad, editar nombre, deshacer/rehacer conserva ID, PASS. Filechooser del navegador interno no entregó evento; no se cuenta como reapertura desktop. Fixtures `/tmp/lila-qa-codex` para QA local.

Próximo: integrar OP12 listo, OP08/14 listos de B/F y último C; elegir DesktopStore, checkpoint completo serializado, entregar SHA a F para aceptación empaquetada con Vite detenido. OP16/extras pospuestos. No tocar producción/main/releases/npm ni limpiar worktrees.

Último C 17ec08f integrado: export default no interactivo bloquea pérdidas, guardar/export explícitos usan interactivo:true; preflight antes de createProject; edición de proceso/anotaciones y undo de primera extensión. 45 tests C dirigidos y tipos pasan. Sin nuevos frentes: solo cierre P0 e integración B/F.
