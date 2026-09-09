# Lila Modeler — Estructura del sistema

Fecha: 2026-09-03. Documento de decisión, no de investigación. La investigación previa (corpus previo, archivado fuera del repo) fue el insumo; las verificaciones de hoy (licencias, versiones, benchmarks, qué hace Bizagi exactamente) están en `investigacion-2026-09-03/`. Aquí están las decisiones y su porqué.

---

## 1. Resumen ejecutivo

Lila Modeler empieza como **un motor de simulación de eventos discretos (DES) sobre BPMN estándar, escrito en TypeScript, sin servidor**, y crece a plataforma de Process Intelligence sin reescribirlo.

- **Qué se construye primero**: un paquete `@lila/engine` (motor puro + parser BPMN + formato de escenario + CLI `lila`) y una SPA (React + bpmn-js) que corre el motor en un Web Worker, empaquetada como app de escritorio con Electron. Cero backend, cero base de datos, cero Python.
- **Dos modalidades de uso, una sola app** (aclarado el 2026-09-03): (1) **app de escritorio instalable** (Electron) para Windows, Linux y macOS, como Discord, que funciona offline y sin servidor; (2) **servidor self-hosted** en la intranet de una empresa, al que sus usuarios entran por navegador. La misma SPA y el mismo motor sirven a las dos; lo único que cambia es de dónde se leen y a dónde se guardan los proyectos (`ProjectStore`, ADR-023).
- **En qué**: TypeScript único. Un bucle de eventos escrito a mano (~300–500 líneas) simula 100 000 casos en 0,14 s en esta máquina; SimPy tarda 1,3 s nativo y 2,8 s bajo Pyodide, que además pesa ~12 MB. No existe en 2026 ningún motor DES BPMN open source adoptable: Prosimos no tiene licencia, Scylla es Java+Swing, BIMP es cerrado, Apromore está archivado.
- **Definición de "hecho"**: reproducir la tabla de resultados de Bizagi Modeler con sus mismas columnas (niveles 1–4: validación, tiempos, recursos, calendarios) y añadir lo que sus usuarios echan en falta y sale gratis de un DES con log: percentiles, longitud de cola, throughput, costo por caso, ranking de cuellos de botella, event log por caso, determinismo por semilla, y correr en macOS/Linux/navegador.
- **Lo que se fija desde el día uno porque duele cambiarlo después** (y cuesta casi nada hoy): el `id` BPMN como única clave de elemento; `bpmn:process@id` + version tag como clave de proceso; un namespace de extensión `lila:` definido una sola vez; tres contratos JSON (IR, escenario, resultado) más un event log plano; la función pura `simulate(ir, scenario) → RunResult` como única puerta para CLI, UI, MCP y REST.
- **Lo que espera, pero está planeado y no es "algún día"**: la modalidad servidor (M6: `packages/server`, Docker, cuentas, REST, repositorio multiusuario). Después: catálogo/RACI con UI, entrevistas, minería. Se enganchan a los contratos, no al motor.

---

## 2. Lo urgente vs. lo que será

| | **Lo urgente (MVP, ~5 semanas)** | **Lo que será (plataforma)** |
|---|---|---|
| Producto | Simulador con paridad Bizagi, en navegador y CLI | Process Intelligence: repositorio, versiones, RACI, riesgos, controles, KPIs, agentes, minería |
| Modalidad | **App de escritorio** (Electron: instaladores para Windows, Linux y macOS; abre `.bpmn` con doble clic), offline, sin servidor | **Servidor self-hosted** en la intranet (Docker); los usuarios entran por navegador; misma SPA, mismo motor |
| Usuario | Estudiante, analista, académico | Equipo de procesos de una empresa + agentes de IA |
| Unidad de trabajo | Carpeta: `model.bpmn` + `*.scenario.json` | Las mismas unidades, en tablas `jsonb`/blob por versión |
| Persistencia | Archivos del usuario con diálogos nativos del sistema (Electron `dialog` + `fs` vía IPC); recientes en `userData`; git opcional | SQLite (equipo pequeño) o PostgreSQL detrás de una interfaz `Storage` de tres operaciones |
| Superficies | CLI, app de escritorio, demo web, (MCP mínimo) | + REST, MCP completo, permisos, auditoría |
| Runtime | Node ≥ 22 y navegador | + Python aislado (solo minería, por licencia AGPL de pm4py) |
| Editor | bpmn-js con su marca de agua | Igual; el editor no es el dominio |

**El principio que conecta ambos**: el `.bpmn` es la verdad del diagrama y de la documentación por elemento; los sidecars JSON (escenarios, catálogo, resultados) van keyed por `id` BPMN; la base de datos futura guarda esos mismos bytes y deriva índices, nunca un segundo modelo canónico. Es exactamente lo que hacen Camunda (Hub 8.10: "versión = snapshot del fichero"), Flowable y Signavio.

**Corrección al corpus previo**: ARCHITECTURE.md decía "Internal model ≠ BPMN XML" con entidades Activity/Role/RACIEntry en PostgreSQL desde el inicio. Eso describe el destino, no el MVP, y mal planteado obliga a mantener dos modelos. Reformulado: *el .bpmn es canónico; la base de datos es un índice derivado*.

---

## 3. Checklist de paridad con Bizagi

