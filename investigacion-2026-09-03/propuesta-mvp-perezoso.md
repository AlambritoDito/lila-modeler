# Lila Modeler — propuesta "MVP perezoso": un solo lenguaje, un solo runtime, cero servidores

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](../docs/) and [`README.md`](../README.md).

**Ángulo**: Lazy MVP first: el camino más corto y creíble a un simulador con paridad Bizagi (niveles 1–4) que un estudiante o analista pueda usar en un mes, en macOS/Linux/navegador, con las costuras mínimas para que la plataforma de Process Intelligence se monte encima sin reescribir nada.

## Resumen

Tesis: no existe en 2026 un motor DES BPMN open source adoptable (Prosimos sin licencia y estancado, Scylla Java/Swing, BIMP cerrado, Apromore archivado), y el benchmark medido hoy en esta máquina demuestra que un bucle de eventos escrito a mano en JavaScript simula 100.000 casos en 0,14 s (vs 1,27 s SimPy nativo y 2,8 s SimPy bajo Pyodide). Por tanto el MVP es un único monorepo TypeScript con dos paquetes reales: `@lila/engine` (motor DES puro + parser BPMN via bpmn-moddle MIT + esquema del escenario + CLI `lila`) y `apps/web` (Vite + React + bpmn-js 18 con su watermark, que corre el motor en un Web Worker y se despliega como sitio estático). Sin servidor, sin base de datos, sin Python, sin Rust, sin Docker. Los contratos estables son tres documentos JSON (IR del proceso, escenario, resultado) y un event log CSV; el `.bpmn` se mantiene intacto y el escenario vive en `*.scenario.json` aparte, keyed por id de elemento, con vocabulario BPSim 2.0 (interTriggerTimer, processingTime, probability, quantity, fixedCost/unitCost, replication, seed, warmup, extends). La paridad con Bizagi se define como una tabla de resultados con exactamente sus columnas (started, completed, min/max/avg/total, espera min/max/avg/std/total, costos, utilización) más lo que sus usuarios echan en falta y sale gratis de un DES con log: percentiles, longitud de cola, throughput, costo por caso, ranking de cuellos de botella y event log por caso. Cinco hitos de aproximadamente una semana cada uno (motor niveles 1–2, recursos/costos/replicaciones, calendarios/what-if, UI web estática, MCP opcional de 3 tools) con tests de aceptación numéricos (teoría de colas M/M/c, snapshots deterministas por semilla, oráculos Prosimos/Scylla fuera de CI). La plataforma futura (repositorio, versiones, RACI, catálogo, REST, MCP completo, entrevistas, mining) se monta sobre los mismos JSON: los archivos de hoy son las filas `jsonb` de mañana, y el `.bpmn` sigue siendo la unidad de versión (como Camunda Hub 8.10). Lo que se decide NO construir queda listado con la fecha/condición en que se construye.

## Stack

- **engine_language**: TypeScript estricto, ESM, un único runtime (Node ≥ 22 LTS para CLI/tests, navegador vía Web Worker para la UI). Núcleo `@lila/engine` con CERO dependencias en runtime dentro de `src/core` (heap + reloj + colas + RNG mulberry32 + 13 distribuciones BPSim escritas a mano: son fórmulas cerradas o algoritmos de <20 líneas, sin numpy). Dependencias del paquete: bpmn-moddle 10.2.0 (MIT, bpmn.io; verificado round-trip con namespace propio hoy) para leer/escribir .bpmn en Node y navegador sin DOM; zod 4.5.x (MIT) para validar el escenario y emitir el JSON Schema (`z.toJSONSchema`, marcar como likely y confirmar en el spike). Dev: vitest 5.0.0, tsx 4.23, TypeScript (npm publica 7.0.2 hoy; fijar la versión que vite 8/vitest 5 soporten — unverified hasta el spike). Motivo: benchmark local Node 24.16: 10k casos/60k eventos en 30 ms, 100k casos en 143 ms; ninguna librería DES en TS tiene adopción (0–35 estrellas, un autor cada una), así que se posee el bucle (~300–500 líneas). Descartados: Python/SimPy (segundo runtime, Pyodide 9,2 MB wasm + 2,4 MB stdlib, 2,3x más lento, parser BPMN sin opción permisiva mantenida), Rust/WASM (sin crate DES con recursos/colas, toolchain recién reorganizado, rendimiento innecesario).
- **editor**: bpmn-js 18.27.1 (publicado 2026-09-03; licencia bpmn.io = MIT + cláusula de watermark 'Powered by bpmn.io' que debe permanecer visible, también en forks) usado tal cual, sin fork, montado en un componente React fino. Panel de propiedades PROPIO en React (evita @bpmn-io/properties-panel y bpmn-js-properties-panel, que no publican tipos y arrastran camunda-bpmn-js-behaviors): el panel lee `selection.changed` del eventBus y escribe en el escenario JSON (no en el XML), salvo nombre y `bpmn:documentation` que van al business object vía `modeling.updateProperties`. Opcional y de una línea: bpmn-js-token-simulation 0.40.0 (MIT) como equivalente al 'Nivel 1 – validación' animado. No usar element templates (solo bindean namespaces bpmn/zeebe/camunda), no usar bpmn-js-headless (experimental, sin licencia declarada). Reservar la esquina inferior derecha del canvas para el watermark. Alternativas revisadas y descartadas por ahora: KIE bpmn-editor 10.2.0 (React ≤18, reactflow 11, una sola release, semántica jBPM; revisitar en 12 meses), diagram-js solo (reescribir ~28k líneas), bpmn-visualization (solo visor), LogicFlow (no conforme), Open BPMN/Modelio/Eclipse (Java/escritorio).
- **ui**: React 19.2 + Vite 8.2, sitio estático (GitHub Pages o cualquier hosting de archivos), sin backend. Estado con useReducer + useSyncExternalStore (sin Redux/Zustand); CSS plano en un archivo; textos de UI en `strings.es.ts` (español primero, sin librería i18n). El motor corre en un Web Worker (`worker.ts` importa `@lila/engine` y ejecuta `simulate()`), la UI recibe `RunResult` por postMessage. Vistas MVP: Modeler (bpmn-js), panel Escenario (por elemento seleccionado + recursos + calendarios + parámetros de corrida), Resultados (tres tablas con las columnas de Bizagi: Elementos de proceso, Recursos, Proceso; más percentiles/colas/throughput/costo por caso/cuellos de botella), Comparar (dos o más escenarios lado a lado, celdas distintas resaltadas), Exportar (CSV de tablas y del event log; descarga de .bpmn y .scenario.json). Tauri queda como wrapper opcional posterior; no aporta nada mientras el sitio estático funcione.
- **persistence_mvp**: Archivos y git, nada más. Un 'proyecto' es una carpeta: `model.bpmn` + `*.scenario.json` (+ opcionalmente `results/*.json` y `*.csv`). En CLI se leen/escriben del disco. En el navegador: abrir con <input type=file> (o File System Access API donde exista, con fallback a descarga), guardar por descarga, y autosave del último estado (xml + escenarios) en localStorage con try/catch. Versionado AS-IS/TO-BE = dos archivos de escenario (`to-be.scenario.json` con `extends: "as-is.scenario.json"`) o dos commits/ramas; comparar versiones = diff de texto. Sin SQLite, sin IndexedDB, sin cuentas.
- **persistence_platform**: Cuando exista la fase de repositorio (y no antes): PostgreSQL con tablas que guardan LOS MISMOS documentos: `process_versions(process_key, version_tag, bpmn_xml text, created_at, author)`, `scenarios(process_version_id, name, doc jsonb)`, `runs(scenario_id, result jsonb, log_uri)` (event log CSV en disco/objeto), `catalog_items(kind, id, doc jsonb)` para roles/sistemas/documentos/riesgos/controles/KPIs. Las tablas por elemento (Activity, RACIEntry…) que propone ARCHITECTURE.md son un índice DERIVADO del XML + `lila:` extensions, no un segundo modelo canónico (patrón Flowable/Camunda: la definición se guarda como blob y se indexa). Clave de proceso = `bpmn:process@id` (slug estable) + version tag; clave de elemento = `id` BPMN (NCName, nunca regenerado). Migrar de archivos a DB es un script de importación de una tarde, porque los bytes son idénticos.
- **api_and_mcp**: MVP: ninguno; la 'API' es la función pura `simulate(ir, scenario): RunResult` + `parseBpmn(xml)` + `compare(results[])` del paquete `@lila/engine`, y la CLI `lila validate|run|compare` (node:util.parseArgs, sin commander). Hito opcional M5 (~100 líneas): `packages/mcp` con @modelcontextprotocol/server 2.0.0 (Tier 1, spec 2026-07-28) exponiendo exactamente tres tools que envuelven esas funciones: `validate_bpmn`, `run_simulation`, `compare_scenarios`; transporte stdio; sin permisos ni auditoría todavía. REST llega cuando exista un servidor (fase repositorio): un router Hono/Fastify de una pantalla sobre las mismas funciones. Regla: UI, CLI, MCP y REST llaman a las mismas funciones del paquete engine; ninguna lógica vive en el borde.

