# Architecture Decision Log

Registro de decisiones de arquitectura de Lila Modeler. Son reversibles mientras el proyecto esté en etapa temprana — cada una indica, cuando aplica, cuándo revisarla.

Fuentes:

- **ADR-001 a ADR-008**: corpus previo del proyecto (entonces llamado *Open Process Platform*), `docs/DECISIONS-corpus-previo.md`. Se copian aquí verbatim.
- **ADR-009 a ADR-023**: `LILA_MODELER_ESTRUCTURA.md`, sección 4 ("Decisiones (ADR)"). Se copian aquí verbatim; ese documento es la fuente de verdad — ante cualquier discrepancia entre este archivo y `LILA_MODELER_ESTRUCTURA.md`, gana el documento de estructura y este archivo se corrige para reflejarlo.
- **ADR-024 en adelante**: decisiones surgidas durante la implementación, con su ticket de prueba.

Varias ADR del corpus previo quedan cerradas o reinterpretadas por decisiones posteriores; cada una lo indica en una nota al final de su entrada, con el ADR que la cierra o reinterpreta.

---

## ADR-001 — BPMN as interchange standard

**Status:** Accepted

Usaremos archivos `.bpmn` estándar para importación y exportación.

El XML BPMN no será necesariamente nuestra única base de datos interna.

### Reason

- Interoperabilidad.
- Evitar lock-in.
- Compatibilidad con herramientas existentes.
- Permitir que el archivo sobreviva al producto.

---

## ADR-002 — Web-first platform

**Status:** Accepted

La aplicación principal será web.

Debe poder ejecutarse:

- Local.
- Self-hosted.
- Servidor.
- Cloud.

Desktop wrapper será opcional.

> **Nota:** ADR-023 concreta esto: la SPA de `apps/web` es la única UI, empaquetada como app de escritorio (Electron, `apps/desktop`) y servida sin cambios por el servidor self-hosted (`packages/server`, M6). "Desktop wrapper opcional" de este ADR es exactamente lo que ADR-023 diseña.

---

## ADR-003 — API-first and agent-first

**Status:** Accepted

Las operaciones de dominio deberán exponerse mediante servicios reutilizables.

UI y MCP utilizarán esos servicios.

> **Nota:** ADR-019 concreta esto: la API son las funciones exportadas de `@lila/engine` (`parseBpmn`, `validate`, `resolveScenario`, `simulate`, `compare`) y la CLI; MCP llega en M4 sobre las mismas funciones, antes que REST.

---

## ADR-004 — Simulation before full BPM suite

**Status:** Accepted

El primer producto funcional será el motor de simulación.

RACI, repository, interviews y process mining vendrán después.

> **Nota:** Confirmado por el orden de hitos de `LILA_MODELER_ESTRUCTURA.md` sección 7: M0–M3 son el motor y la CLI con paridad Bizagi; RACI (`packages/catalog`), `packages/interview` y `mining/` son módulos futuros explícitamente pospuestos (sección 5, "Módulos futuros").

---

## ADR-005 — Evaluate before fork

**Status:** Accepted

No reescribir ni forkear por reflejo.

Proceso:

```text
Discover
↓
Evaluate
↓
PoC
↓
Decide:
Use / Wrap / Fork / Replace
```

> **Nota:** Cerrado por ADR-010: resultado *Replace* para motores DES existentes (Prosimos, Scylla, BIMP/QBP, Apromore, bpmn-engine, Camunda 8, SpiffWorkflow — motor propio) y *Use* para bpmn-js/bpmn-moddle (ADR-011). Prosimos y Scylla se conservan como oráculos numéricos en desarrollo, no como núcleo.

---

## ADR-006 — Own the abstraction layer

**Status:** Accepted (reinterpretado, ver nota)

Incluso si utilizamos un motor externo, la plataforma hablará con una interfaz propia.

Esto permite reemplazar componentes en el futuro.

> **Nota — reinterpretación (`LILA_MODELER_ESTRUCTURA.md` sección 4):** "Own the abstraction layer" no significa una interfaz `SimulationScheduler` con adaptadores a SimPy/Rust (abstracción especulativa que ningún proposal defendió): significa poseer los **tres contratos JSON** (IR, escenario, resultado + event log) y la firma `simulate()`. Es lo que permite reemplazar el kernel sin tocar CLI, UI ni MCP.