«Paridad» aquí es el criterio interno de aceptación (reproducir los resultados publicados), no
el posicionamiento público del proyecto: de cara afuera Bizagi es referencia e inspiración
(#289).

Fuente: ayuda oficial de Bizagi (niveles 1–4, escenarios, elementos no soportados), verificada hoy. Bizagi no expone "4 niveles" en el motor: son qué parámetros están rellenos. Lila no reproduce los niveles como concepto de producto; el motor degrada: sin recursos ⇒ capacidad infinita, sin calendario ⇒ 24×7.

| Capacidad | Bizagi | Lila | Hito |
|---|---|---|---|
| Start/End none, task (todas las variantes), sequence flow | ✓ | ✓ | M1 |
| Exclusive gateway con % por flujo (reparto equitativo por defecto) | ✓ | ✓ | M1 |
| Inclusive gateway con % independientes | ✓ | ✓ | M1 |
| Parallel gateway fork/join | ✓ | ✓ | M1 |
| Subproceso embebido (aplanado); reusable = tarea con tiempo global | ✓ | ✓ | M1 |
| Timer intermedio como retardo | ✓ | ✓ | M1 |
| Llegadas: max arrival count + intervalo (constante o distribución) | ✓ | ✓ | M1 |
| Processing time por tarea/evento, constante o distribución | ✓ | ✓ | M1 |
| Distribuciones: las 13 de BPSim 2.0 + constante + empírica | ✓ (subconjunto no documentado) | ✓ todas | M1 |
| Escenario: nombre, descripción, autor, versión, inicio, duración, unidad de tiempo, moneda, replicaciones, semilla | ✓ | ✓ (+ `warmup`, `extends`) | M1 |
| Parada: duración o max arrival count, lo primero | ✓ | ✓ | M1 |
| Recursos: tipo rol/equipo, disponibilidad, costo fijo por token, costo por hora | ✓ | ✓ | M2 |
| Asignación a tarea: uno o varios recursos, cantidad, AND / OR | ✓ | ✓ | M2 |
| Costo fijo por actividad | ✓ | ✓ | M2 |
| Salidas por elemento: started, completed, tiempo min/max/avg/total, espera min/max/avg/std/total, costo fijo | ✓ | ✓ mismos nombres de columna | M2 |
| Salidas por recurso: utilización %, costo fijo, costo unitario, costo total | ✓ | ✓ | M2 |
| Calendarios: recurrencia, hora de inicio, duración, vigencia; matriz recurso × calendario con calendario por defecto | ✓ | ✓ semanal en v1; mensual/anual y festivos reservados | M3 |
| What-if: varios escenarios, lado a lado, diferencias resaltadas | ✓ | ✓ (`lila compare`) | M3 |
| Replicaciones (recomiendan 30) | ✓ solo en what-if | ✓ siempre, con IC 95 % | M2 |
| Export de resultados | Excel | CSV (Excel lo abre; XLSX después si lo piden) | M2 |
| Importar `.bpmn` exportado por Bizagi | — | ✓ solo diagrama: Bizagi **no exporta** parámetros de simulación (verificado en 5 archivos reales, solo colores en `bizagi:`) | M0 |
| **Extras que Bizagi no da** | | | |
| p50/p90/p95 de ciclo y espera | ✗ | ✓ | M2 |
| Longitud de cola media/máx por actividad | ✗ | ✓ | M2 |
| Throughput por hora, costo por caso | ✗ | ✓ | M2 |
| Ranking de cuellos de botella | ✗ | ✓ | M2 |
| Event log por caso (CSV; XES después) | ✗ | ✓ | M2 |
| Espera fuera de horario separada de espera por recurso | ✗ (queja: "poca granularidad") | ✓ | M3 |
| Determinismo por semilla, byte a byte | parcial | ✓ | M1 |
| macOS / Linux / navegador | ✗ (4.3 sigue Windows-only, sin editor web) | ✓ | M5 |
| **Después** | | | |
| Animación con contadores en vivo | ✓ | token-simulation (MIT) cubre la parte didáctica; contadores DES en vivo no son prioridad | — |
| Start quantity / completion quantity | ✓ | reservado | — |
| Message/signal/link events, boundary events, event-based gateway | parcial | error de validación explícito hasta que un usuario lo pida | — |
| Parámetros desde event logs (Bizagi 4.0 process mining) | ✓ | fase minería (proceso Python separado) | — |
| **No** (Bizagi tampoco los simula) | | | |
| Multi-instancia, complex gateway, choreography/conversation, transaccional, ad-hoc; leer `.bpm` propietario | ✗ | ✗ | — |

---

## 4. Decisiones (ADR)

Numeradas a continuación de las 8 del corpus. Cada una: elección, porqué, qué descarta, cuándo revisarla.

**ADR-009 — Lenguaje y kernel del motor: TypeScript, bucle de eventos propio, cero dependencias en `core/`.**
Porqué: un solo runtime cubre navegador (Worker), CLI, tests y MCP; benchmark medido hoy (100k casos: JS 143 ms, SimPy 1 273 ms, SimPy/Pyodide 2 798 ms más ~12 MB de runtime); ninguna librería DES en TS tiene adopción (0–35 estrellas, un autor cada una); los crates Rust no traen recursos/colas y el toolchain wasm se acaba de reorganizar. Descarta: Python/SimPy (segundo runtime, parser BPMN sin opción permisiva mantenida: SpiffWorkflow es LGPL), Rust/WASM (sin necesidad demostrada), cualquier librería DES. Revisar: solo si un spike muestra que TS no alcanza un objetivo real de rendimiento; entonces `core/` se reimplementa detrás de la misma `simulate()`.

**ADR-010 — Motor existente: ninguno. Se escribe propio. Prosimos y Scylla solo como oráculos numéricos en desarrollo.**
Porqué: Prosimos no tiene archivo LICENSE en ninguna rama (todos los derechos reservados), embebe jars propietarios de QBP, exige Python < 3.12 y su `main` está parado desde 2025-01-30; Scylla es MIT pero Java + Swing + DESMO-J 2017; BIMP/QBP es cerrado; Apromore archivado 2025-08-29; bpmn-engine, Camunda 8 y SpiffWorkflow son motores de ejecución con semántica y licencias equivocadas. Cierra ADR-005 (evaluate before fork) con resultado *Replace* para motores y *Use* para bpmn-js/bpmn-moddle. Revisar: si Prosimos publica una licencia permisiva, reevaluar como oráculo en CI (no como núcleo).

**ADR-011 — Editor: bpmn-js tal cual, con la marca de agua bpmn.io visible; panel de propiedades propio en React.**
Porqué: bpmn-js 18.27.1 (publicado 2026-09-03, 27 releases en 2026) es la única librería del sector viva, con tipos y ejemplos oficiales de moddle extensions, properties providers y renderers; "nueva tarea → nombre editable sin `Task 1`" viene de serie. La licencia es MIT más una cláusula: la marca de agua no se puede quitar, ocultar ni tapar, **tampoco en un fork** (Camunda Desktop Modeler, Fluxnova y Miragon la llevan); reemplazarla por diagram-js son ~28 000 líneas. Los paquetes oficiales del panel de propiedades no publican tipos y arrastran dependencias Camunda. Descarta: fork, KIE bpmn-editor (una sola release, React ≤ 18, semántica jBPM; revisitar en 12 meses), LogicFlow, Camunda Web Modeler (propietario). Consecuencia de diseño: reservar la esquina inferior derecha del canvas.

**ADR-012 — Identidad de elemento y de proceso.**
Elemento = atributo `id` BPMN, NCName, generado con prefijo por tipo y sufijo aleatorio (`Task_7f3k2q1`), nunca regenerado al importar/exportar/renombrar, nuevo al copiar; ids ajenos no-NCName (Bizagi puede emitirlos) se sanitizan con un mapa reversible. Proceso = `bpmn:process@id` como clave lógica (slug ASCII) + `lila:versionTag`; `exporter="Lila Modeler"` y `exporterVersion` en `definitions`. Porqué: es la única clave que comparten todas las herramientas (Signavio `sid-uuid`, bpmn-js `Activity_x`, jBPM `_uuid`) y de la que cuelgan BPSim, qbp, Prosimos y Scylla; usar nombres como clave es la decisión que fuerza reescrituras. Patrón Flowable (definition key + version) / Bonita / Camunda (process id + versionTag).

**ADR-013 — Dónde vive cada dato.**
Diagrama y documentación por elemento **dentro** del `.bpmn` (`bpmn:documentation` estándar + `lila:` en `extensionElements`); parámetros de simulación **fuera**, en `*.scenario.json`; catálogo (roles, sistemas, documentos, riesgos, controles, KPIs) en `catalog.json` con ids estables; resultados en JSON + CSV. Los elementos **referencian** el catálogo (`lila:roleRef`), nunca contienen texto libre: es lo que hacen ADONIS, Signavio (dictionary) y ARIS (definición/ocurrencia), y es la otra decisión que forzaría reescritura si se toma mal. Confirma ADR-001 y ADR-007.

**ADR-014 — Un solo namespace de extensión, definido una sola vez.**
`xmlns:lila="https://lila-modeler.org/schema/bpmn/1"` (el IRI no necesita resolver; debe ser estable y decidirse antes de M4). Descriptor moddle JSON en `packages/engine/src/bpmn/lila.moddle.json`, compartido por editor, CLI y servidor. Elementos (no atributos) para permitir listas. Crece de forma aditiva. bpmn-moddle preserva namespaces desconocidos en round-trip (verificado hoy con archivos BPSim, qbp y Bizagi reales); la preservación por Camunda/Signavio/ADONIS se prueba en M4 y el plan B es `annotations.json` sidecar keyed por id con el mismo descriptor.

**ADR-015 — Formato de escenario v1: JSON propio, separado del .bpmn, keyed por id, vocabulario BPSim 2.0, parámetros nombrados, segundos, `extends`.**
Porqué: cumple los cuatro criterios a la vez (N escenarios por diagrama; diffs de git sin ruido de coordenadas DI; parcheable por agentes como `elements["Task_1"].processingTime.mean = 400`; migra 1:1 a `jsonb`). BPSim está congelado desde 2016 sin tooling open source y, embebido, mezcla layout con parámetros; qbp admite un solo escenario y un recurso por tarea; Prosimos usa parámetros posicionales de scipy y no tiene licencia; Bizagi no exporta parámetros. Descarta: BPSim o qbp como formato canónico. Adaptadores en los bordes cuando aparezca un consumidor: import qbp (~150 líneas, 182 archivos en GitHub, fixtures de Prosimos/Simod), export/import BPSim 2.0 como archivo `.bpsim` cuando haya usuario de Sparx EA, export Prosimos solo para oráculos.

**ADR-016 — Semántica de calendarios (Bizagi no documenta la suya).**
Patrón semanal relativo a `run.start`; sin DST ni festivos en v1 (campos reservados). Una tarea solo arranca dentro del calendario de su recurso y su `processingTime` consume solo tiempo de calendario (se pausa al cerrar el turno y reanuda al abrir). El tiempo cerrado se reporta como `offHoursWait`, separado de `resourceWait`. Utilización = tiempo ocupado / (capacidad × tiempo **disponible** según calendario), única definición que hace comparables niveles 3 y 4. Documentado en `docs/SEMANTICS.md`; ajustable si alguien aporta el comportamiento real de L-Sim/Bizagi.

**ADR-017 — Determinismo.**
Heap ordenado por `(t, seq)` con `seq` monótono; PRNG propio sembrado (mulberry32/xoshiro) con un stream por elemento derivado de `hash(seed, replicación, elementId)`: cinco líneas que dan *common random numbers*, es decir, añadir un cajero no cambia los números de las tareas no tocadas y los what-if se leen limpios. Nunca `Math.random` ni `Date`. Garantía: bytes idénticos dentro de un mismo runtime (test en Node 22 y 24); entre navegadores solo estadísticamente idénticos (`Math.log/exp` pueden diferir en el último bit).

**ADR-018 — Persistencia de la modalidad instalable: archivos del usuario; nada de servidor.**
Un proyecto es una carpeta (`model.bpmn` + `*.scenario.json`). En la app de escritorio: abrir y guardar con los diálogos nativos del sistema (`dialog.showOpenDialog` / `showSaveDialog` y `fs` en el proceso principal de Electron, expuestos al renderer por `preload` + IPC con una API mínima: `openFile`, `saveFile`, `readProject`, `recentFiles`); recientes y estado de ventana en `app.getPath('userData')`. Sin SQLite, sin IndexedDB, sin cuentas, sin servidor. La demo online (GitHub Pages) usa `<input type=file>` y descarga: sirve para probar sin instalar, no es una modalidad. Porqué: un estudiante o analista trabaja con archivos; git da versionado AS-IS/TO-BE y diff gratis para quien lo use; los bytes son los mismos que guardará la modalidad servidor. Revisar: nunca por sí sola; la modalidad servidor (ADR-023) es la respuesta al trabajo compartido, no una evolución de esta.

**ADR-019 — MCP antes que REST; ambos sobre las mismas funciones.**
La API del MVP son las funciones exportadas de `@lila/engine` (`parseBpmn`, `validate`, `resolveScenario`, `simulate`, `compare`) y la CLI. `packages/mcp` (stdio, `@modelcontextprotocol/server` 2.0.0, spec 2026-07-28) llega en M4, justo después de la paridad en CLI y antes de la UI, con 5 tools: cuesta ~100 líneas, no depende de la UI y Brito trabaja con agentes; desde ahí un agente valida, simula, parchea escenarios y compara en su computadora. REST (hono/fastify, una pantalla) llega con el servidor y el repositorio. Ninguna lógica vive en el borde. Cumple ADR-003 (UI y agentes hacen lo mismo) sin construir un servidor que hoy no sirve a nadie.

**ADR-020 — Licencias.**
Núcleo, CLI, MCP y web bajo **Apache-2.0** (decidido por Brito el 2026-09-03: cláusula de patentes explícita y adopción empresarial; compatible con la licencia bpmn.io, MIT de bpmn-moddle y Apache-2.0 de Simod). Prohibido AGPL/LGPL/Camunda License en `packages/*` (pm4py es AGPL-3.0 desde 2.7.12; SpiffWorkflow LGPL; Camunda 8 licencia propia). Prosimos y el jar de QBP jamás entran al repositorio ni a CI pública. La marca de agua de bpmn.io se acepta y se anuncia en el README. Cierra ADR-008: el proyecto se llama Lila Modeler.

**ADR-021 — Alcance BPMN y política de "no soportado".**
Soportado en v1: la lista de la sección 3. Todo lo demás produce **error de validación explícito** con el mismo texto que Bizagi ("no soportado por el simulador"), nunca un fallo silencioso. Cada elemento extra se añade cuando lo pida un usuario real.

**ADR-022 — Estructura del repositorio: un paquete que se publica, una app, y nada especulativo.**
`packages/engine` (con `core/` puro como subcarpeta), `apps/web`, `packages/mcp` en M4. npm workspaces (viene con Node; sin pnpm/turbo/nx). Sin paquetes `shared`, `types` ni `utils`. Porqué: un paquete por cosa que se publica; el aislamiento de `core/` se garantiza con un test que comprueba que el bundle del Worker no incluye `bpmn-moddle`, React ni `node:*`, no con un paquete aparte. Se divide en más paquetes cuando publicar por separado importe.

**ADR-023 — Dos modalidades de despliegue, una sola SPA, un solo motor.**
(1) **App de escritorio**: la SPA de `apps/web` empaquetada con **Electron** en `apps/desktop` (proceso principal + `preload`), construida con electron-builder para macOS (dmg), Windows (nsis) y Linux (AppImage y deb) desde una matriz de CI; `fileAssociations` para abrir `.bpmn` con doble clic; auto-update opcional cuando haya releases frecuentes. El motor corre en el Web Worker del renderer; la persistencia es ADR-018. Precedente directo: Camunda Desktop Modeler (MIT) es Electron + bpmn-js + electron-builder con asociación de `.bpmn`; su `electron-builder.json` es la plantilla. (2) **Servidor self-hosted**: `packages/server` (M6) en Node sirve **la misma SPA compilada**, expone REST y MCP por HTTP sobre las funciones de `@lila/engine`, autentica usuarios, guarda procesos/versiones/escenarios/runs en SQLite o PostgreSQL, y se distribuye como imagen Docker con `docker-compose.yml`. La simulación interactiva sigue corriendo en el Worker del navegador de cada usuario; el servidor solo simula cuando lo piden agentes, la CLI remota o corridas programadas. **La costura entre ambas** es una interfaz `ProjectStore` en la SPA (listar/leer/escribir procesos, escenarios y runs) con implementaciones `DesktopStore` (IPC → `fs`), `RemoteStore` (REST, M6) y un `BrowserStore` mínimo (input/descarga) para la demo online. Se define en M5; la remota llega en M6 sin tocar vistas ni motor. **Porqué Electron y no Tauri**: Tauri 2 produce instaladores de ~10 MB frente a ~150 MB y usa menos memoria, pero depende del webview del sistema, y en Linux (WebKitGTK) hay problemas de rendimiento y estabilidad documentados (reportes de 40 fps frente a 240 fps en Chromium para la misma app; hilo "WebKit is totally unstable" en las discusiones de Tauri); bpmn-js es un canvas SVG intensivo donde la consistencia de Chromium en los tres sistemas vale más que el tamaño; y Tauri exige toolchain Rust. Electron 43, electron-builder 26 y electron-forge (ESM, Node ≥ 22.12) están activos en 2026. Descarta: PWA como modalidad principal (sin diálogos nativos en Safari/Firefox, sin asociación de archivos). Reversible: si el tamaño del instalador se vuelve problema real, Tauri envuelve la misma SPA y solo cambia `DesktopStore`. **Porqué TypeScript sale reforzado**: el mismo bundle corre en el Worker de la app de escritorio y en el Node del servidor; un motor Python habría exigido empaquetar un runtime Python dentro del instalador o cargar Pyodide (~12 MB).

**ADR-006 reinterpretado.** "Own the abstraction layer" no significa una interfaz `SimulationScheduler` con adaptadores a SimPy/Rust (abstracción especulativa que ningún proposal defendió): significa poseer los **tres contratos JSON** (IR, escenario, resultado + event log) y la firma `simulate()`. Es lo que permite reemplazar el kernel sin tocar CLI, UI ni MCP.

---

## 5. Estructura del repositorio

```
lila-modeler/
├── package.json                  # npm workspaces; scripts: test, build, lint
├── tsconfig.base.json            # strict, ESM, target ES2022
├── LICENSE                       # Apache-2.0 (ADR-020)
├── README.md                     # qué es; "pruébalo en el navegador"; npx lila run …; aviso marca de agua bpmn.io
├── .github/workflows/ci.yml      # npm test + build en Node 22 y 24; deploy de apps/web a GitHub Pages
├── docs/
│   ├── SEMANTICS.md              # perfil BPMN soportado y semántica exacta: XOR/OR/AND, joins, calendarios, costos, parada, warmup
│   ├── SCENARIO_FORMAT.md        # JSON Schema generado + tabla campo ↔ BPSim 2.0 ↔ qbp ↔ Bizagi
│   ├── RESULTS_FORMAT.md         # definición de cada métrica y columnas del event log
│   ├── BPMN_EXTENSION.md         # namespace lila:, descriptor moddle, política de ids y de versión
│   ├── BIZAGI_PARITY.md          # la tabla de la sección 3 con estado
│   └── DECISIONS.md              # ADR-001…022
├── examples/
│   ├── pedido/                   # benchmark: start, 4–5 tareas, XOR, AND, timer, 2 recursos
│   │   ├── model.bpmn
│   │   ├── as-is.scenario.json
│   │   └── to-be-3-cajeros.scenario.json      # extends: as-is
│   ├── bizagi-levels/            # réplicas de los ejemplos oficiales de help.bizagi.com (niveles 1–4)
│   ├── bizagi-exports/           # .bpmn reales exportados por Bizagi (xmlns:bizagi anidado, ids raros)
│   └── mm1/                      # M/M/1 y M/M/c con solución analítica (oráculo)
├── packages/
│   ├── engine/                   # @lila/engine — el producto. Todo lo que no es UI vive aquí
│   │   ├── package.json          # exports: ".", "./bpmn", "./schema"; bin: { lila: "dist/cli.js" }
│   │   ├── src/
│   │   │   ├── core/             # CERO dependencias: es lo que corre en el Worker
│   │   │   │   ├── ir.ts         # ProcessIR: nodes (start|end|terminate|task|xor|or|and|timer), flows, lanes
│   │   │   │   ├── heap.ts       # cola de prioridad (t, seq)
│   │   │   │   ├── rng.ts        # PRNG sembrado + streams por elemento
│   │   │   │   ├── distributions.ts  # 13 de BPSim + constante + empírica, parámetros nombrados
│   │   │   │   ├── calendar.ts   # intervalos semanales: isOpen, nextOpen, addWorkingTime
│   │   │   │   ├── sim.ts        # bucle DES: llegadas, tokens, gateways/joins, recursos AND/OR, colas
│   │   │   │   ├── metrics.ts    # agregados por elemento/recurso/proceso/flujo, percentiles, replicaciones, IC
│   │   │   │   ├── compare.ts    # what-if lado a lado con deltas y significancia
│   │   │   │   └── run.ts        # simulate(ir, scenario, opts) → RunResult   ← API pública, pura
│   │   │   ├── scenario.ts       # esquema zod + JSON Schema + resolveExtends + defaults degradantes
│   │   │   ├── bpmn/
│   │   │   │   ├── parse.ts      # bpmn-moddle → IR; aplana subprocesos; sanitiza ids; lee/escribe lila:
│   │   │   │   ├── validate.ts   # NCName, flujos colgantes, no soportados (lista Bizagi), refs de escenario
│   │   │   │   └── lila.moddle.json  # ÚNICA definición del namespace lila:
│   │   │   ├── csv.ts            # tablas y event log → CSV (sin librería)
│   │   │   ├── format.ts         # segundos → baseTimeUnit legible
│   │   │   └── cli.ts            # lila validate | run | compare | import-qbp   (node:util.parseArgs)
│   │   └── test/
│   │       ├── golden/           # snapshots JSON deterministas (seed 42)
│   │       ├── hand.test.ts      # duraciones constantes calculables a mano
│   │       ├── theory.test.ts    # M/M/1, M/M/c vs Erlang-C (tolerancia 3 %)
│   │       ├── semantics.test.ts # joins, OR, calendarios, warmup, parada, costos, degradación
│   │       ├── bpmn.test.ts      # round-trip bizagi:/bpsim:/qbp:, ids, lila:
│   │       └── worker-bundle.test.ts  # core/ no importa bpmn-moddle, React ni node:*
│   └── mcp/                      # M4 — @lila/mcp: 5 tools sobre @lila/engine, transporte stdio
├── apps/
│   ├── web/                      # Vite + React + bpmn-js; la SPA: corre en Electron, en el servidor (M6) y como demo online
│   │   └── src/
│           ├── Modeler.tsx       # monta BpmnModeler({ moddleExtensions: { lila } }); único punto de contacto con bpmn-js
│           ├── PropertiesPanel.tsx  # nombre, bpmn:documentation, lila:*Ref (lectura/escritura)
│           ├── ScenarioPanel.tsx # elements[id], resources, calendars, run → escenario JSON (no al XML)
│           ├── ResultsView.tsx   # tres tablas Bizagi-like + extras + botones CSV
│           ├── CompareView.tsx   # escenarios lado a lado, diferencias resaltadas
│           ├── BottleneckOverlay.ts  # BaseRenderer prioridad 1500: colorea por resourceWait
│           ├── worker.ts         # import { simulate } from '@lila/engine'; onmessage → postMessage
│           ├── store/ProjectStore.ts  # interfaz: listProcesses, getProcess, putProcess, listScenarios, putScenario, putRun  ← costura entre modalidades (ADR-023)
│           ├── store/DesktopStore.ts  # modalidad escritorio: window.lila.openFile/saveFile/… (IPC de Electron)
│           ├── store/BrowserStore.ts  # demo online: <input type=file> + descarga; sin persistencia
│           └── strings.es.ts     # UI en español; sin librería i18n hasta que haga falta
│   └── desktop/                  # Electron: empaqueta apps/web como app de escritorio
│       ├── main.ts               # ventana, menú, dialog + fs, recientes, apertura de .bpmn por doble clic
│       ├── preload.ts            # expone window.lila.{openFile,saveFile,readProject,recentFiles} vía contextBridge
│       └── electron-builder.json # appId, fileAssociations .bpmn, targets dmg | nsis | AppImage+deb
└── tools/oracles/                # scripts dev (NO dependencias): des_simpy.py, run_scylla.sh, run_prosimos.sh
```

Módulos futuros (no crear carpetas hoy): `packages/server` (M6, modalidad servidor: hono + REST + auth + `Storage` sqlite|postgres, sirve la misma SPA, imagen Docker) y su `store/RemoteStore.ts` en la SPA; `packages/catalog` (RACI = consulta sobre IR + catalog.json); `packages/interview`; `mining/` (proceso Python separado, AGPL aislado).

---

## 6. Diseño del motor

**Pipeline** (idéntico en CLI, Worker y MCP):
`.bpmn` → `parseBpmn(xml)` (bpmn-moddle 10.2.0, MIT) → `ProcessIR` → `validate(ir)` → `resolveScenario(json)` (aplica `extends`, defaults, zod) → `simulate(ir, scenario, opts)` → `RunResult` + event log → `toCsv()` / `compare()`. Nada de `core/` toca XML, DOM, disco ni red.

**IR**: `{ id, name, nodes: Record<id, {type, name, lane?, subprocessId?, incoming[], outgoing[]}>, flows: Record<id, {from, to, name, isDefault}>, source: {exporter, exporterVersion, originalIds} }`. Toda variante de tarea se aplana a `task`; los subprocesos embebidos se aplanan conservando `subprocessId` para agregar métricas; call activity = `task` con tiempo global (regla Bizagi). Ids se conservan; nunca se usa el nombre como clave.

**Scheduler**: heap binario `(t, seq)`; reloj virtual en segundos desde `run.start` (float64). Eventos: `arrive`, `taskStart`, `taskEnd`, `timerEnd`, `stop`. Sin eventos de calendario: la disponibilidad se resuelve al planificar (`nextOpen`, `addWorkingTime`). Complejidad O(E log E); 2–4 M eventos/s medidos.

**Llegadas**: por cada start con `interTriggerTimer` se generan casos hasta `triggerCount` o `run.duration`, lo primero; con `calendar`, la llegada se desplaza al siguiente instante abierto.

**Tokens y gateways**: un caso = conjunto de tokens. XOR: flujo por probabilidad acumulada (equitativo si faltan; se normaliza con warning si no suman 1; el `isDefault` recibe el residuo). AND fork: un token por salida; AND join: contador por `(caso, join)`, dispara al completar las entradas y se reinicia (soporta loops). OR fork: cada salida con probabilidad independiente, al menos una; OR join: espera tantos tokens como activó el fork emparejado (semántica práctica de Bizagi/Prosimos, documentada como simplificación). Timer: retardo sin recurso. End: consume el token; caso termina con cero tokens; `terminate` mata todos. Casos en vuelo al parar cuentan como `started`, no `completed` (como Bizagi).

**Recursos**: `resources[pool] = { name, type: role|equipment, capacity, costPerHour, fixedCost, calendar }`; `capacity` es obligatorio, entero y `≥ 1`. Tarea: `resources: [{ref, quantity}]` y `selection: and|or`. AND: arranca cuando **todos** los pools tienen capacidad simultáneamente (se comprueba en cada liberación; no se retienen recursos parciales ⇒ sin deadlock). OR: se encola en todos, arranca con el primero disponible, se retira de los demás. FIFO global ordenado por `(enabledAt, seq)`; con un solo pool es FIFO estricto y con varios se elige el primer candidato satisfacible según las reglas de AND/OR. `resourceWait = started − enabled`. Sin recursos ⇒ capacidad infinita. Reservados y rechazados con error claro hasta implementarse: `priority`, `preempt`, `batch`, `conditions`.

**Calendarios**: ADR-016.

**Distribuciones** (parámetros nombrados, segundos): `constant{value}`, `uniform{min,max}`, `triangular{min,mode,max}`, `exponential{mean}`, `normal{mean,sd}` (truncada a ≥ 0; lint avisa si P(x<0) > 1 %), `truncatedNormal{mean,sd,min,max}`, `lognormal{mean,sd}` (de la variable, no de su log), `gamma{shape,scale}`, `erlang{k,mean}`, `weibull{shape,scale}`, `beta{alpha,beta,min,max}`, `poisson{mean}`, `binomial{n,p}`, `user{points:[{value,probability}]}`. ~120–150 líneas, sin dependencias.

**Costos**: por elemento `fixedCost × completados`; por recurso `fixedCost × atendidos + costPerHour × horas ocupadas`; costo por caso desde el log; total del escenario.

**Event log**: filas planas por asignación de pool, agrupadas por `activityInstanceId`. Una actividad sin recurso o todavía en cola emite una fila sentinel con `resourceId`, `resourceQuantity` y `allocationIndex` en `null`; una actividad AND ya iniciada con dos pools emite dos filas con el mismo id de instancia. El lifecycle parcial conserva `status`, `startedAt`/`endedAt` anulables y `observedUntil`. `elementCost` se carga una sola vez por instancia, `resourceCost` pertenece a cada asignación y `cost = elementCost + resourceCost`, de modo que costos y ocupación se reconstruyen desde el log sin duplicar el fijo del elemento. Se emite por callback `opts.onEvent` para que la web agregue o muestree (30 replicaciones × 10k casos × 20 actividades = 6 M filas no caben cómodamente en memoria de navegador) y la CLI escriba en streaming. Timestamps ISO derivados de `run.start` al exportar. Es el formato plano que XES (IEEE 1849) y OCEL 2.0 / pm4py consumen tras un mapeo trivial. *(decisión: ADR-025; prueba: LILA-033, LILA-037)*

**Métricas (`RunResult`)**: por elemento `started, completed, processing{min,max,mean,total}, resourceWait{min,max,mean,sd,total}, offHoursWait{…}, queueLength{mean,max}, fixedCostTotal`; por flujo `count` (el "nivel 1" de Bizagi); por recurso `utilization, busyTime, fixedCost, unitCost, totalCost`; por proceso `started, completed, inFlight, cycleTime{min,max,mean,sd,p50,p90,p95}, waitTime{…}, throughputPerHour, costPerCase, totalCost`; `bottlenecks` (ranking por `resourceWait.total`, desempate por utilización); con `replications > 1`, `mean, sd, ci95` por KPI; `warnings[]`. `warmup` excluye de estadísticas los casos iniciados antes. La CLI imprime las columnas con los **nombres de Bizagi** para que un usuario académico migre comparando números.

**Validación numérica** (bus factor 1 ⇒ el motor puede dar números plausibles y falsos): (1) casos a mano con duraciones constantes (resultado exacto); (2) M/M/1 y M/M/c contra Erlang-C, tolerancia 3 %, en CI; (3) el script SimPy del benchmark de hoy (`tools/oracles/des_simpy.py`) como oráculo cruzado; (4) Scylla headless y Prosimos corridos una vez en desarrollo y sus salidas congeladas como fixtures con tolerancia estadística (ni una línea de su código entra al repo); (5) los ejemplos publicados en la ayuda de Bizagi (niveles 1–4) reproducidos como escenarios, ±5 %; (6) golden snapshots por semilla.

**Formato de escenario v1** (`examples/pedido/as-is.scenario.json`):

```json
{
  "$schema": "https://lila-modeler.org/schema/scenario/1.json",
  "version": 1,
  "name": "AS-IS",
  "description": "Operación actual, 2 cajeros y 3 cocineros",
  "model": "model.bpmn",
  "run": {
    "start": "2026-09-07T08:00:00-06:00",
    "duration": 2592000,
    "warmup": 3600,
    "replications": 30,
    "seed": 42,
    "baseTimeUnit": "min",
    "currency": "MXN"
  },
  "calendars": {
    "oficina": { "intervals": [ { "days": ["MON","TUE","WED","THU","FRI"], "from": "09:00", "to": "18:00" } ] }
  },
  "resources": {
    "cajero":   { "name": "Cajero",   "type": "role",      "capacity": 2, "costPerHour": 220, "fixedCost": 0, "calendar": "oficina" },
    "cocinero": { "name": "Cocinero", "type": "role",      "capacity": 3, "costPerHour": 180, "calendar": "oficina" },
    "horno":    { "name": "Horno",    "type": "equipment", "capacity": 1 }
  },
  "elements": {
    "StartEvent_Pedido": { "interTriggerTimer": { "type": "exponential", "mean": 240 }, "triggerCount": 10000, "calendar": "oficina" },
    "Task_TomarPedido":  { "processingTime": { "type": "triangular", "min": 60, "mode": 120, "max": 300 },
                           "resources": [ { "ref": "cajero", "quantity": 1 } ], "fixedCost": 2.5 },
    "Task_Preparar":     { "processingTime": { "type": "normal", "mean": 480, "sd": 90 },
                           "resources": [ { "ref": "cocinero" }, { "ref": "horno" } ], "selection": "and" },
    "Task_Revisar":      { "processingTime": { "type": "constant", "value": 90 },
                           "resources": [ { "ref": "cajero" }, { "ref": "cocinero" } ], "selection": "or" },
    "Timer_Reposo":      { "processingTime": { "type": "constant", "value": 600 } },
    "Flow_Aprobado":     { "probability": 0.78 },
    "Flow_Rechazado":    { "probability": 0.22 }
  }
}
```

TO-BE como delta: `{ "version": 1, "name": "TO-BE 3 cajeros", "extends": "as-is.scenario.json", "resources": { "cajero": { "capacity": 3 } } }` (merge profundo; `null` borra; cadenas permitidas; ciclos rechazados).

Reglas: todos los tiempos en segundos salvo `run.start`; `baseTimeUnit` solo afecta a la presentación; las claves de `elements` deben existir en el IR (error si falta, warning si sobra); `probability` solo en sequence flows; `interTriggerTimer`/`triggerCount` solo en starts y timers generadores; al menos uno de `run.duration` o `triggerCount`. Mapeo documentado: `elements[id].processingTime` ↔ `bpsim:ProcessingTime` ↔ `qbp:durationDistribution`; `elements[flow].probability` ↔ `bpsim:Probability` ↔ `qbp:sequenceFlow/@executionProbability`; `resources[id].capacity` ↔ `bpsim:Quantity` ↔ `qbp:resource/@totalAmount`; `triggerCount` ↔ `bpsim:TriggerCount` ↔ Bizagi "Max arrival count".

---

## 7. Hitos con prueba de aceptación

Tiempos estimados para una persona con agentes. Regla del corpus vigente: **nada de repositorio, RACI con UI ni servidor antes de M3**. Orden: M0 contratos → M1–M3 motor y CLI con paridad Bizagi → M4 MCP local (agentes) → M5 app web y de escritorio → M6 servidor. El desglose en épicas y tickets, con dependencias, está en `BACKLOG.md`.

**M0 — Esqueleto, contratos y fixtures (días 1–2).** Monorepo npm workspaces; `packages/engine` con `core/ir.ts`, `heap.ts`, `rng.ts` (portados del `des.js` del benchmark de hoy), `scenario.ts` con zod y JSON Schema, `bpmn/parse.ts` sobre bpmn-moddle, `lila.moddle.json`, `cli.ts` con `lila validate`. `examples/pedido/model.bpmn` dibujado en bpmn-js o Camunda Desktop Modeler; `as-is.scenario.json`; .bpmn reales de Bizagi en `examples/bizagi-exports/`. `docs/SEMANTICS.md`, `SCENARIO_FORMAT.md` y `RESULTS_FORMAT.md` escritos **antes** del motor. CI con vitest.
*Aceptación*: `npx lila validate examples/pedido/model.bpmn` imprime nodos/flujos del IR y 0 errores; el mismo comando sobre un .bpmn de Bizagi parsea sin excepción, conserva `bizagi:BizagiExtensions` en round-trip `saveXML`, sanitiza ids no-NCName con mapa reversible y reporta como no soportados los elementos que Bizagi tampoco simula; `Scenario.parse(to-be)` resuelve `extends` a un objeto igual al AS-IS salvo `capacity = 3`; una clave inexistente en `elements` produce error citando el id; dos llamadas al RNG con seed 42 producen la misma secuencia.

**M1 — Niveles 1 y 2 de Bizagi (semana 1).** `sim.ts` con llegadas, XOR/OR/AND fork-join, subproceso embebido aplanado, timer, 14 distribuciones, capacidad infinita, warmup, replicaciones, parada por duración o `triggerCount`, `metrics.ts` con tablas de elementos, flujos y proceso, `lila run` con tabla en consola (columnas Bizagi + percentiles) y `--json`.
*Aceptación*: (a) Start→A(60 s)→XOR 50/50→B(120 s)|C(30 s)→End con llegadas constantes cada 10 s y 1000 casos ⇒ ciclo medio exactamente 60 + 0,5·120 + 0,5·30 ± 1 s y tokens por flujo 500 ± 40; (b) `lila run --json` dos veces con seed 42 ⇒ bytes idénticos, y el mismo resultado en Node 22 y 24; (c) AND con dos ramas constantes (300 y 500 s) ⇒ la sección dura 500 s exacto; (d) parada: duración 1 h, `triggerCount` 10000, llegadas cada 10 s ⇒ `started = 360`; (e) cada distribución: media y sd de 100 000 muestras dentro del 2 % de la teórica; (f) ejemplo oficial de nivel 2 de Bizagi reproducido: started/completed iguales, min/max/avg ± 5 %; (g) 100 000 casos del benchmark en < 1 s.

**M2 — Nivel 3: recursos, colas, costos, log (semana 2).** Pools, AND/OR, FIFO determinista, esperas min/max/avg/std/total, utilización, costos por elemento/recurso/caso, longitud de cola, throughput, cuellos de botella, event log por callback + `--csv`, IC 95 % con replicaciones, `lila compare` con deltas y significancia.
*Aceptación*: (a) M/M/1 ρ = 0,8, 30 replicaciones ⇒ espera media dentro del 3 % de la fórmula y utilización 0,80 ± 0,02; M/M/3 dentro del 3 % de Erlang-C; (b) benchmark de 5 tareas ⇒ ciclo medio, p95 y utilizaciones dentro del IC 95 de `des_simpy.py`; (c) selección AND de dos pools nunca produce deadlock en 100 000 casos con orden adverso de ids; (d) `total_cost = Σ fijo × usos + Σ hora × horas ocupadas` verificado desde el log; (e) `lila run --csv out/` produce `elements.csv`, `flows.csv`, `resources.csv`, `process.csv`, `log.csv` con los encabezados de `BIZAGI_PARITY.md`; (f) sin recursos en el escenario ⇒ resultado idéntico al de M1 (degradación); (g) `lila compare as-is to-be-3-cajeros` marca como significativa la reducción de espera en `Task_TomarPedido`; (h) ejemplo oficial de nivel 3 ± 5 %.

**M3 — Nivel 4: calendarios y what-if = paridad Bizagi en CLI (semana 3).** `calendar.ts`, calendario por recurso y de llegadas, matriz con calendario por defecto, `offHoursWait`, utilización sobre horas disponibles, lint de escenario (probabilidades que no suman 1, normal con masa negativa, calendario vacío), `docs/BIZAGI_PARITY.md` marcado.
*Aceptación*: (a) tarea de 2 h que arranca 17:30 con calendario 9–18 ⇒ termina 10:30 del siguiente día hábil, `offHoursWait = 15 h`, `resourceWait = 0`; (b) llegadas 24×7 con recursos L–V 9–18 ⇒ utilización sobre horas abiertas y cola máxima el lunes 09:00; (c) sin calendarios ⇒ resultado bit a bit igual al de M2; (d) ejemplo oficial de nivel 4 ± 5 %; (e) JSON Schema valida todos los escenarios de `examples/` y rechaza `probability: 1.5`; (f) 30 × 10 000 casos con calendarios < 10 s en Node.

**M4 — MCP local para agentes (≤ 2 días).** `packages/mcp` con `@modelcontextprotocol/server` 2.0.0, stdio, tools `validate_bpmn`, `run_simulation`, `compare_scenarios`, `patch_scenario` (JSON Patch sobre el escenario) y `describe_process` (IR + resumen legible), servido por `lila mcp`. Va antes de la UI porque no depende de ella: desde aquí un agente en la computadora de Brito valida, simula, parchea escenarios y compara.
*Aceptación*: desde Claude Code con el servidor configurado, "simula examples/pedido con as-is y dime el cuello de botella" devuelve el mismo `bottlenecks[0]` que `lila run`; "qué pasa si agrego un cajero" produce un escenario con `extends` y una comparación coherente, sin ningún cambio en `@lila/engine`.

**M5 — App web y de escritorio (Electron): editar, simular, comparar (semanas 4–6).** `apps/web` con bpmn-js 18.x + `moddleExtensions: { lila }`, panel de propiedades propio, panel de escenario (formularios desde el JSON Schema), Worker con progreso y cancelación, tablas, overlay de cuellos de botella, comparación, exportación CSV/.bpmn/.scenario.json, token-simulation como pestaña "validar rutas", marca de agua visible en su esquina. Modalidad escritorio: `apps/desktop` con Electron (main + preload + IPC mínimo), `ProjectStore` con `DesktopStore` (diálogos nativos, `fs`, recientes) y `BrowserStore` (input/descarga) para la demo; `electron-builder` con `fileAssociations` para `.bpmn`; CI en matriz macOS/Windows/Linux que publica dmg, nsis y AppImage/deb como artefactos de release. Demo online en GitHub Pages; README con "descárgalo / pruébalo en el navegador".
*Aceptación*: flujo de estudiante sin instalar nada: abre la URL, carga un .bpmn exportado por Bizagi, crea una tarea y escribe su nombre de inmediato (sin `Task 1`), asigna distribución y recurso, corre 10 000 × 30 en < 15 s sin congelar la UI, la tabla coincide byte a byte con `lila run --json` (misma semilla), duplica el escenario, cambia una capacidad, compara, descarga `log.csv` y los `.scenario.json`, recarga y recupera el trabajo. Añadir `lila:responsibility` desde el panel ⇒ aparece en el XML y sobrevive a abrir/guardar en Camunda Desktop Modeler (si no: activar plan B `annotations.json`). El bundle del Worker no incluye bpmn-js ni React (< 100 KB). El BPMN más grande que tenga Brito importa y se mueve sin bloqueos > 1 s. Probado en Chrome y Safari (macOS) y Firefox (Linux). Escritorio: los instaladores de macOS, Windows y Linux salen de CI desde el mismo commit; instalada, la app abre en < 2 s; doble clic sobre un `.bpmn` la abre con ese archivo; abrir y guardar usan los diálogos nativos del sistema; funciona sin red; la lista de recientes sobrevive al reinicio; la tabla de resultados coincide byte a byte con `lila run --json`. La demo online completa el mismo flujo con input/descarga.

**M6 — Servidor self-hosted para intranet (después de M5; ~2 semanas).** `packages/server`: hono (o fastify) en Node que sirve la misma SPA compilada; REST `/api/v1` (procesos, versiones, escenarios, runs, simulate) sobre las funciones de `@lila/engine`; `RemoteStore` en la SPA contra ese REST; usuarios locales con sesión (OIDC/LDAP cuando lo pida la primera empresa); interfaz `Storage` con SQLite para equipos pequeños y PostgreSQL detrás de la misma interfaz; MCP por HTTP con la misma autenticación; `Dockerfile` + `docker-compose.yml` (server + postgres). La simulación interactiva sigue en el Worker del navegador de cada usuario.
*Aceptación*: `docker compose up` en una máquina Linux limpia; dos usuarios en la misma red entran por la URL de la intranet, ven la misma lista de procesos, uno guarda una versión nueva y el otro la ve al recargar; cada uno simula en su navegador y el `RunResult` queda guardado en el servidor; `lila run` contra el REST devuelve bytes idénticos a la corrida local con la misma semilla; el bundle de la SPA es el mismo artefacto que el de M4 (un solo build, dos `ProjectStore`); un usuario sin sesión no ve nada.

---

## 8. Cómo crece a plataforma

Regla de enganche única: cada módulo nuevo consume los contratos de `@lila/engine` (IR, escenario, resultado, event log, descriptor `lila`) y sus funciones puras; ninguno modifica el motor ni introduce un segundo modelo canónico.

- **Repositorio y versiones** (= modalidad servidor, M6): hoy `processes/<clave>/` + git; en M6 `packages/server` con interfaz `Storage` de tres operaciones (`getVersion(key, tag)`, `putVersion`, `list`) y dos implementaciones: filesystem (la del MVP) y SQL (SQLite para un equipo self-host, PostgreSQL con concurrencia real). Esquema: `process_versions(key, version_tag, bpmn_xml, created_at, author, status)`, `scenarios(process_key, name, json jsonb)`, `runs(scenario_ref, result jsonb, log_uri)`, `catalog_items(id, type, doc jsonb)`; las tablas por elemento son un **índice derivado** al guardar, vía `parseBpmn`. AS-IS/TO-BE = dos versiones (`lila:versionTag`) o dos escenarios con `extends`; comparar = diff XML + `compare()`. Flujo de liberación tipo ADONIS (Draft → Released → Valid until) = una columna de estado y dos fechas.
- **Catálogo, RACI, sistemas, documentos, riesgos, controles, KPIs**: `catalog.json` (luego tabla) con ids estables; los elementos apuntan con `lila:responsibility type="R|A|C|I" roleRef`, `lila:systemRef`, `lila:documentRef`, `lila:riskRef`, `lila:controlRef`, `lila:kpiRef`, `lila:input`/`lila:output`; la matriz RACI es una consulta sobre `nodes × responsibilities`; "actividad sin responsable" es una regla de lint. Los pools de recursos del escenario pueden referenciar `roleRef` para que RACI y simulación compartan roles. Opcional: escribir la "R" también como `bpmn:performer/resourceRef` estándar para interoperar con motores.
- **REST y MCP completo**: `packages/api` (hono o fastify) expone las mismas funciones (`POST /processes/:key/versions/:tag/simulate`…); el MCP crece por tools (`create_activity`, `connect_elements`, `assign_responsible`, `get_raci_matrix`, `create_process_draft` con `bpmn-auto-layout` 1.3.0 MIT para diagramas creados por agentes sin coordenadas). Permisos (`process:read`, `simulation:run`…) = middleware sobre esa misma lista cuando haya usuarios; auditoría con el servidor.
- **Agentes de entrevista y asistencia**: clientes MCP/REST. Producen IR, parches de escenario o `lila:*` a través de las tools; `bpmnlint` + reglas `lila` devuelven hallazgos como datos. `Finding`/`Interview` son JSON en `processes/<clave>/findings/`, luego filas. No tocan el motor.
- **Process mining**: proceso Python **separado** (`mining/`, AGPL-3.0 aislado por pm4py) acoplado solo por archivos: consume el event log CSV/XES del motor o logs reales, produce un `observado.scenario.json` (tasa de llegadas, empíricas por actividad, probabilidades de gateway; es lo que Bizagi 4.0 hace con su process mining) y un `RunResult` compatible con métricas reales para "documentado vs observado" con el mismo `compare()`. Puente opcional a Simod (Apache-2.0; exige Java 1.8 y Python < 3.12: su propio entorno) por el adaptador Prosimos→lila. OCEL 2.0 cuando haya objetos además de casos. Aquí se activan los campos reservados `conditions`, `priority`, `batch`.
- **Rendimiento futuro**: `core/` se reimplementa en Rust→WASM detrás de la misma `simulate()` si un día hace falta. Hoy no.
- **Escritorio**: ya es la modalidad 1 (Electron, M5). Auto-update con electron-builder cuando haya releases frecuentes; firma y notarización cuando haya usuarios empresariales; la marca de agua de bpmn.io sigue visible dentro.

Lo que **no cambia nunca**: el `id` BPMN como clave, el namespace `lila` (solo crece), la forma de `Scenario` v1 (los reservados se activan, no se renombran), la firma `simulate()`, las columnas del event log. Lo que puede cambiar libremente: framework web, base de datos, transporte MCP, editor (si KIE madura, se reescribe la UI, no el dominio).

---

## 9. Riesgos y preguntas abiertas para Brito

**Decisiones que solo tú puedes tomar**

1. ~~Licencia del núcleo~~ **Decidida: Apache-2.0** (2026-09-03). Falta solo el archivo `LICENSE` y la cabecera en `package.json` al crear el repo.
2. ~~¿"Sin servidor" es requisito duro?~~ **Aclarado (2026-09-03)**: dos modalidades, app de escritorio multiplataforma (Electron) y servidor self-hosted en intranet (ADR-023). Refuerza TypeScript: el mismo bundle corre en el Worker de la app de escritorio y en el Node del servidor; un motor Python habría exigido empaquetar un runtime Python en el instalador o cargar Pyodide.
3. **IRI del namespace y dominio**: `https://lila-modeler.org/...` está escrito sin verificar disponibilidad de marca ni dominio. El IRI no necesita resolver, pero cambiarlo después de M4 duele. Decidirlo (y comprobar colisiones del nombre "Lila") antes de M4.
4. **¿API Python importable para académicos?** Descartada en el MVP. Si la piden, la respuesta lazy es un cliente fino sobre CLI/REST (subprocess + JSON), no bindings.
5. **Marca de agua bpmn.io**: aceptada permanentemente. No hay vía comercial documentada para retirarla; usuarios reportan que ventas de Camunda no la conoce. Si no la aceptas, el único camino es escribir un editor (~28k líneas) o apostar por KIE en 12 meses.
6. **Selección OR de recursos y disciplina de cola**: Bizagi no documenta su política. Elegimos "primer pool disponible, FIFO por habilitación". Si tienes acceso a una máquina Windows con Bizagi, dos capturas de sus ejemplos oficiales valen más que cualquier suposición.
7. **Autenticación en la modalidad servidor**: usuarios locales con sesión en M6 (mínimo) o integrar desde el inicio con el directorio de la empresa (Active Directory/LDAP, OIDC). Lo lazy: local primero, OIDC cuando lo pida la primera empresa. Depende de qué empresas tengas en mente.
8. ~~¿Tauri además de la PWA?~~ **Decidido: Electron** (ADR-023, 2026-09-03). Firma de código: Brito ya tiene cuenta Apple Developer y certificado; **se deja para después** (épica E19 del backlog). Mientras tanto los instaladores salen sin firmar (macOS: clic derecho → Abrir; Windows: aviso de SmartScreen) y el README lo explica. Tauri queda como alternativa reversible si los ~150 MB del instalador se vuelven problema real.

**Riesgos técnicos y su mitigación**

- Semántica de calendarios y OR-join elegida sin poder contrastarla con Bizagi ⇒ números distintos en nivel 4. Mitigación: `SEMANTICS.md` explícito, oráculos analíticos, réplicas de los ejemplos publicados ± 5 %.
- Round-trip de `lila:` por Camunda Desktop Modeler / Signavio / ADONIS no verificado (bpmn-js tuvo el bug #1310 en el pasado). Mitigación: prueba en M4; plan B `annotations.json`.
- Importación de .bpmn de Bizagi: ids no-NCName, `xmlns:bizagi` declarado dentro de cada `extensionElements` (rompió bpmn-js; corregido en bpmn-moddle), pérdida segura de sus extended attributes. Mitigación: fixtures reales desde M0.
- Motor propio con bus factor 1 ⇒ números plausibles pero falsos. Mitigación: sección 6, validación numérica en CI desde M2.
- Memoria en navegador con 6 M filas de log. Mitigación: log por callback; la web agrega o guarda solo la primera replicación; CSV completo solo desde CLI.
- Versiones recientes sin verificar en combinación: TypeScript 7.0.2 (`latest` hoy), vitest 5, zod 4 `toJSONSchema`, `@modelcontextprotocol/server` 2.0.0 (julio 2026). Mitigación: pinar TS 5.9.x si hay fricción; escribir el JSON Schema a mano si zod molesta (es pequeño); SDK MCP 1.x sigue soportado ≥ 6 meses.
- Prosimos sin licencia y jar de QBP propietario: solo scripts locales de oráculo, nunca en CI pública ni redistribuidos. Un issue pidiendo LICENSE a los autores (U. Tartu) cuesta cero.
- Deriva de alcance hacia la plataforma. Mitigación: la regla de NEXT_STEPS sigue vigente y ahora tiene hitos con pruebas.

**Sobre el cumplimiento de tus principios**: BPMN estándar primero ✓; no reinventar (bpmn-js, bpmn-moddle, bpmnlint, auto-layout, token-simulation reutilizados; el motor no porque no hay nada reutilizable) ✓; evaluar antes de forkear ✓ (hecho, resultado: nada que forkear); API-first ✓ con matiz: en el MVP la API son funciones + CLI + MCP, no REST; agent-first ✓ (MCP en M5); web-first ✓ (sitio estático); motor desacoplado ✓ (`core/` sin DOM ni red, mismo bundle en Worker y Node).

---

## 10. Qué cambiar en los docs de investigación previos

- **README.md**: working title → Lila Modeler; comando objetivo `lila run model.bpmn as-is.scenario.json`; añadir "descárgalo para Windows/Linux/macOS" (Electron) y "pruébalo en el navegador" (demo) junto a la CLI; la lista de despliegues queda en dos modalidades (app de escritorio en M5, servidor self-hosted con Docker en M6) y desaparece Tauri; el principio 3 ("fork cuando tenga sentido") registra que, evaluado el ecosistema en 2026, no hay motor forkeable; avisar de la marca de agua bpmn.io.
- **ARCHITECTURE.md**: el diagrama (Web UI → REST/WebSocket → Application API → PostgreSQL, "DES Scheduler SimPy/other") describe la plataforma final; añadir el diagrama MVP de dos cajas (`apps/web` con Worker ↔ `@lila/engine`; CLI ↔ `@lila/engine`). Reescribir "Internal model ≠ BPMN XML" como "el .bpmn es canónico; la base de datos es un índice derivado". Quitar "Python API" de las interfaces del motor. Añadir la lista de elementos `lila:` y el layout `processes/<clave>/`. En Persistence, quitar SQLite/in-memory como prototipos: el prototipo es archivos + git.
- **SIMULATION_ENGINE.md**: borrar la interfaz `SimulationScheduler` y la promesa de migrar entre SimPy/custom/Rust (abstracción especulativa; el contrato son los tres JSON). Fijar TypeScript y kernel propio. Mover calendarios, costos, subproceso embebido, timer e inclusive gateway al MVP (son niveles 1–4 de Bizagi). Ampliar distribuciones a las 13 de BPSim + constante + empírica desde M1. Sustituir el ejemplo de escenario por el formato v1 (keyed por id, `extends`). Añadir parada duration/triggerCount, warmup, replicaciones con IC, semántica explícita de joins y calendarios, `offHoursWait`, `queueLength`, `flows[id].count`, event log por callback. Quitar "Failed cases" (no aplica sin boundary events).
- **DECISIONS.md**: ADR-005 ejecutado (Replace motores; Use bpmn-js/bpmn-moddle); ADR-006 reinterpretado (contratos JSON); ADR-008 cerrado (Lila Modeler; Apache-2.0); añadir ADR-009…022 de este documento.
- **ROADMAP.md**: Phase 0 (PoC editor, PoC motores, PoC DES) está resuelta por la investigación y el benchmark de hoy; fusionar Phase 1 y 2 en M0–M4; adelantar el MCP mínimo a M4, antes de la UI, porque cuesta poco y no depende de ella; reordenar Phase 3 (Repository con DB) **después** de Phase 4 (Business Architecture con `catalog.json` + `lila:`), porque catálogo y RACI no necesitan servidor y el repositorio sí; Phase 8 mining = proceso Python separado por AGPL.
- **NEXT_STEPS.md**: Paso 1 (`engine/ web/ packages/ examples/ tests/`) → el árbol de la sección 5; Paso 2 (benchmark) se mantiene y añade timer, calendario, dos recursos, `examples/mm1` y los ejemplos oficiales de Bizagi; Paso 3 (spike bpmn-js) se reduce a un día dentro de M5 (la edición inmediata de nombre viene de serie; lo que hay que probar es el round-trip de `lila:` en herramientas ajenas); Pasos 4 y 5 (rutas A/B, elegir motor) resueltos: Ruta B, motor propio en TS; Paso 6 → `lila validate|run|compare`; Paso 7 = M5. Añadir Paso 0: escribir `SEMANTICS.md`, `SCENARIO_FORMAT.md`, `RESULTS_FORMAT.md` antes del código.
- **DEPENDENCY_STRATEGY.md**: rellenar la tabla con lo verificado hoy: bpmn-js 18.27.1 (licencia bpmn.io con marca de agua) → Use; bpmn-moddle 10.2.0 MIT → Use; bpmnlint 11.13.0 y bpmn-auto-layout 1.3.0 MIT → Use en fase agentes; bpmn-js-token-simulation 0.40.0 MIT → Use opcional; SimPy 4.1.2 MIT → oráculo, no dependencia; Scylla MIT (push 2025-04) → oráculo, **quitar de "fork candidate"**; Prosimos 2.0.6 **sin licencia** → oráculo local, nunca dependencia ni fork; Simod 5.1.6 Apache-2.0 → fase minería; BIMP/QBP cerrado → ignorar (esquema qbp como import); Apromore archivado 2025-08 → ignorar; pm4py AGPL-3.0 → solo proceso separado; SpiffWorkflow LGPL → ignorar; Camunda 8 (Camunda License) → ignorar; bpmn-engine MIT (ejecución, no simulación) → ignorar; DES en TS/Rust → ignorar; KIE bpmn-editor 10.2.0 → revisitar en 12 meses. Añadir la regla: ninguna dependencia AGPL/LGPL/Camunda License en `packages/*`; nada de Prosimos en el árbol de fuentes ni en CI pública.
- **AGENT_API_MCP.md**: correcto como visión; anotar que el MVP expone 4 tools por stdio con `@modelcontextprotocol/server` 2.0.0 (spec 2026-07-28, request/response sin sesión); las operaciones de modelado (`create_activity`, `connect_elements`…) se implementan sobre bpmn-moddle + bpmn-auto-layout en la fase agentes; permisos y auditoría llegan con el servidor.
- **PRODUCT_VISION.md**: mantener; añadir los diferenciadores verificados frente a Bizagi Modeler 4.3 (solo Windows, sin editor web, freeware no open source, foro de soporte en mantenimiento en septiembre 2026, sin percentiles/colas/throughput/log por caso, quejas de "poca granularidad") y precisar que el caso académico es el MVP y el empresarial la plataforma.
- **Documentos que faltan** y deben existir antes del código: `docs/SEMANTICS.md`, `docs/SCENARIO_FORMAT.md`, `docs/RESULTS_FORMAT.md`, `docs/BPMN_EXTENSION.md`, `docs/BIZAGI_PARITY.md`, `LICENSE`, y una nota de licencias de terceros.

---

*Cómo se produjo este documento*: 6 agentes de investigación con búsqueda web y verificación en repositorios, PDFs y benchmarks locales (Bizagi, simuladores open source, formatos de escenario, editor BPMN, lenguaje/runtime, modelo de dominio); 3 arquitectos independientes con ángulos distintos (dominio primero, MVP perezoso, ecosistema primero); síntesis y crítica en la sesión principal. Todo el material está en `investigacion-2026-09-03/`.
