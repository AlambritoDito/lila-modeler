# OP18 — entrega de A a F
Dueño F para E2E/artefactos; A prepara recorrido del shell vigente. Base integrable fc6f9a2, codex/operativo-20260906.

## Recorrido propio que ya soporta el shell (pendiente aceptación empaquetada)
1. Abrir app final sin Vite; Nuevo proyecto → elegir carpeta temporal vacía con espacios/tilde. Se crea un modelo propio con IDs UUID y dos escenarios, sin cajero/horno ni IDs del ejemplo.
2. Documentación → Versión del proceso = beta-qa; Simulación permite seleccionar la tarea por su ID y Propiedades cambiar Nombre. Probar Deshacer/Rehacer y volver a Guardar proyecto.
3. En Simular/Simulación, AS-IS tiene duración constante 60 s para la tarea; TO-BE hereda AS-IS: editar su duración de tarea para sobrescribirla a 30 s (inicialmente hereda 60 s). Ambos existen desde Nuevo; se pueden editar run.replications (por ejemplo 30), seed=42. Guardar proyecto antes del cierre.
4. Cerrar/reabrir app → Abrir proyecto → MISMA carpeta. Verificar versión/nombre editados y escenarios antes de simular. La reapertura de app sola puede mostrar ejemplo hasta elegir carpeta si B no restaura proyecto.
5. Simular AS-IS y TO-BE con Worker real → Comparar (base AS-IS) → tiempo de ciclo TO-BE esperado menor; en el modelo secuencial nuevo, 60→30 da -50%. Resultados de cada escenario → CSV; verificar archivo real y valores, no solo clic.
6. Volver a guardar tras simular y reabrir para comprobar snapshots persistidos y comparación restaurada. Confirmaciones de cambios: cierre nativo de B; Nuevo/Abrir de A ofrecen Guardar/Descartar/Cancelar.

Abrir/Exportar BPMN SUELTO están ocultos en escritorio por limitación de métodos históricos B. NO planificar un clic inexistente: se abren carpetas con model.bpmn. Cualquier prueba de carpeta heredada sin manifiesto necesita que B preserve model.name=model.bpmn y que el proyecto sea validado por readProject/gate.

## Evidencia actual y reserva
Web real: creación propia, edición/undo, dos simulaciones/Comparar, guardado, modal Cancelar/Guardar y continuar PASS. Electron fuente f061c32: smoke sin Vite PASS. Esto NO sustituye el recorrido empaquetado de F.
Vite de A detenido; no modificar código funcional después del SHA con el que se construya artefacto final. Informar SHA exacto, ubicación .app/DMG y cada paso probado. No entregar el DMG antiguo de OP12 como beta final.

## Cierre de integración A (2026-09-07 07:06)
F entregó e2adccd, funcional89f82bd, DMG arm64 con1265 tests/1omitido y QA E2E por seam. B corrigió los P0 reportados. A consume entrega completa y comprueba equivalencia funcional con SHA del artefacto. Próximo: suite/tipos/build combinados, después recorrido nativo real por CUA incluyendo edición BPMN y diálogos, ya accesibles. No sustituir pruebas nativas por el seam ni declarar edición empaquetada probada antes de ejecutarla.