---

## ADR-007 — Scenario separated from diagram

**Status:** Accepted

Los parámetros de simulación deberán poder existir como escenarios independientes del BPMN.

Esto permite múltiples escenarios sobre un mismo proceso.

> **Nota:** Concretado por ADR-013 (dónde vive cada dato) y ADR-015 (formato de escenario v1): parámetros de simulación en `*.scenario.json`, fuera del `.bpmn`; el `.bpmn` solo lleva diagrama, documentación estándar y la extensión `lila:` (ver `docs/BPMN_EXTENSION.md`).

---

## ADR-008 — No final product name yet

**Status:** Closed (ver nota)

Usar `Open Process Platform` como working title hasta definir:

- Posicionamiento.
- Marca.
- Dominio.
- Licencia.
- Público objetivo.

> **Nota:** Cerrado por ADR-020 ("Cierra ADR-008: el proyecto se llama Lila Modeler."), decidido por Brito el 2026-09-03. Licencia cerrada en el mismo ADR-020 (Apache-2.0).

---

## ADR-009 — Lenguaje y kernel del motor: TypeScript, bucle de eventos propio, cero dependencias en `core/`

**Status:** Accepted

Porqué: un solo runtime cubre navegador (Worker), CLI, tests y MCP; benchmark medido hoy (100k casos: JS 143 ms, SimPy 1 273 ms, SimPy/Pyodide 2 798 ms más ~12 MB de runtime); ninguna librería DES en TS tiene adopción (0–35 estrellas, un autor cada una); los crates Rust no traen recursos/colas y el toolchain wasm se acaba de reorganizar. Descarta: Python/SimPy (segundo runtime, parser BPMN sin opción permisiva mantenida: SpiffWorkflow es LGPL), Rust/WASM (sin necesidad demostrada), cualquier librería DES. Revisar: solo si un spike muestra que TS no alcanza un objetivo real de rendimiento; entonces `core/` se reimplementa detrás de la misma `simulate()`.

---

## ADR-010 — Motor existente: ninguno. Se escribe propio. Prosimos y Scylla solo como oráculos numéricos en desarrollo

**Status:** Accepted

Porqué: Prosimos no tiene archivo LICENSE en ninguna rama (todos los derechos reservados), embebe jars propietarios de QBP, exige Python < 3.12 y su `main` está parado desde 2025-01-30; Scylla es MIT pero Java + Swing + DESMO-J 2017; BIMP/QBP es cerrado; Apromore archivado 2025-08-29; bpmn-engine, Camunda 8 y SpiffWorkflow son motores de ejecución con semántica y licencias equivocadas. Cierra ADR-005 (evaluate before fork) con resultado *Replace* para motores y *Use* para bpmn-js/bpmn-moddle. Revisar: si Prosimos publica una licencia permisiva, reevaluar como oráculo en CI (no como núcleo).

---

## ADR-011 — Editor: bpmn-js tal cual, con la marca de agua bpmn.io visible; panel de propiedades propio en React

**Status:** Accepted

Porqué: bpmn-js 18.27.1 (publicado 2026-09-03, 27 releases en 2026) es la única librería del sector viva, con tipos y ejemplos oficiales de moddle extensions, properties providers y renderers; "nueva tarea → nombre editable sin `Task 1`" viene de serie. La licencia es MIT más una cláusula: la marca de agua no se puede quitar, ocultar ni tapar, **tampoco en un fork** (Camunda Desktop Modeler, Fluxnova y Miragon la llevan); reemplazarla por diagram-js son ~28 000 líneas. Los paquetes oficiales del panel de propiedades no publican tipos y arrastran dependencias Camunda. Descarta: fork, KIE bpmn-editor (una sola release, React ≤ 18, semántica jBPM; revisitar en 12 meses), LogicFlow, Camunda Web Modeler (propietario). Consecuencia de diseño: reservar la esquina inferior derecha del canvas.

---

## ADR-012 — Identidad de elemento y de proceso

**Status:** Accepted

