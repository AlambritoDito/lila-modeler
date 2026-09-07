# OP14 guardia de reemplazo A
Dueño A en codex/operativo-20260906; B conserva cierre nativo y persistencia. Archivos App.tsx, App.test.tsx, app.css.
Objetivo P0 breve: reemplazar confirmación binaria de nuevo/abrir por Guardar/Descartar/Cancelar. Guardado fallido/cancelado detiene reemplazo y conserva dirty. Diálogo nativo HTML modal con foco y Escape.
Próximo: implementar guardia, tests cancelación/fallo/guardar antes de abrir; tipos web. Sin tomar archivos de B.
