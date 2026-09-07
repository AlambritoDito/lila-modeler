# OP14 guardia de reemplazo A
Dueño A en codex/operativo-20260906; B conserva cierre nativo y persistencia. Archivos App.tsx, App.test.tsx, app.css.
Objetivo P0 breve: reemplazar confirmación binaria de nuevo/abrir por Guardar/Descartar/Cancelar. Guardado fallido/cancelado detiene reemplazo y conserva dirty. Diálogo nativo HTML modal con foco y Escape.
Próximo: implementar guardia, tests cancelación/fallo/guardar antes de abrir; tipos web. Sin tomar archivos de B.

VERIFICADO: 17 tests de App y tipos web PASS. Nuevos casos: cancelar reemplazo; guardar cancelado/fallido conserva proyecto y dirty; guardar antes de crear; descartar sin guardar. QA navegador real: versión beta-dialogo conservada tras Cancelar, Guardar y continuar crea proyecto limpio, consola sin errores. Cierre nativo permanece propiedad de B.

P0 breve adicional, antes de editar: impedir interacción con lienzo/panel/undo mientras IO está en curso. La importación transaccional de Modeler es asíncrona: una edición después de la última comprobación de App y antes del intercambio de modeladores podría perderse. inert en zonas de edición y botones undo/redo deshabilitados cierran esa ventana; se conservan además los guards de revisión existentes. Próximo: prueba de estado de controles en apertura pendiente y tipos.

VERIFICADO: 18 tests App y tipos web PASS. Interacción bloqueada durante IO y restaurada al cancelar.

Revisión ab2578f B: cierre nativo/IPC en incremento 1 verificados por B, aún no consumidos por A esperando cierre P0 de IO. Repro Nuevo sin saveAs sobrescribe carpeta; readProjectFolder sigue symlink de model.bpmn. Detalle y rutas en equipo-codex. No se editan módulos de B.
