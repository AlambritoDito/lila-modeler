# OP14 guardia de reemplazo A
Dueño A en codex/operativo-20260906; B conserva cierre nativo y persistencia. Archivos App.tsx, App.test.tsx, app.css.
Objetivo P0 breve: reemplazar confirmación binaria de nuevo/abrir por Guardar/Descartar/Cancelar. Guardado fallido/cancelado detiene reemplazo y conserva dirty. Diálogo nativo HTML modal con foco y Escape.
Próximo: implementar guardia, tests cancelación/fallo/guardar antes de abrir; tipos web. Sin tomar archivos de B.

VERIFICADO: 17 tests de App y tipos web PASS. Nuevos casos: cancelar reemplazo; guardar cancelado/fallido conserva proyecto y dirty; guardar antes de crear; descartar sin guardar. QA navegador real: versión beta-dialogo conservada tras Cancelar, Guardar y continuar crea proyecto limpio, consola sin errores. Cierre nativo permanece propiedad de B.
