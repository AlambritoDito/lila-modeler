# Estado 2026 de motores open source de simulación BPMN y tooling DES (Prosimos, Simod, Scylla, BIMP/QBP, Apromore, bpmn-js-token-simulation, bpmn-engine, Camunda/Zeebe, AgentSimulator, DeepSimulator, RIMS, prosit, casymda, bpmn-os, miroboard, SimPy, salabim, Ciw, DES en JS/TS, DES en Rust/WASM, BPSim, Bizagi como referencia)

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](../docs/) and [`README.md`](../README.md).

_Investigación verificada el 2026-09-03 por un agente con búsqueda web. Cada hallazgo lleva su nivel de confianza._

## Recomendación

Conclusión dura: en 2026 no existe un motor DES BPMN open source que Lila Modeler pueda adoptar como núcleo bajo las restricciones de Brito (licencia permisiva, macOS/Linux/navegador, mantenible por una persona, sin JVM). Prosimos tiene la mejor semántica (recursos diferenciados, calendarios, batching, prioridades, atributos de caso) pero no tiene licencia, embebe jars propietarios de QBP, exige Python <3.12 con dependencias pesadas, no expone seed y su main lleva estancado desde enero de 2025. Scylla es MIT y cubre más BPMN, pero es Java + Swing + DESMO-J de 2017 + XML propio. BIMP/QBP es cerrado, Apromore está archivado y su simulación es enterprise, bpmn-engine/Camunda/SpiffWorkflow son motores de ejecución (semántica y licencias equivocadas), y los DES genéricos en JS/TS o Rust son proyectos de una persona o exceso de toolchain. Por tanto la 'Ruta B' del corpus previo gana: escribir un motor propio, pequeño, detrás de la interfaz propia (ADR-006), y usar Prosimos y Scylla únicamente como oráculos numéricos en el PoC (mismo benchmark .bpmn corrido en los tres; las salidas de Prosimos/Scylla se guardan como fixtures con tolerancia estadística).

Estructura mínima recomendada: un paquete `engine` en TypeScript, sin dependencias de UI, con (1) parser BPMN vía bpmn-moddle (MIT) a una IR propia (nodos: start/end/task/xor/and/or/timer; aristas), (2) un kernel DES de ~300-500 líneas (heap de eventos con reloj virtual, colas por recurso con capacidad y calendario semanal, PRNG sembrado propio tipo xoshiro/mulberry32 para determinismo total), (3) un esquema JSON de escenario separado del diagrama (ADR-007) modelado sobre las secciones de Prosimos — perfiles de recurso con cantidad/costo por hora/calendario, distribución y calendario de llegadas, probabilidades por gateway, distribución por (tarea, recurso), calendarios — sin copiar código, (4) salida: event log tabular (case_id, activity, resource, enabled/start/end) más KPIs agregados (ciclo p50/p90/p95, espera, utilización, throughput, costo, cuello de botella). El mismo bundle corre en Node (CLI `process-sim run`, REST, MCP, tests) y en el navegador dentro de un Web Worker; esto elimina el segundo runtime. Si Brito prefiere Python, SimPy (MIT, puro, 28 contribuidores, corre en Pyodide) es el único kernel que vale la pena, pero cuesta dos runtimes y empaquetado Pyodide. Cubrir primero exactamente los cuatro niveles de Bizagi (validación, tiempo, recursos, calendarios) con las trece distribuciones de BPSim; dejar subprocesos embebidos, boundary/timer events e inclusive gateway para después. Integrar bpmn-js-token-simulation (MIT) como la vista de 'Nivel 1' de validación de rutas, dejando claro que no es DES.

Decisiones de licencia y alcance: mantener el núcleo libre de AGPL/LGPL (pm4py, SpiffWorkflow) y de Camunda License; respetar la cláusula de watermark de bpmn-js o presupuestar su reemplazo más adelante. Diferir Rust/WASM hasta que un spike demuestre que 10k casos × ~20 actividades no corren en segundos en TS. Planear BPSim 2.0 como formato de import/export opcional (XSD gratuito) para interoperar con Bizagi/Trisotech/L-SIM, y el esquema qbp de BIMP como import de cortesía porque es lo que emiten Simod/Prosimos/Apromore CE. Revisitar Simod/prosit/AgentSimulator solo en la fase de process mining (descubrir escenarios AS-IS desde logs).

## Hallazgos

- **[verified]** Prosimos (U. Tartu, AutomatedProcessImprovement/Prosimos) — Python 3.9–3.11, motor DES BPMN con recursos diferenciados. NO tiene archivo LICENSE en main, el pyproject no declara licencia y PyPI muestra licencia vacía: legalmente es 'todos los derechos reservados' salvo aclaración de los autores (Iryna Halenok, Orlenys López-Pintado).
  - _Evidencia_: gh api repos/AutomatedProcessImprovement/Prosimos → license: null; repos/.../license → 404; árbol raíz sin LICENSE; pyproject.toml sin campo license; https://pypi.org/pypi/prosimos/json license ''. Repos hermanos prosimos-docker / prosimos-frontend / prosimos-microservice sí son Apache-2.0, lo que sugiere intención permisiva no formalizada.
