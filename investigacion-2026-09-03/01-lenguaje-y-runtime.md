# Estrategia de lenguaje y runtime para el motor DES de Lila Modeler (TypeScript vs Python vs Rust) — navegador sin backend, CLI, REST, MCP y tests

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](../docs/) and [`README.md`](../README.md).

_Investigación verificada el 2026-09-03 por un agente con búsqueda web. Cada hallazgo lleva su nivel de confianza._

## Recomendación

Ruta A, TypeScript, con bucle de eventos propio. El núcleo (`sim-core`) debe ser un paquete TS puro con cero dependencias en runtime: heap binario de eventos, reloj, colas FIFO por recurso, RNG con semilla (mulberry32 o similar), distribuciones (constante, uniforme, exponencial, normal, triangular, lognormal), gateways XOR/AND con join, calendarios y costos; toma como entrada un IR JSON (nodos, aristas) + un escenario JSON y devuelve resultados JSON + event log tabular. El benchmark medido en esta máquina zanja la duda de rendimiento: 100.000 casos en 0,14 s en JS frente a 1,27 s en SimPy nativo y 2,8 s en SimPy bajo Pyodide; ninguna librería DES en TS tiene adopción (0–35 estrellas, un autor cada una), así que escribir las ~300 líneas del bucle es la norma y elimina un riesgo de mantenimiento. bpmn-moddle (MIT, bpmn.io, activo, verificado en round-trip con extensión propia) parsea .bpmn en Node y navegador sin arrastrar bpmn-js; conviene guardar el escenario en JSON aparte (ADR-007) y, si se quiere interoperabilidad futura, mapearlo a BPSim, porque Bizagi de todos modos no exporta sus parámetros de simulación. Con un solo lenguaje las cinco superficies salen casi gratis: Web Worker en el navegador (sin backend), CLI con Node/npx (o binario con bun --compile si hace falta), REST con cualquier microframework, MCP con @modelcontextprotocol/server 2.0 (Tier 1, spec 2026-07-28, ~15 líneas por tool) y tests con vitest. Estructura mínima: monorepo con `sim-core` (puro), `bpmn` (moddle → IR), `cli`, `mcp` y `web`; los contratos estables son tres JSON (IR, escenario, resultado/event log), no interfaces de scheduler abstractas.

Descartar B y C por ahora, sin cerrar puertas. Python como motor solo tiene sentido si el motor fuera una librería académica importable; pero el requisito "navegador sin backend" lo penaliza con ~12 MB de runtime Pyodide (9,2 MB wasm + 2,4 MB stdlib) más paquetes, ~1 s de arranque y una ralentización de 2,3x, además de una segunda toolchain, un parser BPMN sin opción permisiva mantenida (SpiffWorkflow es LGPL; Prosimos no tiene licencia; bpmn_python GPL abandonado). Rust queda como opción de optimización futura que hoy no resuelve ningún problema real: no hay crate DES con primitivas de recursos/colas que ahorre trabajo (nexosim es actor-based, sim es experimental, desim GPL+nightly), y el toolchain, aunque vivo, acaba de reorganizarse (rustwasm archivado, wasm-pack muerto). Si algún día hiciera falta, el diseño de contratos JSON permite reimplementar `sim-core` en Rust→WASM/PyO3 detrás de la misma interfaz sin tocar UI, CLI ni MCP.

La fase de process mining no queda comprometida: es Python por naturaleza (pm4py, pandas), pero se conecta por datos, no por lenguaje. El motor TS debe emitir desde el día uno un event log por caso/actividad/recurso/timestamps en CSV (y opcionalmente XES), que es exactamente lo que pm4py y Simod consumen; el mining vivirá como proceso Python separado invocado por CLI o como servicio aislado. Ese aislamiento además es obligatorio por licencia: pm4py es AGPL-3.0 desde 2.7.12, y mezclarlo con el núcleo contaminaría el producto. Un cliente Python fino que llame a la CLI (subprocess) o a la REST cubre el caso "API Python" para usuarios académicos sin necesidad de bindings nativos.

