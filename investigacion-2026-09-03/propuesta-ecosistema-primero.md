# Lila Modeler — propuesta "Ecosystem first": motor Python sobre SimPy, editor bpmn-js, formatos del ecosistema (Prosimos JSON, qbp, BPSim, XES/OCEL) en los bordes

**Ángulo**: Ecosystem first: reutilizar al máximo el ecosistema open source de BPM, simulación y process mining (SimPy, bpmn-js/bpmn-moddle, Prosimos/Simod como formato y oráculo, BPSim/qbp como adaptadores, pm4py aislado por licencia), escribir solo la capa BPMN que nadie ofrece con licencia permisiva, y optimizar para que la fase de process mining (descubrir escenarios AS-IS desde logs) sea barata. Se declara honestamente el costo: dos runtimes (Python + TypeScript), y el modo "navegador sin backend" es más pesado (Pyodide) y llega después del CLI y del servidor local.

## Resumen

Tesis: en septiembre de 2026 no existe ningún motor DES BPMN open source adoptable como núcleo (Prosimos no tiene licencia en ninguna rama —verificado hoy—, Scylla es JVM+Swing sobre DESMO-J de 2017, QBP es cerrado, Apromore está archivado), así que "reutilizar" no puede significar forkear un motor BPMN. Sí puede significar tres cosas concretas: (1) reutilizar CÓDIGO mantenido en cada capa donde existe con licencia permisiva —SimPy 4.1.2 (MIT, 28 contribuidores, corre en Pyodide) como kernel DES; bpmn-js 18.27.1 + bpmn-moddle 10.2.0 + bpmnlint + bpmn-auto-layout + bpmn-js-token-simulation en el editor; FastAPI 0.141 y el SDK oficial mcp 2.1.1 (Tier 1) para REST y MCP; pydantic 2.13 para el esquema del escenario; (2) reutilizar FORMATOS: el escenario propio es un JSON pequeño con vocabulario BPSim 2.0 pero con adaptadores sin pérdida hacia/desde el JSON de Prosimos (lo que emite Simod, Optimos y el corpus académico de Tartu), importador qbp (182 ficheros en GitHub, XSD público), import/export BPSim 2.0 y event log en CSV/XES convertible a OCEL 2.0; (3) reutilizar MOTORES AJENOS COMO ORÁCULOS: Prosimos y Scylla se ejecutan solo en desarrollo para validar números del motor propio, nunca se distribuyen. Lo único que se escribe desde cero es la capa BPMN sobre SimPy (parser xml.etree → IR, semántica de tokens XOR/OR/AND/timer/subproceso embebido, pools con calendarios, costos, métricas con las columnas exactas de Bizagi más percentiles/colas/throughput): estimo 1.500–2.500 líneas de Python, sin numpy, para que el mismo wheel corra en CPython y en Pyodide. Coste honesto frente a una ruta "todo TypeScript": dos toolchains (uv + pnpm), un proceso Python local para la UI (`lila serve` sirve la SPA y la API en un solo proceso), rendimiento 4–9x menor que un bucle a mano en JS (pero 10.000 casos en ~126 ms nativo y ~288 ms en Pyodide, sobrado para la paridad con Bizagi que recomienda 1.000 tokens × 30 replicaciones), modo navegador-sin-backend con ~12 MB de runtime y ~1 s de arranque que se entrega como milestone opcional M6, y el auto-layout de diagramas creados por agentes requiere Node (bpmn-auto-layout) como subproceso. Beneficio: la fase de mining es Python nativo (pm4py, pandas, Simod), el motor es importable como librería académica, y el escenario descubierto por Simod se carga en Lila con un adaptador de ~150 líneas.

## Stack

- **engine_language**: Python ≥3.12 gestionado con uv 0.12.9 (verificado PyPI 2026-09-01). Paquete `lila-sim` con dependencias de runtime mínimas: simpy 4.1.2 (MIT, 2026-05-24, Python ≥3.8, verificado) y pydantic 2.13.5 (MIT, verificado) para modelos + JSON Schema. Parser BPMN con xml.etree (stdlib); lxml 6.1.3 (BSD) solo si hace falta XPath en adaptadores BPSim/qbp. Distribuciones con `random.Random` de la stdlib (Python ≥3.12 trae beta, binomial, exponencial, gamma→Erlang, normal, lognormal, triangular, uniforme, Weibull; verificado): Poisson (Knuth), normal truncada (rechazo) y empírica (random.choices) se implementan en ~40 líneas. Regla dura: `lila-sim` NO depende de numpy/scipy/pandas para que el wheel puro se instale en Pyodide vía micropip (SimPy verificado instalable así). Prosimos (sin licencia; python <3.12; pix-framework arrastra polars/pyarrow) y Scylla (Java 11/17, MIT) se usan solo como oráculos en un venv/JDK de desarrollo, nunca como dependencia.
- **editor**: bpmn-js 18.27.1 (licencia bpmn.io = MIT + watermark obligatorio y visible; verificado 2026-09-03) sin fork; bpmn-moddle 10.2.0 (MIT) como parser/serializador en Node; bpmnlint 11.x (MIT) para validación estructural en UI; bpmn-auto-layout 1.3.0 (MIT, Node ≥22.12) para diagramas creados por agentes sin BPMNDI; bpmn-js-token-simulation 0.40.0 (MIT) como equivalente al 'Nivel 1 – Process Validation' de Bizagi (rutas, gateways), explícitamente NO DES. Namespace propio `lila:` (`https://lila-modeler.org/schema/bpmn/1.0`) definido una sola vez como descriptor moddle JSON (`web/src/editor/lila.moddle.json`) y replicado en el parser Python. No usar element templates (solo bindean bpmn/zeebe/camunda) ni bpmn-js-headless (experimental, sin licencia declarada).
- **ui**: React 18 + TypeScript + Vite (pnpm). Componente `LilaModeler.tsx` que monta `BpmnModeler` con `moddleExtensions: { lila }` y `additionalModules` propios; panel de propiedades PROPIO en React (evita @bpmn-io/properties-panel y bpmn-js-properties-panel, que no publican tipos y arrastran camunda-bpmn-js-behaviors); panel de escenario keyed por id de elemento; tabla de resultados con las columnas de Bizagi + percentiles; overlay de cuellos de botella con un `BaseRenderer` de prioridad 1500; comparación what-if lado a lado. La UI habla con `lila-server` por REST (`/api/v1`); en M6 opcional, con un Web Worker Pyodide que carga el wheel de `lila-sim`. Esquina inferior derecha del canvas reservada al watermark de bpmn.io.
- **persistence_mvp**: Archivos en git, cero base de datos: `processes/<clave>/model.bpmn` (BPMN 2.0 estándar con extensionElements `lila:` para documentación/RACI refs), `processes/<clave>/scenarios/<nombre>.scenario.json` (uno por escenario, `extends` para TO-BE como delta), `processes/<clave>/runs/<timestamp>-<escenario>/{result.json, log.csv}` (ignorables por .gitignore), `catalog.json` a nivel de repositorio (roles, sistemas, documentos, riesgos, controles, KPIs con id estable). `lila-server` implementa `storage/files.py` sobre ese layout; versión = commit/tag de git; comparar versiones = diff XML.
- **persistence_platform**: PostgreSQL 16 + SQLAlchemy 2 + Alembic detrás de la misma interfaz `Storage` (`storage/postgres.py`). Tablas: process(key, name), process_version(process_key, version_tag, bpmn_xml, created_at, status), scenario(process_version_id, name, json jsonb), run(scenario_id, seed, result jsonb, log_uri), catalog_item(id, type, json jsonb), element_index(process_version_id, element_id, name, type, refs jsonb) como índice DERIVADO del XML (nunca segundo modelo canónico). El escenario y el resultado se guardan como el mismo JSON que hoy vive en disco; el XML se guarda íntegro por versión como hacen Camunda/Flowable.
- **api_and_mcp**: FastAPI 0.141.1 (MIT; verificado 2026-07-29) expone `/api/v1` con OpenAPI generado; `lila-mcp` usa el SDK oficial `mcp` 2.1.1 (MIT, Tier 1, spec 2026-07-28, Python ≥3.10) con `MCPServer` y `@mcp.tool()`. Ambos llaman al mismo módulo `lila_server.services` (validate_bpmn, get_ir, list/create/patch_scenario, run_simulation, get_results, compare_runs, find_bottlenecks, y después catalog/raci). Transporte MCP: stdio para uso local con Claude Code/Desktop; HTTP streamable cuando exista servidor. El CLI `lila-sim` es la misma librería sin servidor.