## Estructura del repositorio

```
lila-modeler/
├── package.json                # npm workspaces (npm viene con Node; sin pnpm/turbo/nx)
├── tsconfig.base.json          # strict, ESM, target ES2022
├── .github/workflows/ci.yml    # npm test + build + deploy de apps/web a GitHub Pages
├── LICENSE                     # MIT o Apache-2.0 (decisión ADR-014; sin AGPL en el núcleo)
├── packages/
│   └── engine/                 # @lila/engine — el producto. Todo lo que no es UI vive aquí
│       ├── package.json        # exports: ".", "./bpmn", "./schema"; bin: { lila: "dist/cli.js" }
│       ├── src/
│       │   ├── core/           # CERO dependencias: lo que corre en el Worker
│       │   │   ├── ir.ts       # tipos ProcessGraph/Node/Edge (start,end,task,xor,and,or,timer)
│       │   │   ├── heap.ts     # cola de prioridad ordenada por (t, seq) → determinismo
│       │   │   ├── rng.ts      # mulberry32 sembrado + 13 distribuciones BPSim + empírica
│       │   │   ├── calendar.ts # intervalos semanales: isOpen(t), nextOpen(t), addWorkingTime(t,d)
│       │   │   ├── sim.ts      # bucle DES: llegadas, tokens, gateways/joins, recursos AND/OR, colas
│       │   │   ├── metrics.ts  # agregados por elemento/recurso/proceso, percentiles, replicaciones
│       │   │   ├── compare.ts  # diff de RunResult entre escenarios (what-if lado a lado)
│       │   │   └── run.ts      # simulate(ir, scenario, opts) → RunResult  (API pública, pura)
│       │   ├── scenario.ts     # zod schema + toJSONSchema() + resolveExtends() + defaults (24x7, cap ∞)
│       │   ├── bpmn/
│       │   │   ├── parse.ts    # bpmn-moddle → IR + warnings; aplana subprocesos embebidos
│       │   │   └── validate.ts # ids NCName, flujos colgantes, elementos no soportados (lista Bizagi)
│       │   ├── csv.ts          # event log y tablas → CSV (sin librería)
│       │   ├── format.ts       # segundos → baseTimeUnit legible para CLI/UI
│       │   └── cli.ts          # `lila validate|run|compare` con node:util.parseArgs
│       └── test/
│           ├── golden/         # snapshots JSON deterministas (seed 42) del ejemplo pedido
│           ├── hand.test.ts    # casos con duraciones constantes calculables a mano
│           ├── theory.test.ts  # M/M/1 y M/M/c contra fórmulas (tolerancia 3%)
│           ├── semantics.test.ts # AND join, OR join, calendarios, warmup, parada, costos
│           └── oracle/         # scripts que corren Prosimos/Scylla sobre examples/ (NO en CI)
├── apps/
│   └── web/                    # Vite + React 19 + bpmn-js 18; sitio estático, sin backend
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── Modeler.tsx     # monta BpmnModeler; expone importXML/saveXML/eventBus
│           ├── ScenarioPanel.tsx # edita elements[id]/resources/calendars/run del escenario activo
│           ├── ResultsView.tsx # tres tablas Bizagi-like + extras + botones CSV
│           ├── CompareView.tsx # escenarios lado a lado con diferencias resaltadas
│           ├── worker.ts       # import { simulate } from '@lila/engine'; onmessage → postMessage
│           ├── store.ts        # { xml, scenarios[], results[] } + autosave localStorage (try/catch)
│           ├── strings.es.ts   # textos de UI (español primero)
│           └── app.css
├── examples/
│   ├── pedido/                 # proceso benchmark del corpus (start, 5 tareas, XOR, AND, recursos)
│   │   ├── model.bpmn
│   │   ├── as-is.scenario.json
│   │   └── to-be-mas-cajero.scenario.json   # extends: as-is, cambia una capacidad
│   ├── bizagi-level-2/         # reproducción de los ejemplos oficiales del help de Bizagi
│   └── bizagi-exports/         # .bpmn reales exportados por Bizagi (bizagi:BizagiExtensions) para import
└── docs/
    ├── SCENARIO_FORMAT.md      # JSON Schema generado + tabla campo ↔ BPSim ↔ qbp ↔ Bizagi
    ├── SEMANTICS.md            # reglas del motor: gateways, joins, calendarios, costos, parada, warmup
    ├── BIZAGI_PARITY.md        # checklist must/later/skip con estado
    └── DECISIONS.md            # ADRs (los del corpus previo + los nuevos de esta propuesta)
```

## Diseño del motor

PIPELINE (idéntico en CLI, Worker y futuro MCP): `.bpmn` → `parseBpmn(xml)` (bpmn-moddle) → `ProcessGraph` (IR JSON) → `validate(ir)` → `resolveScenario(json)` (aplica `extends`, defaults y zod) → `simulate(ir, scenario)` → `RunResult` JSON (+ event log en memoria) → `toCsv()` / `compare()`. Nada del motor toca XML, DOM, disco ni red: `core/` es un módulo puro que recibe y devuelve objetos.

