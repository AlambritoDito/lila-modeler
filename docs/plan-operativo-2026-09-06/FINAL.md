# Beta Mac — entrega final Codex A

Artefacto funcional **358353d9e01282c25e18cd4e016aba0da7441d85**, macOS arm64, 2026-09-07. Rama canónica codex/operativo-20260906. Los commits posteriores de cierre solo documentan la evidencia; no cambian el código del artefacto.

## Archivos
- DMG: /Users/brito/development/lila-wt-integracion/apps/desktop/release/Lila Modeler-0.0.1-mac-arm64.dmg
- App probada: /Users/brito/development/lila-wt-integracion/apps/desktop/release/mac-arm64/Lila Modeler.app
- Proyecto propio de aceptación y CSV: /Users/brito/development/lila-wt-integracion/apps/desktop/release/QA
- Origen: apps/desktop/release/ORIGEN.txt.
- SHA256 DMG: 5c2ffb4e83fdfbaeb218c5a9964a8c0f6959856ee4458d1f1d35b52f6e6872be
- Tamaño DMG: 128247380 bytes.

El DMG se montó en modo de solo lectura: app.asar, Info.plist y ejecutable coinciden byte a byte con la app probada. Evidencia: QA/artifact-check.json. Puertos Vite 5173/5174 cerrados; la app usa lila://app/ y Worker incluido.

## Aceptación nativa del SHA 358353d — PASS
Con CUA, sin LILA_E2E_FOLDER/CLOSE ni CDP:
1. Nuevo proyecto mediante selector nativo → subcarpeta Final358353d dentro de una ruta con espacio y tilde. IDs propios y dos escenarios, sin depender del ejemplo.
2. Seleccionar tarea y editar Nombre a «Validar solicitud final» en el BPMN empaquetado; Guardar proyecto. XML en disco comprobado.
3. Cerrar con botón rojo → reabrir app → Abrir proyecto mediante selector nativo. Conserva tarea editada y escenarios.
4. Simular AS-IS (60s), editar TO-BE heredado a 30 s y simular; seed 42, 3 réplicas. Comparar muestra cycleTime.mean de 1 a 0,5 min (−50%).
5. Resultados → Proceso → Exportar CSV → Save nativo. CSV real:20 iniciados, 20 completados, ciclo medio 30 s (unidad interna del CSV; 0,5 min en pantalla).
6. Cerrar con dirty: Cancelar conserva proyecto; Guardar escribe escenario y dos runs antes de salir.
7. Segunda reapertura → Comparar muestra ambas corridas y −50% SIN volver a simular. Snapshots y revisiones comprobados en disco.

El primer artefacto de Claude 89f82bd tenía un P0 descubierto en QA nativo: cerrar la última ventana en Mac dejaba la app sin ventana y sin poder reabrir. 358353d termina la sesión de esta beta de una sola ventana después de resolver las guardias de cierre. Se reconstruyó y repitió el recorrido completo; el DMG anterior queda superado.

## Verificación
- npm test:1265 PASS / 1 omitida.
- npm run typecheck:PASS (motor/raíz/web); tipos desktop PASS.
- npm run build -w @lila/web y npm run dist:mac -w @lila/desktop:PASS.
- Pruebas dirigidas de cierre/IO:34 PASS.
- Logs del checkpoint final:/tmp/lila-a-final-*.log.
- B corrigió guardado parcial con preflight/rollback, carpeta ocupada en creación/primer guardado, symlinks, identidad, IPC/origen, problemas visibles y cierre nativo. Sus pruebas de permiso denegado, JSON roto, cambios externos y fallo intermedio están integradas; QA adicional de F queda en FINAL-claude.md y OP-18-claude.md, distinguiendo su seam del recorrido nativo de arriba.

## Pendientes reales
- Sin firma/notarización ni icono propio. Windows/Linux e Intel no probados.
- Importar/exportar BPMN suelto y asociar doble clic no están conectados en el shell desktop. El recorrido aceptado usa proyectos creados/guardados por la app. Las carpetas externas sin lila-project.json necesitan normalización de metadatos antes de prometer simulación: el fallback actual usa el nombre de carpeta como model.name.
- Recientes sin menú; abrir ruta pendiente sin conectar; cambios externos se recuperan mediante Guardar como, sin botón Sobrescribir.
- Mensajes de errores crudos, editor visual semanal de calendarios y extras OP16/MCP pendientes. No se cierran issues completos por estos incrementos.
- El rollback maneja fallos de escritura; no se promete una transacción multiarchivo resistente a corte de energía.

Integración local únicamente. Checkout original limpio en 71e653e (solo plan); sin push/main/release/npm/producción. B/E y C/D sin trabajo activo, worktrees conservados. Saldo final observado 4%; 3 restablecimientos intactos, ninguno consumido.

## Seguimiento posterior a la entrega — 2026-09-07

El usuario pospuso el diseño de un proyecto más fácil de compartir y la importación/exportación directa de `.bpmn` hasta después de probar la app. Alcance y criterios propuestos registrados en [BACKLOG.md](../../BACKLOG.md#seguimiento-de-la-beta-mac--2026-09-07). No se implementan en este seguimiento.

Después del cierre local descrito arriba, el usuario autorizó guardar estos pendientes en documentación y publicar los commits en `origin`. La rama de integración es `codex/operativo-20260906`; esta autorización no cambia el artefacto probado ni publica una release.