Elemento = atributo `id` BPMN, NCName, generado con prefijo por tipo y sufijo aleatorio (`Task_7f3k2q1`), nunca regenerado al importar/exportar/renombrar, nuevo al copiar; ids ajenos no-NCName (Bizagi puede emitirlos) se sanitizan con un mapa reversible. Proceso = `bpmn:process@id` como clave lógica (slug ASCII) + `lila:versionTag`; `exporter="Lila Modeler"` y `exporterVersion` en `definitions`. Porqué: es la única clave que comparten todas las herramientas (Signavio `sid-uuid`, bpmn-js `Activity_x`, jBPM `_uuid`) y de la que cuelgan BPSim, qbp, Prosimos y Scylla; usar nombres como clave es la decisión que fuerza reescrituras. Patrón Flowable (definition key + version) / Bonita / Camunda (process id + versionTag).

> Implementación operativa completa en `docs/BPMN_EXTENSION.md`.

---

## ADR-013 — Dónde vive cada dato

**Status:** Accepted

Diagrama y documentación por elemento **dentro** del `.bpmn` (`bpmn:documentation` estándar + `lila:` en `extensionElements`); parámetros de simulación **fuera**, en `*.scenario.json`; catálogo (roles, sistemas, documentos, riesgos, controles, KPIs) en `catalog.json` con ids estables; resultados en JSON + CSV. Los elementos **referencian** el catálogo (`lila:roleRef`), nunca contienen texto libre: es lo que hacen ADONIS, Signavio (dictionary) y ARIS (definición/ocurrencia), y es la otra decisión que forzaría reescritura si se toma mal. Confirma ADR-001 y ADR-007.

---

## ADR-014 — Un solo namespace de extensión, definido una sola vez

**Status:** Accepted

`xmlns:lila="https://lila-modeler.org/schema/bpmn/1"` (el IRI no necesita resolver; debe ser estable y decidirse antes de M4). Descriptor moddle JSON en `packages/engine/src/bpmn/lila.moddle.json`, compartido por editor, CLI y servidor. Elementos (no atributos) para permitir listas. Crece de forma aditiva. bpmn-moddle preserva namespaces desconocidos en round-trip (verificado hoy con archivos BPSim, qbp y Bizagi reales); la preservación por Camunda/Signavio/ADONIS se prueba en M4 y el plan B es `annotations.json` sidecar keyed por id con el mismo descriptor.

> Implementación operativa completa en `docs/BPMN_EXTENSION.md`.

---

## ADR-015 — Formato de escenario v1: JSON propio, separado del .bpmn, keyed por id, vocabulario BPSim 2.0, parámetros nombrados, segundos, `extends`

**Status:** Accepted

Porqué: cumple los cuatro criterios a la vez (N escenarios por diagrama; diffs de git sin ruido de coordenadas DI; parcheable por agentes como `elements["Task_1"].processingTime.mean = 400`; migra 1:1 a `jsonb`). BPSim está congelado desde 2016 sin tooling open source y, embebido, mezcla layout con parámetros; qbp admite un solo escenario y un recurso por tarea; Prosimos usa parámetros posicionales de scipy y no tiene licencia; Bizagi no exporta parámetros. Descarta: BPSim o qbp como formato canónico. Adaptadores en los bordes cuando aparezca un consumidor: import qbp (~150 líneas, 182 archivos en GitHub, fixtures de Prosimos/Simod), export/import BPSim 2.0 como archivo `.bpsim` cuando haya usuario de Sparx EA, export Prosimos solo para oráculos.

---

## ADR-016 — Semántica de calendarios (Bizagi no documenta la suya)

**Status:** Accepted

Patrón semanal relativo a `run.start`; sin DST ni festivos en v1 (campos reservados). Una tarea solo arranca dentro del calendario de su recurso y su `processingTime` consume solo tiempo de calendario (se pausa al cerrar el turno y reanuda al abrir). El tiempo cerrado se reporta como `offHoursWait`, separado de `resourceWait`. Utilización = tiempo ocupado / `Σᵢ (capacidadᵢ × tiempo abiertoᵢ)`, sumando los tramos de capacidad del pool sobre la ventana de medida `[warmup, t_stop]` — **no** la duración declarada del escenario, que es lo que usa Bizagi en su nivel 4 (conversión exacta en `docs/BIZAGI_PARITY.md` § D7). Es la única definición que hace comparables niveles 3 y 4. Documentado en `docs/SEMANTICS.md`; ajustable si alguien aporta el comportamiento real de L-Sim/Bizagi.