## Hallazgos

- **[verified]** Benchmark propio (este Mac, Node 24.16.0): un bucle de eventos escrito a mano en JS (heap binario + reloj + colas FIFO por recurso, 27 líneas) simula un proceso de 5 tareas secuenciales con recursos limitados (cap 1–3), llegadas exponenciales y duraciones triangulares: 10.000 casos (60.000 eventos) en 30,5 ms y 100.000 casos (600.000 eventos) en 143,5 ms (~2–4 M eventos/s).
  - _Evidencia_: Script des.js ejecutado en /private/tmp/claude-501/.../scratchpad/bench. Salida: 'JS cases=10000 events=60000 ms=30.5 events/s=1.96e+6 avgCT=61.99 p95=86.40' y 'JS cases=100000 events=600000 ms=143.5 events/s=4.18e+6'.
- **[verified]** El mismo modelo escrito a mano en CPython 3.14.5 (heapq) tarda 40,5 ms (10k casos) y 466,5 ms (100k casos): ~1,3–1,5 M eventos/s, es decir 1,3x–3,3x más lento que JS según el tamaño.
  - _Evidencia_: Script des.py: 'PY cases=10000 events=60000 ms=40.5 events/s=1.48e+06' y 'PY cases=100000 ms=466.5 events/s=1.29e+06'. Mismos KPIs que JS (avgCT≈61.3, p95≈85, utilización idéntica), lo que valida cruzadamente ambos motores.
- **[verified]** SimPy 4.1.2 nativo (procesos por generadores + simpy.Resource) tarda 126 ms para 10k casos y 1.273 ms para 100k (~79.000 casos/s): unas 4x más lento que el bucle a mano en JS a 10k y ~9x a 100k, con resultados estadísticamente equivalentes.
  - _Evidencia_: Script des_simpy.py en venv uv con simpy 4.1.2: 'SIMPY cases=10000 ms=126.3 cases/s=7.92e+04 avgCT=61.30 p95=83.63 util=[0.47,0.67,0.53,0.67,0.43]' y 'SIMPY cases=100000 ms=1272.7'.
- **[verified]** Pyodide 314.0.6 (CPython 3.14.2 en WASM) ejecuta el DES a mano 2,4x más lento que CPython nativo (99 ms / 1.084 ms) y SimPy bajo Pyodide 2,3x más lento que SimPy nativo (288 ms / 2.798 ms). Cargar el runtime desde disco local en Node tarda ~820 ms; micropip install simpy (red) ~876 ms adicionales.
  - _Evidencia_: Script pyo.mjs con npm pyodide@314.0.6: 'pyodide 314.0.6 load ms=820', 'PYODIDE cases=10000 ms=99.1', 'PYODIDE cases=100000 ms=1083.7', 'micropip install simpy ms=876', 'SIMPY-PYODIDE cases=10000 ms=288.0', 'SIMPY-PYODIDE cases=100000 ms=2797.6'. sys.version dentro de Pyodide: '3.14.2 (main, Aug 25 2026 ...)'. SimPy es wheel puro, se instala vía micropip sin problema.
- **[verified]** Coste de arranque de Python en navegador: el núcleo de Pyodide pesa 9,2 MB (pyodide.asm.wasm) + 2,4 MB (python_stdlib.zip) ≈ 11,6 MB antes de cualquier paquete; numpy 2.8 MB, pandas 4.0 MB (+numpy, dateutil, pytz), scipy 13,4 MB (wheels wasm32 en el CDN oficial v314.0.6). Un simulador Python en navegador implica descargar ~12–20 MB y ~1 s+ de inicialización, frente a 0 MB extra para un motor TS.
  - _Evidencia_: Tamaños medidos: 'ls -l node_modules/pyodide/pyodide.asm.wasm → 9.2 MB', 'python_stdlib.zip → 2.4 MB'; cabeceras Content-Length de https://cdn.jsdelivr.net/pyodide/v314.0.6/full/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl (2.8 MB), pandas-3.0.2 (4.0 MB), scipy-1.18.0 (13.4 MB). Literatura previa (hacks.mozilla.org 2021) citaba 6,4 MB y 4–5 s de init; las cifras 2026 medidas aquí son mayores en tamaño. Pyodide npm license MPL-2.0; último release 314.0.6 el 2026-08-25 (gh releases).