- **[verified]** Prosimos — actividad: último release PyPI/GitHub 2.0.6 el 2024-09-30; último commit en main 2025-01-30; hay una rama 'short-term-simulation' con commits hasta 2026-06-16 (el pushed_at 2026-06 del repo viene de esa rama, no de main). 5 contribuidores, 13 estrellas, 13 issues abiertos. CI GitHub Actions (pytest en Python 3.9) y ~80 funciones de test en testing_scripts/.
  - _Evidencia_: gh api releases/latest → 2.0.6 2024-09-30; commits?sha=main → 2025-01-30; commits?sha=short-term-simulation → 2026-06-16; Link header contributors=5; .github/workflows/python.yml; grep -c 'def test_' = 80.
- **[verified]** Prosimos — elementos BPMN: enum interno TASK, START/END, INTERMEDIATE_EVENT (catch: TIMER, MESSAGE, LINK, SIGNAL, TERMINATE), EXCLUSIVE, INCLUSIVE, PARALLEL y EVENT_BASED gateway. Sin subprocesos, boundary events ni multi-instancia. Entrada: .bpmn estándar + JSON propio con secciones resource_profiles, arrival_time_distribution, arrival_time_calendar, gateway_branching_probabilities, task_resource_distribution, resource_calendars, batch_processing, case_attributes, prioritisation_rules. Calendarios semanales por recurso y de llegadas; costo por hora por recurso; distribuciones scipy.stats por (tarea, recurso).
  - _Evidencia_: prosimos/control_flow_manager.py (class BPMN, class EVENT_TYPE); simulation_properties_parser.py mapea xmlns:eventBasedGateway, intermediateCatchEvent, timerEventDefinition; simulation_scenario_example.json (keys listadas); README https://github.com/AutomatedProcessImprovement/Prosimos.
- **[verified]** Prosimos — salidas: CSV de estadísticas (KPIs por tarea, utilización por recurso, costos, waiting) y CSV de event log con columnas case_id, activity, enable_time, start_time, end_time, resource. Determinismo: no expone seed; usa numpy.random global, scipy rvs y random.shuffle sin seed → reproducibilidad solo si se siembran manualmente numpy y random antes de correr.
  - _Evidencia_: prosimos/file_manager.py header_row; simulation_stats.py; grep -rn seed prosimos/ → sin resultados; probability_distributions.py usa numpy.random / dist.rvs; control_flow_manager.py usa random.shuffle.
- **[verified]** Prosimos — dependencias pesadas y riesgo: exige pix-framework (que arrastra polars, pyarrow, optuna, m5py, pandasql), Python <3.12, y el repo incluye binarios propietarios del QBP simulator (bimp_simulation_engine/qbp-simulator-engine.jar) usados para comparación. No corre en navegador (Pyodide inviable por pyarrow/polars). Veredicto: REPLACE — no usar como dependencia ni forkear (licencia inexistente + jars propietarios + main estancado); usar como referencia semántica (esquema JSON de escenario, calendarios, recursos diferenciados) y como oráculo numérico en el PoC.
  - _Evidencia_: pyproject.toml python >=3.9,<3.12 y pix-framework ^0.14.0; PyPI pix-framework 0.14.2 requires polars/pyarrow/optuna/m5py; ls prosimos/bimp_simulation_engine → qbp-simulator-engine.jar, qbp-simulator-engine_with_csv_statistics.jar.
- **[verified]** Simod (AutomatedProcessImprovement/Simod) — Python, Apache-2.0, v5.1.6 (2025-05-27), 9 contribuidores, 53 estrellas, tests/ y docs/. NO es simulador: descubre modelos de simulación desde event logs (XES/CSV) y embebe Prosimos como motor; requiere Java 1.8 para el descubrimiento de control-flow. Veredicto: IGNORE por ahora; reconsiderar en la fase de process mining (descubrir escenario AS-IS desde logs).
  - _Evidencia_: gh api repos/.../Simod → Apache-2.0, release 5.1.6 2025-05-27; README: 'can be simulated using the Prosimos simulator, which is embedded in Simod', 'Java 1.8'; https://github.com/AutomatedProcessImprovement/Simod; paper SoftwareX 2025 https://www.sciencedirect.com/science/article/pii/S2352711025001244.
- **[verified]** Scylla (bptlab/scylla, HPI + TU Munich) — Java 11/17, MIT (copyright 2023 HPI BPT + TUM IS), 26 estrellas, 7 contribuidores, 34 issues; último commit 2025-04-08 ('Reconstruct bpmn activity ids for resource utilization logs'); único release etiquetado 0.0.1-SNAPSHOT (2023-08). CI Maven en JDK 11 y 17; 29 archivos de test JUnit 5 con tests parametrizados por seed (TestSeeds/SeedProvider) y RegressionSystemTests.
  - _Evidencia_: gh api repos/bptlab/scylla; clon local: pom.xml source/target 11, .github/workflows/CI.yml matrix [11,17], src/test/java/de/hpi/bpt/scylla/TestSeeds.java, RegressionSystemTests.java.
