# OP08 integración Codex A
Dueño A, rama codex/operativo-20260906, base 2e8990d. B conserva DesktopStore, puente y persistencia.
Objetivo: consumir entrega verificada f0d2095 (implementación 2cba842) y seleccionar DesktopStore en main.tsx. No es aceptación beta: fallos P0 de guardado/cierre pendientes B/F.
Archivos A: main.tsx y reportes. Próximo comando: merge entrega B, bootstrap, tests store y tipos web/desktop.

Bootstrap VERIFICADO: 63 tests App/store, tipos web y desktop PASS. main.tsx elige DesktopStore si window.lila existe. App recibe bpmnFilesEnabled=false en escritorio: el adaptador histórico no importa/exporta un BPMN suelto; se evita escribir el snapshot equivocado. Crear/abrir/guardar/guardar como carpeta siguen disponibles. B/F conservan la corrección de IO y OP14. No se afirma beta lista.
Próximo: consumir OP11 740fc76 listo y comprobar tests del panel tras el cambio de input dedicado para capacidad.