IR: `{ processId, nodes: Record<id,{type:'start'|'end'|'task'|'xor'|'and'|'or'|'timer', name, incoming:id[], outgoing:id[]}>, edges: Record<id,{source,target}> }`. El parser aplana subprocesos embebidos (conecta el flujo entrante al start interno y el end interno al flujo saliente) y trata `callActivity` como task con processingTime global (comportamiento Bizagi). Elementos fuera de la lista (boundary, message, signal, event-based, multi-instancia, complex, choreography) producen error de validación con el mismo texto que Bizagi ('no soportado por el simulador'), no un fallo silencioso. Los ids se conservan tal cual; nunca se usa el nombre como clave.

SCHEDULER: heap binario ordenado por `(t, seq)` donde `seq` es un contador monótono; garantiza que dos corridas con la misma semilla produzcan bytes idénticos. Tipos de evento: `ARRIVAL`, `TASK_END`, `TIMER_END`, `STOP`. No hay eventos de calendario: la disponibilidad se resuelve al planificar (`nextOpen`, `addWorkingTime`). Reloj en segundos desde `run.start`. Llegadas: para cada nodo start con `interTriggerTimer` se generan casos hasta `triggerCount` o hasta `duration`, lo primero que ocurra (regla Bizagi); si el start tiene `calendar`, las llegadas se desplazan al siguiente intervalo abierto. Tokens: un caso lleva una lista de tokens activos; cada token está en un nodo. XOR: elige un flujo saliente por probabilidad acumulada (reparto equitativo si no se define; se normaliza con warning si no suma 1). AND fork: un token por flujo saliente; AND join: por caso y por nodo join se cuenta un token por arista entrante, dispara al completarse y se reinicia (soporta loops). OR fork: cada flujo se activa con su probabilidad independiente, forzando al menos uno; OR join: espera tantos tokens como flujos activó el fork correspondiente (se registra `expected[case][join]` en el fork). Timer intermedio: retardo = `processingTime`, sin recurso.

RECURSOS Y COLAS: `resources[pool] = { quantity, unitCost (por hora), fixedCost (por token), calendar }`. Cada tarea declara `resources: [{ref, quantity}]` y `selection: 'and' | 'or'`. AND: la tarea arranca cuando TODOS los pools tienen capacidad libre simultáneamente (se comprueba en cada liberación; no se retienen recursos parciales, así que no hay deadlock). OR: arranca con el primer pool que tenga capacidad; el token se encola en todos y se retira de los demás al arrancar. Cola FIFO por pool ordenada por instante de habilitación (empate → seq). Tiempo de espera = start − enabled. Sin recursos declarados ⇒ capacidad infinita (equivalente al nivel 2 de Bizagi). Calendarios: intervalos semanales `{days, from, to}`; sin calendario ⇒ 24×7 (nivel 3). Semántica elegida y documentada en SEMANTICS.md porque Bizagi no la documenta: una tarea sólo arranca dentro del calendario del recurso y su processingTime consume únicamente tiempo de calendario (se pausa al cerrar el turno y se reanuda al abrir, es decir, `end = addWorkingTime(start, duration)`); el tiempo fuera de turno cuenta como espera del caso, no como proceso, y se reporta aparte (`waitCalendar`). Es la regla más simple que no crea preempción ni tareas huérfanas y coincide con Prosimos.

RNG Y DISTRIBUCIONES: mulberry32 sembrado (seed de 32 bits); replicación r usa `seed + r`. Todas las extracciones vienen de un único stream en orden fijo (llegadas, ruteo, duraciones), lo que mantiene el determinismo. Distribuciones (nombres y parámetros nombrados, unidades en segundos): constant{value}, uniform{min,max}, triangular{min,mode,max}, exponential{mean} (=NegativeExponential BPSim), normal{mean,sd} (truncada a ≥0 con warning en validación, como avisa Bizagi), truncatedNormal{mean,sd,min,max}, lognormal{mean,sd} (parámetros en escala real, se convierten a μ,σ), gamma{shape,scale} (Marsaglia–Tsang), erlang{k,mean} (suma de exponenciales), weibull{shape,scale} (inversa), beta{alpha,beta,min?,max?} (cociente de gammas), poisson{mean} (Knuth), binomial{n,p}, user{points:[[x,p]…]} (empírica). Cubre las 13 de BPSim 2.0 en ~120 líneas.

COSTOS: por elemento `fixedCost` × tokens completados; por recurso `fixedCost` × tokens atendidos + `unitCost` × horas ocupadas; costo por caso = suma de lo anterior repartido por caso desde el log; costo total del escenario.

MÉTRICAS (metrics.ts, calculadas desde el log en memoria, no acumuladores dispersos): por elemento → started, completed, processing min/max/avg/total, waiting min/max/avg/std/total, queue length avg/max, fixedCost; por recurso → utilization %, fixedCost, unitCost, totalCost, tokens; por proceso → started, completed, in-flight al parar, cycle time min/max/avg/p50/p90/p95/total, waiting total, throughput por hora (completed / horas simuladas), costo por caso, bottleneck ranking (avg wait × count, desempate por utilización). Con `replications > 1` se guarda cada corrida y se reporta mean, sd e IC95 (1,96·sd/√n) por KPI. Warmup: casos llegados antes de `warmup` ocupan recursos pero se excluyen de las estadísticas.

EVENT LOG: filas `{case_id, activity_id, resource_id, enabled, start, end, wait, waitCalendar, cost}` en un array plano (200k filas para 10k casos × 20 actividades cabe sin problema); `toCsv()` lo exporta con timestamps ISO derivados de `run.start`; convertible a XES/OCEL después sin tocar el motor. Puede desactivarse (`opts.log=false`) para corridas masivas.

DETERMINISMO Y TESTS: golden snapshots JSON por semilla en CI; tests a mano con duraciones constantes (resultado exacto); M/M/1 y M/M/c contra fórmulas de Erlang-C con 100k casos y tolerancia 3%; tests semánticos de joins/calendarios/warmup/parada; scripts de oráculo que corren Prosimos (sembrando numpy/random) y Scylla headless sobre `examples/` y comparan con IC, fuera de CI por licencia de Prosimos y el jar de QBP.

RENDIMIENTO: objetivo 10k casos × 20 actividades con recursos y calendarios < 1 s en un Worker; el benchmark de hoy (5 tareas, 100k casos, 143 ms) deja margen de sobra. Sin Rust, sin WASM.

CÓDIGO REUTILIZADO/FORKEADO: se reutiliza bpmn-moddle (MIT) como dependencia; el `des.js` del benchmark del scratchpad (heap + mulberry32 + colas) es la semilla literal de `heap.ts`, `rng.ts` y `sim.ts`. No se forkea nada. Prosimos y Scylla se usan sólo como oráculos ejecutables (sin copiar código: Prosimos no tiene licencia). Del JSON de Prosimos se toma la idea de secciones (perfiles de recurso, calendario de llegadas, probabilidades por gateway), del XSD de BPSim el vocabulario de nombres.

## Formato de escenario

Un archivo JSON por escenario, junto al diagrama, keyed por `id` de elemento BPMN, con vocabulario BPSim 2.0 y parámetros de distribución NOMBRADOS. Regla única de unidades: todos los tiempos en segundos (números), salvo `run.start` (ISO 8601 con zona); `baseTimeUnit` sólo afecta a la presentación. Esquema zod en `scenario.ts` que emite el JSON Schema publicado en docs/SCENARIO_FORMAT.md; el mismo validador corre en CLI, UI y MCP.