- **[verified]** Scylla — construido sobre DESMO-J 2.5.1e (jar vendorizado en lib/, última versión 2017-03-24, Apache-2.0, U. Hamburg) más OpenXES 2016. Entrada: uno o varios .bpmn + XML global propio (namespace bsim: recursos dinámicos con cantidad/costo/timetable, timetables semanales, zoneOffset, randomSeed opcional) + XML de simulación por proceso (arrivalRate, duration por tarea con distribuciones exponential/constant/normal/etc., recursos por tarea, branchingProbability por flujo). Salida: XES event log, logs de utilización de recursos y stats (cost, waiting, resourceUtilization). Seed determinista soportado (globalConfiguration.getRandomSeed()).
  - _Evidencia_: scylla/lib/desmoj-2.5.1e-bin.jar; pom.xml install-desmoj; samples/Kreditkarte_global_1.xml y Kreditkarte_sim_1.xml; samples/p61_conf_batch.xml <scy:randomSeed>; SimulationManager.java líneas 130-136; plugin statslogger_nojar; DESMO-J: https://en.wikipedia.org/wiki/DESMO-J.
- **[verified]** Scylla — cobertura BPMN vía plugins incluidos: boundaryevent, bpmntimer, bpmnerror, bpmnescalation, subprocess, batch, dataobject, eventArrivalRate, gateway_exclusive, gateway_inclusive, gateway_eventbased, xeslogger, statslogger. Es el motor open source con licencia permisiva más completo semánticamente, pero es JVM + GUI Swing, formato XML propio (no BPSim), DES base sin mantenimiento desde 2017 y sin posibilidad de correr en navegador. Veredicto: WRAP solo como oráculo de PoC (modo headless) para validar números del motor propio; NO como núcleo del producto ni fork.
  - _Evidencia_: ls scylla/src/main/java/de/hpi/bpt/scylla/plugin; README modo headless y SimulationManager API https://github.com/bptlab/scylla; wiki https://github.com/bptlab/scylla/wiki.
- **[verified]** Ecosistema Scylla periférico está muerto o marginal: scylla-ui (Angular, MIT, último commit 2018-03), SimuBridge (INSM-TUM, MIT, frontend + Scylla-Container REST + Simod; último commit 2024-08), Scylla-Plugin--SOPA (MIT, 2025-12, plugin de sostenibilidad). Veredicto: IGNORE.
  - _Evidencia_: gh api repos/bptlab/scylla-ui (pushed 2018-03-25); repos/INSM-TUM/SimuBridge (2024-08-19); repos/INSM-TUM/Scylla-Plugin--SOPA (2025-12-09).
- **[verified]** BIMP / QBP — El motor QBP Simulator es propietario (licencia comercial requerida; la UI en línea es 'trial and academic use only'). Solo la UI (qbpsimulator/bimp-ui, TypeScript/React, MIT, Madis Abel) es open source y llama por REST a qbp-simulator.com:8080; último commit 2020-08, 2 contribuidores. Formato: BPMN 2.0 con extensión propia definida en QBPSchema.xsd (namespace qbp) y salida MXML/CSV. El único código de motor abierto es un fork de 2014 del BIMP original de Google Code (s7nio/bimp-simulator, Java/Tomcat 7, GPL-3.0, sin actividad). Veredicto: IGNORE (motor cerrado; fork GPL de 2014 obsoleto). Conocer el esquema qbp: es el formato de facto que usaron Apromore CE, Simod y Prosimos para intercambiar parámetros.
  - _Evidencia_: README bimp-ui https://github.com/qbpsimulator/bimp-ui (QBPSchema.xsd, endpoint REST); https://www.qbp-simulator.com/products/bimp-online-simulator/; gh api repos/s7nio/bimp-simulator → GPL-3.0, pushed 2014-07-03; https://sep.cs.ut.ee/Main/BIMPCommandLine.
- **[verified]** Apromore — ApromoreCore (LGPL-3.0, JavaScript/Java) fue archivado por el propietario el 2025-08-29; todos los repos de la organización están archivados; último release v7.20.1 (2021-07). En CE la simulación era un plugin 'Process-Simulation-Info-Logic' que anotaba el BPMN y delegaba en BIMP/QBP; la simulación propia ('Simulate process', descubrimiento de modelos de simulación) es exclusiva de Apromore Enterprise. Veredicto: IGNORE.
  - _Evidencia_: https://github.com/apromore/ApromoreCore ('archived by the owner on Aug 29, 2025'); gh api → archived:true, LGPL-3.0; árbol git contiene Apromore-Custom-Plugins/Process-Simulation-Info-Logic; https://documentation.apromore.org/simulation/simulateprocess.html; https://github.com/apromore.
