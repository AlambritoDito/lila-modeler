# Guía para agentes

> Leer en: [English](../AGENT_GUIDE.md)

Esta guía es para un agente (Claude Code, Claude Desktop, Codex, Hermes Agent o cualquier cliente
MCP) que convierte lo que la gente cuenta de un proceso en un modelo, una simulación y un
documento, sin que nadie haga clic en la app. Cada paso es una tool MCP del servidor MCP de Lila
([`MCP.md`](MCP.md), con el contrato completo de cada una) o el comando `lila` equivalente
([`CLI.md`](CLI.md)). Los pasos 2 a 7 de abajo, llamada por llamada,
corren en el CI sin interfaz: `packages/mcp/test/agent-flow.e2e.test.ts`, a partir de la entrevista
sintética `packages/mcp/test/fixtures/entrevista-tarjeta.txt`. El paso 8 necesita la app de
escritorio, así que se comprueba a mano con `tools/agent-live-check.mjs`.

El servidor es su propio paquete de npm y se arranca con `npx -y @lila-modeler/mcp`; cómo
registrarlo en cada cliente está en [`MCP.md`](MCP.md#instalación). Un cliente que solo tiene MCP lee
esta guía como el recurso `lila://guide` (los formatos son `lila://outline-format`,
`lila://scenario-format` y `lila://scenario-schema`), y el prompt `interview-to-process` arranca el
flujo de abajo con una entrevista ([`MCP.md`](MCP.md#recursos-y-prompt)).

## El flujo

| Paso | Tool | CLI |
| --- | --- | --- |
| 0. El archivo ya existe: leer lo que tiene, o traer un BPMN | `get_project`, `get_scenario`, `put_process_bpmn`, `get_process_bpmn` | `lila project show`, `lila scenario show`, `lila process import`, `lila process export-bpmn` |
| 1. Leer la entrevista, escribir un esquema | (el agente) | |
| 2. Crear el proceso | `create_process` | `lila process create` |
| 3. Corregirlo | `edit_process`, `get_process_outline` | `lila process edit`, `lila process show` |
| 4. Documentarlo (opcional) | `annotate_element`, `get_raci_matrix` | `lila process annotate`, `lila process raci` |
| 5. Llenar el escenario | `patch_scenario`, o `export_scenario_template` + `import_scenario_sheet` | `lila scenario template`, `lila scenario import` |
| 6. Simular y guardar la corrida | `run_simulation` con `saveRun: true` | `lila run … --save` |
| 7. Entregar | `export_document`, `export_results`, `export_diagram` | `lila export doc|results|diagram` |
| 8. Mostrarlo | abrir el `.lila` en la app; se recarga con cada escritura posterior | `open -a "Lila Modeler" archivo.lila` (macOS) |
| En cualquier momento: ordenar | `rename_process`, `delete_process`, `rename_scenario`, `delete_scenario` | `lila process rename|delete`, `lila scenario rename|delete` |

Dos reglas dan forma al flujo:

- **El esquema es el mapa; el escenario, los números.** En el esquema van los carriles, los pasos,
  el orden y las ramas. Tiempos, personal, llegadas y costos son datos del escenario: se pueden
  poner `duration`, `resources` y la `probability` de una rama en el esquema (van al escenario base
  `as-is.scenario.json`), pero todo lo demás pasa por `patch_scenario` o por una hoja.
- **Todo es el `.lila`.** El servidor no guarda estado. Cada tool lee el archivo, hace su trabajo y,
  si escribe, escribe el archivo completo de forma atómica. La app de escritorio que lo tiene
  abierto lo recarga sola.

### 0. Un `.lila` que ya existe: `get_project`

Cuando el `.lila` ya existe, empieza aquí, no por la entrevista:

```json
{ "name": "get_project", "arguments": { "project": "tarjeta.lila" } }
```

Lista los procesos (su `slug` es lo que recibe `process` cuando hay varios), los escenarios de cada
uno con su revisión y su `extends`, y las corridas guardadas, vigentes (`current`) u obsoletas. No
escribe nada. `get_scenario` lee un escenario, como está guardado o con `resolved: true`, con las
`notes` del validador; lee un escenario con ella antes de parchearlo, nunca con un `patch_scenario`
de solo `test`. Después sigue el paso de abajo que la persona pidió: un proceso nuevo (paso 2), una
corrección (paso 3), números nuevos (paso 5) o una corrida nueva (paso 6).

Cuando la persona trae un BPMN dibujado en otro lado (una exportación de Bizagi, por ejemplo), no lo
rehagas como esquema: añádelo como otro proceso del `.lila` con `put_process_bpmn` y `mode: "add"`.
Recibe un escenario base con llegadas y tiempos de tarea por defecto, que llenas en el paso 5 antes
de correr. Un diagrama que el simulador no puede correr (eventos de mensaje, colaboraciones) se
guarda para documentar con `allowUnsimulatable: true`, con sus errores en `notes`.
`get_process_bpmn` entrega el XML de un proceso, y `mode: "replace"` lo recibe de vuelta (ver
[El BPMN de un proceso](MCP.md#el-bpmn-de-un-proceso)).

```json
{ "name": "put_process_bpmn", "arguments": { "project": "tarjeta.lila", "mode": "add", "bpmn": "exportacion-bizagi.bpmn", "name": "Aclaración de cargo", "locale": "es" } }
```

Para ordenar el archivo, `rename_process` y `rename_scenario` cambian un nombre (nunca un slug ni
un nombre de archivo), y `delete_process` y `delete_scenario` quitan un proceso o un escenario con
sus corridas guardadas. Los borrados rechazan, sin escribir nada, lo que rompería el proyecto: el
último proceso o escenario, un proceso al que llama otro, un escenario del que heredan otros.
Pruébalos antes con `dryRun: true` (ver [Renombrar y borrar](MCP.md#renombrar-y-borrar)).

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
(`add`, `connect`, `remove`, `rename`, `setType`, `moveToLane`, `addLane`, `removeLane`, `moveLane`, `addBoundary`,
`annotate`, `addDataObject`…) todas o ninguna, conserva
cada id y todo lo que las operaciones no tocan (documentación, RACI, atributos, otros procesos).
Mándala primero con `dryRun: true` y muéstrale los `changes` a la persona cuando la edición no sea
trivial.

```json
{ "name": "edit_process", "arguments": { "project": "tarjeta.lila", "dryRun": true, "operations": [
  { "op": "add", "step": { "id": "verificar", "name": "Verificar identidad", "duration": "5m" }, "after": "recibir" },
  { "op": "rename", "id": "emitir", "name": "Emitir la tarjeta" },
  { "op": "addBoundary", "on": "consultar", "boundary": { "id": "buroCaido", "type": "timer", "duration": "30m",
    "label": "Sin respuesta en 30 min", "to": "evaluar" } } ] } }
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

Un atributo extendido (un SLA, un nivel de riesgo…) tiene que estar definido antes de que un
elemento tenga un valor para él. `define_attribute` lo define una vez por tipo de elemento, con las
reglas del diálogo de la app, y `get_project` lista los que define cada proceso:

```json
{ "name": "define_attribute", "arguments": { "project": "tarjeta.lila", "name": "Nivel de riesgo", "type": "list",
  "appliesTo": "task", "options": ["Bajo", "Medio", "Alto"] } }
```

Luego `annotate_element` lo rellena por nombre, `"attributes": { "Nivel de riesgo": "Alto" }`, y
el documento del proceso lo imprime bajo el elemento. Repetir `define_attribute` con la misma
definición no cambia nada; cambiarle el tipo o quitarle opciones quita los valores que ya no
encajan, y `removedValues` dice cuáles.

### 5. El escenario

El escenario base `as-is.scenario.json` empieza con los valores por defecto de la app (20 casos,
uno por minuto, una corrida de una hora) más lo que traía el esquema (`get_scenario` con
`resolved: true` lo muestra, con las rutas que usa un patch). Completa el resto con un solo
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

La respuesta es un resumen de la corrida, de pocos KB: `process`, `bottlenecks`, la utilización, la
espera y el costo de cada recurso, los elementos que más esperan (`topWaits`) y los avisos
agrupados; `detail: "full"` devuelve el `RunResult` completo ([`RESULTS_FORMAT.md`](RESULTS_FORMAT.md)),
que es grande. Un segundo bloque de texto dice `{ "savedRun": { "id", … } }`. La corrida queda
guardada completa en el `.lila`, igual que la guarda la app, así que la app la muestra como la
corrida vigente y las exportaciones la usan. Usa una `seed` fija para que la persona pueda
reproducir los números; usa `compare_scenarios` para comparar AS-IS y TO-BE (su resumen conserva las
filas del proceso y de los recursos y las diferencias significativas). Una corrida larga informa su
progreso por replicación y se puede cancelar.

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
| `starts` | Eventos de inicio opcionales: `{ id, name?, type?, lane? }`, `type` `none` (por defecto) o `timer`. Sin él, un inicio simple (`StartEvent`) lleva al primer paso. Con él, los ids de los inicios los pones tú (las llegadas del escenario usan esos ids), los pasos nombran el suyo con `from`, y cada inicio está en el `from` de exactamente un paso: para bifurcar, pon una compuerta después. `lane` sigue la regla de `steps[].lane` y por defecto es el carril de su paso. Cada inicio recibe las llegadas por defecto, así que dos inicios traen dos flujos de casos. Un inicio `timer` es notación: sus casos llegan por las llegadas del escenario en ese inicio, igual que en uno simple, no por un calendario del temporizador. |
| `steps[].id` | El id BPMN. Los escenarios usan ese id, así que elige ids cortos y estables. |
| `steps[].name` | La etiqueta. |
| `steps[].type` | `task` (por defecto), `userTask`, `serviceTask`, `sendTask`, `receiveTask`, `manualTask`, `scriptTask`, `businessRuleTask`, `callActivity`, `xor`, `and`, `or`, `eventGateway`, `timer`, `message`, `subprocess`. Las variantes de tarea simulan como `task`; el documento y el diagrama muestran lo que son. `message` (la espera de un mensaje) solo va después de un `eventGateway`, como una de sus ramas. |
| `steps[].lane` | Por defecto, el carril del paso anterior. |
| `steps[].from` | Con `starts`: el id o los ids de los inicios que llevan a este paso. Solo vale si viene `starts`; solo ids de inicio. |
| `steps[].next` | El paso o los pasos que siguen cuando no es simplemente el siguiente de la lista (un regreso, una unión). |
| `steps[].branches` | Solo compuertas: `{ label?, to, probability?, default? }` o `{ label?, end: true \| "terminate", probability?, default? }`. Las ramas XOR sin probabilidad se reparten lo que falta para 1. `default: true` marca el flujo por defecto de un `xor` o un `or`, uno por compuerta: en un `xor` no cambia el reparto (lo que falta para 1 sigue yendo a las ramas sin probabilidad); en un `or` es la salida de respaldo cuando no se toma ninguna otra. Toda salida de un `eventGateway` (sus ramas, `next` o el paso siguiente) va a un paso `timer` o `message` cuya única entrada es esa compuerta: ni el paso anterior de la lista, ni otro `next`, `to` o `from`, ni un evento de borde. Sus ramas no llevan `probability`, `default` ni `end`. Gana el primer evento que ocurre; una rama sin `duration` nunca se dispara, y si ninguna la tiene, los casos se quedan en la compuerta. |
| `steps[].end` | `true`: este paso termina el proceso (se agrega un evento de fin después). `"terminate"`: un evento de fin de terminación, que termina el caso entero, con todos sus caminos en paralelo. |
| `steps[].duration` | Segundos, `20m`, `1h30m`, `normal(20m, 5m)`, `triangular(1m, 2m, 5m)`, `exponential(mean=4m)`, o un objeto de distribución en segundos. En una tarea, su tiempo de proceso; en un `timer` o un `message`, cuánto falta para que ocurra. |
| `steps[].resources` | Nombres, o `{ name, quantity }`. Con varios, `selection: "or"` toma cualquiera de ellos. |
| `steps[].boundary` | Tareas (cualquier variante) y actividades de llamada, no subprocesos: plazos sobre el paso, `{ id, type: "timer", name?, label?, duration?, interrupting?, to \| end }`. `interrupting` (por defecto `true`) corta el paso; `false` lo deja corriendo y abre un camino en paralelo. `to` es el paso al que lleva el borde; `end` (`true` o `"terminate"`) termina ese camino con un evento de fin `EndEvent_<id del borde>`. `label` nombra el flujo que sale de él. La `duration` cuenta desde que el caso llega al paso, incluida la espera por recursos; sin ella el borde nunca se dispara. |
| `steps[].notes` | Anotaciones de texto que cuelgan del paso, en orden; cada texto una vez por paso. |
| `steps[].data` | Solo actividades (tareas, actividades de llamada, subprocesos): objetos de datos que el paso lee (`direction: "in"`) o escribe (`"out"`), `{ name, direction }`, cada nombre y dirección una vez por paso. Los pasos que nombran el mismo objeto lo comparten. |

El orden de la lista es el flujo. Los eventos de fin se agregan solos, y también el de inicio salvo
que venga `starts` (entonces los ids de los inicios son tuyos). Inicios, pasos y eventos de borde
comparten un solo conjunto de ids, y `next` y `to` solo nombran pasos. Ids como `StartEvent`,
`EndEvent_<paso>`, `EndEvent_<borde>` (el fin al que lleva un borde con `end`) y `Flow_<de>_<a>` son
de Lila. `get_process_outline` devuelve el mismo formato en forma normal (cada carril nombrado,
duraciones como objetos, probabilidades completas), así que un esquema va y vuelve igual. Las
reglas completas están en [`MCP.md`](MCP.md#crear-un-proceso-desde-un-esquema).

### Ejemplo: escalar a las 48 horas

«Si el ajustador no ha decidido en 48 horas, el siniestro pasa a un supervisor; el ajustador sigue
trabajando en él. Después le pedimos al cliente que confirme, y si no contesta en cinco días el
siniestro se cierra.» Un plazo sobre una tarea es un temporizador de borde (`boundary`):
`interrupting: false` porque el ajustador sigue trabajando mientras el supervisor lo revisa (`true`,
el valor por defecto, le quitaría el siniestro al ajustador). «La respuesta o cinco días, lo que
pase primero» es un `eventGateway` cuyas ramas son un paso `message` y un paso `timer`; el camino del
temporizador termina con `"terminate"`, que cierra el caso entero, camino de la escalación
incluido. Es `examples/outline/claim-escalation.json` (en inglés, como todos los ejemplos del repo):

```json
{ "name": "Claim handling",
  "lanes": ["Customer service", "Adjuster", "Supervisor"],
  "steps": [
    { "id": "register", "name": "Register claim", "lane": "Customer service", "duration": "10m", "resources": ["Clerk"] },
    { "id": "assess", "name": "Assess claim", "type": "userTask", "lane": "Adjuster",
      "duration": "triangular(4h, 24h, 72h)", "resources": ["Adjuster"],
      "boundary": [ { "id": "sla", "type": "timer", "name": "48 h", "duration": "48h", "interrupting": false,
                      "label": "No decision in 48 h", "to": "escalate" } ] },
    { "id": "covered", "type": "xor", "name": "Covered?",
      "branches": [ { "label": "Yes", "to": "confirm", "probability": 0.8, "default": true },
                    { "label": "No", "to": "reject" } ] },
    { "id": "confirm", "name": "Ask the customer to confirm", "type": "sendTask", "lane": "Customer service", "duration": "5m" },
    { "id": "reply", "type": "eventGateway", "name": "Customer replies?",
      "branches": [ { "to": "confirmed" }, { "to": "deadline" } ] },
    { "id": "confirmed", "type": "message", "name": "Confirmation received", "duration": "exponential(mean=2d)" },
    { "id": "pay", "name": "Pay claim", "type": "serviceTask", "lane": "Adjuster", "duration": "1m", "end": true },
    { "id": "deadline", "type": "timer", "name": "5 days", "lane": "Customer service", "duration": "5d", "end": "terminate" },
    { "id": "reject", "name": "Notify rejection", "type": "sendTask", "lane": "Customer service", "duration": "5m", "end": true },
    { "id": "escalate", "name": "Escalate to supervisor", "lane": "Supervisor", "duration": "30m", "resources": ["Supervisor"], "end": true } ] }
```

Las duraciones de `sla`, `confirmed` y `deadline` van al escenario base, nunca al XML: la
`duration` de un paso `message` es lo que tarda el cliente en contestar. **Alarga la corrida antes
de simularlo:** el escenario base corre una hora (`run.duration: 3600`), y en una hora ningún caso
llega a un plazo de 48 horas, así que la escalación nunca se vería. Cambia primero `run.duration`,
por ejemplo a 60 días, y después corre y exporta:

```json
{ "name": "patch_scenario", "arguments": { "project": "claims.lila", "scenario": "as-is",
  "patch": [ { "op": "replace", "path": "/run/duration", "value": 5184000 } ] } }
```

Con un solo ajustador, casi todos los siniestros esperan más de 48 horas, así que el supervisor ve
casi todos: la corrida lo dice en `elements.sla.completed` y `elements.escalate.completed`. Un caso
termina donde termina su último camino, así que `byEndEvent` cuenta un siniestro en
`EndEvent_pay`, no en `EndEvent_escalate`, cuando se pagó después de escalarse.

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
- **Las ediciones** solo alcanzan el proceso principal de un BPMN (el que lee el simulador).
  `edit_process` no agrega eventos de inicio ni les cambia el tipo: ponlos en el esquema (`starts`)
  o edítalos en la app.
- **Del esquema al escenario** solo pasan `duration`, `resources` y la `probability` de las ramas.
  Llegadas, calendarios, costos y capacidades van por `patch_scenario` o por una hoja.
- **Una corrida larga tarda lo suyo.** El servidor sigue respondiendo e informa cada replicación, y
  una llamada cancelada detiene la corrida, pero la corrida en sí no es más rápida. Usa pocas
  réplicas mientras iteras.
