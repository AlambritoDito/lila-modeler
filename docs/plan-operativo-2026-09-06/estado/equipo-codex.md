# Disponibilidad Codex — vigente

A activo en integración canónica `codex/operativo-20260906`, worktree `/Users/brito/development/lila-wt-integracion`. C/D terminaron; ningún trabajador activo. Sin cesión. Último saldo observado 12% restante; solo P0/cierre. Tres resets conservados, no consumir.

## Listo para F: f061c32 + siguiente commit de guardia IO
- **f061c32 checkpoint completo 5 VERIFICADO**: 1182 tests PASS / 1 skipped, tipos raíz/web y builds web/desktop PASS. Logs `/tmp/lila-a-checkpoint5-*.log`. Smoke Electron real sin Vite: lienzo/tema/fuente/puente ok, consoleErrors vacío, loadFailure null (`/tmp/lila-a-desktop-bootstrap-smoke.log`).
- Siguiente commit (este reporte): guardia IO de App con inert en lienzo/panel y undo/redo deshabilitados durante apertura/guardado para impedir edición entre validación e importación asíncrona. **18 tests App + tipos web PASS** (`/tmp/lila-a-io-controls-*.log`).
- Incluye OP01 PRs web; C #221/OP03/09/15 último17ec08f; D #229→230→235/#222/OP10 2505470; E OP05/11/12; B OP02/08 f0d2095; F CI. No se cerraron issues originales por incrementos.
- Bootstrap main.tsx YA selecciona DesktopStore con window.lila. Proyectos propios por carpeta. App oculta Abrir/Exportar BPMN suelto en desktop porque los métodos históricos de B no tienen esa semántica; no usar getProcess/putProcess para ese flujo hasta implementar import/export reales.
- OP14 shell: Nuevo/Abrir ofrece Guardar/Descartar/Cancelar; si guardar falla/cancela no reemplaza. QA navegador real conserva versión tras Cancelar y guarda antes de crear. Cierre nativo permanece propiedad B.
- Comparación usa snapshots/revisiones y runMetaFrom E; problemas opcionales visibles/preservados; export default de C no interactivo, guardar/export explícitos interactivo:true, preflight antes de createProject. Todo integrado.

## P0 B/F antes de beta
1. writeProjectFolder e16ef9a: repro EISDIR con destino escenario como directorio modifica model.bpmn aunque el guardado falla. F aceptó diagnóstico y B corrige rollback/preflight en OP14. No declarar snapshot seguro todavía.
2. openProject cambia activeDir antes de que App acepte XML; rechazar B y guardar A jamás debe escribir A dentro de B. Mapa por id o error explícito protege; guard E-PROYECTO-DISTINTO anunciada por B.
3. toProjectDocument elimina problems de documento en 2cba842. El contrato YA admite problems? desde1f85b50; devolverlo dentro del documento para que App muestre advertencia, no solo lastProblems.
4. onSaveRequested no-op de OP08 elimina fallback beforeunload del shell: OP14 nativo debe quedar conectado antes de aceptación. App ya publica dirty síncrono tras save y devuelve false ante cambio concurrente.
5. Symlinks/senderFrame/navegación y conflictos externos: corrección anunciada B OP14, pendiente SHA listo.

## QA y siguiente paso
Vite propio PID45442 DETENIDO a 23:30, no servidor requerido por Electron. Fixtures temporales `/tmp/lila-qa-codex`. QA web propio: dos escenarios, Worker real, comparación -50%, guardado y edición/undo PASS; reapertura final debe probarse en desktop.
F: consumir último commit integrable de esta rama, integrar OP14 listo y devolver SHA a A. A hará checkpoint combinado final; F construye y prueba app empaquetada del MISMO SHA con Vite detenido y registra artefacto/recorrido. DMG de OP12 anterior es infraestructura, no la beta aceptada. OP16/extras pospuestos. Sin main/push/releases/npm/producción.

A preparó estado/OP-18-codex.md con recorrido vigente de proyecto NUEVO por carpeta y dos escenarios propios para F; evita el paso de importar BPMN suelto que no existe en la modalidad desktop actual. Sin nuevas modificaciones funcionales desde fc6f9a2.

## Revisión OP14 ab2578f — P0 concretos para B/F antes del incremento final
- **Nuevo proyecto sobre carpeta ocupada aún sobrescribe**: DesktopStore.createProject llama writeProject(dir,document) sin {saveAs:true}; primer saveProject sin activeDir también pasa saveAs:false aunque acaba de elegir carpeta. assertFolderNotOccupied solo corre con saveAs:true. Repro con documento original→nuevo sin opciones deja model.bpmn=NUEVO. Pasar modo de destino nuevo a createProject y primer guardado, además de Guardar como; test de carpeta ajena intacta.
- **Lectura model.bpmn (y manifest) sigue symlinks**: readProjectFolder lee modelo directo y readManifest también; la protección de B cubrió escenarios/runs. Repro model.bpmn symlink a archivo temporal externo devuelve MARCADOR_EXTERNO. Rechazar con E-SYMLINK antes de leer modelo/manifiesto; verificar carpeta raíz real/autorizada si cambia durante sesión.
- Reproducciones aisladas: /var/folders/wg/5yq4g1gj52s21z2rh5szn9gm0000gn/T/lila-review-op14-gccPcx; sin modificar worktree de B. Métodos importados de B solo para estos datos temporales.
- problems sigue eliminado en toProjectDocument ab2578f: pendiente propagar campo ya admitido por contrato A.
- Guardado con rollback y conflictos externos aún pendientes incremento 2; no repetir QA final antes de resolverlos. Recientes/ventana extras detrás de estos P0.