- **[verified]** bpmn-js-token-simulation (bpmn-io) — JavaScript, MIT (Camunda Services GmbH), muy activo: v0.40.0 (2026-07-01), último commit 2026-08-28, 19 contribuidores, 312 estrellas, tests karma. Es animación de tokens conforme a BPMN 2.0 (pausa, paso a paso, scopes) sobre bpmn-js Modeler/Viewer; no modela tiempo, duraciones, recursos, colas ni estadísticas. Veredicto: USE, pero solo para el equivalente al 'Nivel 1 - Validación de proceso' de Bizagi (rutas, semántica de gateways, deadlocks visuales), nunca como DES.
  - _Evidencia_: gh api repos/bpmn-io/bpmn-js-token-simulation; npm view → 0.40.0 2026-07-08; README https://github.com/bpmn-io/bpmn-js-token-simulation.
- **[verified]** bpmn-engine (paed01) — JavaScript, MIT, activo (npm 25.0.1 publicado 2026-08-22, tag v26.0.3; bpmn-elements 17.3.0 2026-09-02), 10 contribuidores, 966 estrellas. bpmn-elements es isomórfico (empaquetable en navegador) y cubre casi todo BPMN 2.0 ejecutable (boundary, timers timeDuration/timeDate/timeCycle, subprocess, multi-instance, event-based, inclusive, message/signal/error/escalation, call activity, transaction) con getState/recover/resume; los Timers aceptan setTimeout/clearTimeout personalizados (reloj virtual posible). Es motor de EJECUCIÓN por instancia, sin recursos, colas, distribuciones ni estadísticas; simular 10k casos requeriría orquestar 10k instancias con reloj falso. Veredicto: IGNORE como núcleo DES; su hermano bpmn-moddle (MIT, 10.2.0 2026-08) sí es candidato USE como parser BPMN en TypeScript.
  - _Evidencia_: gh api repos/paed01/bpmn-engine; npm view bpmn-engine/bpmn-elements/bpmn-moddle; README bpmn-elements ('Isomorphic JavaScript BPMN 2.0 workflow elements suitable for bundling into frontend') y lista de elementos; docs/Timers.md (setTimeout/clearTimeout opcionales).
- **[verified]** Camunda 8 / Zeebe (camunda/camunda) — Java, muy activo (8.9.18 el 2026-08-31, 210 contribuidores). Licencia: Camunda License 1.0 (fuente disponible, uso solo en entornos no productivos; producción requiere Enterprise) para Zeebe/Operate/Tasklist; solo clientes Java, Spring starter, exporter-api, protocol y bpmn-model son Apache-2.0. Camunda 7 CE (Apache-2.0) está EoL y el repo archivado. Es motor de orquestación persistente en tiempo real (sin reloj virtual, sin semántica estocástica, sin recursos/colas de simulación). Veredicto: IGNORE (no es simulador y la licencia no es open source).
  - _Evidencia_: repos/camunda/camunda/licenses/CAMUNDA-LICENSE-1.0.txt ('only ... in Non-Production Environment'); README sección License; gh api repos/camunda/camunda-bpm-platform → archived:true, descripción 'Camunda 7 CE is End of Life'; https://camunda.com/blog/2024/04/licensing-update-camunda-8-self-managed/.
- **[verified]** AgentSimulator (lukaskirchdorfer/AgentSimulator, U. Mannheim/Viena) — Python/Jupyter, MIT, código de paper (BPM 2024, arXiv 2408.08571). Entrada: event log CSV (case, activity, resource, start, end); no acepta BPMN; descubre y simula un sistema multi-agente centrado en recursos y produce logs simulados. 2 contribuidores, 6 estrellas, último commit 2025-02-06. Veredicto: IGNORE (investigación log-driven; sin BPMN, sin escenarios what-if configurables).
  - _Evidencia_: gh api repos/lukaskirchdorfer/AgentSimulator → MIT, último commit 2025-02-06; README https://github.com/lukaskirchdorfer/AgentSimulator; https://arxiv.org/abs/2408.08571.
- **[verified]** DSIM = DeepSimulator (AdaptiveBProcess/DeepSimulator, Camargo/Dumas/González-Rojas) — Python, Apache-2.0, híbrido DDS + deep learning que aprende de event logs; último commit 2023-03-31, 11 estrellas. Veredicto: IGNORE (abandonado, log-driven).
  - _Evidencia_: gh api repos/AdaptiveBProcess/DeepSimulator; paper https://arxiv.org/pdf/2103.11944; https://link.springer.com/chapter/10.1007/978-3-031-07472-1_4.
- **[verified]** RIMS_tool (francescameneghello/RIMS_tool, FBK/Trento) — Python 3.10 sobre SimPy 4.0.1 + pm4py; simulador híbrido ML+DES. Entrada: Petri net PNML (no BPMN) + JSON; soporta roles, calendarios y mapeo recurso-actividad; salida XES/CSV. Sin LICENSE en el repo; último commit 2026-06-22 (solo docs HTML), 5 estrellas. Veredicto: IGNORE (sin licencia, PNML, foco predictivo).
  - _Evidencia_: gh api repos/francescameneghello/RIMS_tool → license null; README https://github.com/francescameneghello/RIMS_tool; paper https://www.sciencedirect.com/science/article/pii/S0306437924001303.