Ejemplo `examples/pedido/as-is.scenario.json`:

{
  "version": "0.1",
  "name": "AS-IS",
  "description": "Operación actual, 2 cajeros y 3 cocineros",
  "bpmn": "model.bpmn",
  "extends": null,
  "run": {
    "start": "2026-09-07T08:00:00-06:00",
    "duration": 2592000,
    "triggerCount": 10000,
    "warmup": 3600,
    "replications": 30,
    "seed": 42,
    "baseTimeUnit": "min",
    "baseCurrencyUnit": "MXN"
  },
  "calendars": {
    "oficina": { "weekly": [ { "days": ["MO","TU","WE","TH","FR"], "from": "09:00", "to": "18:00" } ] }
  },
  "resources": {
    "cajero":   { "name": "Cajero",   "type": "role",      "quantity": 2, "unitCost": 220, "fixedCost": 0, "calendar": "oficina" },
    "cocinero": { "name": "Cocinero", "type": "role",      "quantity": 3, "unitCost": 180, "calendar": "oficina" },
    "horno":    { "name": "Horno",    "type": "equipment", "quantity": 1 }
  },
  "elements": {
    "StartEvent_1":     { "interTriggerTimer": { "type": "exponential", "mean": 240 }, "calendar": "oficina" },
    "Task_TomarPedido": { "processingTime": { "type": "triangular", "min": 60, "mode": 120, "max": 300 },
                          "resources": [ { "ref": "cajero", "quantity": 1 } ], "fixedCost": 0 },
    "Task_Preparar":    { "processingTime": { "type": "normal", "mean": 480, "sd": 90 },
                          "resources": [ { "ref": "cocinero" }, { "ref": "horno" } ], "selection": "and" },
    "Task_Revisar":     { "processingTime": { "type": "constant", "value": 90 },
                          "resources": [ { "ref": "cajero" }, { "ref": "cocinero" } ], "selection": "or" },
    "Timer_Reposo":     { "processingTime": { "type": "constant", "value": 600 } },
    "Flow_Aprobado":    { "probability": 0.78 },
    "Flow_Rechazado":   { "probability": 0.22 }
  }
}

Un TO-BE es un delta: `{ "version": "0.1", "name": "TO-BE +1 cajero", "extends": "as-is.scenario.json", "resources": { "cajero": { "quantity": 3 } } }` (merge profundo por clave; `null` borra). Defaults cuando falta algo: sin `interTriggerTimer` en un start ⇒ error; sin `processingTime` ⇒ 0; sin `resources` ⇒ capacidad infinita; sin `calendar` ⇒ 24×7; probabilidades ausentes ⇒ reparto equitativo; `replications` 1; `warmup` 0; parada = min(duration, triggerCount). Distribuciones admitidas: constant, uniform, triangular, exponential, normal, truncatedNormal, lognormal, gamma, erlang, weibull, beta, poisson, binomial, user. Campos reservados y NO implementados en 0.1 (aceptados por el esquema como `unknown` para no cerrar la puerta): `conditions` (ruteo por atributos de caso), `priority`, `batch`. Mapeo documentado: `elements[id].processingTime` ↔ `bpsim:ProcessingTime` ↔ `qbp:durationDistribution`; `elements[flowId].probability` ↔ `bpsim:Probability` ↔ `qbp:sequenceFlow/@executionProbability`; `resources[id].quantity` ↔ `bpsim:Quantity` ↔ `qbp:resource/@totalAmount`; `run.triggerCount` ↔ `bpsim:TriggerCount` ↔ Bizagi 'Max arrival count'. Nada de esto se escribe dentro del .bpmn (ADR-007); bpmn-moddle preserva los bloques `bpsim:`/`qbp:`/`bizagi:` ajenos si el archivo los trae.

Resultado (`RunResult`, resumido): `{ scenario, ir: {processId}, run: {seed, replications, simulatedSeconds}, process: {started, completed, inFlight, cycle: {min,max,avg,p50,p90,p95,total}, wait: {...}, throughputPerHour, costPerCase, totalCost, bottlenecks: [{elementId, avgWait, count}]}, elements: { [id]: {type, name, started, completed, processing:{min,max,avg,total}, wait:{min,max,avg,std,total}, waitCalendar, queue:{avg,max}, fixedCost} }, resources: { [id]: {utilization, tokens, fixedCost, unitCost, totalCost} }, replications?: [{seed, process, elements, resources}], ci95?: {...}, warnings: string[], log?: Row[] }`.

## Alcance del MVP

- Motor DES TypeScript puro (`@lila/engine/core`) con paridad de los 4 niveles de Bizagi: validación de rutas (tokens por flujo/actividad/fin), tiempos (llegadas + processingTime), recursos (quantity, fixedCost, unitCost, AND/OR, esperas, utilización), calendarios (semanales, matriz recurso→calendario, calendario de llegadas).
- Elementos BPMN: start/end 'none', task (todas las variantes como tarea genérica), sequence flow, exclusive gateway (probabilidades, reparto equitativo por defecto), inclusive gateway (probabilidades independientes), parallel gateway fork/join, subproceso embebido aplanado, call activity como tarea con tiempo global, timer intermedio como retardo. Todo lo demás → error de validación explícito.
- 13 distribuciones BPSim 2.0 + empírica, con parámetros nombrados y truncado de normal a ≥0 con aviso.
- Escenario `*.scenario.json` separado del .bpmn, keyed por id, con `extends` para what-if, JSON Schema publicado, validación compartida CLI/UI.
- Parada por duración o triggerCount (lo primero), warmup, replicaciones con semilla reproducible (mean/sd/IC95).
- Tabla de resultados con exactamente las columnas de Bizagi (Elementos: started/completed/min/max/avg/total, espera min/max/avg/std/total, costo fijo; Recursos: utilización, costo fijo, costo unitario, costo total; Proceso agregado) MÁS percentiles p50/p90/p95, longitud de cola avg/max, throughput/hora, costo por caso, ranking de cuellos de botella y event log por caso exportable a CSV.
- What-if: N escenarios sobre el mismo .bpmn, `lila compare` y vista lado a lado con diferencias resaltadas.
- CLI `lila validate model.bpmn`, `lila run model.bpmn as-is.scenario.json [--csv dir] [--json out]`, `lila compare model.bpmn a.json b.json`; salida de texto como la del README del corpus.
- Web app estática (Vite + React + bpmn-js con watermark): abrir/crear .bpmn (incluidos los exportados por Bizagi con `bizagi:` extensions), editar con edición inmediata del nombre al crear tarea (comportamiento nativo de bpmn-js), panel de escenario por elemento seleccionado, editor de recursos y calendarios, correr en Web Worker, tablas de resultados, comparar, exportar CSV/.bpmn/.scenario.json, autosave localStorage, UI en español.
- Ejemplos: proceso benchmark `pedido` con AS-IS y TO-BE, reproducción de los ejemplos oficiales de niveles 1–4 del help de Bizagi como fixtures, .bpmn reales exportados por Bizagi para probar importación.
- Tests: golden snapshots por semilla, casos a mano, M/M/1 y M/M/c vs teoría, semántica de joins/calendarios/warmup/parada, y scripts de oráculo Prosimos/Scylla fuera de CI.
- Documentación mínima: SCENARIO_FORMAT.md, SEMANTICS.md, BIZAGI_PARITY.md, DECISIONS.md, README con el comando de 30 segundos (`npx lila run ...`).
- Opcional si sobra tiempo (M5): servidor MCP stdio con 3 tools (validate_bpmn, run_simulation, compare_scenarios) sobre las mismas funciones; bpmn-js-token-simulation como botón 'Animar rutas'.
- NO se construye en el MVP (y cuándo sí): base de datos y servidor (fase repositorio, cuando haya más de un usuario editando el mismo proceso); REST (cuando exista servidor); cuentas/permisos/auditoría (con REST); catálogo de roles/sistemas/documentos/riesgos/controles/KPIs y RACI (fase arquitectura de negocio, tras el MVP, como `catalog.json` + namespace `lila:` en extensionElements); import/export BPSim 2.0 (cuando aparezca un usuario de Sparx EA o convenga decir 'compatible BPSim'; un día de trabajo sobre el JSON); import qbp/BIMP (cuando se necesiten más fixtures; ~150 líneas); lector del .bpm de Bizagi (sólo si un spike de una hora muestra XML de escenarios dentro del ZIP); animación con contadores en vivo estilo Bizagi (nunca como prioridad; token-simulation cubre el 80%); Excel (CSV basta; XLSX si lo piden usuarios reales); boundary/message/signal/event-based/multi-instancia (cuando un usuario los necesite; Bizagi tampoco simula varios de ellos); priorización, batching, atributos de caso y ruteo por condición (fase process mining, cuando Simod/logs los alimenten); Python API (cliente fino sobre CLI/REST si lo piden usuarios académicos); Rust/WASM (sólo si un spike demuestra que TS no alcanza un objetivo real de rendimiento); Tauri (cuando alguien pida instalador de escritorio); i18n (cuando haya usuarios no hispanohablantes); process mining (fase 8, proceso Python separado por AGPL de pm4py).