- **[verified]** No existe una librería DES en TypeScript con adopción real: simloop 0.5.1 (MIT, creada 2026-03-28, 0 estrellas, un autor, ~1.000 líneas dist), discrete-sim 0.1.8 (MIT, 3 estrellas, último push 2026-02-15, estilo SimPy con generadores), SimScript 1.0.37 (MIT/ISC, 35 estrellas, último push 2024-03-04, orientado a animación), simjs 2.0.3 (repo sin commits desde 2016). El patrón habitual es escribir el bucle de eventos a mano.
  - _Evidencia_: npm view: simloop 0.5.1 MIT modified 2026-04-11, repo github.com/Mettiu88/simloop (gh api: created_at 2026-03-28, stars 0); discrete-sim 0.1.8 MIT modified 2026-02-15 (gh: stars 3, pushed 2026-02-15); simscript 1.0.37 ISC modified 2022-05-17 (gh: MIT, stars 35, pushed 2024-03-04); simjs 2.0.3 (gh btelles/simjs-updated pushed 2016-05-17). wc -l: simloop/dist/index.js 1002 líneas, discrete-sim/dist/index.js 3451. Exports verificados por import ESM (simloop: SimulationEngine, Resource, Queue, SeededRandom, triangular, exponential...; discrete-sim: Simulation, Resource, Store, Process, Random...).
- **[verified]** bpmn-moddle 10.2.0 (MIT, bpmn.io, publicado 2026-08-25) parsea y serializa BPMN 2.0 en Node y navegador y preserva extensiones con namespace propio en round-trip, lo que permite leer .bpmn en el motor TS sin depender de bpmn-js ni del DOM.
  - _Evidencia_: Smoke test moddle.mjs: 'parsed nodes: StartEvent:s Task:t1 ExclusiveGateway:g Task:t2 EndEvent:e SequenceFlow:f1...', 'extension read back: lila:duration', 'roundtrip keeps extension: true', warnings 0. npm view bpmn-moddle: version 10.2.0, license MIT, type module (export nombrado BpmnModdle, no default). gh api bpmn-io/bpmn-moddle: MIT, 510 estrellas, pushed 2026-08-28.
- **[verified]** bpmn-js 18.27.1 se publicó el 2026-09-03 (mismo día de esta investigación); su licencia es MIT modificada: exige mantener visible la marca de agua bpmn.io en los diagramas renderizados. bpmn-js-token-simulation 0.40.0 (MIT, push 2026-08-28) solo anima tokens; no hace simulación cuantitativa (sin recursos, colas ni tiempos).
  - _Evidencia_: npm view bpmn-js: 18.27.1, time.modified 2026-09-03T14:01Z, license 'SEE LICENSE IN LICENSE'. LICENSE en github.com/bpmn-io/bpmn-js: 'The source code responsible for displaying the bpmn.io project watermark ... MUST NOT be removed or changed'. github.com/bpmn-io/bpmn-js-token-simulation: 'A BPMN 2.0 specification compliant token simulator, built as a bpmn-js extension', 312 estrellas.
