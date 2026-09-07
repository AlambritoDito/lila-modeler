# Contrato operativo v1 — A/B/C/E/F

Publicado por A. Fuente de tipos: apps/web/src/store/ProjectStore.ts. Se mantiene la API histórica; el recorrido de proyecto usa ProjectSessionStore, extensión de ProjectStore. B implementa DesktopStore; A implementa BrowserStore y shell. main.tsx es el único bootstrap de adaptadores; App recibe store por props y no monta root.

## Documento y persistencia
ProjectDocument v1 contiene id opaco del proyecto, nombre, model {id lógico BPMN, name, xml, revision}, scenarios por nombre de archivo relativo (incluye .scenario.json), scenarioRevisions y runs con snapshot de XML/escenario resuelto y revisiones. Los escenarios crudos son Record<string, unknown>: guardar borradores no afirma validez. ResolveExtends y validadores del motor son la única puerta a simular. Los paths físicos quedan en B.

ProjectSessionStore: createProject(document), openProject(), saveProject(document, {saveAs?}); devuelven ProjectDocument o null (cancelación). Error rechaza Promise. No marcar limpio ni sustituir proyecto ante null/error. createProject es una operación de selección/escritura de carpeta en DesktopStore; BrowserStore conserva sesión hasta descarga explícita. openProject devuelve el snapshot completo. saveProject escribe un snapshot coherente y solo confirma al terminar; B debe evitar reemplazar archivos válidos parcialmente. Guardar como cancela sin cambiar ubicación activa.

setDirty?(dirty) informa al adaptador. onSaveRequested?(callback) permite al puente solicitar guardado antes de cerrar; callback Promise<boolean> devuelve true únicamente si guardó. B muestra confirmación nativa guardar/descartar/cancelar y espera al renderer para guardar. Sin confirmación exitosa no cierra. No fs ni IPC genérico desde App.

## Identidad y revisiones
Proyecto id opaco != model.id BPMN (ir.id). Model revision aumenta en commandStack.changed, incluso cambios de layout para dirty; importar satisfactoriamente establece una nueva identidad/snapshot. Scenario revision aumenta al editar/duplicar. Dirty se compara con el snapshot confirmado y se conserva si llegan cambios durante guardar. Resultados almacenan inputs {modelRevision, scenarioRevision, xml, scenario}; también scenarioName. Un cambio invalida resultados afectados (incluidos hijos extends), aborta Worker y evita aceptar respuestas tardías. Comparar requiere mismo modelo/revisión, escenarios actuales y monedas compatibles. Nunca alterar RunResult del motor para meter estado de UI.

## Puente B
window.lila expone únicamente métodos tipados equivalentes al ProjectSessionStore a través de preload/contextBridge. nodeIntegration:false, contextIsolation:true, sandbox:true. Main valida formas de mensajes y rutas relativas; nombres/ids del documento no conceden lectura fuera de la carpeta seleccionada. B puede definir canales privados y su archivo de tipos; A solo importa DesktopStore desde main.tsx cuando esté listo. No escribir main/App en B: entregar cambio de bootstrap a A.

## Modelador C
Conservar abrir(xml):Promise<boolean>, exportar():Promise<string>, ajustar(), servicios, suscribir(eventos, callback), cuellos(), seleccionar(id) existentes. abrir es transaccional: fallo conserva XML/ids anteriores. OP-09 usa sanitizeXmlIds compartido y mapa reversible por instancia; exportación preserva ids originales y referencias. suscribir(['commandStack.changed'], cb) informa ediciones y suscribir(['selection.changed'], cb) actualiza selección por servicios.selection. Para nuevo documento A genera BPMN mínimo válido y llama abrir; no hace falta otra API. onListo debe publicarse con XML inicial ya importado para no exportar lienzo vacío.

Decisión: snapshot de proyecto versionado evita coordinar escrituras sueltas desde App y permite probar reabrir sin Electron. Prueba pendiente: contrato implementado por adaptadores y aceptación sobre app empaquetada del mismo SHA. Este documento no anuncia beta lista.
