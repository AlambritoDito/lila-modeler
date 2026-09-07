# OP13 Codex A
Dueño A, codex/operativo-20260906, base 189f881.
Archivos: App, project.ts, BrowserStore y sus tests, bootstrap/CSS.
Objetivo: nuevo/abrir/guardar proyectos propios, dos escenarios y comparación con snapshots/revisiones. B mantiene DesktopStore y Electron.
Próximo comando: implementar documento inicial y persistencia BrowserStore, luego conectar App.
Estado activo, no verificado.

Incremento dirigido VERIFICADO: 24 tests App/proyecto/BrowserStore y typecheck web PASS. Recorrido lógico real crea BPMN con DI/ids únicos, genera ASIS/TOBE, valida/simula ambos, serializa snapshot, reabre y reproduce RunResult. App protege dirty ante guardar cancelado y edición concurrente, separa id de proyecto del IR, invalida escenarios dependientes y usa CompareView.
BrowserStore descarga .lila.json completo al crear/guardar. DesktopStore pendiente B; bootstrap se conectará al SHA listo. App mantiene cancelación/error visibles y navegación sin desmontar editor.
Pendiente aceptación en navegador/app real; importar escenarios individuales y refinamientos OP13 no cerrados. Guardar requiere snapshot estructural válido, escenarios crudos admiten borradores. Sin fiabilidad de métricas P0 anunciada antes OP10.
Próximo: integrar OP09/B/E y ejecutar checkpoint completo cuando E corrija capacity.