- **[verified]** prosit (franvinci/prosit, PyPI prosit-pm) — nuevo 2025-2026: Python ≥3.10, MIT, v1.0.4 (2026-07-03), motor DES propio con árboles de decisión condicionales; entrada XES + Petri net (pm4py inductive), soporta calendarios, multitasking, atributos de caso, seed (random_state). Depende de pm4py (AGPL-3.0). Un solo autor. Veredicto: IGNORE por ahora (descubrimiento desde logs, Petri nets, AGPL transitiva); vigilar para la fase de process mining.
  - _Evidencia_: gh api repos/franvinci/prosit → MIT, release v1.0.4 2026-07-03; PyPI prosit-pm 1.0.4 deps pm4py>=2.4; README https://github.com/franvinci/prosit; paper ICSOC 2025 DOI 10.1007/978-981-95-5015-9_24.
- **[verified]** casymda (fladdimir/casymda) — Python, MIT, 52 estrellas, último commit 2024-12-14. Convierte diagramas BPMN hechos en Camunda Modeler a código SimPy (bloques conectables, seize/release de recursos, animación tkinter/web). Es el precedente más directo de la 'Ruta B' (parser BPMN + DES general), pero genera código en vez de interpretar y está inactivo. Veredicto: IGNORE como dependencia; leer como referencia de diseño.
  - _Evidencia_: gh api repos/fladdimir/casymda; README https://github.com/fladdimir/casymda.
- **[verified]** Proyectos nuevos 2026 detectados por búsqueda API de GitHub (sort=updated): bpmn-os/bpmnos-engine (C++23, 'BPMN for optimization and simulation', activo 2026-08, pero licencia CC BY-NC-ND 4.0 → no comercial, sin derivados: IGNORE); bpmn-os/bpmn-workbench y bpmnos-workbench (JS, MIT, creados jun-jul 2026, 0 estrellas); xodapi/miroboard (TypeScript, MIT, creado 2026-08-07, 0 estrellas, un archivo HTML offline con editor BPMN + Monte Carlo 500 corridas, distribuciones fixed/uniform/triangular, colas de recursos, formato .mboard propio, docs en ruso: IGNORE, pero confirma demanda); KORALLE-bpmn-graph-sim (Python, creado 2026-09-01, sin licencia: IGNORE); Merck/ReactiveDynamics.jl (Julia, MIT, Petri nets estocásticas con recursos: IGNORE); ProcessMining-uOttawa/PMM4RPAAI-Sim (MIT, 2026, usa Simod+Prosimos). No existe ningún proyecto llamado 'OpenSim BPMN'.
  - _Evidencia_: gh api search/repositories q=bpmn+simulation sort=updated; gh api repos/bpmn-os/bpmnos-engine/license → 'licensed under CC BY-NC-ND 4.0'; README miroboard; búsquedas 'OpenSim BPMN' sin resultados relevantes.
- **[verified]** Otros motores BPMN de ejecución (no simulación): SpiffWorkflow (Python, LGPL-3.0, muy activo 2026-09, 1915 estrellas) y pm4py (AGPL-3.0, 2.7.23.8 2026-09; incluye playout/simulación de Petri nets sin recursos). Ambos con licencias copyleft que contaminarían un núcleo permisivo. uwep/bpmn-simulator (Java Swing, Apache-2.0, animación, último commit 2019) y camunda-consulting/camunda-bpm-simulator (Java sobre Camunda 7, sin licencia, 2023) están muertos. Veredicto: IGNORE.
  - _Evidencia_: gh api repos/sartography/SpiffWorkflow (LGPL-3.0); repos/process-intelligence-solutions/pm4py (AGPL-3.0); repos/uwep/bpmn-simulator (2019-12-02); repos/camunda-consulting/camunda-bpm-simulator (2023-08-09, license null).
- **[verified]** SimPy — Python puro, MIT, 4.1.2 (2026-05-24), Python ≥3.8, 28 contribuidores en GitLab (team-simpy/simpy), última actividad 2026-07. Procesos por generadores, Resource/PriorityResource/PreemptiveResource, Store; determinismo depende del RNG del usuario (random/numpy sembrados). Corre en navegador vía Pyodide (hay apps SimPy desplegadas con stlite/pyodide). No trae calendarios ni semántica BPMN: hay que construirlos encima. Veredicto: USE como kernel DES si el motor se hace en Python.
  - _Evidencia_: https://pypi.org/project/simpy/ (4.1.2, MIT, >=3.8); GitLab API projects/team-simpy%2Fsimpy contributors=28, last_activity 2026-07-14; https://github.com/pythonhealthdatascience/llm_simpy_models (SimPy en navegador con stlite/pyodide).
- **[verified]** salabim — Python ≥3.7, MIT, 26.0.8 (2026-06-24), 3 contribuidores (un autor principal, Ruud van der Ham), 404 estrellas; DES con animación 2D/3D, monitores y colas. El modo 'yieldless' depende de greenlet (extensión C) → problemático en Pyodide; existe versión 'yield' pura. Veredicto: IGNORE (más pesado que SimPy, bus factor 1, animación irrelevante para web).
  - _Evidencia_: gh api repos/salabim/salabim (release 26.0.1 2026-02, último commit 2026-05-29, 3 contribuidores); PyPI salabim 26.0.8; README 'Salabim is licensed under the MIT License'; https://www.salabim.org/manual/Overview.html (yieldless requiere greenlet).