**LILA-164 (R-CAL-11):** un mismo pool puede tener capacidad distinta por calendario — `capacity: [{ calendar, capacity }]`, el «Resources → Calendars → quantity» de Bizagi — en vez de partirse en un pool por turno. El pool está abierto por **unión** de sus calendarios (tres turnos que cubren las 24 h son un 24×7, sin `offHoursWait`), su capacidad en `t` es la **suma** de los tramos abiertos (dos calendarios que se solapan suman), cerrar un tramo **no** interrumpe lo que está en curso, y durante el cierre del pool entero vale la capacidad del primer instante abierto posterior, que es lo que conserva R-CAL-6 y deja la forma numérica bit a bit igual a M3 (R-DEG-2). Sin esto el nivel 4 de Bizagi no se puede replicar.

> Fórmulas y definiciones operativas completas en `docs/RESULTS_FORMAT.md`.

---

## ADR-017 — Determinismo

**Status:** Accepted

Heap ordenado por `(t, seq)` con `seq` monótono; PRNG propio sembrado (mulberry32/xoshiro) con un stream por elemento derivado de `hash(seed, replicación, elementId)`: cinco líneas que dan *common random numbers*, es decir, añadir un cajero no cambia los números de las tareas no tocadas y los what-if se leen limpios. Nunca `Math.random` ni `Date`. Garantía: bytes idénticos dentro de un mismo runtime (test en Node 22 y 24); entre navegadores solo estadísticamente idénticos (`Math.log/exp` pueden diferir en el último bit).

---

## ADR-018 — Persistencia de la modalidad instalable: archivos del usuario; nada de servidor

**Status:** Accepted

Un proyecto es una carpeta (`model.bpmn` + `*.scenario.json`). En la app de escritorio: abrir y guardar con los diálogos nativos del sistema (`dialog.showOpenDialog` / `showSaveDialog` y `fs` en el proceso principal de Electron, expuestos al renderer por `preload` + IPC con una API mínima: `openFile`, `saveFile`, `readProject`, `recentFiles`); recientes y estado de ventana en `app.getPath('userData')`. Sin SQLite, sin IndexedDB, sin cuentas, sin servidor. La demo online (GitHub Pages) usa `<input type=file>` y descarga: sirve para probar sin instalar, no es una modalidad. Porqué: un estudiante o analista trabaja con archivos; git da versionado AS-IS/TO-BE y diff gratis para quien lo use; los bytes son los mismos que guardará la modalidad servidor. Revisar: nunca por sí sola; la modalidad servidor (ADR-023) es la respuesta al trabajo compartido, no una evolución de esta.

---

## ADR-019 — MCP antes que REST; ambos sobre las mismas funciones

**Status:** Accepted

La API del MVP son las funciones exportadas de `@lila/engine` (`parseBpmn`, `validate`, `resolveScenario`, `simulate`, `compare`) y la CLI. `packages/mcp` (stdio, `@modelcontextprotocol/server` 2.0.0, spec 2026-07-28) llega en M4, justo después de la paridad en CLI y antes de la UI, con 5 tools: cuesta ~100 líneas, no depende de la UI y Brito trabaja con agentes; desde ahí un agente valida, simula, parchea escenarios y compara en su computadora. REST (hono/fastify, una pantalla) llega con el servidor y el repositorio. Ninguna lógica vive en el borde. Cumple ADR-003 (UI y agentes hacen lo mismo) sin construir un servidor que hoy no sirve a nadie.

---

## ADR-020 — Licencias

**Status:** Accepted

Núcleo, CLI, MCP y web bajo **Apache-2.0** (decidido por Brito el 2026-09-03: cláusula de patentes explícita y adopción empresarial; compatible con la licencia bpmn.io, MIT de bpmn-moddle y Apache-2.0 de Simod). Prohibido AGPL/LGPL/Camunda License en `packages/*` (pm4py es AGPL-3.0 desde 2.7.12; SpiffWorkflow LGPL; Camunda 8 licencia propia). Prosimos y el jar de QBP jamás entran al repositorio ni a CI pública. La marca de agua de bpmn.io se acepta y se anuncia en el README. Cierra ADR-008: el proyecto se llama Lila Modeler.

---

## ADR-021 — Alcance BPMN y política de "no soportado"

**Status:** Accepted

Soportado en v1: la lista de la sección 3 de `LILA_MODELER_ESTRUCTURA.md` (ver `docs/BIZAGI_PARITY.md`). Todo lo demás produce **error de validación explícito** con el mismo texto que Bizagi ("no soportado por el simulador"), nunca un fallo silencioso. Cada elemento extra se añade cuando lo pida un usuario real.