## Hitos

### M0 — Esqueleto y benchmark (días 1–2)

Monorepo con npm workspaces, `packages/engine` con `core/ir.ts`, `heap.ts`, `rng.ts` (portados del des.js del benchmark), `scenario.ts` con zod y `toJSONSchema`, `bpmn/parse.ts` sobre bpmn-moddle 10.2.0, `cli.ts` con `lila validate`. `examples/pedido/model.bpmn` dibujado con bpmn-js (o Camunda Desktop Modeler) y `as-is.scenario.json`. CI con vitest.

_Aceptación_: `npx lila validate examples/pedido/model.bpmn` imprime la lista de nodos/aristas del IR y 0 errores; el mismo comando sobre un .bpmn exportado por Bizagi (fixture `bizagi_A10.bpmn` del scratchpad) parsea sin excepción, conserva `bizagi:BizagiExtensions` en un round-trip `saveXML` y reporta como no soportados los elementos que Bizagi tampoco simula. `npm test` verde con un test de RNG: dos llamadas con seed 42 producen la misma secuencia de 1000 números.

### M1 — Niveles 1 y 2 de Bizagi (semana 1)

`sim.ts` con llegadas (interTriggerTimer + triggerCount + duration), XOR/OR/AND fork-join, subproceso embebido aplanado, timer intermedio, processingTime con las 13 distribuciones, capacidad infinita, warmup, replicaciones, `metrics.ts` con la tabla de elementos y proceso, `lila run` con salida de texto y `--json`.

_Aceptación_: (a) Caso a mano: proceso Start→A(60 s)→XOR 50/50→B(120 s)|C(30 s)→End con llegadas constantes cada 10 s y 1000 casos produce exactamente avg cycle = 60 + 0,5·120 + 0,5·30 ± 1 s, tokens por flujo 500±40, y `lila run` con seed 42 dos veces produce bytes idénticos (golden snapshot). (b) Reproducción del ejemplo oficial de Nivel 2 del help de Bizagi (level_2_example) con sus mismos parámetros: instances completed/started iguales y min/max/avg dentro de ±5% del reporte publicado. (c) Parada: con duration 1 h y triggerCount 10000 y llegadas cada 10 s, started = 360 y no 10000.

### M2 — Nivel 3: recursos, colas, costos, log (semana 2)

Pools con quantity/unitCost/fixedCost, asignación por tarea con AND/OR, colas FIFO, espera min/max/avg/std/total, utilización, costos por elemento/recurso/caso, longitud de cola, throughput, ranking de cuellos de botella, event log en memoria + `--csv`, tabla de recursos, IC95 con replicaciones.

_Aceptación_: (a) M/M/1 con λ=1/12 s, μ=1/10 s, 100k casos, 5 replicaciones: espera media en cola dentro de ±3% de ρ/(μ−λ)·… (fórmula Erlang-C) y utilización 0,833±0,01. (b) M/M/c con c=3: idem contra Erlang-C. (c) Oráculo (fuera de CI): `examples/pedido` corrido en Prosimos (numpy/random sembrados) y en Scylla headless; avg cycle y utilización por recurso dentro del IC95 de 30 replicaciones de Lila. (d) `lila run --csv out/` genera `elements.csv`, `resources.csv`, `process.csv`, `log.csv` cuyos encabezados coinciden con los nombres de columnas de Bizagi documentados en BIZAGI_PARITY.md. (e) Reproducción del ejemplo oficial de Nivel 3 de Bizagi dentro de ±5%.

### M3 — Nivel 4: calendarios y what-if (semana 3)

`calendar.ts` (intervalos semanales, `addWorkingTime`), calendario por recurso y de llegadas, `waitCalendar` en métricas, `extends` en escenarios, `compare.ts` y `lila compare` con tabla lado a lado y diferencias marcadas, docs SEMANTICS.md y SCENARIO_FORMAT.md con el JSON Schema generado.

_Aceptación_: (a) Recurso con calendario L–V 9–18 y llegadas 24×7 cada hora, tarea de 10 min: los casos llegados el sábado 00:00 esperan hasta el lunes 09:00 y `waitCalendar` del elemento = suma exacta de horas cerradas; tarea de 2 h que arranca a las 17:00 termina a las 10:00 del día siguiente. (b) Sin calendario el resultado es idéntico bit a bit al de M2 (regresión). (c) `lila compare model.bpmn as-is.json to-be-mas-cajero.json` muestra utilización del cajero menor y espera menor en TO-BE, y marca sólo las celdas que cambian. (d) Reproducción del ejemplo oficial de Nivel 4 de Bizagi dentro de ±5%. (e) El JSON Schema publicado valida todos los escenarios de `examples/` y rechaza uno con `probability: 1.5`.

### M4 — Web app estática (semanas 4–5)

`apps/web` con bpmn-js 18.27.1, panel de escenario propio en React, editor de recursos/calendarios/corrida, Worker que ejecuta `simulate`, vistas Resultados y Comparar, exportación CSV/.bpmn/.scenario.json, autosave localStorage, despliegue en GitHub Pages desde CI, README con 'pruébalo en el navegador' y `npx lila`.