- **[verified]** Ciw — Python, MIT, 3.2.7 (2025-12-05), 14 contribuidores, 175 estrellas; redes de colas abiertas con clases de cliente, prioridades, schedules de servidores, bloqueo, detección de deadlock y seed (ciw.seed). Modelo = red de colas, no grafo BPMN con AND-join por caso. Veredicto: IGNORE como núcleo; referencia útil para semántica de schedules/rostering de servidores.
  - _Evidencia_: gh api repos/CiwPython/Ciw; https://ciw.readthedocs.io/en/latest/ ('How to Set a Seed', Ciw 3.2.7, Python 3.8-3.12).
- **[verified]** DES en JavaScript/TypeScript: todo es marginal y unipersonal. discrete-sim (anesask, TS, MIT, 0.1.8 2026-02-15, 3 estrellas, cero dependencias, generadores, Resource con FIFO/LIFO/priority, RNG sembrable, estadísticas); simloop (Mettiu88, TS, MIT, 0.5.1 2026-04, 0 estrellas); SimScript (Bernardo-Castilho, TS, MIT/ISC, último release 2021, 35 estrellas); simjs (2022). Veredicto: IGNORE como dependencia — un kernel DES (heap de eventos + reloj virtual + colas de recursos + PRNG sembrado) son unos pocos cientos de líneas en TS y es mejor poseerlo.
  - _Evidencia_: npm view discrete-sim/simloop/simscript/simjs; gh api repos/anesask/discrete-sim (MIT, 2026-02-15); repos/Mettiu88/simloop (MIT, 2026-04-11, 0 estrellas); repos/Bernardo-Castilho/SimScript (release 1.0.36 2021-09); README discrete-sim (features: seedable RNG, Resource FIFO/LIFO/Priority).
- **[verified]** DES en Rust/WASM: nexosim (asynchronics, MIT/Apache-2.0 dual, 1.0.0 2026-02-03, 8 contribuidores, 299 estrellas) es un framework asíncrono multi-hilo orientado a simulación de sistemas/hardware-in-the-loop; su README no menciona WASM. ndebuhr/sim ('SimRS', MIT/Apache-2.0, 0.13.1 2025-04-26, 7 contribuidores) es estilo DEVS con soporte explícito WebAssembly y paquete npm sim-rs (modelos declarativos YAML/JSON). desru (Apache-2.0, 2025-04, mínimo), quokkasim (MIT, 0.3.0-alpha, 2026-01), desim (GPL-3.0, 2024, generadores nightly). Parsers BPMN en Rust: Ebi_BPMN (MIT, 0.0.51 2026-08, parser/writer/espacio de estados) y rust_bpmn_analyzer (MIT, model checker con bindings WASM, commit 2026-09-01). Veredicto: IGNORE por ahora — añade toolchain (Rust+wasm-bindgen) sin necesidad demostrada; revisitar solo si el spike en TS/Python no alcanza el objetivo de rendimiento.
  - _Evidencia_: gh api repos/asynchronics/nexosim + README (licencia dual, sin 'wasm'); crates.io nexosim 1.0.0; README ndebuhr/sim ('compatible with ... WebAssembly', npm sim-rs); crates.io sim 0.13.1, desru 0.1.13, quokkasim 0.3.0-alpha.7, desim 0.4.0 (GPL-3.0); gh api repos/BPM-Research-Group/Ebi_BPMN y repos/timKraeuter/rust_bpmn_analyzer.
- **[verified]** JaamSim — Java, Apache-2.0, activo (v2026-05 publicado 2026-07-06, 8 contribuidores, 236 estrellas): DES general con GUI de escritorio, sin BPMN ni navegador. Veredicto: IGNORE.
  - _Evidencia_: gh api repos/jaamsim/jaamsim.
- **[likely]** BPSim 2.0 (WfMC, documento WFMC-BPSWG-2016-01) es el estándar de intercambio de parámetros de simulación sobre BPMN/XPDL; especificación PDF, XSD e implementers guide descargables gratis en bpsim.org. Implementadores comerciales: Lanner L-SIM, Trisotech, PragmaDev Process; Bizagi declara que su simulación 'sigue BPSim' y soporta todas sus distribuciones. No se encontró ninguna implementación open source de BPSim (ni parser ni motor).
  - _Evidencia_: https://www.bpsim.org/ ; https://www.bpsim.org/specifications/2.0/WFMC-BPSWG-2016-01.pdf ; https://www.lanner.com/en-us/insights/news/lanner-and-trisotech-partnership-launches-bpsim-in-the-cloud.html ; https://www.haskoning.com/en/services/l-sim ; https://help.bizagi.com/platform/en/simulation_in_bizagi.htm.