- **[verified]** Ecosistema MCP (sept. 2026): SDKs oficiales Tier 1 = TypeScript, Python, C#, Go, Rust; Tier 2 = Java, Ruby; Tier 3 = Swift, PHP, Kotlin. La spec vigente es 2026-07-28 (protocolo pasa a request/response sin sesión, cabeceras Mcp-Method/Mcp-Name, Tasks como extensión, Roots/Sampling/Logging deprecados). TypeScript, Python, Go y C# ya la implementan; Rust en beta.
  - _Evidencia_: https://modelcontextprotocol.io/docs/2026-07-28/sdk (tabla de tiers) y https://modelcontextprotocol.io/community/sdk-tiers (Tier 1 = 100% conformance, triage en 2 días hábiles). https://blog.modelcontextprotocol.io/posts/2026-07-28/: 'MCP is transforming from a bidirectional stateful protocol into a request/response stateless protocol'; 'Four Tier 1 SDKs support the specification: TypeScript, Python, Go, and C#. The Rust SDK supports it in beta'.
- **[verified]** Un servidor MCP es trivial tanto en TS como en Python: TS v2 = paquetes @modelcontextprotocol/server y @modelcontextprotocol/client 2.0.0 (publicados 2026-07-28; el paquete legado @modelcontextprotocol/sdk sigue en 1.30.0 con soporte ≥6 meses), ejemplo mínimo de ~15 líneas con McpServer + registerTool + zod + StdioServerTransport. Python = paquete mcp 2.1.1 (2026-08-25, Python ≥3.10), ejemplo mínimo de 5 líneas con MCPServer y decorador @mcp.tool(). Rust = crate rmcp 3.2.0 (2026-08-31).
  - _Evidencia_: npm view @modelcontextprotocol/server → 2.0.0, modified 2026-07-28; @modelcontextprotocol/sdk → 1.30.0 MIT. README typescript-sdk: import { McpServer } from '@modelcontextprotocol/server'; server.registerTool('greet', { description, inputSchema: z.object({ name: z.string() }) }, async ({ name }) => ({ content: [{ type: 'text', text: ... }] })); 'v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release'. README python-sdk: from mcp.server import MCPServer; mcp = MCPServer('Demo'); @mcp.tool() def add(a: int, b: int) -> int. PyPI mcp 2.1.1 upload 2026-08-25, requires_python >=3.10. crates.io rmcp 3.2.0 updated 2026-08-31, 24 M descargas.
- **[verified]** Python DES: SimPy 4.1.2 (MIT, release 2026-05-24, Python ≥3.8, activo), salabim 26.0.8 (MIT según PyPI, release 2026-06-24, push 2026-05-29; el repo no tiene archivo LICENSE), Ciw 3.2.7 (MIT, release 2025-12-05, redes de colas abiertas). Todos son wheels puros ejecutables en Pyodide.
  - _Evidencia_: pypi.org/project/simpy: 'Latest Version: 4.1.2, Release Date: May 24, 2026, MIT License, Python >=3.8'. pypi salabim: 26.0.8, 2026-06-24, classifier 'OSI Approved :: MIT License'; gh api salabim/salabim license null, root sin LICENSE. pypi Ciw 3.2.7 2025-12-05; gh api CiwPython/Ciw license MIT, pushed 2025-12-05.
- **[verified]** Prosimos (simulador BPMN Python de la Univ. de Tartu) NO tiene archivo LICENSE en el repo ni metadato de licencia en PyPI (2.0.6): legalmente 'todos los derechos reservados' salvo aclaración. Último commit 2025-01-30, fijado a Python >=3.9,<3.12. No es reutilizable como dependencia sin resolver la licencia.
  - _Evidencia_: gh api repos/AutomatedProcessImprovement/Prosimos → license: null; listado raíz: '.github .gitignore .pylintrc README.md bimp_simulation_engine bpdfr_discovery cli htmlcov.zip input_output_files.zip poetry.toml prosimos pyproject.toml ...' (sin LICENSE). pyproject: name='prosimos', version='2.0.6', python='>=3.9,<3.12'. PyPI prosimos: license None, classifiers []. Últimos commits: 2025-01-30 'Merge pull request #73 ... batching_stats'. Funcionalmente sí cubre recursos diferenciados, calendarios semanales, probabilidades de gateway, batching (README).