---

## ADR-022 — Estructura del repositorio: un paquete que se publica, una app, y nada especulativo

**Status:** Accepted

`packages/engine` (con `core/` puro como subcarpeta), `apps/web`, `packages/mcp` en M4. npm workspaces (viene con Node; sin pnpm/turbo/nx). Sin paquetes `shared`, `types` ni `utils`. Porqué: un paquete por cosa que se publica; el aislamiento de `core/` se garantiza con un test que comprueba que el bundle del Worker no incluye `bpmn-moddle`, React ni `node:*`, no con un paquete aparte. Se divide en más paquetes cuando publicar por separado importe.

---

## ADR-023 — Dos modalidades de despliegue, una sola SPA, un solo motor

**Status:** Accepted

(1) **App de escritorio**: la SPA de `apps/web` empaquetada con **Electron** en `apps/desktop` (proceso principal + `preload`), construida con electron-builder para macOS (dmg), Windows (nsis) y Linux (AppImage y deb) desde una matriz de CI; `fileAssociations` para abrir `.bpmn` con doble clic; auto-update opcional cuando haya releases frecuentes. El motor corre en el Web Worker del renderer; la persistencia es ADR-018. Precedente directo: Camunda Desktop Modeler (MIT) es Electron + bpmn-js + electron-builder con asociación de `.bpmn`; su `electron-builder.json` es la plantilla.

(2) **Servidor self-hosted**: `packages/server` (M6) en Node sirve **la misma SPA compilada**, expone REST y MCP por HTTP sobre las funciones de `@lila/engine`, autentica usuarios, guarda procesos/versiones/escenarios/runs en SQLite o PostgreSQL, y se distribuye como imagen Docker con `docker-compose.yml`. La simulación interactiva sigue corriendo en el Worker del navegador de cada usuario; el servidor solo simula cuando lo piden agentes, la CLI remota o corridas programadas.

**La costura entre ambas** es una interfaz `ProjectStore` en la SPA (listar/leer/escribir procesos, escenarios y runs) con implementaciones `DesktopStore` (IPC → `fs`), `RemoteStore` (REST, M6) y un `BrowserStore` mínimo (input/descarga) para la demo online. Se define en M5; la remota llega en M6 sin tocar vistas ni motor.

**Porqué Electron y no Tauri**: Tauri 2 produce instaladores de ~10 MB frente a ~150 MB y usa menos memoria, pero depende del webview del sistema, y en Linux (WebKitGTK) hay problemas de rendimiento y estabilidad documentados (reportes de 40 fps frente a 240 fps en Chromium para la misma app; hilo "WebKit is totally unstable" en las discusiones de Tauri); bpmn-js es un canvas SVG intensivo donde la consistencia de Chromium en los tres sistemas vale más que el tamaño; y Tauri exige toolchain Rust. Electron 43, electron-builder 26 y electron-forge (ESM, Node ≥ 22.12) están activos en 2026. Descarta: PWA como modalidad principal (sin diálogos nativos en Safari/Firefox, sin asociación de archivos). Reversible: si el tamaño del instalador se vuelve problema real, Tauri envuelve la misma SPA y solo cambia `DesktopStore`.

**Porqué TypeScript sale reforzado**: el mismo bundle corre en el Worker de la app de escritorio y en el Node del servidor; un motor Python habría exigido empaquetar un runtime Python dentro del instalador o cargar Pyodide (~12 MB).

---

## ADR-024 — Agregado top-level de varias replicaciones

**Status:** Accepted

`simulate()` publica en los campos numéricos top-level la media aritmética del mismo campo ya
agregado en cada replicación. `replications.kpis` conserva, para esos mismos paths, media,
desviación muestral e IC95. Esto deja un resultado directamente consumible por CLI/UI sin obligar
a navegar el mapa de KPI y mantiene una observación estadística por replicación.

Se descarta usar la primera replicación: sería determinista pero no representativa y podría
contradecir el `mean` publicado al lado. Se descarta agrupar todos los casos de todas las
replicaciones: daría más peso a las corridas con más observaciones y rompería la unidad estadística
con la que se calcula el IC. En cancelación, el top-level incluye el trabajo de la réplica parcial
para no ocultarlo; el IC usa solo replicaciones completas y se omite con menos de dos.