- **[likely]** Referencia objetivo Bizagi Modeler: solo Windows (Mac/Linux vía VM). Cuatro niveles: 1 Validación (probabilidades de flujos + contador de llegadas → tokens por flujo/actividad/fin), 2 Tiempo (intervalos de llegada y tiempos de servicio constantes o por distribución → min/max/media/total por proceso y actividad), 3 Recursos (roles con disponibilidad, costo fijo por token y costo por hora; asume recursos ilimitados en nivel 3? — el help lo indica literalmente; utilización, costos, ciclo esperado y esperas por recurso), 4 Calendarios (disponibilidad por calendario, 24/7 por defecto). Distribuciones (según BPSim): beta, binomial, Erlang, gamma, lognormal, exponencial negativa, normal, Poisson, normal truncada, uniforme, Weibull, triangular y definida por el usuario. Resultados exportables a Excel; escenarios what-if. No soporta: múltiples eventos, complex gateways, event-based gateway sin eventos intermedios, multi-instancia, subprocesos reutilizables (los embebidos sí). Al exportar BPMN 2.0 'los atributos extendidos no se incluyen'.
  - _Evidencia_: https://help.bizagi.com/platform/en/simulation_levels.htm ; https://help.bizagi.com/platform/en/level_2_example.htm ; https://help.bizagi.com/platform/en/simulation_in_bizagi.htm ; https://help.bizagi.com/platform/en/general_faqs.htm ; https://help.bizagi.com/platform/en/exporting_to_bpmn.htm ; búsqueda 'Bizagi ... distributions' (help.bizagi.com/what_is_simulation.htm).
- **[verified]** bpmn-js (editor) — JavaScript, 18.27.1 (2026-09-03), 9645 estrellas, licencia propia tipo MIT con cláusula obligatoria: el watermark 'bpmn.io' debe permanecer visible y no puede quitarse ni taparse. bpmn-moddle (parser/serializador BPMN 2.0) es MIT sin esa cláusula.
  - _Evidencia_: repos/bpmn-io/bpmn-js/contents/LICENSE ('The source code responsible for displaying the bpmn.io project watermark ... MUST NOT be removed or changed'); npm view bpmn-js 18.27.1 'SEE LICENSE IN LICENSE'; npm view bpmn-moddle license MIT.
- **[verified]** El web portal de Prosimos (prosimos.cloud.ut.ee) tiene sus repos prosimos-frontend (TypeScript/React, Apache-2.0) y prosimos-microservice (Python/Flask, Apache-2.0) sin commits desde junio 2023. Optimos v2 (optimizador sobre Prosimos, sin licencia, 2025-05) y roptimus-prime (sin licencia, 2024-07) igual. Veredicto: IGNORE.
  - _Evidencia_: gh api repos/AutomatedProcessImprovement/prosimos-frontend (2023-06-16), prosimos-microservice (2023-06-15), optimos_v2 (license null, 2025-05-16), roptimus-prime (license null, 2024-07-15); README prosimos-docker.

## Preguntas abiertas

- Licencia de Prosimos: ¿los autores (López-Pintado, Halenok, grupo de Dumas en U. Tartu) aceptarían añadir Apache-2.0 como en prosimos-docker/frontend? Hasta que exista un LICENSE, ninguna línea de código de Prosimos puede reutilizarse; solo puede correrse como oráculo.
- ¿Qué produce exactamente Bizagi Modeler al exportar BPMN 2.0 con datos de simulación: BPSim, namespace propio o nada? El help dice que 'los atributos extendidos no se incluyen'; hace falta un .bpmn real exportado desde Bizagi para decidir si el import de escenarios desde Bizagi es viable o si el usuario reintroducirá parámetros a mano.
- Lenguaje del motor: TypeScript (un runtime, navegador + Node, bpmn-moddle MIT) vs Python (SimPy MIT + Pyodide). Decisión de Brito; el spike debe medir 10k casos × ~20 actividades con recursos y calendarios en navegador (objetivo sugerido: pocos segundos en Web Worker).
- Fidelidad semántica objetivo frente a Bizagi: cómo trata Bizagi el nivel 3 'recursos ilimitados' vs nivel 4, si las esperas por calendario se cuentan como waiting, y cómo agrega costos fijos por token vs por hora; conviene reproducir 2-3 ejemplos oficiales del help de Bizagi como fixtures.
- Determinismo cruzado: Prosimos no expone seed y sus salidas variarán entre corridas; para usarlo como oráculo hay que sembrar numpy/random globalmente o comparar con tolerancias estadísticas (intervalos de confianza con N corridas).
- Cláusula de watermark de bpmn-js: aceptable para un producto open source, pero conviene decidir ahora si se acepta permanentemente o si se planea un renderer propio a largo plazo.
- Alcance BPMN de la v1: confirmar que start/end, task, XOR, AND, timers de llegada y subproceso embebido bastan para los casos de Brito, y dejar inclusive gateway, boundary/timer events y multi-instancia (que ni Bizagi soporta) para después.

## Fuentes