- **[verified]** Otros simuladores BPMN existentes son Java y de baja actividad: Scylla (MIT, Java 11+, último push 2025-04-08, 26 estrellas, genera XES) y BIMP/QBP (bimp-ui MIT, último push 2023-01-07). Simod (Apache-2.0, descubre modelos de simulación a partir de logs) último push 2025-06-13. Ninguno corre en navegador sin backend.
  - _Evidencia_: gh api bptlab/scylla: MIT, pushed 2025-04-08, stars 26; README: 'Scylla is an extensible business process simulator', 'Produces XES event logs'. gh api qbpsimulator/bimp-ui: MIT, pushed 2023-01-07. gh api AutomatedProcessImprovement/Simod: Apache-2.0, pushed 2025-06-13.
- **[verified]** Rust DES: nexosim 1.0.0 (Apache-2.0/MIT, crates.io 2026-02-03, push 2026-08-10, 299 estrellas) es un framework de actores asíncronos para simulación de sistemas, sin primitivas tipo Resource/Queue de SimPy; sim/sim-rs 0.13.1 (MIT/Apache, 2025-04-26, 55 estrellas, badge 'experimental', publicado también como npm vía wasm); desim 0.4.0 (GPL-3.0, requiere feature nightly de generadores, última versión 2023-11-25). Ninguno ahorra trabajo real frente a un bucle propio de ~30–300 líneas.
  - _Evidencia_: crates.io: nexosim 1.0.0 updated 2026-02-03 (19k descargas); sim 0.13.1 updated 2025-04-26; desim 0.4.0 updated 2023-11-25. docs.rs nexosim README: 'an asynchronous implementation of the actor model, where each simulation model is an actor'; 'does not describe SimPy-like resource or queue primitives'. github ndebuhr/sim: 'experimental' stability badge, 'compatible with ... WebAssembly', npm 'sim-rs'. gh api garro95/desim: GPL-3.0, 'using the generator experimental feature', pushed 2024-09-23.
- **[verified]** Toolchain Rust→WASM y Rust→Python es maduro y está mantenido en 2026, pero cambió de manos: la org rustwasm se archivó (anuncio 2025-07-21, archivado sept. 2025), wasm-pack quedó archivado, y wasm-bindgen continúa en su propia org (0.2.118, 2026-04-10, push 2026-09-03). PyO3 0.29.x (CPython ≥3.9, wheels free-threaded 3.13t) y maturin siguen activos (push 2026-09-02 y 2026-08-31). Este equipo no tiene cargo/rustc instalado hoy.
  - _Evidencia_: blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/: 'The wasm-bindgen repository is going to be transferred to a new wasm-bindgen organization with new additional maintainers'; 'In September of 2025 the rustwasm GitHub organization will be archived'. gh api wasm-bindgen/wasm-bindgen: Apache-2.0, 9137 estrellas, pushed 2026-09-03; README MSRV table 0.2.118 2026-04-10. github PyO3/pyo3: 0.29.2, 'CPython 3.9 or greater', maturin recomendado. gh api PyO3/pyo3 pushed 2026-09-02, PyO3/maturin pushed 2026-08-31. Local: 'cargo not found', 'rustc not found'.
- **[unverified]** Rendimiento esperado de un motor Rust→WASM para este workload: probablemente 2–5x más rápido que V8 JIT, es decir 100k casos en ~30–70 ms frente a ~143 ms en JS. No aporta valor práctico: el JS ya resuelve 100k casos en 0,14 s en el hilo de un Web Worker.
  - _Evidencia_: No medido (sin toolchain Rust en la máquina). Estimación por analogía con literatura general WASM-vs-JS; el dato firme es el JS medido (143,5 ms / 100k casos).