## Estructura del repositorio

```
lila-modeler/                              monorepo; uv workspace (Python) + pnpm (web); Apache-2.0 salvo lila-mining
├── README.md                              qué es, `uv run lila-sim run …`, `uv run lila serve`
├── LICENSE                                Apache-2.0 (núcleo, server, mcp, web)
├── pyproject.toml                         uv workspace: members = ["packages/*"]
├── docs/
│   ├── adr/                               ADR-001…015 (los del corpus, corregidos + nuevos de esta propuesta)
│   ├── SCENARIO_FORMAT.md                 JSON Schema + tabla campo ↔ BPSim 2.0 ↔ qbp ↔ Prosimos
│   ├── BPMN_EXTENSION.md                  namespace lila:, descriptor moddle, política de ids
│   ├── BIZAGI_PARITY.md                   checklist niveles 1-4 y columnas exactas del reporte
│   └── ORACLES.md                         cómo correr Prosimos/Scylla en dev para regenerar fixtures
├── packages/
│   ├── lila-sim/                          MOTOR. deps runtime: simpy, pydantic. Sin numpy. Corre en Pyodide
│   │   ├── pyproject.toml                 [project.scripts] lila-sim = "lila_sim.cli:main"
│   │   ├── src/lila_sim/
│   │   │   ├── bpmn/parse.py              xml.etree → IR; tolera xmlns declarados por elemento (Bizagi)
│   │   │   ├── bpmn/ir.py                 Process/Node/Edge (pydantic); `lila-sim ir` lo vuelca a JSON
│   │   │   ├── bpmn/lint.py               alcanzabilidad, gateways sin salida, ids duplicados, refs colgantes
│   │   │   ├── scenario/model.py          Scenario (pydantic) → JSON Schema; `extends` resuelto aquí
│   │   │   ├── scenario/adapters/prosimos.py  lila ↔ Prosimos JSON (lo que emite Simod)
│   │   │   ├── scenario/adapters/qbp.py   qbp:processSimulationInfo → lila (solo import)
│   │   │   ├── scenario/adapters/bpsim.py BPSim 2.0 ↔ lila (M7+, cuando haya usuario Sparx/jBPM)
│   │   │   ├── engine/kernel.py           simpy.Environment, reloj en segundos, RNG por replicación
│   │   │   ├── engine/distributions.py    las 13 de BPSim sobre random.Random
│   │   │   ├── engine/resources.py        pools (PriorityResource), turnos/calendarios, costos
│   │   │   ├── engine/tokens.py           semántica BPMN: XOR/OR/AND split-join, timer, subproceso aplanado
│   │   │   ├── engine/run.py              run(ir, scenario, seed, replications) → RunResult
│   │   │   ├── results/log.py             EventLog → CSV / XES (escritor stdlib, sin pm4py)
│   │   │   ├── results/metrics.py         columnas Bizagi + p50/p90/p95, cola, throughput, costo/caso, bottleneck
│   │   │   ├── results/compare.py         what-if lado a lado con diferencias marcadas
│   │   │   └── cli.py                     validate | ir | run | compare | convert
│   │   └── tests/
│   │       ├── fixtures/                  benchmark.bpmn, bizagi-level-{1..4}.{bpmn,scenario.json}, scylla samples (MIT)
│   │       ├── oracles/                   salidas guardadas de Scylla/Prosimos + tolerancias (no se redistribuye código ajeno)
│   │       ├── test_analytic.py           M/M/1, M/M/c (Erlang-C), sumas constantes
│   │       └── test_determinism.py        misma semilla → CSV byte-idéntico
│   ├── lila-server/                       FastAPI; /api/v1; sirve web/dist; `lila serve` abre el navegador
│   │   └── src/lila_server/{app.py, services.py, storage/{base.py,files.py,postgres.py(post-MVP)}}
│   ├── lila-mcp/                          servidor MCP (mcp 2.1.1) sobre lila_server.services; stdio + http
│   └── lila-mining/                       FASE 8. AGPL-3.0, paquete y distribución SEPARADOS. pm4py, puente Simod, OCEL
├── web/                                   React 18 + Vite + TS
│   ├── package.json                       bpmn-js 18.x, bpmn-moddle 10.x, bpmnlint, bpmn-js-token-simulation
│   ├── src/editor/LilaModeler.tsx         monta BpmnModeler con moddleExtensions {lila}; importXML/saveXML
│   ├── src/editor/lila.moddle.json        descriptor del namespace lila: (única fuente; el parser Python lo lee en tests)
│   ├── src/editor/PropertiesPanel.tsx     panel propio: documentation, lila:*Ref, valores por defecto de simulación
│   ├── src/simulation/{ScenarioPanel,ResultsTable,Compare,BottleneckOverlay}.tsx
│   ├── src/validation/TokenSim.tsx        bpmn-js-token-simulation = "Nivel 1"
│   ├── src/api/client.ts                  cliente generado desde OpenAPI de lila-server
│   └── src/worker/pyodide.ts              M6 opcional: Pyodide + wheel lila-sim en Web Worker
├── examples/
│   ├── benchmark/{benchmark.bpmn, as-is.scenario.json, to-be-extra-analista.scenario.json}
│   └── bizagi-levels/                     réplicas de help.bizagi.com level_1..4_example
├── tools/oracles/                         scripts dev: run_prosimos.sh (venv py3.11), run_scylla.sh (JDK 17)
└── .github/workflows/{python.yml, web.yml, oracles.yml (manual)}
```

## Diseño del motor