_Aceptación_: Flujo de estudiante sin instalar nada: abre la URL, carga un .bpmn exportado por Bizagi, crea una tarea nueva y escribe su nombre inmediatamente (sin 'Task 1'), asigna distribución y recurso desde el panel, corre 10.000 casos × 30 replicaciones en < 5 s sin congelar la UI, ve las tres tablas, duplica el escenario, cambia una capacidad, compara, descarga log.csv y los dos .scenario.json; recarga la página y recupera el trabajo. El watermark bpmn.io queda visible y sin solapar. El bundle del Worker no incluye bpmn-js ni React (verificar con `vite build --report` que `worker.js` < 100 KB).

### M5 — MCP mínimo (opcional, ≤ 1 día)

`packages/mcp` con @modelcontextprotocol/server 2.0.0, transporte stdio, tres tools (`validate_bpmn`, `run_simulation`, `compare_scenarios`) que reciben rutas o contenido y devuelven el mismo JSON que la CLI.

_Aceptación_: Desde Claude Code configurado con el servidor: el prompt 'simula examples/pedido con el escenario as-is y dime el cuello de botella' devuelve el mismo `bottlenecks[0]` que `lila run`; 'qué pasa si agrego un cajero' produce un escenario con `extends` y una comparación coherente. Sin ningún cambio en `@lila/engine`.

## Evolución a plataforma

Las costuras que el MVP deja fijadas (y que cuestan cero hoy) son cuatro: (1) el `id` BPMN como única clave de elemento y `bpmn:process@id` como clave de proceso; (2) tres documentos JSON con esquema (IR, escenario, resultado) y un event log CSV plano; (3) una función pura `simulate()` que todos los bordes (CLI, Worker, MCP, REST) llaman sin lógica propia; (4) el `.bpmn` intacto como unidad de versión, con bpmn-moddle preservando namespaces ajenos. Sobre eso, cada pieza de la visión se añade sin tocar el motor:

REPOSITORIO Y VERSIONES: hoy carpeta + git; mañana `packages/server` (Hono/Fastify + PostgreSQL) que guarda `process_versions.bpmn_xml`, `scenarios.doc jsonb`, `runs.result jsonb` — los mismos bytes que hoy están en disco; un script importa la carpeta. AS-IS/TO-BE = dos versions tags o dos escenarios con `extends`; comparar = diff XML (Camunda) + `compare.ts` (resultados). Workflow de release (Draft/Released/Valid, estilo ADONIS) es una columna `status` y fechas; nada de esto cambia el editor.

RACI, ROLES, SISTEMAS, DOCUMENTOS, RIESGOS, CONTROLES, KPIs: un `catalog.json` en el repositorio (después tabla `catalog_items`) con ids estables, y un descriptor moddle `lila:` (namespace `https://lila-modeler.org/schema/bpmn/1.0`) que escribe DENTRO del .bpmn `lila:responsibility type=\"R|A|C|I\" roleRef`, `lila:systemRef`, `lila:documentRef`, `lila:riskRef`, `lila:controlRef`, `lila:kpiRef`, más `bpmn:documentation` estándar para descripciones. Los `*Ref` colgantes son warnings de lint. El panel de propiedades propio del MVP gana pestañas; el motor no cambia. Si algún vendor (Camunda, Signavio, ADONIS) descarta `lila:` en su round-trip, el plan B es `annotations.json` sidecar keyed por id con el mismo descriptor: mismo modelo de dominio. Los pools de recursos del escenario pueden referenciar `roleRef` del catálogo para que RACI y simulación compartan roles.

API REST Y MCP: REST = un router sobre `parseBpmn`, `validate`, `simulate`, `compare` y (en fase repositorio) CRUD de los documentos; MCP = los tres tools del M5 más los de AGENT_API_MCP.md (create_activity, connect_elements, set_activity_duration, assign_responsible…), implementados como operaciones sobre bpmn-moddle + bpmn-auto-layout 1.3.0 (MIT) para que un agente cree diagramas sin coordenadas; permisos y auditoría llegan con el servidor y las cuentas, no antes. El paquete engine sigue sin dependencias de red.

AGENTES DE ENTREVISTA Y GENERACIÓN ASISTIDA: consumen y producen los mismos tres JSON + .bpmn (un agente escribe un `scenario.json` a partir de una entrevista, o un IR que bpmn-auto-layout convierte en diagrama); viven fuera del núcleo, en `packages/agents` o como skills, y usan la API/MCP.

PROCESS MINING: es Python por naturaleza (pm4py AGPL-3.0, Simod Apache-2.0) y se conecta por datos, no por lenguaje: el event log CSV que el motor emite desde M2 es lo que consumen; un proceso Python separado (CLI o servicio aislado, obligatorio por AGPL) descubre un `scenario.json` AS-IS desde logs reales (idea Simod/Bizagi 4.0) y compara 'documentado vs observado'. Los campos reservados `conditions`, `priority`, `batch` del esquema se implementan entonces.

RENDIMIENTO FUTURO: si alguna vez hiciera falta, `core/` se reimplementa en Rust→WASM detrás del mismo `simulate(ir, scenario)`; ningún borde lo nota. Hoy no hay motivo.

DESKTOP: Tauri envolviendo `apps/web` cuando alguien pida instalador; el Worker y los archivos ya funcionan offline.

## Decisiones

- **Lenguaje y runtime del motor** → TypeScript único; motor DES escrito a mano (~300–500 líneas) en `@lila/engine/core` con cero dependencias; mismo bundle en Node (CLI, tests, MCP) y en Web Worker (navegador).
  - _Por qué_: Benchmark verificado hoy: JS 100k casos en 143 ms vs SimPy 1,27 s nativo y 2,8 s en Pyodide (12 MB de runtime). Ninguna librería DES en TS/Rust ahorra trabajo real (0–35 estrellas, un autor; nexosim es actor-based; desim GPL+nightly). Un lenguaje elimina toolchain, empaquetado Pyodide y la 'Python API' del corpus.
- **Motor propio vs motor existente (cierra ADR-005/006 y Paso 4–5 de NEXT_STEPS)** → Ruta B: motor propio; Prosimos y Scylla sólo como oráculos numéricos fuera de CI; ningún fork.
  - _Por qué_: Prosimos no tiene LICENSE (todos los derechos reservados), embebe jars propietarios de QBP, exige Python <3.12 y main estancado desde 2025-01; Scylla es MIT pero Java+Swing+DESMO-J 2017; BIMP cerrado; Apromore archivado 2025-08; bpmn-engine/Camunda/Spiff son motores de ejecución con licencias/semántica equivocadas. La abstracción que protege el producto no es un `SimulationScheduler` abstracto sino los contratos JSON.
- **Editor BPMN** → bpmn-js 18.27.1 tal cual, con watermark visible, sin fork; panel de propiedades propio en React; bpmn-moddle 10.2.0 (MIT) como parser en Node.
  - _Por qué_: Única librería del sector con releases varias veces al mes en 2026, tipos incluidos, ejemplos oficiales de moddle extensions/renderers, y el comportamiento 'nueva tarea → nombre editable' de serie. El watermark no se puede quitar ni en fork (Camunda Desktop Modeler, Fluxnova y Miragon lo llevan); reemplazarla = reescribir ~28k líneas. KIE bpmn-editor (React ≤18, reactflow 11, una release) se revisita en 12 meses.