- **[verified]** PM4Py (process mining, Python) es AGPL-3.0 desde la versión 2.7.12 (actual 2.7.22.x, push 2026-09-01), con licencia comercial separada. Usarlo dentro de un servicio de red obliga a liberar el código del servicio bajo AGPL; conviene aislarlo en un proceso/servicio Python separado que consuma event logs (CSV/XES) y no enlazarlo al núcleo.
  - _Evidencia_: github.com/process-intelligence-solutions/pm4py/blob/release/LICENSE: 'GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007'. gh api: AGPL-3.0, pushed 2026-09-01, 1020 estrellas. Búsqueda: 'for versions before 2.7.12, PM4Py used GPL-3.0, and from version 2.7.12 onwards, it switched to AGPL-3.0-or-later'; página comercial pm4py.fit.fraunhofer.de/solution-licensing.
- **[verified]** Parsers BPMN en Python: SpiffWorkflow 3.2.0 (LGPL-3.0, release 2026-08-10) es la única opción mantenida; bpmn_python 0.0.18 es GPL y está abandonado desde 2017-07-14. Un motor Python tendría que parsear BPMN con lxml a mano o aceptar LGPL/AGPL (pm4py también importa BPMN).
  - _Evidencia_: PyPI JSON: SpiffWorkflow 3.2.0, license 'lGPLv3', upload 2026-08-10; bpmn_python 0.0.18, 'GNU GENERAL PUBLIC LICENSE', upload 2017-07-14. spiffworkflow.readthedocs.io/en/latest/bpmn/parsing.html.
- **[likely]** BPSim (WfMC) es el único estándar para parámetros de simulación sobre BPMN (categorías time/control/resource/cost/property/priority; spec 1.0 2013, 2.0 2016). Bizagi Modeler exporta BPMN 2.0 pero su ayuda indica que los atributos extendidos no se incluyen en la exportación, así que no hay que esperar importar escenarios Bizagi; solo el diagrama .bpmn.
  - _Evidencia_: https://www.bpsim.org/specifications/2.0/WFMC-BPSWG-2016-01.pdf y /1.0/WFMC-BPSWG-2012-01.pdf. Paper Lancaster (eprints.lancs.ac.uk/86603): 'BPSim is the only standard specifically designed to support the simulation of a BPMN diagram'. help.bizagi.com/platform/en/exporting_to_bpmn.htm (vía resumen de búsqueda): 'when you export a diagram, its extended attributes are not included in the generated package'. No se encontró librería JS 'bpsim-moddle' pública; bpmn-moddle admite esquemas de extensión propios (ej. bpmn-i18n-moddle).
- **[likely]** Distribución de una CLI TypeScript sin exigir Node instalado es viable: Node.js SEA (aún marcado experimental) o 'bun build --compile' generan un binario único; npx sigue siendo el camino cero-esfuerzo.
  - _Evidencia_: nodejs.org docs 'Single executable applications' ('still an experimental feature'); bun.sh/docs/bundler/executables ('bun build ./cli.ts --compile --outfile mytool').
- **[likely]** Un motor TS en un Web Worker cubre 'navegador sin backend' con el mismo código que la CLI Node y el servidor MCP: los 27 líneas del benchmark corren sin cambios en Node 24 y en cualquier navegador moderno (solo usa Math, arrays y performance.now).
  - _Evidencia_: des.js no importa módulos ni usa APIs de Node; ejecutado en Node 24.16.0. Los Web Workers y worker_threads exponen el mismo modelo de mensajería postMessage.

## Preguntas abiertas

