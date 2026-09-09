# Qué hace exactamente la simulación de Bizagi Modeler (niveles, parámetros, salidas, persistencia, estado 2026, limitaciones) y checklist de paridad para Lila Modeler

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](../docs/) and [`README.md`](../README.md).

_Investigación verificada el 2026-09-03 por un agente con búsqueda web. Cada hallazgo lleva su nivel de confianza._

## Recomendación

La paridad con Bizagi es un objetivo pequeño y bien acotado: un DES terminante sobre BPMN núcleo (start/end, task, XOR/OR/AND, subproceso embebido, timer) con llegadas por triggerCount + interTriggerTimer, processingTime por tarea, recursos con availability/fixedCost/unitCost y asignación AND/OR, calendarios con recurrencia y matriz recurso×calendario, gateways por probabilidad, escenarios independientes con replications+seed, y una tabla de resultados con exactamente las columnas de Bizagi (started, completed, min/max/avg/total, espera min/max/avg/std/total, costos, utilización) más un what-if lado a lado. No hace falta reproducir los "4 niveles" como concepto: son sólo qué parámetros están rellenos; el motor debe degradar (sin recursos ⇒ capacidad infinita, sin calendario ⇒ 24×7). La única parte con complejidad real es calendarios (turnos que cortan tareas en curso y disponibilidad por franja); conviene diseñarla desde el principio en el modelo de recursos aunque el MVP sólo soporte recurrencia diaria/semanal.