Revisar solo si un consumidor necesita explícitamente resultados por réplica; en ese caso se añade
un campo separado, sin cambiar el significado del top-level. *(prueba: LILA-029)*

---

## ADR-025 — Event log plano por asignación, agrupado por instancia de actividad

**Status:** Accepted

Cada asignación de pool produce una fila plana y todas las filas de una ocurrencia comparten
`activityInstanceId` y su posición original en `allocationIndex`. Una actividad sin recurso, o
una que se cierra todavía en cola, produce una fila sentinel (`resourceId = null`,
`resourceQuantity = null`, `allocationIndex = null`). El lifecycle parcial distingue `terminated` de `inFlight`, conserva timestamps anulables y
`observedUntil`. Los costos se descomponen en `elementCost` y `resourceCost`; el fijo del elemento
aparece una sola vez en la fila emitida de menor `allocationIndex` y `cost` es su suma exacta.

Se descarta una fila por actividad con `resources[]`: duplica estructura dentro del CSV, dificulta
streaming/XES y contradice el formato plano comprometido. Se descartan acumuladores internos sin
reconstrucción desde el log: violan R-COST-3 y no permiten auditar utilización/costos sin volver a
simular. La alternativa elegida conserva CSV plano, representa `quantity` y AND/OR, evita duplicar
el costo fijo y mantiene observables las tareas en cola o en curso al cortar.

Revisar solo con una nueva versión del formato de resultados; consumidores v1 dependen de estas
columnas. *(prueba: LILA-033, LILA-036, LILA-037)*

---

## ADR-026 — Scheduler AND por firmas y heap de cabezas elegibles

**Status:** Accepted

Las solicitudes AND con la misma firma ordenada de `(pool, quantity)` comparten una cola FIFO. Cada
pool indexa solo las firmas que lo usan; al cambiar su capacidad se reevalúan esas cabezas. Un heap
separado, comparado explícitamente por el `(enabledAt, seq)` original, elige el primer candidato
satisfacible y reserva todos sus pools en una sola mutación. Las solicitudes single-pool comparten
una única clase por pool, incluso con cantidades distintas, para conservar FIFO estricto.

Se descarta recorrer y reinsertar toda la cola global en cada llegada: bajo saturación produce
O(n² log n). También se descarta crear una clase single-pool por cantidad, porque permitiría que una
solicitud pequeña adelantase a la cabeza del mismo pool. Versiones/tombstones invalidan cabezas sin
búsquedas lineales y release/cancel reúnen todos los pools afectados antes de planificar.

LILA-035 usa esa estructura sin añadir nada nuevo: una selección OR se encola como **una entrada
por alternativa**, cada una en la clase single-pool de su pool y todas con el mismo `seq`, así que
comparten posición FIFO y compiten en igualdad con las solicitudes de un solo pool. Conceder una
alternativa deja a las demás como lápidas — el mismo mecanismo que ya invalida cabezas — y marca sus
clases para reevaluar en el acto, que es lo que impide que la cabeza siguiente de un pool retirado
espere a un evento que ya no va a llegar. El desempate entre alternativas libres a la vez es el
índice declarado en el escenario (R-REC-6): `(enabledAt, seq, altIndex)` sigue siendo un orden total
y no altera el de AND/single, donde `altIndex` siempre vale 0. Se descarta elegir el pool más libre o
el de menor utilización: obligaría a un criterio global y a reordenar colas, y no hay paridad Bizagi
que lo pida. `ResourceManager` sigue sin ser API pública. *(prueba: LILA-034, LILA-035)*

---

## Ver también

- `LILA_MODELER_ESTRUCTURA.md` — documento de estructura completo (fuente de verdad de todas las ADR de este archivo).
- `docs/BIZAGI_PARITY.md` — tabla de paridad referenciada por ADR-021.
- `docs/BPMN_EXTENSION.md` — implementación operativa de ADR-012 y ADR-014.
- `docs/RESULTS_FORMAT.md` — implementación operativa de la parte de calendarios/utilización de ADR-016.
- `docs/DECISIONS-corpus-previo.md` — texto original de ADR-001 a ADR-008 (corpus previo, proyecto entonces llamado *Open Process Platform*).
- `BACKLOG.md` — desglose en épicas y tickets por hito.