- Rendimiento real de Rust→WASM para este workload no se midió (no hay cargo/rustc en la máquina); solo relevante si algún día se simulan millones de casos o réplicas Monte Carlo masivas en navegador.
- Tiempo de carga de Pyodide en un navegador real con red (aquí se midió 820 ms desde disco local en Node); irrelevante si se elige TS, pero pendiente si se reabre la ruta Python.
- ¿Brito quiere una API Python importable para usuarios académicos? Si sí, decidir entre cliente fino sobre CLI/REST (recomendado) o bindings nativos (innecesarios con TS).
- Formato exacto de escenario: JSON propio desde el día uno con mapeo opcional a BPSim, o BPSim embebido en el .bpmn; depende de si se busca interoperar con Enterprise Architect/otros que sí leen BPSim.
- Política de licencia del producto frente a pm4py (AGPL-3.0): confirmar que el mining irá en proceso/servicio separado y qué licencia tendrá el núcleo (MIT/Apache vs AGPL) antes de escribir código de mining.
- Bizagi: confirmar en la ayuda oficial (no solo en el resumen de búsqueda) que la exportación BPMN omite los parámetros de simulación, para fijar la expectativa 'solo importamos el diagrama'.
- Semántica de calendarios y de join paralelo en el bucle propio: definir el test de aceptación (proceso benchmark del corpus) y validar contra SimPy como oráculo, como se hizo aquí con el caso de 5 tareas.

## Fuentes

- Benchmarks locales: /private/tmp/claude-501/-Users-brito-development-Lila-Modeler/51a9369c-edce-4d04-b666-b7f1a3e95b1a/scratchpad/bench/{des.js,des.py,des_simpy.py,pyo.mjs,moddle.mjs} (Node 24.16.0, CPython 3.14.5, simpy 4.1.2, pyodide npm 314.0.6, bpmn-moddle 10.2.0)
- https://modelcontextprotocol.io/docs/2026-07-28/sdk
- https://modelcontextprotocol.io/community/sdk-tiers
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md
- https://github.com/modelcontextprotocol/python-sdk/blob/main/README.md
- https://pypi.org/pypi/mcp/json
- https://crates.io/api/v1/crates/rmcp
- https://www.npmjs.com/package/@modelcontextprotocol/server
- https://www.npmjs.com/package/simloop
- https://github.com/Mettiu88/simloop
- https://github.com/anesask/discrete-sim
- https://github.com/Bernardo-Castilho/SimScript
- https://github.com/btelles/simjs-updated
- https://github.com/bpmn-io/bpmn-moddle
- https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE
- https://github.com/bpmn-io/bpmn-js-token-simulation
- https://pypi.org/project/simpy/
- https://pypi.org/project/salabim/
- https://pypi.org/project/Ciw/
- https://github.com/CiwPython/Ciw
- https://github.com/AutomatedProcessImprovement/Prosimos
- https://pypi.org/pypi/prosimos/json
- https://github.com/AutomatedProcessImprovement/Simod
- https://github.com/bptlab/scylla
- https://github.com/qbpsimulator/bimp-ui
- https://github.com/pyodide/pyodide (releases API)
- https://cdn.jsdelivr.net/pyodide/v314.0.6/full/ (Content-Length de numpy/pandas/scipy wheels)
- https://hacks.mozilla.org/2021/04/pyodide-spin-out-and-0-17-release/
- https://github.com/pyodide/pyodide/discussions/1406
- https://docs.rs/crate/nexosim/latest/source/README.md
- https://crates.io/api/v1/crates/nexosim
- https://github.com/ndebuhr/sim
- https://crates.io/api/v1/crates/sim
- https://crates.io/api/v1/crates/desim
- https://github.com/garro95/desim
- https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/
- https://github.com/wasm-bindgen/wasm-bindgen
- https://github.com/PyO3/pyo3
- https://github.com/PyO3/maturin
- https://github.com/process-intelligence-solutions/pm4py/blob/release/LICENSE
- https://pm4py.fit.fraunhofer.de/solution-licensing
- https://pypi.org/pypi/SpiffWorkflow/json
- https://pypi.org/pypi/bpmn_python/json
- https://www.bpsim.org/specifications/2.0/WFMC-BPSWG-2016-01.pdf
- https://www.bpsim.org/specifications/1.0/WFMC-BPSWG-2012-01.pdf
- https://eprints.lancs.ac.uk/id/eprint/86603/1/article_rr_v6_np.pdf
- https://help.bizagi.com/platform/en/exporting_to_bpmn.htm
- https://beta.docs.nodejs.org/single-executable-applications
- https://bun.sh/docs/bundler/executables
