# Guía para agentes

> Leer en: [English](../AGENT_GUIDE.md)

Esta guía es para un agente (Claude Code, Claude Desktop, Codex, Hermes Agent o cualquier cliente
MCP) que convierte lo que la gente cuenta de un proceso en un modelo, una simulación y un
documento, sin que nadie haga clic en la app. Cada paso es una tool MCP de `lila mcp`
([`MCP.md`](MCP.md), con el contrato completo de cada una) o el comando `lila` equivalente
([`CLI.md`](CLI.md)). Los pasos 2 a 7 de abajo, llamada por llamada,
corren en el CI sin interfaz: `packages/mcp/test/agent-flow.e2e.test.ts`, a partir de la entrevista
sintética `packages/mcp/test/fixtures/entrevista-tarjeta.txt`. El paso 8 necesita la app de
escritorio, así que se comprueba a mano con `tools/agent-live-check.mjs`.

Cómo registrar el servidor en cada cliente está en [`MCP.md`](MCP.md#instalación).

## El flujo

| Paso | Tool | CLI |
| --- | --- | --- |
| 1. Leer la entrevista, escribir un esquema | (el agente) | |
| 2. Crear el proceso | `create_process` | `lila process create` |
| 3. Corregirlo | `edit_process`, `get_process_outline` | `lila process edit`, `lila process show` |
| 4. Documentarlo (opcional) | `annotate_element`, `get_raci_matrix` | `lila process annotate`, `lila process raci` |
| 5. Llenar el escenario | `patch_scenario`, o `export_scenario_template` + `import_scenario_sheet` | `lila scenario template`, `lila scenario import` |
| 6. Simular y guardar la corrida | `run_simulation` con `saveRun: true` | `lila run … --save` |
| 7. Entregar | `export_document`, `export_results`, `export_diagram` | `lila export doc|results|diagram` |
| 8. Mostrarlo | abrir el `.lila` en la app; se recarga con cada escritura posterior | `open -a "Lila Modeler" archivo.lila` (macOS) |

Dos reglas dan forma al flujo:

- **El esquema es el mapa; el escenario, los números.** En el esquema van los carriles, los pasos,
  el orden y las ramas. Tiempos, personal, llegadas y costos son datos del escenario: se pueden
  poner `duration`, `resources` y la `probability` de una rama en el esquema (van al escenario base
  `as-is.scenario.json`), pero todo lo demás pasa por `patch_scenario` o por una hoja.
- **Todo es el `.lila`.** El servidor no guarda estado. Cada tool lee el archivo, hace su trabajo y,
  si escribe, escribe el archivo completo de forma atómica. La app de escritorio que lo tiene
  abierto lo recarga sola.

### 1. De la entrevista al esquema

Lee la transcripción y anota: los roles que hacen el trabajo (carriles), cada cosa que alguien hace
(un paso, con verbo + objeto: «Validar documentos»), las decisiones (compuertas `xor`, con las
proporciones que da la gente: «una de cada siete» es `0.15`), las esperas (`timer`) y cómo termina
cada camino. Usa las palabras de quien habla para los nombres: quien lea el documento las va a
buscar.

Pregunta antes de suponer. Un proceso que la persona no reconoce es peor que una pregunta.

### 2. `create_process`

```json
{ "name": "create_process", "arguments": { "project": "tarjeta.lila", "outline": { … } } }
```

Un `project` que no existe se crea como un `.lila` de un proceso; uno que existe recibe un proceso
nuevo (nunca reemplaza uno: elige otro slug en `process`). La respuesta trae el esquema en forma
normal, el `slug`, `warnings` y `notes`. Lee `notes`: avisan de modelos que dejarían casos
atorados, como una unión paralela que espera ramas de una misma división exclusiva.

`dryRun: true` revisa y devuelve todo sin escribir.

### 3. `edit_process` y `get_process_outline`

Para cambiar un proceso no lo crees otra vez: `edit_process` aplica una lista de operaciones
(`add`, `connect`, `remove`, `rename`, `setType`, `moveToLane`, `addLane`) todas o ninguna, conserva
cada id y todo lo que las operaciones no tocan (documentación, RACI, atributos, otros procesos).
Mándala primero con `dryRun: true` y muéstrale los `changes` a la persona cuando la edición no sea
trivial.

```json
{ "name": "edit_process", "arguments": { "project": "tarjeta.lila", "dryRun": true, "operations": [
  { "op": "add", "step": { "id": "verificar", "name": "Verificar identidad", "duration": "5m" }, "after": "recibir" },
  { "op": "rename", "id": "emitir", "name": "Emitir la tarjeta" } ] } }
```

**Después de cualquier edición el proceso sigue simulando.** Las entradas de escenario que ya no
aplican se quitan de todos los escenarios del proceso (la entrada completa de un elemento borrado, o
los campos que un elemento con otro tipo no admite, como recursos en una compuerta), y cada una se
reporta en `scenarioRemovals` como `{ scenario, id, removed, entry }` con los valores anteriores,
para que puedas ponerlos en otro lado con `patch_scenario`. Un dry run devuelve el mismo reporte.
Después se valida cada escenario contra el modelo editado; un error que antes no tenía rechaza la
edición. `notes` además nombra los flujos a corregir cuando las probabilidades de una XOR ya no suman 1.

`get_process_outline` lee cualquier proceso como esquema, también uno dibujado en la app o
importado de Bizagi; `warnings` dice lo que un esquema no puede llevar.

### 4. Anotaciones y RACI

`annotate_element` escribe la descripción, la lista RACI, las referencias de catálogo y los
atributos extendidos de un elemento, por su id BPMN. `get_raci_matrix` devuelve la matriz que
imprimirá el documento. Las dos son opcionales; el documento sale mejor con ellas.

### 5. El escenario

El escenario base `as-is.scenario.json` empieza con los valores por defecto de la app (20 casos,
uno por minuto, una corrida de una hora) más lo que traía el esquema. Completa el resto con un solo
`patch_scenario` (JSON Patch, validado antes de escribir nada):

```json
{ "name": "patch_scenario", "arguments": { "project": "tarjeta.lila", "scenario": "as-is", "patch": [
  { "op": "replace", "path": "/run/duration", "value": 28800 },
  { "op": "remove", "path": "/elements/StartEvent/triggerCount" },
  { "op": "replace", "path": "/elements/StartEvent/interTriggerTimer", "value": { "type": "exponential", "mean": 900 } },
  { "op": "replace", "path": "/resources/ejecutivo/capacity", "value": 3 },
  { "op": "replace", "path": "/resources/analista/capacity", "value": 2 },
  { "op": "add", "path": "/elements/emitir/processingTime", "value": { "type": "constant", "value": 600 } } ] } }
```

Los tiempos del escenario van en segundos; el formato está en
[`SCENARIO_FORMAT.md`](SCENARIO_FORMAT.md). La clave de un recurso es el slug de su nombre
(`Mesa de control` → `mesa-de-control`). Un `add` de JSON Patch necesita a su padre: si el esquema
no traía `resources`, el escenario aún no tiene `/resources`, así que se agrega completo
(`{ "op": "add", "path": "/resources", "value": { "ejecutivo": { "name": "Ejecutivo", "capacity": 3 } } }`).
Para un TO-BE, pasa `saveTo: "to-be-4-ejecutivas"`: el escenario nuevo hereda del original y solo
guarda las claves que cambian.

Cuando los números vienen de personas y no de una transcripción, dales una hoja:
`export_scenario_template` escribe el escenario como `.xlsx` ([`SCENARIO_SHEETS.md`](SCENARIO_SHEETS.md)),
la llenan, e `import_scenario_sheet` la aplica (primero con `dryRun: true`: `changes` lista cada campo
antes → después; `issues`, las filas que no pudo aplicar).

### 6. `run_simulation` con `saveRun`

```json
{ "name": "run_simulation", "arguments": { "model": "tarjeta.lila", "scenario": "as-is", "seed": 42, "replications": 10, "saveRun": true } }
```

La respuesta es el `RunResult` (`structuredContent`, [`RESULTS_FORMAT.md`](RESULTS_FORMAT.md)) más
un segundo bloque de texto `{ "savedRun": { "id", … } }`. La corrida queda guardada en el `.lila`
igual que la guarda la app, así que la app la muestra como la corrida vigente y las exportaciones
la usan. Usa una `seed` fija para que la persona pueda reproducir los números; usa
`compare_scenarios` para comparar AS-IS y TO-BE.

### 7. Exportaciones

- `export_document` escribe el documento del proceso como `docx` o `html`: proceso, carriles, pasos
  con su descripción y RACI, compuertas con sus probabilidades y los resultados de la corrida
  vigente. El HTML lleva el diagrama en SVG.
- `export_results` escribe las tablas de la corrida como `.xlsx` (o cuatro CSV).
- `export_diagram` devuelve o escribe el diagrama en SVG.

Ninguna sobrescribe un archivo sin `overwrite: true`, y ninguna escribe nunca sobre el proyecto.

### 8. Abrirlo en la app

Abre el `.lila` en Lila Modeler (doble clic, «Abrir», o `open -a "Lila Modeler" tarjeta.lila` en
macOS). A partir de ahí, cada escritura de un agente (`create_process`, `edit_process`,
`patch_scenario`, una corrida guardada…) aparece en la ventana abierta sin un clic: la app nota el
cambio en disco y recarga, conservando el modo, el proceso activo y los escenarios. Un proceso nuevo
aparece como una pestaña nueva. Si la persona tiene cambios sin guardar, la app no los tira: muestra
«El archivo cambió fuera de Lila» con **Recargar** y **Conservar los míos**.
`tools/agent-live-check.mjs` lo comprueba contra la app de escritorio real.

## El formato del esquema

```json
{
  "name": "Solicitud de tarjeta de crédito",
  "lanes": ["Ejecutivo de sucursal", "Analista de crédito", "Mesa de control"],
  "steps": [
    { "id": "recibir", "name": "Recibir solicitud", "lane": "Ejecutivo de sucursal",
      "duration": "triangular(5m, 10m, 20m)", "resources": ["Ejecutivo"] },
    { "id": "validar", "name": "Validar documentos", "duration": "normal(8m, 2m)", "resources": ["Ejecutivo"] },
    { "id": "completos", "type": "xor", "name": "¿Documentos completos?",
      "branches": [ { "label": "Sí", "to": "consultar" }, { "label": "No", "to": "faltantes", "probability": 0.15 } ] },
    { "id": "faltantes", "name": "Solicitar documentos faltantes", "duration": "5m", "next": "validar" },
    { "id": "consultar", "type": "serviceTask", "name": "Consultar buró de crédito", "lane": "Analista de crédito",
      "duration": "exponential(mean=3m)" },
    { "id": "evaluar", "name": "Evaluar capacidad de pago", "duration": "normal(25m, 8m)", "resources": ["Analista"] },
    { "id": "aprobada", "type": "xor", "name": "¿Aprobada?",
      "branches": [ { "label": "Sí", "to": "emitir" }, { "label": "No", "to": "rechazo", "probability": 0.35 } ] },
    { "id": "emitir", "name": "Emitir tarjeta", "lane": "Mesa de control", "resources": ["Mesa de control"], "end": true },
    { "id": "rechazo", "name": "Notificar rechazo", "lane": "Ejecutivo de sucursal", "end": true }
  ]
}
```

| Campo | Significado |
| --- | --- |
| `name` | El nombre del proceso (y el slug por defecto). |
| `lanes` | Los carriles en orden. Opcional: sin él, se toman de los pasos. |
| `steps[].id` | El id BPMN. Los escenarios usan ese id, así que elige ids cortos y estables. |
| `steps[].name` | La etiqueta. |
| `steps[].type` | `task` (por defecto), `userTask`, `serviceTask`, `callActivity`, `xor`, `and`, `or`, `timer`, `subprocess`. |
| `steps[].lane` | Por defecto, el carril del paso anterior. |
| `steps[].next` | El paso o los pasos que siguen cuando no es simplemente el siguiente de la lista (un regreso, una unión). |
| `steps[].branches` | Solo compuertas: `{ label?, to, probability? }` o `{ label?, end: true, probability? }`. Las ramas XOR sin probabilidad se reparten lo que falta para 1. |
| `steps[].end` | Este paso termina el proceso (se agrega un evento de fin después). |
| `steps[].duration` | Segundos, `20m`, `1h30m`, `normal(20m, 5m)`, `triangular(1m, 2m, 5m)`, `exponential(mean=4m)`, o un objeto de distribución en segundos. |
| `steps[].resources` | Nombres, o `{ name, quantity }`. Con varios, `selection: "or"` toma cualquiera de ellos. |

El orden de la lista es el flujo. Los eventos de inicio y fin se agregan solos; ids como
`StartEvent`, `EndEvent_<paso>` y `Flow_<de>_<a>` son de Lila. `get_process_outline` devuelve el
mismo formato en forma normal (cada carril nombrado, duraciones como objetos, probabilidades
completas), así que un esquema va y vuelve igual. Las reglas completas están en
[`MCP.md`](MCP.md#crear-un-proceso-desde-un-esquema).

## Cuando una llamada falla

- **Todos los problemas a la vez, cada uno con su ruta, en una sola pasada.** Una llamada mala
  responde `isError: true` con todos sus problemas juntos — de forma y de fondo, en el idioma de la
  llamada — cada uno con dónde está. Un esquema: `steps[2].branches[0].to: …`, `steps[0].duraton:
  …`. Una edición nombra su operación: `operations[2].after: …`, `operations[3].nombre: …`, y un
  modelo que la edición rompería responde con el código del validador:
  `operations[0].bpmn.Process_1: E-SIN-START: …`. Corrige todas esas entradas y vuelve a llamar una
  vez; no se escribió nada.
- **`dryRun` antes de escribir** cuando una persona deba ver el cambio primero: `create_process`,
  `edit_process`, `annotate_element` e `import_scenario_sheet` lo aceptan, revisan todo y no
  escriben nada.
- **Validar no es un error de la tool.** `validate_bpmn` responde `isError: false` con un reporte
  cuyo `errors[]` puede venir lleno; léelo.
- **Idioma.** Los mensajes siguen `lila mcp --lang es` (o `LILA_LANG`), o `locale` en cada llamada.
  Los códigos (`E-…`), los ids y las claves JSON no cambian.

## Más de un escritor

Agentes, la CLI y la app de escritorio pueden trabajar sobre el mismo `.lila`:

- **Escrituras atómicas.** Cada escritura va a un archivo temporal que reemplaza al `.lila` con un
  rename. Nadie lee medio archivo.
- **Un candado.** Los escritores se turnan con `<archivo>.lila.lock` junto al archivo. Si otro lo
  tiene más de 3 segundos, la llamada falla con `E-ARCHIVO-OCUPADO` («otro programa está guardando
  … ahora mismo; no se escribió nada. Vuelve a intentarlo en un momento.»). Un candado sin tocar por 10 segundos se toma como restos de un fallo y
  se borra.
- **Cambió en disco.** Si el archivo cambió entre la lectura y la escritura de la tool, no se
  escribe nada y la llamada falla («… cambió en disco mientras esta llamada trabajaba con él; no se
  escribió nada. Vuelve a intentarlo.»). Vuelve a llamarla: lee el archivo nuevo. La corrida guardada es
  la excepción: se agrega a lo que haya, salvo que el modelo o el escenario con que corrió hayan
  cambiado (entonces ya está vencida y no se guarda).
- **La app.** Recarga después de tus escrituras. Si la persona tiene ediciones sin guardar, primero
  pregunta: Recargar o Conservar los míos. Tras Conservar los míos, guardar se niega con
  `E-CAMBIO-EXTERNO` («… cambió fuera de Lila desde que se abrió, así que no se guardó nada…»), así
  que tu trabajo no se pisa; ella recarga, o usa «Guardar como» para conservar su versión en otro
  archivo.

Haz una escritura a la vez por archivo y espera su respuesta; escribir en paralelo sobre el mismo
`.lila` no gana nada.

## Límites conocidos

- **El documento Word va sin diagrama**, y ninguno de los dos documentos lleva las gráficas de la
  corrida: Word necesita un PNG y el motor no rasteriza. El documento HTML sí lleva el diagrama
  (SVG). `notes` en la respuesta dice qué quedó fuera. Para dar una imagen, manda el HTML o usa
  `export_diagram`.
- **Acomodo.** `create_process` y `edit_process` (por defecto) acomodan el proceso con
  `bpmn-auto-layout` 1.3 más el ajuste de carriles de Lila. Se lee bien, pero no es bonito: los
  carriles pueden quedar más altos de lo necesario, el nombre de una compuerta puede caer sobre un
  flujo que sale por abajo, los cruces no se desenredan y un subproceso se crea colapsado.
  `edit_process` con `layout: true` reemplaza las posiciones puestas a mano en ese proceso;
  `layout: false` las conserva y coloca los pasos nuevos de forma simple. Mueve las cosas en la app
  cuando el dibujo importe.
- **Las ediciones** solo alcanzan el proceso principal de un BPMN (el que lee el simulador), y no se
  pueden borrar carriles.
- **Del esquema al escenario** solo pasan `duration`, `resources` y la `probability` de las ramas.
  Llegadas, calendarios, costos y capacidades van por `patch_scenario` o por una hoja.
- **La simulación es síncrona** en el servidor: una corrida larga lo bloquea hasta terminar. Usa
  pocas réplicas mientras iteras.
- **Instalación.** `npx -y @lila-modeler/engine mcp` todavía no funciona: el motor publicado no trae
  el servidor MCP, que vive en `@lila-modeler/mcp`, sin publicar. Corre el servidor desde un clon
  del repo ([`MCP.md`](MCP.md#instalación)).