- **Formato del escenario (implementa ADR-007)** → `*.scenario.json` separado del .bpmn, keyed por id de elemento, vocabulario BPSim 2.0 con parámetros nombrados, segundos como única unidad, `extends` para what-if, JSON Schema generado con zod y compartido por CLI/UI/MCP.
  - _Por qué_: Cumple a la vez N escenarios por diagrama, diffs git sin ruido DI, edición por agentes como JSON patch y migración 1:1 a `jsonb`. Bizagi no exporta parámetros de simulación (su BPMN sólo lleva colores en `bizagi:`), así que no hay round-trip que preservar; BPSim/qbp se hacen con adaptadores en los bordes cuando haya un consumidor.
- **Persistencia del MVP** → Archivos (.bpmn + JSON + CSV) y git; localStorage sólo como autosave; sin SQLite, sin IndexedDB, sin servidor, sin cuentas.
  - _Por qué_: Un estudiante o analista trabaja con archivos; git da versionado AS-IS/TO-BE y diff gratis; los bytes son idénticos a los que guardará PostgreSQL en la fase repositorio, así que no hay reescritura. Camunda Hub 8.10 confirma que 'versión = snapshot de un fichero' es el estado del arte.
- **Despliegue del MVP** → Sitio estático (GitHub Pages) + `npx lila` para CLI. Sin Docker, sin backend, sin Tauri.
  - _Por qué_: El motor corre en un Worker; no hay nada que servir. Docker/Tauri se añaden cuando exista servidor o alguien pida instalador.
- **Paridad Bizagi como definición de 'hecho'** → Reproducir la tabla de resultados de Bizagi con sus mismas columnas y los cuatro niveles como parámetros opcionales con degradación (sin recursos ⇒ capacidad infinita, sin calendario ⇒ 24×7), no como cuatro modos de producto; añadir percentiles, colas, throughput, costo por caso, cuellos de botella y event log.
  - _Por qué_: Facilita que un usuario académico migre comparando números; los extras son exactamente las quejas de usuarios de Bizagi ('poca granularidad', 'difícil de interpretar') y salen gratis de un DES con log.
- **Semántica de calendarios** → Una tarea sólo arranca dentro del calendario de su recurso y su processingTime consume sólo tiempo de calendario (se pausa fuera de turno); el tiempo cerrado se reporta como `waitCalendar`, separado de la espera por cola.
  - _Por qué_: Bizagi no documenta qué hace con tareas en curso al cerrar un turno; esta regla es la más simple sin preempción ni tareas huérfanas, coincide con Prosimos y es determinista. Se documenta en SEMANTICS.md para poder cambiarla si un usuario aporta el comportamiento real de Bizagi.
- **Determinismo** → Heap ordenado por (t, seq), un único stream mulberry32 sembrado, replicación r = seed + r, golden snapshots en CI.
  - _Por qué_: Reproducibilidad exacta es requisito académico y de tests; Prosimos no la ofrece. Cuesta un contador.
- **Alcance BPMN del MVP** → start/end none, task genérica, XOR, OR, AND, subproceso embebido aplanado, call activity como tarea, timer intermedio. Boundary/message/signal/event-based/multi-instancia → error de validación explícito.
  - _Por qué_: Es el núcleo que Bizagi simula en niveles 1–4; lo que Bizagi no soporta tampoco lo exigen sus usuarios. Cada elemento extra se añade cuando un usuario real lo pida.
- **Estructura del repositorio** → npm workspaces con dos paquetes (`packages/engine`, `apps/web`) más `examples/` y `docs/`; CLI dentro de engine como `bin`; MCP como tercer paquete sólo en M5.
  - _Por qué_: Un paquete por cosa que se publica; ningún paquete 'shared', 'utils' o 'types' especulativo. npm viene con Node: sin pnpm/turbo/nx.
- **Licencia del núcleo (resuelve parte de ADR-008)** → MIT o Apache-2.0 para engine, web y docs; ninguna dependencia AGPL/LGPL en el núcleo (pm4py, SpiffWorkflow); pm4py sólo en proceso Python separado en fase mining. Nombre: Lila Modeler (cierra ADR-008).
  - _Por qué_: Compatibilidad con bpmn-js (licencia bpmn.io), bpmn-moddle (MIT), adopción académica y empresarial, y aislamiento del AGPL de pm4py.
- **Panel de propiedades** → Propio en React, leyendo selección del eventBus de bpmn-js y escribiendo en el escenario JSON; nombre y documentation vía `modeling.updateProperties`.
  - _Por qué_: Los paquetes oficiales del properties panel no publican tipos, son Preact y arrastran dependencias Camunda; el panel de simulación de todos modos edita el escenario, no el XML.
- **Idioma de la UI y del proyecto** → UI en español desde `strings.es.ts`; código, ids y claves JSON en inglés (vocabulario BPSim); docs en español.
  - _Por qué_: Brito y sus primeros usuarios (LatAm académico) trabajan en español; los identificadores en inglés mantienen la compatibilidad con BPSim/qbp y con agentes.

## Riesgos

- Fidelidad numérica frente a Bizagi: su disciplina de cola, la resolución de recursos OR y el trato de tareas en curso al cerrar un turno no están documentados; los ejemplos oficiales de niveles 2–4 se reproducen con tolerancia ±5%, pero un usuario que compare cifras exactas puede encontrar diferencias. Mitigación: SEMANTICS.md explícito, tests contra teoría de colas, y ajustar la semántica si alguien aporta capturas de Bizagi.
- Watermark bpmn.io: es permanente (también en forks) y no hay vía comercial documentada para retirarlo; hay que aceptarlo como parte del producto y diseñar el layout para no solaparlo.
- bpmn-js es una dependencia estratégica con release cadence alta (27 releases en 2026): riesgo de breaking changes en la integración React y en la API de moddle extensions. Mitigación: fijar versión exacta, componente `Modeler.tsx` de una pantalla como único punto de contacto.
- Preservación de `lila:` y de `bpmn:documentation` en round-trips por Camunda/Signavio/ADONIS/Bizagi no está verificada (sólo bpmn-moddle en tests). Afecta a la fase RACI, no al MVP; el plan B (sidecar `annotations.json`) mantiene el modelo de dominio.
- Prosimos sin licencia y jar de QBP propietario: no pueden entrar en CI ni redistribuirse; sólo scripts locales de oráculo. Si un día se quiere reutilizar su código o formato hay que pedir licencia a los autores (U. Tartu).
- Determinismo cruzado entre navegadores: `Math.log/exp/sqrt` pueden diferir en el último bit entre motores JS, así que 'mismos bytes' está garantizado dentro de un mismo runtime, no entre Chrome, Safari y Node. Mitigación: golden tests en Node; en UI se documenta como reproducible 'dentro del mismo navegador'.
- Memoria del event log en navegador: 30 replicaciones × 10k casos × 20 actividades = 6 M filas; hay que guardar sólo el log de la primera replicación (o desactivarlo) y agregar el resto en el Worker. Decidir en M2.
- Alcance del MVP en un mes para una persona con agentes: los hitos M1–M3 son realistas (el bucle ya existe en 27 líneas), M4 es donde se va el tiempo (UX del panel de escenario y tablas). Mitigación: M4 arranca con tablas planas HTML sin librerías de grid ni gráficas; los charts llegan después.
- zod 4 `toJSONSchema` y TypeScript 7.0.2 recién publicado: compatibilidad con vite 8/vitest 5 no verificada hoy; si molesta, se fija TypeScript 5.9.x y se escribe el JSON Schema a mano (es pequeño).
- Tentación de construir plataforma antes de tiempo (DB, REST, cuentas): el corpus previo ya la tiene; la regla de NEXT_STEPS ('nada de roadmap antes de que la simulación base produzca resultados confiables') debe seguir vigente y aplicarse también a la investigación.