Para el formato de datos, adoptar el vocabulario de BPSim 2.0 (interTriggerTimer, triggerCount, processingTime, probability, availability, quantity, selection, fixedCost, unitCost; ScenarioParameters start/duration/warmup/replication/seed/baseTimeUnit/baseCurrencyUnit; ResultType min/max/mean/count/sum; distribuciones Beta…Weibull + UserDistribution) en el JSON de escenario propio (ADR-007) y ofrecer más adelante import/export del XML BPSim embebido en bpmn:definitions/extensionElements. Hay que asumir que no habrá round-trip de parámetros con Bizagi: su .bpmn exportado sólo lleva colores en <bizagi:BizagiExtensions> (namespace http://www.bizagi.com/bpmn20 declarado por elemento — el parser debe tolerarlo) y no exporta BPSim. Por tanto el importador de Lila debe leer BPMN limpio + escenario aparte, y como cortesía ignorar/preservar bizagi:BizagiProperties.

Donde Lila puede ganar sin esfuerzo adicional: percentiles, longitud de cola, throughput por hora, costo por caso, ranking de cuellos de botella y event log por caso, que es exactamente lo que los usuarios de Bizagi echan en falta ("poca granularidad", "difícil de interpretar"), además de correr en macOS/Linux/navegador (Bizagi sigue siendo Windows-only en 4.3, sin editor web, y su foro de soporte está caído en mantenimiento en septiembre de 2026). Mantener el motor como librería pura con CLI (process-sim run process.bpmn scenario.json) y una tabla de resultados idéntica en nombres a la de Bizagi facilita que un usuario académico migre comparando números.

## Hallazgos

- **[verified]** [Niveles] Bizagi organiza la simulación en 4 niveles acumulativos: 1 Process Validation, 2 Time Analysis, 3 Resource Analysis, 4 Calendar Analysis. Cada nivel añade datos al anterior; no son modos de motor distintos sino qué parámetros se rellenan.
  - _Evidencia_: help.bizagi.com/platform/en/simulation_levels.htm describe los cuatro niveles y qué requiere y produce cada uno; la página remite a la especificación BPSim para las distribuciones.
- **[verified]** [Nivel 1 – Process Validation] Entradas: porcentajes de activación en cada flujo saliente de gateways exclusivos/inclusivos (0–100 %; si no se define, reparto equitativo) y 'Max. arrival count' en el Start Event (recomiendan ≥1000). Salidas: qué caminos se activaron, si todas las instancias terminaron, tokens que pasaron por cada Sequence Flow/Activity/End Event; tabla por elemento con Name, Type, Instances completed; botón Export a Excel. Durante la ejecución hay animación con contadores (instancias completadas, tokens creados, tokens por shape).
  - _Evidencia_: help.bizagi.com/platform/en/level_1_example.htm (configuración, Run → Start, Results, Export) y simulation_levels.htm.
- **[verified]** [Nivel 2 – Time Analysis] Añade: 'Arrival interval time' (constante o distribución; aplica a Start Events, actividades que inician procesos y Timer Events) y 'Processing time' por actividad/evento (constante o distribución). Supone capacidad infinita de recursos, por lo que no hay esperas. Salidas por actividad y por proceso: Instances completed, Instances started, Minimum time, Maximum time, Average time, Total time; el promedio del proceso es ponderado por las probabilidades de gateways. Unidad de tiempo la fija 'Base Time unit' del escenario.
  - _Evidencia_: help.bizagi.com/platform/en/level_2_example.htm y level_2_example_st.htm (columnas: Name, Type, Tokens completed, Tokens started, Min/Max/Avg/Total time). Post LinkedIn 'Bizagi Modeler: Niveles de Simulación' confirma que el nivel 2 no muestra esperas ni encolamiento.
- **[verified]** [Nivel 3 – Resource Analysis] Recursos con: Name, Description, Type (Business Role o Equipment), Availability (cantidad total), Fixed cost (por token procesado) y Cost per hour. Asignación a actividades: uno o más recursos con cantidad requerida y lógica AND/OR (todos a la vez o alternativos). Cada actividad puede tener además un Fixed cost propio. Salidas por elemento: Instances completed/started, Min/Max/Avg processing time, tiempo esperando recurso (Min, Max, Avg, Std deviation, Total), Total fixed cost. Salidas por recurso: Utilization %, Total fixed cost (fijo × tokens), Total unit cost (hora × horas usadas), Total cost.
  - _Evidencia_: help.bizagi.com/platform/en/level_3_example.htm.
- **[verified]** [Nivel 4 – Calendar Analysis] Calendarios con: Name, Start time, Duration, Recurrence pattern (daily/weekly/monthly/yearly), Start of recurrence, End of recurrence (fecha o número de repeticiones). La disponibilidad se define en una matriz recurso × calendario; celdas en blanco heredan la disponibilidad del 'Default Calendar' del nivel 3. Los resultados tienen las mismas dos pestañas (Process elements / Resources) que el nivel 3.
  - _Evidencia_: help.bizagi.com/platform/en/level_4_example.htm.
- **[verified]** [Escenario] Propiedades: Name, Description, Author, Version, Start date, Duration (30 días por defecto), Base Time Unit, Base Currency Unit, Replication (recomiendan 30) y Seed. Los escenarios son independientes entre sí (propiedades y datos por shape); se crean en blanco o duplicando otro. La corrida termina al primero que ocurra: duración del escenario o Max arrival count. Las replicaciones sólo se ejecutan desde What-If, no desde la corrida animada.
  - _Evidencia_: help.bizagi.com/platform/en/scenarios.htm; notas sobre duración vs max arrival count también en level_2_example.htm.
- **[likely]** [Escenario] Existe un tope de 999 días de duración de escenario; Bizagi es una simulación terminante (no de estado estacionario), y el foro de soporte recomienda alargar la duración en vez de fijar número de tokens cuando se busca comparar con teoría de colas.
  - _Evidencia_: Resumen de búsqueda del hilo feedback.bizagi.com 'bizagi-simulated-process-completion-times-appear-not-to-be-consistent-with-queuing-theory'. El portal feedback.bizagi.com redirige a portal.bizagi.com/maintenance en sept-2026, no pude leer el hilo original.
- **[verified]** [Propiedades avanzadas por tarea] Start Quantity (tokens que deben llegar para iniciar) y Completion Quantity (tokens que genera al terminar), ambos por defecto 1, en la pestaña Advanced de Element Properties; la doc pide revisarlos antes de simular.
  - _Evidencia_: help.bizagi.com/platform/en/simulation_in_bizagi.htm y resultado de búsqueda sobre additional_properties.htm.
- **[verified]** [Distribuciones] La ayuda oficial documenta con ejemplo sólo Exponential (mean) y Normal (mean, std dev; avisa si puede producir negativos) y remite al estándar BPSim para el resto. BPSim 2.0 define: Beta, Binomial, Erlang, Gamma, LogNormal, NegativeExponential, Normal, Poisson, Triangular, TruncatedNormal, Uniform, UserDistribution (empírica) y Weibull, además de valor constante.
  - _Evidencia_: help.bizagi.com/platform/en/level_2_example.htm y simulation_levels.htm; PDF WFMC-BPSWG-2016-01 (BPSim 2.0) sección 6.3.5, convertido y grepeado localmente.
- **[likely]** [Distribuciones] El diálogo 'avanzado' de Bizagi Modeler ofrece (según fuente secundaria en español): Constante, Normal, Exponencial, Uniforme, Triangular, Poisson, Beta, Erlang, Gamma, Lognormal y Weibull. Un paper afirma que Bizagi 11.1 BPM Suite soporta todas las distribuciones de BPSim.
  - _Evidencia_: adnlean.com 'Modelado y simulación en Bizagi'; resultado de búsqueda citando BPSim 1.0 y 'Bizagi 11.1 BPM Suite'. No hay página oficial que liste el conjunto completo.
- **[verified]** [Elementos BPMN NO soportados por el motor] Multiple events (Start, Intermediate, End); Complex gateways; Event-based gateways seguidos de eventos intermedios 'none' o tareas; Multiple instance tasks; Multiple instance sub-processes; diagramas Choreography y Conversation; Transactional process; Ad Hoc process. El contenido de Reusable Sub-processes no se simula (hay que darle un tiempo global); para simular la lógica interna se usa Embedded Sub-process. Los Message events requieren message flows para mapear tokens; Signal y Link events se emparejan por nombre.
  - _Evidencia_: help.bizagi.com/platform/en/simulation_in_bizagi.htm (sección de consideraciones).
- **[verified]** [Salidas y reportes] Botón Results muestra gráficos/tablas por elemento; botón 'Export to Excel' (abajo a la izquierda) exporta el reporte. Corrida animada: Run → ventana 'Process Simulation' → Start; se puede Stop en cualquier momento. Columnas exactas del reporte: Name, Type, Tokens/Instances completed, Tokens/Instances started, Min/Max/Avg/Total time, y en niveles 3-4 tiempo de espera por recurso (min/max/avg/desv.est./total), Total fixed cost; pestaña Resources con Utilization, Fixed cost, Unit cost, Total cost.
  - _Evidencia_: help.bizagi.com/platform/en/simulation_in_bizagi.htm; level_1/2/3/4_example.htm.
- **[likely]** [Salidas] No aparecen en la documentación: percentiles (P90/P95), longitud de cola, throughput por unidad de tiempo, costo por caso, event log por caso, ni tiempo de espera desglosado por recurso (sólo por actividad). Un control de velocidad de la animación tampoco está documentado.
  - _Evidencia_: Ausencia en todas las páginas de niveles y resultados; búsquedas específicas de 'P90/percentile/queue length' y 'speed slider' en help.bizagi.com sin resultado.
- **[likely]** [Excel] El Excel de resultados contiene por shape Name, Type, Tokens completed, Tokens started, Min/Max/Avg/Total time; si se corrió más de un escenario incluye pestañas adicionales por escenario y una pestaña de consumo de recursos.
  - _Evidencia_: Resultado de búsqueda sobre level_2_example.htm y páginas relacionadas; no verifiqué abriendo un Excel real.
- **[verified]** [What-If] Se crean varios escenarios sobre el mismo modelo, se marcan los que se comparan y se ejecuta; el reporte muestra todos los escenarios lado a lado con los valores que difieren resaltados en rojo. Recomendaciones oficiales: ≥30 replicaciones, ejecutar What-If directo (no la animación), comparar máximo 2 escenarios a la vez.
  - _Evidencia_: help.bizagi.com/platform/en/what_if_analysis.htm y what_if_analysis_example.htm (ejemplo de urgencias: cambian disponibilidades por turno y se comparan utilización, costo, tokens completados y tiempos de espera).
- **[verified]** [Process Mining → simulación] Desde Modeler 4.0 (11/07/2022) el módulo de Process Mining (event logs XES o CSV con cabeceras activityid, caseid, activitydescription, activitycreationdate, activitysolutiondate) rellena automáticamente tiempos de proceso promedio y porcentajes de gateways; corre 1000 tokens por defecto, es determinista, y los parámetros se guardan en cada elemento al guardar el modelo.
  - _Evidencia_: help.bizagi.com/platform/en/process_mining_simulation.htm; releasenotes.bizagi.com modeler-4-0; resultado de búsqueda sobre process_discovery.htm.
- **[verified]** [Persistencia] El formato nativo es .bpm (propietario; descrito como contenedor ZIP) y ahí viven escenarios y parámetros. La exportación BPMN 2.0 declara explícitamente que 'extended attributes are not included'.
  - _Evidencia_: help.bizagi.com/platform/en/exporting_to_bpmn.htm; fileinfo/fileproinfo sobre .bpm (ZIP) — lo del ZIP es fuente secundaria.
- **[verified]** [Persistencia] El BPMN exportado por Bizagi NO contiene parámetros de simulación ni BPSim. Usa el namespace xmlns:bizagi="http://www.bizagi.com/bpmn20" declarado dentro de cada <extensionElements> (no en <definitions>), con la estructura <bizagi:BizagiExtensions><bizagi:BizagiProperties><bizagi:BizagiProperty name="…" value="…"/>. En 5 archivos reales (exportados entre 2014 y agosto-2026) sólo aparecen propiedades visuales: bgColor, borderColor, textColor, textBackgroundColor, textDirection, runtimeProperties, y en uno antiguo DeadlineConfig/DeadlineType/IntervalType/Percentage/Value/UniqueCode. Cero apariciones de triggerCount, processingTime, distribution, resource, bpsim.
  - _Evidencia_: Archivos descargados vía gh api: bpmn-miwg/bpmn-miwg-test-suite 'Bizagi Modeler 2.8.0.8/A.1.0-roundtrip.bpmn' y cuatro exportaciones Bizagi de repos personales sin archivo LICENSE (2018–2026; se descartaron como fixtures por ese motivo). Bizagi no escribe atributo exporter/exporterVersion, así que la versión exacta del exportador de cada muestra no es verificable.
- **[verified]** [Persistencia] La declaración de namespace anidada por elemento rompió el round-trip en bpmn-js (guardar tras editar dejaba el archivo inabrible); se corrigió en bpmn-moddle. Es un dato útil: cualquier importador propio debe tolerar xmlns declarados dentro de extensionElements.
  - _Evidencia_: github.com/bpmn-io/bpmn-js/issues/469 (fix en bpmn-io/bpmn-moddle#40).
- **[likely]** [Persistencia] Bizagi afirma seguir BPSim para su simulación, pero no documenta exportación ni importación de XML BPSim; el intercambio de parámetros de simulación con otras herramientas no existe en la práctica (sólo Excel de resultados).
  - _Evidencia_: help.bizagi.com/platform/en/simulation_in_bizagi.htm y bizagi.com/en/platform/standards mencionan BPSim sólo como base del motor; ninguna página de Export/Import menciona BPSim; el paper de Lancaster (eprints.lancs.ac.uk 86603) señala que Bizagi, L-SIM y Simul8 usan BPSim pero con formatos propietarios adicionales.
- **[verified]** [Estado 2026] Versión vigente: Modeler 4.3 (21/11/2025), cuyo único cambio es rebranding visual. Anteriores: 4.2 (14/05/2025, rendimiento en diagramas grandes y publicación), 4.1 (31/10/2024, AutoSave), 4.0 (11/07/2022, process mining simulation, permisos, retiro de planes). A fecha de la consulta no hay ninguna release de Modeler en 2026 en la página de releases.
  - _Evidencia_: releasenotes.bizagi.com/en/release-notes/releases/modeler-4-3, modeler-4-2, modeler-4-1, modeler-4-0 y all-releases. SourceForge muestra 'Last Update 2026-01-16' sin número de versión.
- **[verified]** [Estado 2026] Es freeware, no open source, sin versión de desarrollador. La app de escritorio es gratuita y no requiere licencia; Modeler no se vende por separado, viene con la suscripción Bizagi Platform (Enterprise), que añade colaboración, versionado, Process Library web y soporte.
  - _Evidencia_: help.bizagi.com/platform/en/general_faqs.htm y bm-faqs.htm (actualizado 14/07/2025).
- **[verified]** [Estado 2026] Desde el 1/07/2022 Bizagi retiró los planes Personal/Professional/Workgroup; la simulación (antes de pago, plan Professional) y la publicación web/SharePoint pasaron al plan gratuito.
  - _Evidencia_: releasenotes.bizagi.com modeler-4-0 ('Free tier now includes Simulation and web/SharePoint publishing'); resumen de búsqueda del anuncio feedback.bizagi.com/en/announcement/change-in-license-options (portal en mantenimiento, no leído directamente).
- **[verified]** [Estado 2026] Sólo Windows: Windows 11/10/8.1/7, Server 2016/2012 R2, x64, .NET Framework 4.6.1, 8 GB RAM mín. (16 recomendados), 1 GB disco, 1920×1080. macOS y Linux no soportados; la FAQ propone una máquina virtual. Página de requisitos actualizada 08/08/2025.
  - _Evidencia_: help.bizagi.com/platform/en/bm_requirements.htm; general_faqs.htm.
- **[verified]** [Estado 2026] No existe editor ni simulador en navegador. La 'Process Library' (model.bizagi.com, sólo Enterprise) permite navegar, comentar y aprobar; editar, documentar y simular exige la app de escritorio. El uso gratuito muestra pantalla de inicio de sesión al arrancar con opción 'Continue without signing in' para modelos locales.
  - _Evidencia_: help.bizagi.com/platform/en/ms_requirements.htm; editing_cloud_models.htm; bm_start.htm; signing-in-personal.htm (vía búsqueda).
- **[verified]** [Estado 2026] El portal de soporte comunitario feedback.bizagi.com redirige a portal.bizagi.com/maintenance (todas las URLs de hilos probadas), lo que corrobora quejas de reseñas sobre foro desatendido.
  - _Evidencia_: Redirecciones 302 observadas en 4 URLs distintas de feedback.bizagi.com durante esta investigación.
- **[verified]** [Quejas de usuarios] Recurrentes: resultados de simulación difíciles de interpretar y con poca granularidad de tiempos/costos (PeerSpot jul-2024, feb-2022); 'herramientas de simulación limitadas' (Capterra feb-2021); rendimiento pobre y consumo de recursos con diagramas grandes (PeerSpot 2020-2021, Capterra 2018-2021); congelamientos; sólo Windows, no Linux (PeerSpot sep-2022; processcamp.io lo llama 'dealbreaker'); software cerrado difícil de integrar; exportación limitada más allá de PDF; no se pueden añadir extensiones BPMN; interfaz envejecida; foro sin moderar. SourceForge resume: 'advanced analytics and simulation capabilities are limited'.
  - _Evidencia_: peerspot.com/questions/what-needs-improvement-with-bizagi; capterra.com/p/127621/BPM-Suite/reviews; processcamp.io/tools/bizagi; sourceforge.net/app/bizagi-modeler; selecthub/getapp vía búsqueda.
- **[unverified]** [Quejas de usuarios] Hilos del foro (títulos y resúmenes de búsqueda) apuntan a: nivel 2 sin tiempos de espera; resultados no consistentes con teoría de colas por ser simulación terminante; problemas al introducir decimales en parámetros de distribución; la simulación se detiene en event-based gateways; errores al exportar a Excel; petición de exportar a CSV/OpenOffice.
  - _Evidencia_: Títulos indexados de feedback.bizagi.com (simulation-calculates-wrong-times, entering-decimals-in-distribution-parameters…, my-simulation-stops-at-event-based-gateway, error-exporting-to-excel, how-to-export-simulation-results-to-csv…). No pude leer los hilos (portal en mantenimiento; web.archive.org bloqueado).
- **[verified]** [Vocabulario BPSim reutilizable] BPSim agrupa parámetros en TimeParameters (transferTime, queueTime, waitTime, setupTime, processingTime, validationTime, reworkTime; lagTime y duration sólo como resultados), ControlParameters (interTriggerTimer, triggerCount, probability, condition), ResourceParameters (availability, quantity, selection), CostParameters (fixedCost, unitCost), PriorityParameters (interruptible, priority) y PropertyParameters; ScenarioParameters: start, duration, warmup, replication, seed, baseTimeUnit, baseCurrencyUnit, baseResultFrequency, traceOutput; ResultType: min, max, mean, count, sum; Calendar basado en iCalendar RFC 5545. Bizagi expone un subconjunto: interTriggerTimer, triggerCount, processingTime, probability, availability, quantity, selección AND/OR, fixedCost, unitCost, replication, seed, baseTimeUnit, baseCurrencyUnit.
  - _Evidencia_: PDF BPSim 2.0 (WFMC-BPSWG-2016-01) secciones 6.1, 6.3.3, 7.x, 6.4, cruzado con las páginas de niveles de Bizagi.
- **[verified]** [CHECKLIST MVP-must] Elementos BPMN: start/end event 'none', task (todas las variantes como task genérica), sequence flow, exclusive gateway con probabilidades por flujo (reparto equitativo por defecto), inclusive gateway con probabilidades independientes, parallel gateway (fork/join), embedded subprocess aplanado, timer intermediate event como retardo. Es el mismo núcleo que Bizagi simula en niveles 1-4.
  - _Evidencia_: level_1_example.htm (gateways exclusivos/inclusivos), simulation_in_bizagi.htm (subprocesos embebidos vs reutilizables, timer events como generadores).
- **[verified]** [CHECKLIST MVP-must] Escenario: name, description, start date, duration, base time unit, base currency unit, replications, seed; parada por duración o por max arrival count (el primero); varios escenarios sobre el mismo .bpmn; duplicar escenario.
  - _Evidencia_: scenarios.htm.
- **[verified]** [CHECKLIST MVP-must] Llegadas: triggerCount (max arrival count) + interTriggerTimer constante o distribución en cada start event/timer generador. Tiempos: processingTime constante o distribución por tarea/evento. Distribuciones mínimas: constante, uniforme, triangular, exponencial, normal (con truncado a ≥0 y aviso), lognormal; añadir erlang, gamma, weibull, beta, poisson y empírica (UserDistribution) cuesta poco con numpy y cubre BPSim completo.
  - _Evidencia_: level_2_example.htm + lista BPSim 2.0 + lista secundaria adnlean.
- **[verified]** [CHECKLIST MVP-must] Recursos: id, nombre, tipo (rol/equipo), availability (cantidad), fixedCost por uso, unitCost por hora; asignación por tarea con cantidad y modo AND (todos) / OR (cualquiera); fixedCost por actividad. Calendarios: patrón de recurrencia (diario/semanal como mínimo; mensual/anual después), hora de inicio, duración, rango de vigencia, matriz disponibilidad recurso × calendario con calendario por defecto.
  - _Evidencia_: level_3_example.htm, level_4_example.htm.
- **[verified]** [CHECKLIST MVP-must] Salidas por elemento: instancias iniciadas y completadas, tiempo de proceso min/max/avg/total, espera por recurso min/max/avg/desv.est./total, costo fijo total. Por recurso: utilización %, costo fijo, costo unitario, costo total. Por proceso: mismas métricas agregadas. Reporte what-if lado a lado con diferencias resaltadas; exportación tabular (CSV/XLSX). Replicaciones con semilla reproducible.
  - _Evidencia_: level_3/4_example.htm, what_if_analysis.htm, simulation_in_bizagi.htm.
- **[likely]** [CHECKLIST MVP-must, más allá de Bizagi y barato] Percentiles (P50/P90/P95) de cycle time y espera, longitud media/máxima de cola por actividad, throughput por unidad de tiempo, costo por caso, ranking de cuellos de botella, event log por caso (case_id, activity, resource, start, end, wait). Son quejas explícitas de usuarios de Bizagi y salen gratis de un DES que ya registra eventos.
  - _Evidencia_: Quejas PeerSpot/Capterra sobre falta de granularidad; ausencia de estas columnas en la doc de Bizagi; SIMULATION_ENGINE.md del corpus ya las lista.
- **[verified]** [CHECKLIST later] Corrida animada con contadores en vivo; Start Quantity / Completion Quantity; message events emparejados por message flow; signal/link events por nombre; boundary events (timer/error) e event-based gateway; warm-up (BPSim lo define, Bizagi no lo expone); parámetros alimentados desde event logs (process mining); publicación a PDF/Word; gestión de recursos por turno con preempción configurable.
  - _Evidencia_: simulation_in_bizagi.htm, process_mining_simulation.htm, BPSim 2.0 ScenarioParameters.warmup.
- **[verified]** [CHECKLIST skip] Choreography/Conversation diagrams, multiple-instance tasks/subprocesses, complex gateways, transactional y ad-hoc processes (Bizagi tampoco los simula); lectura del formato .bpm propietario; publicación a SharePoint/Wiki; XPDL; réplica del diálogo de 4 'niveles' como concepto de producto (basta con que los parámetros sean opcionales y el motor degrade: sin recursos ⇒ capacidad infinita, sin calendarios ⇒ 24×7).
  - _Evidencia_: simulation_in_bizagi.htm (lista de no soportados); exporting_to_bpmn.htm.

## Preguntas abiertas

- Lista exacta de distribuciones en el diálogo avanzado de Modeler 4.3 (sólo hay fuente secundaria; verificar en una VM Windows o con captura de pantalla de un usuario).
- Disciplina de cola del motor de Bizagi (¿FIFO estricto? ¿prioridades? no se expone) y cómo resuelve la asignación OR entre recursos alternativos.
- Comportamiento de calendarios sobre tareas en curso al cerrar un turno: ¿se interrumpen y reanudan (preempción) o terminan? No documentado.
- Si el .bpm propietario guarda los parámetros de simulación como XML legible (posible ZIP) — sólo verificable abriendo un .bpm real.
- Si Bizagi sigue BPSim 1.0 o 2.0 y si su motor calcula 'sum' y 'count' como en ResultType de BPSim.
- Existencia de control de velocidad/pausa en la corrida animada (no documentado).
- Si habrá release 4.4 o cambios de licencia en lo que queda de 2026 (feedback.bizagi.com en mantenimiento; release notes sin entradas 2026).
- Contenido exacto del Excel de what-if (pestañas por escenario, pestaña de recursos) — sólo fuente indirecta.

## Fuentes

- https://help.bizagi.com/platform/en/simulation_levels.htm
- https://help.bizagi.com/platform/en/level_1_example.htm
- https://help.bizagi.com/platform/en/level_2_example.htm
- https://help.bizagi.com/platform/en/level_2_example_st.htm
- https://help.bizagi.com/platform/en/level_3_example.htm
- https://help.bizagi.com/platform/en/level_4_example.htm
- https://help.bizagi.com/platform/en/scenarios.htm
- https://help.bizagi.com/platform/en/what_if_analysis.htm
- https://help.bizagi.com/platform/en/what_if_analysis_example.htm
- https://help.bizagi.com/platform/en/simulation_in_bizagi.htm
- https://help.bizagi.com/platform/en/what_is_simulation.htm
- https://help.bizagi.com/platform/en/simulation.htm
- https://help.bizagi.com/platform/en/process_mining_simulation.htm
- https://help.bizagi.com/platform/en/process_mining.htm
- https://help.bizagi.com/platform/en/process_discovery.htm
- https://help.bizagi.com/platform/en/exporting_to_bpmn.htm
- https://help.bizagi.com/platform/en/import_diagram_from_bpmn.htm
- https://help.bizagi.com/platform/en/bm-faqs.htm
- https://help.bizagi.com/platform/en/general_faqs.htm
- https://help.bizagi.com/platform/en/bm_requirements.htm
- https://help.bizagi.com/platform/en/bm_download.htm
- https://help.bizagi.com/platform/en/ms_requirements.htm
- https://help.bizagi.com/platform/en/editing_cloud_models.htm
- https://help.bizagi.com/platform/en/signing-in-personal.htm
- https://help.bizagi.com/platform/en/additional_properties.htm
- https://releasenotes.bizagi.com/en/release-notes/releases/modeler-4-3
- https://releasenotes.bizagi.com/en/release-notes/releases/modeler-4-2
- https://releasenotes.bizagi.com/en/release-notes/releases/modeler-4-1
- https://releasenotes.bizagi.com/en/release-notes/releases/modeler-4-0
- https://releasenotes.bizagi.com/en/release-notes/releases/all-releases
- https://releasenotes.bizagi.com/en/release-notes/updates/modeler
- https://www.bizagi.com/en/business-process-simulation
- https://www.bizagi.com/en/platform/standards
- https://www.bizagi.com/en/platform/modeler
- https://feedback.bizagi.com/en/announcement/change-in-license-options
- http://feedback.bizagi.com/en/topic/bizagi-simulated-process-completion-times-appear-not-to-be-consistent-with-queuing-theory
- https://feedback.bizagi.com/en/topic/simulation-calculates-wrong-times
- https://feedback.bizagi.com/en/topic/my-simulation-stops-at-event-based-gateway
- https://www.bpsim.org/specifications/2.0/WFMC-BPSWG-2016-01.pdf
- https://www.bpsim.org/specifications/1.0/WFMC-BPSWG-2012-01.pdf
- https://github.com/bpmn-io/bpmn-js/issues/469
- https://github.com/bpmn-io/bpmn-moddle/issues/40
- https://github.com/bpmn-miwg/bpmn-miwg-test-suite/tree/master/Bizagi%20Modeler%202.8.0.8
- (se descartaron repos personales sin archivo LICENSE como fuente de fixtures)
- https://eprints.lancs.ac.uk/id/eprint/86603/1/article_rr_v6_np.pdf
- https://adnlean.com/modelado-y-simulacion-en-bizagi-caso-aplicado-en-plantilla-excel/
- https://www.linkedin.com/pulse/bizagi-modeler-niveles-de-simulaci%C3%B3n-daniel-jara-tralma
- https://www.peerspot.com/questions/what-needs-improvement-with-bizagi
- https://www.capterra.com/p/127621/BPM-Suite/reviews/
- https://processcamp.io/tools/bizagi
- https://sourceforge.net/app/bizagi-modeler/
- https://en.wikipedia.org/wiki/Bizagi