- https://github.com/AutomatedProcessImprovement/Prosimos
- https://pypi.org/pypi/prosimos/json
- https://github.com/AutomatedProcessImprovement/prosimos-docker
- https://github.com/AutomatedProcessImprovement/prosimos-frontend
- https://github.com/AutomatedProcessImprovement/prosimos-microservice
- https://github.com/AutomatedProcessImprovement/Simod
- https://www.sciencedirect.com/science/article/pii/S2352711025001244
- https://github.com/AutomatedProcessImprovement/pix-framework
- https://github.com/AutomatedProcessImprovement/optimos_v2
- https://github.com/AutomatedProcessImprovement/roptimus-prime
- https://link.springer.com/chapter/10.1007/978-3-031-26886-1_23
- https://github.com/bptlab/scylla
- https://github.com/bptlab/scylla/wiki
- https://github.com/bptlab/scylla-ui
- https://en.wikipedia.org/wiki/DESMO-J
- https://ceur-ws.org/Vol-1920/BPM_2017_paper_198.pdf
- https://github.com/INSM-TUM/SimuBridge
- https://github.com/INSM-TUM/Scylla-Plugin--SOPA
- https://github.com/qbpsimulator/bimp-ui
- https://www.qbp-simulator.com/products/bimp-online-simulator/
- https://sep.cs.ut.ee/Main/BIMPCommandLine
- https://github.com/s7nio/bimp-simulator
- https://github.com/apromore/ApromoreCore
- https://github.com/apromore
- https://documentation.apromore.org/simulation/simulateprocess.html
- https://github.com/bpmn-io/bpmn-js-token-simulation
- https://github.com/bpmn-io/bpmn-js-token-simulation/releases
- https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE
- https://www.npmjs.com/package/bpmn-moddle
- https://github.com/paed01/bpmn-engine
- https://github.com/paed01/bpmn-elements
- https://github.com/paed01/bpmn-elements/blob/master/docs/Timers.md
- https://github.com/camunda/camunda
- https://github.com/camunda/camunda/blob/main/licenses/CAMUNDA-LICENSE-1.0.txt
- https://github.com/camunda/camunda-bpm-platform
- https://camunda.com/blog/2024/04/licensing-update-camunda-8-self-managed/
- https://github.com/lukaskirchdorfer/AgentSimulator
- https://arxiv.org/abs/2408.08571
- https://github.com/AdaptiveBProcess/DeepSimulator
- https://arxiv.org/pdf/2103.11944
- https://github.com/francescameneghello/RIMS_tool
- https://www.sciencedirect.com/science/article/pii/S0306437924001303
- https://github.com/franvinci/prosit
- https://pypi.org/project/prosit-pm/
- https://github.com/fladdimir/casymda
- https://github.com/bpmn-os/bpmnos-engine
- https://github.com/xodapi/miroboard
- https://github.com/toewl-devv/KORALLE-bpmn-graph-sim
- https://github.com/Merck/ReactiveDynamics.jl
- https://github.com/ProcessMining-uOttawa/PMM4RPAAI-Sim
- https://github.com/topics/business-process-simulation
- https://github.com/sartography/SpiffWorkflow
- https://github.com/process-intelligence-solutions/pm4py
- https://github.com/uwep/bpmn-simulator
- https://github.com/camunda-consulting/camunda-bpm-simulator
- https://pypi.org/project/simpy/
- https://gitlab.com/team-simpy/simpy
- https://github.com/pythonhealthdatascience/llm_simpy_models
- https://github.com/salabim/salabim
- https://pypi.org/project/salabim/
- https://www.salabim.org/manual/Overview.html
- https://github.com/CiwPython/Ciw
- https://ciw.readthedocs.io/en/latest/
- https://github.com/anesask/discrete-sim
- https://www.npmjs.com/package/simloop
- https://github.com/Bernardo-Castilho/SimScript
- https://www.npmjs.com/package/simjs
- https://github.com/asynchronics/nexosim
- https://crates.io/crates/nexosim
- https://github.com/ndebuhr/sim
- https://www.npmjs.com/package/sim-rs
- https://crates.io/crates/desru
- https://crates.io/crates/quokkasim
- https://crates.io/crates/desim
- https://github.com/BPM-Research-Group/Ebi_BPMN
- https://github.com/timKraeuter/rust_bpmn_analyzer
- https://github.com/jaamsim/jaamsim
- https://www.bpsim.org/
- https://www.bpsim.org/specifications/2.0/WFMC-BPSWG-2016-01.pdf
- https://www.lanner.com/en-us/insights/news/lanner-and-trisotech-partnership-launches-bpsim-in-the-cloud.html
- https://www.haskoning.com/en/services/l-sim
- https://help.bizagi.com/platform/en/simulation_levels.htm
- https://help.bizagi.com/platform/en/level_2_example.htm
- https://help.bizagi.com/platform/en/simulation_in_bizagi.htm
- https://help.bizagi.com/platform/en/what_is_simulation.htm
- https://help.bizagi.com/platform/en/general_faqs.htm
- https://help.bizagi.com/platform/en/exporting_to_bpmn.htm