## Cambios propuestos a los docs previos

- README.md: renombrar el comando `process-sim run` a `lila run`; añadir 'pruébalo en el navegador (sitio estático)' como primer objetivo junto con la CLI; sustituir la visión de despliegue (Docker, servidor, self-hosted, Tauri) por 'sitio estático + npx' para el MVP y mover el resto a la fase repositorio; cerrar el working title: el proyecto se llama Lila Modeler.
- ARCHITECTURE.md: el diagrama de alto nivel (Web UI → REST/WebSocket → Application API → PostgreSQL, 'DES Scheduler SimPy / other') describe la plataforma final, no el MVP; añadir un diagrama MVP de dos cajas (apps/web con Worker ↔ @lila/engine; CLI ↔ @lila/engine). Eliminar 'Python API' de las interfaces esperadas. Matizar 'Internal model ≠ BPMN XML': en el MVP el .bpmn ES el modelo y las entidades de dominio (Activity, Role, RACIEntry…) serán un índice derivado del XML + `lila:` extensions, no un segundo modelo canónico. Sección Persistence: quitar SQLite/in-memory como opciones de prototipo; el prototipo es archivos + git.
- SIMULATION_ENGINE.md: borrar la interfaz abstracta `SimulationScheduler` (Python) y la lista 'SimPy / Custom / Rust / Other' — es una abstracción especulativa; la portabilidad la dan los contratos JSON. Fijar el lenguaje (TypeScript) y el kernel propio. Mover subproceso embebido, timer intermedio e inclusive gateway al MVP (paridad Bizagi) y dejar boundary/message/signal/multi-instancia como 'cuando lo pida un usuario'. Ampliar distribuciones a las 13 de BPSim 2.0 + empírica desde el inicio (cuestan ~120 líneas). Sustituir los ejemplos JSON de escenario (con `gateway_id`/`flows`, `resources` como lista, `scenario: 'AS-IS'`) por el formato definitivo keyed por id de elemento con vocabulario BPSim y `extends`. Añadir: condiciones de parada (duration|triggerCount), warmup, replicaciones con IC95, semántica de calendarios, costos fijos/unitarios, columnas exactas de Bizagi, y el event log con `enabled/start/end/waitCalendar`. Quitar 'Failed cases' (no aplica sin boundary events).
- DECISIONS.md: ADR-005 (Evaluate before fork) queda ejecutado con resultado 'Replace' para motores y 'Use' para bpmn-js/bpmn-moddle; ADR-006 (Own the abstraction layer) se reformula: la capa propia son los contratos JSON + `simulate()`, no un adaptador de scheduler; ADR-008 se cierra (Lila Modeler, MIT/Apache-2.0). Añadir ADR-009 TypeScript único y motor propio; ADR-010 bpmn-js con watermark y panel propio; ADR-011 archivos + git como persistencia hasta la fase repositorio; ADR-012 formato de escenario 0.1 (keyed por id, BPSim, segundos, extends); ADR-013 semántica de calendarios; ADR-014 licencia del núcleo y aislamiento de AGPL (pm4py); ADR-015 identidad: id BPMN como clave de elemento, process@id + version tag como clave de proceso, namespace `lila:` versionado para la fase RACI.
- ROADMAP.md: Phase 0 (PoC editor, PoC motores existentes, PoC DES) está sustancialmente resuelta por la investigación de hoy — dejar sólo el spike de bpmn-js de un día dentro de M4; fusionar Phase 1 (Simulation Core) y Phase 2 (Simulation UI) en el MVP con los hitos M0–M4; adelantar 'Agent API' mínima (3 tools MCP) como M5 opcional porque cuesta un día y Brito trabaja con agentes; reordenar Phase 3 (Repository con DB) DESPUÉS de Phase 4 (Business Architecture con catalog.json + `lila:`), porque el catálogo y RACI no necesitan servidor y el repositorio sí. Marcar Process Mining como proceso Python separado por AGPL.
- NEXT_STEPS.md: Paso 1 (estructura `engine/ web/ packages/ examples/ tests/`) se reemplaza por el árbol de esta propuesta (dos paquetes; tests dentro de cada paquete). Paso 2 (benchmark) se mantiene y se amplía con los ejemplos oficiales de Bizagi como fixtures. Paso 3 (spike bpmn-js) se reduce a un día y se mueve a M4. Pasos 4 y 5 (comparar rutas A/B y elegir motor) quedan resueltos: Ruta B, motor propio en TS. Paso 6 (`process-sim validate|run`) pasa a `lila validate|run|compare` en M0–M3. Paso 7 (primera UI) = M4.
- DEPENDENCY_STRATEGY.md: rellenar la tabla con datos verificados hoy: bpmn-js 18.27.1 (licencia bpmn.io con watermark) → Use; bpmn-moddle 10.2.0 MIT → Use; bpmn-auto-layout 1.3.0 MIT y bpmnlint 11.13.0 MIT → Use en fase agentes; bpmn-js-token-simulation 0.40.0 MIT → Use opcional (nivel 1 animado); SimPy 4.1.2 MIT → no se usa (segundo runtime); Scylla MIT → oráculo, NO candidato a fork (Java/Swing/DESMO-J 2017); Prosimos sin licencia → oráculo local, nunca dependencia ni fork; BIMP/QBP cerrado → ignorar; Apromore archivado → ignorar; pm4py AGPL-3.0 → sólo en proceso separado en fase mining; KIE bpmn-editor 10.2.0 → revisitar en 12 meses. Quitar 'Scylla: Research/Fork candidate'. Añadir la regla de que el núcleo no admite AGPL/LGPL ni Camunda License.
- AGENT_API_MCP.md: es correcto como visión; añadir que el MVP expone sólo tres tools (validate_bpmn, run_simulation, compare_scenarios) sobre stdio con @modelcontextprotocol/server 2.0 (spec 2026-07-28), que las operaciones de modelado (create_activity, connect_elements…) se implementarán sobre bpmn-moddle + bpmn-auto-layout en la fase agentes, y que permisos/auditoría llegan con el servidor y las cuentas, no antes.
- PRODUCT_VISION.md: mantener; añadir explícitamente los diferenciadores verificados frente a Bizagi 4.3 (sólo Windows, sin editor web, foro de soporte en mantenimiento en sept-2026, sin percentiles/colas/throughput/log por caso) y precisar que el caso de uso académico es el MVP y el empresarial la plataforma.
- Documentos que faltan y deben crearse: docs/SCENARIO_FORMAT.md (JSON Schema + tabla de mapeo BPSim/qbp/Bizagi), docs/SEMANTICS.md (reglas del motor), docs/BIZAGI_PARITY.md (checklist must/later/skip con estado), y una nota de licencias de terceros (bpmn.io watermark, MIT de bpmn-moddle/zod/vite/react).