PIPELINE (igual al del corpus, con piezas concretas): `.bpmn` → `bpmn/parse.py` (xml.etree.ElementTree; recorre bpmn:process, aplana bpmn:subProcess embebidos anotando `parent`, ignora bpmn:diagram y cualquier extensionElements que no sea `lila:`; tolera `xmlns:bizagi` declarado dentro de cada extensionElements —bpmn-io/bpmn-js#469 verificado— porque ElementTree resuelve namespaces por elemento) → IR (`Process{id, name, nodes[], edges[]}`, `Node{id, type ∈ start|end|task|xor|or|and|timer|subprocess_start|subprocess_end, name, incoming[], outgoing[], parent?}`, `Edge{id, source, target, name}`; pydantic, serializable, expuesto por `lila-sim ir`) → `bpmn/lint.py` (start alcanzable a todos los nodos, end alcanzable, gateways con ≥1 salida, probabilidades XOR que suman 1 ± 1e-6 o reparto equitativo si faltan, refs de escenario a ids inexistentes = error, elementos no soportados = error con lista, igual que la lista de no soportados de Bizagi) → `compile(ir, scenario)` → `SimModel` (nodos resueltos a callables de muestreo, pools instanciados, calendarios precalculados como lista de intervalos abiertos en segundos desde `run.start`) → `engine/run.py` (una `simpy.Environment` por replicación) → `EventLog` (filas en memoria o streaming a CSV) → `results/metrics.py` → `RunResult` JSON.

KERNEL: SimPy 4.1.2 tal cual (no se envuelve en un `SimulationScheduler` abstracto: ADR-006 se reinterpreta —ver decisiones— como 'los contratos estables son tres JSON: IR, escenario, resultado', no una interfaz de scheduler). Reloj = `env.now` en segundos flotantes desde `run.start`. Cada caso = `env.process(case(case_id))`. Semántica de tokens en `engine/tokens.py`: (a) task: `enabled_at = env.now`; selección de recursos AND = requests anidados en orden canónico por id de pool (evita deadlock); OR = `simpy.AnyOf` sobre requests a los pools alternativos, cancelando los perdedores; `started_at` al obtener el recurso; `yield env.timeout(duration)`; `ended_at`; sin recursos configurados ⇒ capacidad infinita (degradación tipo 'Nivel 2'); (b) XOR: `rng.random()` contra probabilidades acumuladas de los flujos salientes; (c) AND-split: `env.process` por rama; AND-join: contador por (case, gateway) con un `simpy.Event` que se dispara al completar `len(incoming)`; (d) OR-split: Bernoulli independiente por flujo con garantía de ≥1; OR-join simplificado: espera tantas ramas como activó el split emparejado (se documenta como simplificación; Bizagi no documenta la suya); (e) timer intermedio: `yield env.timeout(sample)`; (f) subproceso embebido: aplanado, sus tareas reportan también agregado por `parent`; (g) start quantity / completion quantity, boundary events, message/signal, event-based: fuera del MVP (checklist 'later' de Bizagi).

RECURSOS Y CALENDARIOS (`engine/resources.py`): pool = `simpy.PriorityResource(capacity)`, `fixed_cost` por uso y `cost_per_hour`; calendario semanal = lista de intervalos (día, hh:mm–hh:mm); implementación estándar de SimPy: un proceso 'turno' por pool que al cerrar el turno pide `capacity` unidades con prioridad -1 y las retiene hasta la apertura, de modo que los casos encolados esperan y las tareas EN CURSO terminan (no preemptivo por defecto; `preempt: true` cambia a `PreemptiveResource` y reencola el tiempo restante — M3 o después). Llegadas: proceso generador que muestrea el interarrival y, si hay calendario de llegadas, salta al siguiente intervalo abierto. Parada: `env.run(until=run.duration_s)` o al alcanzar `run.cases` (lo primero), igual que Bizagi; `warmup_s` excluye del cómputo las filas con `enabled_at < warmup`. Utilización = tiempo ocupado / (capacidad × tiempo DISPONIBLE según calendario), que es la única definición que hace comparables niveles 3 y 4.

DETERMINISMO: un único `random.Random(seed * 1_000_003 + replication)` inyectado desde el kernel; prohibido `random` global, numpy o iterar sets; el heap de SimPy ordena por (tiempo, prioridad, id de inserción) así que dos corridas con la misma semilla producen el mismo CSV byte a byte (test en `test_determinism.py`). Replicaciones: media e IC 95% con `statistics.NormalDist`/t; 30 por defecto en `compare`, 1 en `run`.

EVENT LOG (`results/log.py`): columnas `replication, case_id, activity_id, activity_name, resource_id, enabled_at, started_at, ended_at, wait_s, proc_s, cost` con timestamps ISO derivados de `run.start`; escritor XES mínimo en stdlib (concept:name, time:timestamp, org:resource, lifecycle:transition start/complete) para que pm4py, Simod y ProM lo lean sin que `lila-sim` dependa de ellos. OCEL 2.0 se genera en `lila-mining` cuando exista.

MÉTRICAS (`results/metrics.py`): por elemento exactamente las columnas de Bizagi (instances_started, instances_completed, time_min/max/avg/total, wait_min/max/avg/std/total, fixed_cost_total); por recurso (utilization, fixed_cost, unit_cost, total_cost); por proceso (lo mismo agregado) MÁS lo que los usuarios de Bizagi echan en falta: cycle p50/p90/p95, wait p90, longitud de cola media/máx ponderada por tiempo, throughput por hora, costo por caso, ranking de cuellos de botella (wait_total desc, empate por utilización). `compare.py` alinea dos RunResult y marca diferencias, con IC si hay replicaciones.

RENDIMIENTO MEDIDO (benchmarks de hoy, verificado): SimPy nativo 10k casos × 5 tareas con recursos = 126 ms, 100k = 1,27 s; bajo Pyodide 288 ms / 2,8 s. 30 replicaciones × 10k ≈ 4 s nativo. Suficiente para paridad con Bizagi (que recomienda ≥1.000 tokens y 30 replicaciones). Si algún día no basta, el contrato JSON permite un `engine/` alternativo (Rust→PyO3/WASM) sin tocar formatos, CLI, REST, MCP ni UI.

CÓDIGO REUTILIZADO / FORKEADO: se reutiliza SimPy (kernel), pydantic (esquema), stdlib (xml, random, csv, statistics). NO se forkea nada: Prosimos no puede forkearse (sin licencia) y Scylla no aporta código útil fuera de la JVM. Prosimos se usa como referencia SEMÁNTICA (calendarios semanales por recurso, pools con `amount`/`cost_per_hour`, probabilidades por gateway) y como ORÁCULO: `tools/oracles/run_prosimos.sh` lo corre en un venv Python 3.11 aparte con numpy/random sembrados, y sus salidas se guardan como fixtures con tolerancia estadística; lo mismo con Scylla headless (JDK 17) en un job manual de CI. bpmn-js-token-simulation cubre la 'validación de rutas' sin que el motor la implemente.

## Formato de escenario

Un archivo JSON por escenario, separado del .bpmn (confirma ADR-007), keyed por `id` de elemento BPMN, con vocabulario BPSim 2.0 y parámetros NOMBRADOS (no posicionales estilo scipy), tiempos en segundos, calendarios como intervalos semanales. Modelo pydantic en `scenario/model.py` que exporta el JSON Schema usado por CLI, UI y MCP. Campo `extends` = `inherits` de BPSim (TO-BE como delta del AS-IS).

Ejemplo `processes/pedido/scenarios/as-is.scenario.json`:
{
  "version": "0.1",
  "name": "AS-IS",
  "bpmn": "../model.bpmn",
  "extends": null,
  "run": { "cases": 10000, "duration_s": 2592000, "warmup_s": 3600, "replications": 1, "seed": 42,
           "start": "2026-09-07T08:00:00-06:00", "base_time_unit": "min", "currency": "MXN" },
  "calendars": { "oficina": [ { "days": ["MON","TUE","WED","THU","FRI"], "from": "09:00", "to": "18:00" } ] },
  "arrivals": { "StartEvent_1": { "inter_trigger": { "type": "exponential", "mean": 240 }, "trigger_count": 10000, "calendar": "oficina" } },
  "resources": { "cajero":   { "name": "Cajero",   "kind": "role",      "quantity": 2, "cost_per_hour": 220, "fixed_cost": 0, "calendar": "oficina" },
                 "cocinero": { "name": "Cocinero", "kind": "role",      "quantity": 3, "cost_per_hour": 180, "calendar": "oficina" },
                 "caja":     { "name": "Caja",     "kind": "equipment", "quantity": 1 } },
  "tasks": { "Task_TomarPedido": { "processing_time": { "type": "triangular", "min": 60, "mode": 120, "max": 300 },
                                   "resources": { "selection": "and", "items": [ { "ref": "cajero", "quantity": 1 }, { "ref": "caja", "quantity": 1 } ] },
                                   "fixed_cost": 0 },
             "Task_Preparar":    { "processing_time": { "type": "normal", "mean": 480, "sd": 90 },
                                   "resources": { "selection": "or", "items": [ { "ref": "cocinero" }, { "ref": "cajero" } ] } } },
  "gateways": { "Gateway_Aprobado": { "Flow_Si": 0.78, "Flow_No": 0.22 } },
  "events": { "Timer_Espera": { "processing_time": { "type": "constant", "value": 600 } } }
}

TO-BE: { "version": "0.1", "name": "TO-BE +1 cajero", "extends": "as-is.scenario.json", "resources": { "cajero": { "quantity": 3 } } }

Distribuciones (`type` + parámetros nombrados): constant{value}, uniform{min,max}, triangular{min,mode,max}, exponential{mean}, normal{mean,sd} (truncada a ≥0 con aviso, como Bizagi), truncated_normal{mean,sd,min,max}, lognormal{mean,sd} (de la variable, no del log; se convierte), gamma{shape,scale}, erlang{k,mean}, weibull{shape,scale}, beta{alpha,beta,min,max}, poisson{mean}, binomial{n,p}, empirical{values[],weights[]}. Tabla de mapeo en docs/SCENARIO_FORMAT.md: `tasks[id].processing_time` ↔ bpsim:ProcessingTime ↔ qbp:durationDistribution ↔ Prosimos task_resource_distribution; `gateways[id][flow]` ↔ bpsim:Probability (en el sequenceFlow) ↔ qbp:sequenceFlow/@executionProbability ↔ Prosimos gateway_branching_probabilities; `resources[id].quantity` ↔ bpsim:Quantity ↔ qbp:resource/@totalAmount ↔ Prosimos resource_list[].amount; `arrivals[id].inter_trigger` ↔ bpsim:InterTriggerTimer ↔ qbp:arrivalRateDistribution ↔ Prosimos arrival_time_distribution; `calendars` ↔ iCalendar (BPSim) ↔ qbp:timetable rules ↔ Prosimos resource_calendars. Adaptadores: `lila-sim convert --from prosimos|qbp|bpsim --to lila` y `--to prosimos|bpsim`. La conversión Prosimos→lila resuelve la distribución por (tarea, recurso) de Prosimos en `processing_time` por tarea con override opcional `by_resource` (campo reservado en v0.1, implementado cuando llegue Simod). Fuera de v0.1 y reservados: `conditions` (branch_rules/ExpressionParameter), `batching`, `priorities`, `case_attributes`.

Resultado (`result.json`): { "scenario": …, "run": {seed, replications, elapsed_ms, engine: "lila-sim/0.1.0"}, "process": {started, completed, cycle: {min,max,avg,total,p50,p90,p95}, wait: {…}, throughput_per_hour, cost_per_case, total_cost}, "elements": { "<id>": {columnas Bizagi + queue_len_avg/max} }, "resources": { "<id>": {utilization, fixed_cost, unit_cost, total_cost} }, "bottlenecks": [ {element, wait_total, utilization} ], "ci": {…si replications>1} }.

## Alcance del MVP

- BPMN soportado: start/end 'none', task (todas las variantes como tarea genérica), sequence flow, exclusive gateway con probabilidades (reparto equitativo por defecto), inclusive gateway con probabilidades independientes, parallel gateway fork/join, subproceso embebido aplanado, timer intermedio como retardo. Fuera: boundary events, message/signal, event-based, multi-instancia, subprocesos reutilizables (igual que Bizagi), start/completion quantity.
- Escenario JSON v0.1 con JSON Schema: run (cases, duration_s, warmup_s, replications, seed, start, base_time_unit, currency), calendars semanales, arrivals por start event (inter_trigger + trigger_count + calendar), resources (role|equipment, quantity, cost_per_hour, fixed_cost, calendar), tasks (processing_time, resources AND/OR con cantidad, fixed_cost), gateways, events (timers), extends.
- Las 13 distribuciones BPSim + constante + empírica sobre random.Random, con truncado a ≥0 y aviso para normal.
- Degradación automática: sin resources ⇒ capacidad infinita (Nivel 2); sin calendars ⇒ 24×7 (Nivel 3); con ambos ⇒ Nivel 4.
- Salidas: event log CSV (y XES mínimo), result.json con columnas exactas de Bizagi por elemento/recurso/proceso + p50/p90/p95, longitud de cola, throughput/h, costo por caso, ranking de cuellos de botella; replicaciones con IC 95%; `compare` lado a lado con diferencias marcadas; export CSV/XLSX (openpyxl como extra opcional).
- CLI `lila-sim validate | ir | run | compare | convert` con salida tabular tipo la del README del corpus y `--json`.
- Adaptadores de formato: import qbp:processSimulationInfo, import/export Prosimos JSON. BPSim 2.0 pospuesto a que aparezca un usuario de Sparx EA/jBPM.
- Oráculos en desarrollo: fixtures analíticas (M/M/1, M/M/c) y salidas guardadas de Prosimos y Scylla sobre el benchmark; el motor debe caer dentro del IC.
- Web UI mínima servida por `lila serve` (un solo proceso Python): editor bpmn-js con extensión lila:, edición inmediata del nombre al crear tarea (de serie en bpmn-js), panel de escenario keyed por id, botón Run, tabla de resultados, overlay de cuellos de botella, comparación de dos escenarios, token simulation como validación de rutas.
- REST /api/v1 (validate, ir, scenarios CRUD + JSON-patch, run, results, compare, bottlenecks) y servidor MCP con las mismas herramientas, ambos sobre `lila_server.services`.
- Persistencia por archivos en git con el layout processes/<clave>/…; sin base de datos, sin Docker, sin auth en el MVP.
- Explícitamente fuera del MVP: repositorio/versionado con UI, RACI/catálogo editable (solo se reservan lila:*Ref y catalog.json), animación con contadores en vivo, process mining, agentes de entrevistas, modo navegador sin backend (M6 opcional), Postgres, Docker, Tauri.

## Hitos

### M0 — Esqueleto, benchmark y fixtures

Monorepo con uv workspace + pnpm, CI verde, `examples/benchmark/benchmark.bpmn` (Start → Registrar → XOR 70/30 → (Revisar | Aprobación rápida) → AND (Notificar ‖ Archivar) → End, con un pool 'analista' capacidad 2 y duraciones distintas), `as-is` y `to-be-extra-analista` escenarios, JSON Schema publicado en docs/SCENARIO_FORMAT.md, réplicas de los 4 ejemplos de help.bizagi.com en examples/bizagi-levels, y el BPMN de Bizagi con `xmlns:bizagi` anidado como fixture.

_Aceptación_: `uv run lila-sim validate examples/benchmark/benchmark.bpmn` termina con código 0 y `lila-sim ir` devuelve 9 nodos y 9 aristas; el fixture Bizagi (namespace anidado) se parsea sin error y sus bizagi:BizagiProperties se ignoran; `jsonschema` valida ambos escenarios y rechaza uno con `tasks["NoExiste"]` con mensaje que cita el id.

### M1 — Niveles 1 y 2 de Bizagi (validación y tiempo)

`lila-sim run` con llegadas (inter_trigger + trigger_count), processing_time por tarea/timer, XOR/AND/OR, subproceso embebido, capacidad infinita, event log CSV, tabla con las columnas de Bizagi (started, completed, min/max/avg/total), semilla determinista, parada por duración o por trigger_count.

_Aceptación_: (a) Dos corridas con `--seed 42` producen log.csv con el mismo SHA-256; (b) en bizagi-level-1 con 10.000 tokens las proporciones de cada flujo XOR quedan a ±1 punto de lo configurado; (c) en bizagi-level-2 el tiempo promedio del proceso iguala la suma ponderada de las medias por rama a ±2 % y con duraciones constantes lo iguala exactamente; (d) con AND-split de dos ramas constantes (300 s y 500 s) el tiempo de la sección es 500 s exacto; (e) 10.000 casos del benchmark corren en < 0,5 s en CPython.

### M2 — Nivel 3 de Bizagi (recursos y costos)

Pools con quantity/cost_per_hour/fixed_cost, selección AND/OR con cantidades, fixed_cost por tarea, esperas min/max/avg/std/total por elemento, utilización y costos por recurso, p50/p90/p95, longitud de cola ponderada, throughput/h, costo por caso, ranking de cuellos de botella; salida tabular como la del README del corpus.

_Aceptación_: (a) Modelo M/M/1 (λ=1/300 s, μ=1/240 s) con 200.000 casos: Wq a ±3 % de la fórmula analítica y utilización 0,80 ± 0,01; (b) M/M/3 con Erlang-C: Wq a ±3 %; (c) selección AND de dos pools nunca produce deadlock en 100.000 casos (test con orden adverso de ids); (d) total_cost = Σ(fixed_cost × usos) + Σ(cost_per_hour × horas ocupadas) verificado aritméticamente desde el log; (e) benchmark vs oráculo Scylla (fixture guardada): avg cycle y utilización dentro del IC 95 % de 30 replicaciones; (f) el ranking de cuellos de botella del benchmark señala 'analista' y al pasar a to-be la espera total baja.

### M3 — Nivel 4 (calendarios), what-if y adaptadores

Calendarios semanales para recursos y llegadas, matriz recurso × calendario con calendario por defecto, replicaciones con IC 95 %, `lila-sim compare a.json b.json` lado a lado, export CSV/XLSX, warmup, `convert` Prosimos↔lila y qbp→lila.

_Aceptación_: (a) Un caso que llega viernes 17:59 a un pool 'oficina' (L-V 9-18) con tarea de 2 h termina el lunes a las 10:59 ± 60 s; (b) utilización con calendario 8×5 se calcula sobre horas disponibles y coincide con 24×7 escalado (test de invariancia); (c) round-trip lila → prosimos → lila es igual campo a campo (excluyendo los reservados); (d) el fixture qbp de Scylla (MIT) se convierte y corre sin error; (e) con 30 replicaciones el IC del cycle time promedio es más estrecho que con 5 (test de sanidad) y `compare` marca en rojo las filas que cambian entre as-is y to-be; (f) oráculo Prosimos sobre el benchmark (venv dev, numpy/random sembrados): media de cycle time dentro del IC (job manual de CI, no bloqueante).

### M4 — UI de simulación servida por un solo proceso

`uv run lila serve` levanta FastAPI, sirve `web/dist` y abre el navegador: editor bpmn-js 18 con extensión lila:, panel de propiedades propio, panel de escenario keyed por id, Run, tabla de resultados, overlay de cuellos de botella, comparación de escenarios, token simulation como 'Nivel 1'. Persistencia en archivos.

_Aceptación_: Playwright: (a) importar el fixture exportado por Bizagi, crear una tarea y comprobar que el nombre queda en edición inmediata sin 'Task 1'; (b) fijar processing_time desde el panel, guardar y verificar que el .bpmn exportado difiere del original SOLO en un bloque `lila:` y que `bizagi:BizagiProperties` sigue presente; (c) pulsar Run sobre as-is y ver en la tabla los mismos números que `lila-sim run --seed 42` (igualdad exacta); (d) el watermark de bpmn.io queda visible y no solapado en la esquina inferior derecha en 1280×800 y 375×812; (e) el overlay resalta 'analista' como cuello de botella.

### M5 — REST y MCP para agentes

`/api/v1` con OpenAPI y `lila-mcp` (stdio) con tools validate_bpmn, get_ir, list_scenarios, create_scenario, patch_scenario (JSON Patch), run_simulation, get_results, compare_runs, find_bottlenecks; cliente TS generado desde OpenAPI para la UI.

_Aceptación_: (a) Snapshot del OpenAPI en tests; (b) con el cliente Python del SDK mcp, un test llama patch_scenario para poner `resources.analista.quantity = 3`, luego run_simulation con seed 42 y obtiene exactamente el result.json de `lila-sim run to-be…`; (c) un agente Claude Code conectado por stdio responde a 'simula qué pasa si agregamos un analista' usando solo las tools (test manual documentado); (d) UI y MCP pasan por `lila_server.services` — un test de import verifica que la UI no llama a lila_sim directamente.

### M6 (opcional) — Modo navegador sin backend

Web Worker con Pyodide 0.28/314.x que carga el wheel puro de `lila-sim` y simpy desde assets empaquetados; la UI elige backend REST o Worker; sitio estático desplegable en GitHub Pages.

_Aceptación_: (a) En Chrome, tras la inicialización (medida y mostrada en UI), 10.000 casos del benchmark en < 1 s; (b) resultado byte-idéntico al del CLI con la misma semilla; (c) el bundle total descargado se documenta (objetivo < 15 MB) y se cachea con service worker; (d) sin red tras la primera carga la simulación sigue funcionando.

## Evolución a plataforma

Los contratos que hacen que nada de esto obligue a reescribir: (1) el `id` BPMN (NCName, nunca regenerado) es la única clave de elemento; (2) la clave de proceso es `bpmn:process@id` (slug) + version_tag; (3) tres JSON estables — IR, escenario, resultado/event log — son la API entre motor, CLI, REST, MCP, UI y, después, base de datos y mining; (4) `lila_server.services` es la única puerta: UI, REST y MCP ya la usan desde M4/M5.

Repositorio y versiones (fase 3): `storage/files.py` se complementa con `storage/postgres.py` detrás de la misma interfaz `Storage`; `process_version` guarda el XML íntegro por (clave, version_tag) y `element_index` es un índice derivado que se reconstruye desde el XML (como Camunda Hub 8.10 y Flowable: 'versión = snapshot del fichero'); AS-IS/TO-BE son dos versiones o dos ramas; comparar = diff XML + `compare` de resultados. Workflow de release (Draft → Released → Archived, validez con fechas, estilo ADONIS) es una columna `status` y dos fechas más; nada del motor cambia.

RACI, roles, sistemas, documentos, riesgos, controles, KPIs (fase 4): ya viven en el MVP como referencias `lila:responsibility type=\"R|A|C|I\" roleRef`, `lila:systemRef`, `lila:documentRef`, `lila:riskRef`, `lila:controlRef`, `lila:kpiRef` dentro del .bpmn (descriptor moddle único) y como entradas de `catalog.json` con id estable; la 'R' puede además escribirse como `bpmn:performer/resourceRef` estándar para interoperar con motores. La fase 4 añade UI de catálogo, matriz RACI (consulta sobre element_index) y lint 'actividad sin responsable'. Si el spike de round-trip (Camunda Desktop Modeler, Signavio) demuestra que algún vendor descarta `lila:`, el fallback es `annotations.json` sidecar keyed por id, sin tocar el modelo de dominio.

API y MCP (fase 5): el MCP crece por herramientas sobre los mismos services (create_role, assign_responsible, get_raci_matrix, create_activity…). Crear/editar diagramas desde un agente exige BPMNDI: se resuelve invocando `bpmn-auto-layout` (Node) como subproceso desde lila-server, o editando el XML con xml.etree y dejando el layout al abrir en la UI; se decide en fase 5, no antes. Permisos: FastAPI dependencies + los scopes del corpus (process:read, simulation:run…), reutilizados por el MCP HTTP.

Asistencia IA y agentes de entrevistas (fases 6-7): son clientes MCP/REST; no tocan el motor. El 'escenario sugerido por IA' es simplemente un JSON de escenario válido contra el mismo JSON Schema.

Process mining (fase 8) — aquí paga la apuesta Python: `packages/lila-mining` es un paquete y una DISTRIBUCIÓN separados bajo AGPL-3.0 (pm4py 2.7.23.8 es AGPL desde 2.7.12; el propio equipo de Prosimos lo retiró por eso —issue #56 verificado—), invocado por `lila-server` como subproceso/servicio con datos por CSV/XES/JSON, nunca importado por el núcleo Apache-2.0. Entrega: (a) importar XES/CSV con las mismas columnas que emite `lila-sim` (case_id, activity, resource, start, end), (b) 'descubrimiento ligero' propio con pandas —tasa de llegadas, distribución empírica por actividad, probabilidades de gateway sobre un BPMN existente— que produce un `observado.scenario.json` (es lo que Bizagi Modeler 4.0 hace con su Process Mining → simulación), (c) puente opcional a Simod 5.1.6 (Apache-2.0, exige Java 1.8 y Python <3.12: se corre en su propio entorno) cuyo BPMN + JSON Prosimos entra por el adaptador ya existente desde M3, (d) conformance/deviations con pm4py sobre 'documentado vs observado', ambos como EventLog. OCEL 2.0 se emite desde aquí cuando haya objetos además de casos. Fase 9 (Process Intelligence) es composición de lo anterior: el agente compara scenario documentado, scenario observado y transcripciones de entrevistas a través de MCP.

## Decisiones

- **Lenguaje del motor** → Python ≥3.12 con SimPy 4.1.2 como kernel DES (Ruta 'B' del corpus: parser BPMN + DES general), en un paquete `lila-sim` sin numpy.
  - _Por qué_: Es la única forma de 'reutilizar código mantenido' en el kernel con licencia MIT y 28 contribuidores (verificado); Python es el lenguaje nativo de todo el ecosistema al que queremos enchufarnos (pm4py, Simod, Prosimos, pandas, XES) y de los usuarios académicos; el SDK MCP de Python es Tier 1. Coste asumido: 4–9x más lento que un bucle a mano en JS (irrelevante a la escala de Bizagi: 10k casos en 126 ms), dos toolchains, y modo navegador vía Pyodide. Sin numpy para que el wheel puro corra en Pyodide (SimPy verificado instalable con micropip).
- **Fork o wrap de un motor BPMN existente** → Ninguno. Prosimos y Scylla se usan solo como oráculos en desarrollo; la capa BPMN se escribe sobre SimPy.
  - _Por qué_: Prosimos no tiene LICENSE en ninguna rama (verificado hoy vía API de GitHub, incluida short-term-simulation), embebe jars propietarios de QBP, fija Python <3.12 y arrastra pix-framework (polars/pyarrow): forkearlo es ilegal y adoptarlo es inviable en Pyodide. Scylla es MIT pero JVM + Swing + DESMO-J 2017 + XML propio. Abrir un issue pidiendo licencia a los autores de Prosimos cuesta cero y, si llega, se reevalúa como backend opcional.
- **Formato canónico del escenario** → JSON propio versionado con vocabulario BPSim 2.0 y parámetros nombrados, separado del .bpmn, con `extends`; adaptadores en los bordes (Prosimos JSON bidireccional en M3, qbp import en M3, BPSim 2.0 cuando haya usuario).
  - _Por qué_: Ninguno de los formatos ajenos cumple los cuatro criterios: qbp es uno-por-proceso y un solo recurso por tarea; Prosimos JSON no está versionado, usa parámetros posicionales scipy y su repo no tiene licencia; BPSim es XML con IDREF y substitutionGroups, hostil para JSON-patch desde agentes y sin tooling OSS; Bizagi no exporta parámetros. Adoptar el vocabulario BPSim hace el mapeo 1:1 y adoptar el JSON Prosimos como adaptador hace gratis la entrada de Simod.
- **Reinterpretación de ADR-006 (own the abstraction layer)** → No escribir una interfaz `SimulationScheduler` abstracta sobre SimPy; los contratos estables son tres JSON (IR, escenario, resultado/log) y el módulo `services`.
  - _Por qué_: Una abstracción de scheduler es especulativa (YAGNI): nadie va a cambiar de kernel sin reescribir la semántica BPMN. Lo que sí permite reemplazar el motor (por Rust/PyO3 o por Prosimos si obtiene licencia) es que UI, CLI, REST y MCP solo conozcan los JSON.
- **Editor BPMN** → bpmn-js 18.27.1 sin fork, watermark visible, panel de propiedades propio en React, extensión moddle `lila:` única.
  - _Por qué_: Única librería del sector con releases mensuales en 2026, tipos incluidos, ejemplos oficiales de extensión y renderer, y la UX 'nueva tarea → nombre editable' de serie (verificado en LabelEditingProvider.js). Reemplazarla es reescribir ~28k líneas; KIE bpmn-editor tiene una sola release y semántica jBPM. El watermark no se puede quitar ni en fork; se acepta.
- **Persistencia del MVP** → Archivos en git con layout `processes/<clave>/{model.bpmn, scenarios/*.json, runs/}` + `catalog.json`; Postgres detrás de la misma interfaz `Storage` en fase 3.
  - _Por qué_: Cero infraestructura antes de validar el motor (regla del corpus); los diffs de git separan cambios de parámetros de cambios de layout; el mismo JSON pasa a columnas jsonb sin transformación.
- **Dónde viven documentación y RACI** → Dentro del .bpmn: `bpmn:documentation` estándar + `lila:*Ref` en extensionElements apuntando a ids de `catalog.json`; parámetros de simulación fuera (escenario).
  - _Por qué_: Lo que describe al proceso debe sobrevivir al producto y viajar con el fichero (ADR-001); lo que describe un experimento (escenario) varía N veces por proceso. bpmn-moddle preserva namespaces ajenos en round-trip (verificado con Car Repair BPSim, qbp y Bizagi). Referencias, nunca texto libre: es la única decisión de dominio que forzaría reescritura si se toma mal.
- **Process mining y pm4py** → Paquete y distribución separados `lila-mining` bajo AGPL-3.0, comunicándose con el núcleo por CSV/XES/JSON y subproceso/servicio; núcleo Apache-2.0.
  - _Por qué_: pm4py es AGPL-3.0 desde 2.7.12 (verificado); enlazarlo contaminaría el núcleo. El equipo de Prosimos lo retiró por la misma razón (issue #56). Simod (Apache-2.0) exige Java 1.8 y Python <3.12, así que también vive en su propio entorno y entra por el adaptador Prosimos.
- **Servidor y MCP** → FastAPI 0.141 + SDK oficial `mcp` 2.1.1 sobre un único módulo `services`; `lila serve` = un proceso que sirve SPA + API; MCP por stdio primero.
  - _Por qué_: Un solo proceso local es el mínimo de piezas móviles con un motor Python; el SDK Python de MCP es Tier 1 y ya implementa la spec 2026-07-28 (verificado); el módulo `services` garantiza ADR-003 (UI y agentes hacen lo mismo).
- **Modo navegador sin backend** → Milestone opcional M6 con Pyodide en Web Worker; no condiciona el MVP.
  - _Por qué_: Es el coste real de la apuesta Python: ~12 MB de runtime y ~1 s de arranque (medido), 2,3x más lento. Se mantiene viable por diseño (wheel puro sin numpy) pero se entrega después de CLI, servidor local y UI, porque el objetivo urgente es 'no Windows-only', no 'sin servidor'.
- **Validación numérica** → Tres oráculos: fórmulas analíticas (M/M/1, M/M/c, sumas), Scylla headless (job manual, JDK 17) y Prosimos en venv 3.11 con RNG sembrados; salidas guardadas como fixtures con tolerancia/IC.
  - _Por qué_: Prosimos no expone seed y no puede distribuirse; Scylla sí tiene seed. Las fórmulas son el único oráculo que no depende de código ajeno. Reproducir además los ejemplos oficiales de Bizagi (niveles 1-4) como fixtures facilita que un usuario académico migre comparando números.
- **Licencia del proyecto** → Apache-2.0 para núcleo, server, mcp y web; AGPL-3.0 solo para lila-mining; respetar bpmn.io license en la UI.
  - _Por qué_: Permisiva para adopción académica y empresarial; el único componente copyleft se aísla por obligación (pm4py). Se registra en ADR nuevo (resuelve parte de ADR-008).
- **Distribución del CLI** → `uv tool install lila-sim` / `uvx lila-sim`; sin binarios empaquetados en el MVP.
  - _Por qué_: uv es el estándar de facto en 2026 y evita PyInstaller; un binario único se evalúa solo si aparece un usuario sin Python.

## Riesgos

- Dos runtimes (Python + TypeScript) para una persona: duplica CI, empaquetado y superficie de errores; mitigación: uv workspace + pnpm con dos workflows simples, y la UI solo consume OpenAPI generado (sin lógica de dominio en TS).
- Modo navegador sin backend queda como opcional y pesado (~12 MB Pyodide, ~1 s de arranque, 2,3x más lento; medido hoy). Si Brito considera imprescindible 'sitio estático sin servidor' desde el día uno, esta propuesta es la equivocada y la ruta TypeScript gana.
- Rendimiento de SimPy (4–9x por debajo de un bucle a mano en JS): suficiente para paridad con Bizagi, pero réplicas Monte Carlo masivas (p. ej. 1.000 réplicas × 100k casos) tardarían minutos; mitigación: contratos JSON permiten reimplementar `engine/` en Rust vía PyO3 sin tocar nada más.
- Prosimos sin licencia: cualquier reutilización de código (no de ideas ni de formato) es ilegal; incluso correrlo como oráculo debe quedar fuera de la distribución y de la CI pública; mitigación: job manual, fixtures propios, issue pidiendo LICENSE a los autores (prosimos-docker/frontend son Apache-2.0, sugiere intención permisiva). La licencia del jar de QBP dentro de Prosimos no se ha verificado: no usarlo.
- Contaminación AGPL por pm4py y semántica 'arm's length' del subproceso: la separación por proceso y por distribución es la práctica común pero no una garantía jurídica; mitigación: lila-mining es opcional, se instala aparte y el núcleo funciona sin él; revisar con asesoría antes de distribuir binarios combinados.
- Simod exige Java 1.8 y Python <3.12 y depende de Prosimos: el 'descubrimiento automático de escenarios' vía Simod es frágil de instalar; mitigación: descubrimiento ligero propio con pandas cubre el 80 % (tasa de llegadas, empíricas por actividad, probabilidades de gateway) como hace Bizagi 4.0.
- Semántica no documentada de Bizagi (disciplina de cola, OR-join, tareas en curso al cerrar turno, cómo cuenta esperas por calendario): la paridad numérica exacta no es alcanzable ni verificable sin una VM Windows; mitigación: documentar las elecciones propias (FIFO, no preemptivo, OR-join por ramas activadas) y validar contra fórmulas y Scylla, no contra Bizagi.
- Round-trip del namespace `lila:` por otras herramientas (Camunda Desktop Modeler, Signavio, ADONIS) no está probado; mitigación: spike en M4 y fallback a `annotations.json` sidecar sin cambiar el dominio.
- Watermark de bpmn.io permanente en el producto; aceptado, pero debe reservarse espacio en el layout y avisarse en el README.
- Auto-layout de diagramas creados por agentes requiere Node (bpmn-auto-layout es JS) desde un servidor Python: dependencia cruzada de runtimes en fase 5; mitigación: decidir entonces entre subproceso Node o layout diferido al abrir en la UI.
- Bus factor de SimPy relativamente alto (28 contribuidores) pero cadencia lenta; si se estanca, el kernel son <2k líneas puras y se puede vendorizar (MIT).
- Tentación de reproducir los '4 niveles' de Bizagi como concepto de producto: no hacerlo; el motor degrada según los parámetros presentes.

## Cambios propuestos a los docs previos

- ARCHITECTURE.md: el diagrama sitúa 'DES Scheduler: SimPy / other' bajo un 'Simulation Core' abstracto; sustituir por: `lila-sim` (Python, SimPy directo) + contratos JSON (IR, escenario, resultado). Eliminar 'Python API' como interfaz aparte: el motor ES una librería Python. Añadir que la UI se sirve desde el mismo proceso FastAPI en local. 'Internal model ≠ BPMN XML' es correcto como destino, pero en el MVP el .bpmn + sidecars ES el modelo y la base de datos guardará el XML íntegro por versión con un índice derivado; corregir para no sugerir un segundo modelo canónico.
- SIMULATION_ENGINE.md: (1) borrar la interfaz `SimulationScheduler` (now/schedule/request_resource…) y la lista 'migrar entre SimPy / Custom / Rust / Other': es especulativa; reemplazar por los tres JSON como contrato. (2) La lista de distribuciones 'iniciales/después' se sustituye por las 13 de BPSim + constante + empírica desde M1 (cuestan 40 líneas con stdlib). (3) El ejemplo de escenario ('scenario', 'arrivals', 'resources': [], 'activities', 'routing') se sustituye por el formato v0.1 keyed por id con vocabulario BPSim (arrivals por start event, tasks.processing_time, resources.quantity, gateways). (4) Añadir la degradación por parámetros ausentes (sin recursos ⇒ infinito, sin calendario ⇒ 24×7) y la parada 'duración o trigger_count, lo primero'. (5) Añadir columnas exactas de Bizagi al apartado Outputs y la regla de utilización sobre tiempo disponible. (6) Event log: fijar columnas (case_id, activity_id, resource_id, enabled_at, started_at, ended_at, wait_s, proc_s, cost) y XES mínimo sin pm4py.
- DECISIONS.md: ADR-005 'Evaluate before fork' está cumplido: registrar el resultado (Use: SimPy, bpmn-js, bpmn-moddle, FastAPI, mcp; Wrap como oráculo: Prosimos, Scylla; Replace: motores BPMN; Ignore: BIMP/QBP, Apromore, Camunda, bpmn-engine, Rust DES). ADR-006 se reinterpreta (contratos JSON, no scheduler abstracto). Añadir ADR-009 lenguaje del motor (Python/SimPy, sin numpy), ADR-010 formato de escenario v0.1 con vocabulario BPSim y adaptadores Prosimos/qbp/BPSim, ADR-011 namespace lila: y política de ids (NCName, nunca regenerar; clave de proceso = process@id + version_tag), ADR-012 licencias (Apache-2.0 núcleo, AGPL-3.0 solo lila-mining, bpmn.io license aceptada con watermark), ADR-013 pm4py/Simod solo en proceso separado, ADR-014 modo navegador vía Pyodide como opcional, ADR-015 persistencia MVP en archivos con layout fijo. ADR-008: fijar el nombre 'Lila Modeler' (ya lo usa Brito) y cerrar la licencia.
- ROADMAP.md: Phase 0 'PoC 2 — Existing Simulation Engines' y 'Paso 4/5 de NEXT_STEPS' ya están resueltos por la investigación de hoy: eliminarlos y poner en su lugar M0–M6 con sus tests de aceptación. Phase 1 debe incluir calendarios y costos (Bizagi niveles 3-4), no solo recursos y colas, y los adaptadores Prosimos/qbp. Phase 2 (UI) y Phase 5 (MCP) se adelantan a M4/M5 porque el módulo `services` cuesta lo mismo hacerlo bien desde el principio. Phase 8 debe decir explícitamente 'paquete separado AGPL' y 'descubrimiento ligero propio + puente Simod opcional'.
- NEXT_STEPS.md: la estructura sugerida (engine/, web/, packages/, examples/, tests/) se reemplaza por el árbol de esta propuesta (uv workspace + pnpm); el benchmark del Paso 2 se concreta (Start → Registrar → XOR 70/30 → Revisar|Aprobación rápida → AND Notificar‖Archivar → End, pool analista×2); el Paso 3 (spike bpmn-js) cambia a: importar fixture Bizagi, crear tarea, verificar edición inmediata, añadir `lila:` vía descriptor moddle y comprobar que bizagi:* sobrevive; los Pasos 4-5 se eliminan (decidido).
- DEPENDENCY_STRATEGY.md: la tabla 'Investigación continua' está desactualizada; rellenar con datos verificados hoy: bpmn-js 18.27.1 (bpmn.io license, muy activo, USE), bpmn-moddle 10.2.0 (MIT, USE), SimPy 4.1.2 (MIT, USE), Scylla (MIT, push 2025-04, ORACLE), Prosimos 2.0.6 (SIN LICENCIA, main 2025-01, ORACLE/format only), Simod 5.1.6 (Apache-2.0, Java 1.8, fase 8), BIMP/QBP (cerrado, IGNORE; esquema qbp como import), Apromore (archivado 2025-08, IGNORE), pm4py 2.7.23.8 (AGPL-3.0, aislado), Camunda 8 (Camunda License, IGNORE), bpmn-engine (MIT, motor de ejecución, IGNORE), DES en TS/Rust (marginales, IGNORE). Añadir la regla 'nada de Prosimos en el árbol de fuentes ni en CI pública hasta que exista LICENSE'.
- AGENT_API_MCP.md: mantener la lista de operaciones pero ordenarla por milestone (M5: validate_bpmn, get_ir, scenarios CRUD/patch, run_simulation, get_results, compare_runs, find_bottlenecks; fase 4-5: RACI/catalog; fase 5: create_activity/connect_elements con nota sobre auto-layout en Node). Indicar SDK concreto (mcp 2.1.1, spec 2026-07-28, stdio primero) y que las tools llaman a `lila_server.services`.
- PRODUCT_VISION.md: añadir el posicionamiento frente a Bizagi verificado hoy (Modeler 4.3 sigue Windows-only, sin editor web, foro en mantenimiento, usuarios se quejan de poca granularidad de resultados) y la lista de lo que Lila da 'gratis' (percentiles, colas, throughput, costo por caso, event log por caso, macOS/Linux). Añadir explícitamente que el watermark de bpmn.io será visible.
- README.md: el ejemplo de salida (`process-sim run process.bpmn scenario.json`) pasa a `lila-sim run processes/pedido/model.bpmn processes/pedido/scenarios/as-is.scenario.json`; añadir `lila serve` y el modo navegador como opcional. El principio 3 'Fork cuando tenga sentido' debe registrar que, evaluado el ecosistema en 2026, no hay nada que forkear.
