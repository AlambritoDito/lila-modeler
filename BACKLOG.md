# Lila Modeler — Backlog (épicas y tickets)

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](docs/) and [`README.md`](README.md).

Fecha: 2026-09-03. Complementa `LILA_MODELER_ESTRUCTURA.md` (decisiones, diseño, hitos). Aquí está el trabajo desglosado para que agentes y personas sepan qué hacer, en qué orden y cuándo está terminado.

**Dónde se gestiona**: en GitHub Issues del repo privado `AlambritoDito/lila-modeler`. El número de issue coincide con el id del ticket (`LILA-026` = `#26`); las 20 épicas son los issues `#112`–`#131` con su lista de tareas; los hitos M0–M6 son milestones. Este archivo es la fuente que generó los issues; si cambia el alcance, se edita aquí y se actualiza el issue, no al revés.

## Ampliación organizacional — 2026-09-26 (revisada 2026-10-14, base `7dd61e2`, beta.26)

Dirección aprobada: [roadmap completo y matriz de brechas](docs/es/ROADMAP.md); épica GitHub
#497 (etiqueta `later`). Primero repositorio local, catálogo, tablas, RACI e Insights (fases 1–2);
después mapas, riesgos, análisis y modelos complementarios; servidor/gobierno en fase 7 y
ecosistema en fase 8. M6 ya no bloquea el repositorio ni el catálogo local. Las fases nuevas no
renumeran M0–M6.

**Orden**: el código ADONIS empieza cuando el Lote R cierre la épica de agentes #527 (Lote P
mezclado en beta.25; Q en curso; R después). El contrato RM-01 (solo documentación) es
`docs/REPOSITORY_CONTRACT.md` + ADR-032, aceptada el 2026-10-14 con las decisiones del dueño. Lotes propuestos: A0 contrato · A1 almacén
por objeto + catálogo (roles, unidades, sistemas, documentos) + selectores + explorador · A2 tabla
+ matriz RACI agregada + Insights · A3 mapas/cadenas de valor + organigrama + enlace rol↔pool ·
A4 riesgos/controles · A5 KPIs, Ishikawa, SIPOC, impacto · después fases 6–8. #639 (simulador:
multi-instancia, bucles, eventos de error) **no** está en el camino a ADONIS.

Ya existe (no reabrir): repositorio v2 con varios procesos por `.lila` bajo `processes/<slug>/`
(#498/#461, Lote H #521; slugs en Lote N #614), pestañas por proceso y navegación a call
activities; `lila:versionTag`; anotaciones `lila:*` (documentación, RACI, referencias por ID);
atributos extendidos (#509); documento del proceso Word/HTML (#454); importación de parámetros
desde Excel/CSV (#514); matriz RACI **por proceso** en motor/CLI/MCP (#99: `lila process raci`,
`get_raci_matrix`). Todavía no: objetos de catálogo `catalog/<tipo>/<id>.json`, `ProjectStore`
por objeto con carga diferida, adjuntos, explorador/búsqueda de repositorio, índice inverso de
usos, matriz RACI agregada o en la app, mapas, historial de versiones. No cerrar un ticket por
existir solamente su base; esta revisión es documental y no certifica paridad ADONIS.

Los IDs LILA se conservan. E20 es la épica de idiomas (#283) y **E21–E26 ya son épicas de GitHub**
(#330, #335, #336, #443, #444, #445); por eso las épicas organizacionales nuevas se llaman
`ORG-1`…`ORG-9` (locales, bajo #497) y `RM-*` son claves de planificación, **no números de issue
de GitHub**. El alcance ampliado sustituye las estimaciones antiguas de E14–E18: dimensionar por
entregas tras fijar contratos. #92 tal como está escrito (`catalog.json` monolítico) queda
sustituido por un archivo por objeto (ADR-029). No se han creado ni actualizado issues remotos con
esta revisión.

**Convenciones**

- `LILA-nnn` es el id del ticket. Las épicas son `E0`…`E19`. Los hitos `M0`…`M6` son los de la sección 7 del documento de estructura.
- Cada ticket tiene: qué, aceptación (la prueba que lo cierra), de qué depende, tamaño (S ≤ medio día, M ≤ 2 días, L ≤ 1 semana) y archivos que toca.
- **Reglas para agentes**: (1) leer `docs/SEMANTICS.md`, `SCENARIO_FORMAT.md` y `RESULTS_FORMAT.md` antes de tocar el motor; (2) `packages/engine/src/core/` no importa nada fuera de `core/` (ni `bpmn-moddle`, ni `node:*`, ni React); (3) ningún ticket cierra sin su prueba de aceptación en verde; (4) nombres de columna de resultados = los de Bizagi (ver `docs/BIZAGI_PARITY.md`); (5) todo tiempo en segundos, dinero en `run.currency`; (6) el `id` BPMN es la única clave; nunca el nombre.
- **v1 = "como Bizagi"**: épicas E0–E11 (hitos M0–M5). **Después**: E12–E19.
  «Paridad» aquí es el criterio interno de aceptación (reproducir los resultados publicados), no
  el posicionamiento público del proyecto: de cara afuera Bizagi es referencia e inspiración
  (#289).
- **Cuándo arranca la UI**: la épica E9 puede correr como workstream paralelo a M2/M3 en cuanto cierre M1 (`simulate` y `lila run` existen), empezando por LILA-112 (importar el diseño) y LILA-057 (shell con bpmn-js). Resultados, comparar y overlay (LILA-062…064) esperan a M2; el panel de escenario (LILA-061) conviene después de M3; Electron (E10) al final.
- **Regla de idioma** (decisión de Brito, 2026-09-09, épica E20 #283): el código nuevo, los commits y la documentación pública van en inglés; el español es la primera traducción, un archivo por idioma. Los identificadores y comentarios existentes no se renombran. Este archivo y `LILA_MODELER_ESTRUCTURA.md` son documentos de trabajo y se quedan en español.

---

## Seguimiento de la beta Mac — 2026-09-07

**Estado: pendiente y pospuesto por el usuario hasta después de probar la app.** Esta sección registra el alcance futuro; no implica que esté implementado ni cierra tickets existentes.

### Proyecto más fácil de compartir

Diseñar un archivo o paquete de proyecto que simplifique guardar, abrir y compartir el modelo junto con sus escenarios de simulación. La beta actual guarda una carpeta con BPMN, escenarios JSON y metadatos del proyecto. Quedan por decidir el contenedor, la extensión, el versionado, la compatibilidad con esas carpetas y si se incluyen resultados de simulaciones.

Aceptación propuesta: compartir un solo archivo o paquete, abrirlo en otra instalación y recuperar el diagrama y sus escenarios sin reconstruir rutas ni perder referencias por ID BPMN. Definir y verificar la migración de proyectos existentes antes de cambiar el formato.

### Importar y exportar `.bpmn` directamente en escritorio

Añadir acciones explícitas con selectores nativos para importar un archivo `.bpmn` y exportar el diagrama actual como `.bpmn`, sin exigir que el usuario manipule la carpeta del proyecto. Conservar IDs, disposición visual y metadatos compatibles; informar cualquier pérdida o incompatibilidad. Definir cómo se crean o conservan los escenarios al importar otro modelo, dado que sus parámetros se vinculan por ID BPMN.

Aceptación propuesta: importar un BPMN externo, editarlo, exportarlo y reabrirlo conservando el contenido compatible. Distinguir en la interfaz el BPMN del proyecto completo: exportar el diagrama no debe dar a entender que incluye los escenarios JSON propios de Lila.

Retomar ambos puntos con los comentarios de las pruebas del usuario; no iniciar su implementación durante esta pausa.

---

## v1 — Simulador con paridad Bizagi (M0 → M5)

### E0 — Fundaciones del repositorio (M0)

#### LILA-001 · Crear el monorepo
- Épica E0 · Hito M0 · Tamaño S · Depende de —
- Qué: repo `lila-modeler/` con npm workspaces (`packages/*`, `apps/*`), `tsconfig.base.json` (strict, ESM, ES2022), vitest, `LICENSE` Apache-2.0, `README.md` esqueleto, `.gitignore`, `.editorconfig`.
- Aceptación: `npm install && npm test && npm run build` pasan en Node 22 y 24 con un paquete `engine` vacío.
- Archivos: `package.json`, `tsconfig.base.json`, `packages/engine/package.json`, `LICENSE`.

#### LILA-002 · CI en GitHub Actions
- Épica E0 · Hito M0 · Tamaño S · Depende de LILA-001
- Qué: workflow `ci.yml`: install, test, build en matriz Node 22/24 sobre ubuntu; cache de npm.
- Aceptación: un PR con un test roto falla; con tests verdes pasa.
- Archivos: `.github/workflows/ci.yml`.

#### LILA-003 · docs/SEMANTICS.md (antes del motor)
- Épica E0 · Hito M0 · Tamaño M · Depende de —
- Qué: perfil BPMN soportado y semántica exacta: XOR (probabilidades, default, normalización), OR fork/join, AND fork/join con loops, timer, end/terminate, subproceso embebido aplanado, call activity como tarea, llegadas y parada (duration | triggerCount), warmup, replicaciones, recursos AND/OR, FIFO y desempate por `seq`, calendarios (pausa/reanudación, `offHoursWait`, utilización sobre horas disponibles), costos, degradación (sin recursos ⇒ ∞, sin calendario ⇒ 24×7), lista de elementos no soportados con el texto del error.
- Aceptación: cada regla lleva el id del ticket que la prueba; revisado contra la sección 6 del documento de estructura; sin contradicciones.
- Archivos: `docs/SEMANTICS.md`.

#### LILA-004 · docs/SCENARIO_FORMAT.md v1
- Épica E0 · Hito M0 · Tamaño S · Depende de —
- Qué: formato v1 (run, calendars, resources, elements keyed por id, extends, campos reservados), reglas de validación, ejemplo AS-IS/TO-BE, tabla de mapeo campo ↔ BPSim 2.0 ↔ qbp ↔ Bizagi.
- Aceptación: los ejemplos del documento de estructura aparecen tal cual y son válidos contra las reglas descritas.
- Archivos: `docs/SCENARIO_FORMAT.md`.

#### LILA-005 · docs/RESULTS_FORMAT.md
- Épica E0 · Hito M0 · Tamaño S · Depende de —
- Qué: `RunResult` (por elemento, flujo, recurso, proceso; `bottlenecks`; `replications`/`ci95`; `warnings`), definición de cada métrica, columnas del event log, nombres de columna Bizagi para la CLI.
- Aceptación: cada métrica tiene fórmula o definición operativa; el event log tiene tipos y unidades.
- Archivos: `docs/RESULTS_FORMAT.md`.

#### LILA-006 · docs/BPMN_EXTENSION.md
- Épica E0 · Hito M0 · Tamaño S · Depende de —
- Qué: IRI del namespace `lila`, elementos v1 (`responsibility`, `systemRef`, `documentRef`, `riskRef`, `controlRef`, `kpiRef`, `input`, `output`, `versionTag`), política de ids (NCName, prefijo por tipo, nunca regenerar, nuevo al copiar, sanitizado reversible), `exporter`/`exporterVersion`, clave de proceso.
- Aceptación: consistente con ADR-012 y ADR-014; incluye el descriptor moddle de ejemplo.
- Archivos: `docs/BPMN_EXTENSION.md`.

#### LILA-007 · docs/BIZAGI_PARITY.md y docs/DECISIONS.md
- Épica E0 · Hito M0 · Tamaño S · Depende de —
- Qué: copiar la tabla de paridad (sección 3 del documento de estructura) con columna de estado; migrar ADR-001…023.
- Aceptación: ambos archivos existen y enlazan a la fuente.
- Archivos: `docs/BIZAGI_PARITY.md`, `docs/DECISIONS.md`.

#### LILA-008 · Proceso benchmark `examples/pedido`
- Épica E0 · Hito M0 · Tamaño S · Depende de LILA-004
- Qué: `model.bpmn` (start, 4–5 tareas, XOR 0.78/0.22, AND fork/join, timer, 2 pools) dibujado en bpmn-js o Camunda Desktop Modeler; `as-is.scenario.json`; `to-be-3-cajeros.scenario.json` con `extends`.
- Aceptación: el .bpmn abre en Camunda Desktop Modeler sin avisos; los escenarios coinciden con los ejemplos de `SCENARIO_FORMAT.md`.
- Archivos: `examples/pedido/*`.

#### LILA-009 · Fixtures reales exportados por Bizagi
- Épica E0 · Hito M0 · Tamaño S · Depende de —
- Qué: ≥ 3 archivos `.bpmn` exportados por Bizagi Modeler (distintas versiones) con `xmlns:bizagi` declarado dentro de `extensionElements`, ids no-NCName si los hay, subprocesos y gateways; un README con su origen y licencia de uso.
- Aceptación: archivos presentes, cada uno con su procedencia.
- Archivos: `examples/bizagi-exports/*`.

#### LILA-010 · Réplicas de los ejemplos oficiales de Bizagi (niveles 1–4)
- Épica E0 · Hito M0 · Tamaño M · Depende de LILA-004
- Qué: por cada ejemplo de help.bizagi.com (`level_1..4_example`): `model.bpmn`, `scenario.json` con sus parámetros y `expected.json` con los valores publicados (los que existan).
- Aceptación: cuatro carpetas con los tres archivos; `expected.json` cita la URL de origen.
- Archivos: `examples/bizagi-levels/level-{1,2,3,4}/*`.

#### LILA-011 · Oráculos analíticos `examples/mm1`
- Épica E0 · Hito M0 · Tamaño S · Depende de LILA-004
- Qué: M/M/1 (ρ = 0,8) y M/M/3 como .bpmn de una tarea + escenarios; `expected.json` con Wq, L, utilización calculados con Erlang-C (incluir el script que los calcula).
- Aceptación: valores reproducibles con el script incluido.
- Archivos: `examples/mm1/*`.

### E1 — Contratos: IR, escenario, resultado, event log, namespace (M0)

#### LILA-012 · Tipos y esquema del IR
- Épica E1 · Hito M0 · Tamaño S · Depende de LILA-001
- Qué: `ProcessIR`, `Node` (`start|end|terminate|task|xor|or|and|timer`, `name`, `lane?`, `subprocessId?`, `incoming[]`, `outgoing[]`), `Flow` (`from`, `to`, `name`, `isDefault`), `source` (`exporter`, `exporterVersion`, `originalIds`); esquema zod.
- Aceptación: tests de tipo y de validación (un IR con flujo colgante es inválido).
- Archivos: `packages/engine/src/core/ir.ts`.

#### LILA-013 · Esquema del escenario v1 y JSON Schema
- Épica E1 · Hito M0 · Tamaño M · Depende de LILA-004, LILA-012
- Qué: zod para `run`, `calendars`, `resources`, `elements`, `extends`, distribuciones (14, parámetros nombrados), campos reservados (`priority`, `preempt`, `batch`, `conditions`, `holidays`, `timezone`) aceptados por el esquema pero rechazados por el motor; defaults degradantes; generación de JSON Schema a `docs/scenario.schema.json`.
- Aceptación: los escenarios de `examples/` validan; `probability: 1.5` se rechaza; clave inexistente en `elements` produce error que cita el id; el JSON Schema generado valida los mismos casos con un validador externo.
- Archivos: `packages/engine/src/scenario.ts`, `docs/scenario.schema.json`.

#### LILA-014 · `resolveExtends`
- Épica E1 · Hito M0 · Tamaño S · Depende de LILA-013
- Qué: merge profundo sobre el padre, `null` elimina clave, cadenas de herencia, ciclos rechazados, rutas relativas al archivo.
- Aceptación: `to-be-3-cajeros` resuelve a un objeto igual al AS-IS salvo `capacity = 3`; un ciclo A→B→A produce error.
- Archivos: `packages/engine/src/scenario.ts`.

#### LILA-015 · Tipos de `RunResult` y `EventLogRow`
- Épica E1 · Hito M0 · Tamaño S · Depende de LILA-005
- Qué: tipos + zod según `RESULTS_FORMAT.md`.
- Aceptación: un `RunResult` de ejemplo valida; un campo faltante falla.
- Archivos: `packages/engine/src/core/result.ts`.

#### LILA-016 · Descriptor moddle `lila`
- Épica E1 · Hito M0 · Tamaño S · Depende de LILA-006
- Qué: `lila.moddle.json` con los elementos v1 (extienden `Element`, van dentro de `extensionElements`) y `versionTag` en `bpmn:process`.
- Aceptación: bpmn-moddle con la extensión lee y escribe `lila:responsibility type="R" roleRef="rol-1"`; el round-trip conserva orden y valores.
- Archivos: `packages/engine/src/bpmn/lila.moddle.json`.

#### LILA-017 · Generador y sanitizador de ids
- Épica E1 · Hito M0 · Tamaño S · Depende de LILA-006
- Qué: `newId(type)` → NCName con prefijo por tipo y sufijo aleatorio; `sanitizeIds(xmlIds)` → mapa reversible para ids que no son NCName (p. ej. empiezan por dígito).
- Aceptación: 10 000 ids generados son NCName únicos; un id `1abc` se sanitiza y se recupera.
- Archivos: `packages/engine/src/bpmn/ids.ts`.

### E2 — Parser BPMN y validación (M0)

#### LILA-018 · `parseBpmn`: bpmn-moddle → IR
- Épica E2 · Hito M0 · Tamaño M · Depende de LILA-012, LILA-016
- Qué: leer `.bpmn` con bpmn-moddle 10.x, producir `ProcessIR` (toda variante de task → `task`; timers intermedios; gateways; lanes; `isDefault`), conservar `exporter`.
- Aceptación: snapshot del IR de `examples/pedido`; nodos y flujos esperados; funciona en Node sin DOM.
- Archivos: `packages/engine/src/bpmn/parse.ts`.

#### LILA-019 · Aplanado de subprocesos embebidos y call activities
- Épica E2 · Hito M0 · Tamaño M · Depende de LILA-018
- Qué: start/end internos → pass-through; cada nodo conserva `subprocessId`; call activity → `task` con tiempo global.
- Aceptación: un subproceso con AND interno produce el mismo IR (salvo ids) que el proceso aplanado a mano.
- Archivos: `packages/engine/src/bpmn/parse.ts`.

#### LILA-020 · Tolerancia a archivos de Bizagi
- Épica E2 · Hito M0 · Tamaño S · Depende de LILA-017, LILA-018, LILA-009
- Qué: `xmlns:bizagi` anidado, ids no-NCName sanitizados con mapa, preservación de `bizagi:BizagiExtensions` en round-trip `saveXML`.
- Aceptación: los fixtures de `examples/bizagi-exports` parsean sin excepción y el round-trip conserva los bloques `bizagi:` con el mismo conteo.
- Archivos: `packages/engine/src/bpmn/parse.ts`, tests.

#### LILA-021 · `validate(ir)`
- Épica E2 · Hito M0 · Tamaño M · Depende de LILA-018, LILA-003
- Qué: elementos no soportados → error con el texto de `SEMANTICS.md`; flujos colgantes; ids duplicados; gateway sin salida; nodos inalcanzables; warnings vs errors.
- Aceptación: un .bpmn con boundary event produce error explícito; `examples/pedido` produce 0 errores.
- Archivos: `packages/engine/src/bpmn/validate.ts`.

#### LILA-022 · Leer y escribir `bpmn:documentation` y `lila:*`
- Épica E2 · Hito M0 · Tamaño S · Depende de LILA-016, LILA-018
- Qué: `annotateElement(xml, id, {documentation?, responsibilities?, refs?})` → xml; `readAnnotations(xml)`.
- Aceptación: añadir `lila:responsibility` y volver a leer devuelve lo escrito; el resto del XML no cambia (diff mínimo).
- Archivos: `packages/engine/src/bpmn/annotate.ts`.

### E3 — Motor DES, niveles 1 y 2 de Bizagi (M1)

#### LILA-023 · Heap `(t, seq)`
- Épica E3 · Hito M1 · Tamaño S · Depende de LILA-001
- Qué: cola de prioridad binaria ordenada por tiempo y contador monótono.
- Aceptación: eventos con el mismo `t` salen en orden de inserción; 1 M push/pop < 300 ms.
- Archivos: `packages/engine/src/core/heap.ts`.

#### LILA-024 · PRNG sembrado con streams por elemento
- Épica E3 · Hito M1 · Tamaño S · Depende de —
- Qué: mulberry32 o xoshiro; `stream(seed, replication, elementId)` por hash; nunca `Math.random`.
- Aceptación: misma semilla ⇒ misma secuencia de 1000 números; dos elementos distintos producen streams distintos; cambiar el stream de A no cambia el de B.
- Archivos: `packages/engine/src/core/rng.ts`.

#### LILA-025 · Distribuciones (14, parámetros nombrados)
- Épica E3 · Hito M1 · Tamaño M · Depende de LILA-024
- Qué: constant, uniform, triangular, exponential, normal (truncada ≥ 0 con warning), truncatedNormal, lognormal (mean/sd de la variable), gamma, erlang, weibull, beta, poisson, binomial, user (empírica).
- Aceptación: media y sd de 100 000 muestras dentro del 2 % de la teórica para cada una; normal con P(x<0) > 1 % emite warning.
- Archivos: `packages/engine/src/core/distributions.ts`.

#### LILA-026 · Bucle DES v1: llegadas, tokens, gateways, timers, parada
- Épica E3 · Hito M1 · Tamaño L · Depende de LILA-023, LILA-024, LILA-025, LILA-012, LILA-013, LILA-003
- Qué: llegadas por start (`interTriggerTimer`, `triggerCount`, `run.duration`, lo primero), tokens por caso, XOR/OR/AND fork-join (con loops), timer, end/terminate, capacidad infinita, casos en vuelo al parar = started sin completed.
- Aceptación: (a) Start→A(60 s)→XOR 50/50→B(120 s)|C(30 s)→End, llegadas cada 10 s, 1000 casos ⇒ ciclo medio 60 + 0,5·120 + 0,5·30 ± 1 s y tokens por flujo 500 ± 40; (b) AND con ramas constantes 300 y 500 s ⇒ sección de 500 s exacto; (c) duración 1 h, `triggerCount` 10000, llegadas cada 10 s ⇒ `started = 360`; (d) OR con probabilidades 1.0/0.5 ⇒ el join espera 1 o 2 tokens según el fork.
- Archivos: `packages/engine/src/core/sim.ts`.

#### LILA-027 · Warmup y replicaciones
- Épica E3 · Hito M1 · Tamaño S · Depende de LILA-026
- Qué: casos iniciados antes de `warmup` ocupan recursos pero no cuentan; replicación r usa streams derivados de (seed, r); agregación mean/sd/ci95 por KPI.
- Aceptación: con `warmup` = fin de la corrida, todas las métricas son 0/vacías; con 30 replicaciones el IC es más estrecho que con 5.
- Archivos: `packages/engine/src/core/sim.ts`, `metrics.ts`.

#### LILA-028 · Métricas v1 (elemento, flujo, proceso)
- Épica E3 · Hito M1 · Tamaño M · Depende de LILA-026, LILA-015
- Qué: por elemento started/completed/processing min-max-mean-total; por flujo `count`; por proceso started/completed/inFlight, cycleTime min/max/mean/sd/p50/p90/p95, throughputPerHour.
- Aceptación: en un proceso lineal con tiempos constantes el ciclo es exactamente la suma y p50 = p95.
- Archivos: `packages/engine/src/core/metrics.ts`.

#### LILA-029 · `simulate(ir, scenario, opts)`
- Épica E3 · Hito M1 · Tamaño S · Depende de LILA-026, LILA-028
- Qué: función pura pública; `opts.onEvent` (callback), `opts.onProgress`, `opts.signal` (cancelación), `opts.log: boolean`.
- Aceptación: llamada dos veces con la misma entrada ⇒ `JSON.stringify` idéntico; cancelar a mitad devuelve resultado parcial marcado.
- Archivos: `packages/engine/src/core/run.ts`, `index.ts`.

#### LILA-030 · Determinismo: golden snapshots
- Épica E3 · Hito M1 · Tamaño S · Depende de LILA-029, LILA-008
- Qué: snapshot JSON de `examples/pedido` con seed 42 en el repo; test que lo compara byte a byte; CI en Node 22 y 24.
- Aceptación: el snapshot pasa en ambas versiones de Node; cambiar la semilla lo rompe.
- Archivos: `packages/engine/test/golden/*`.

#### LILA-031 · Rendimiento
- Épica E3 · Hito M1 · Tamaño S · Depende de LILA-029
- Qué: benchmark reproducible (`npm run bench`) y test de regresión con umbral holgado.
- Aceptación: 100 000 casos del benchmark de 5 tareas < 1 s en Node en la máquina de Brito; el test falla por encima de 3 s.
- Archivos: `packages/engine/bench/*`.

#### LILA-032 · Aislamiento de `core/`
- Épica E3 · Hito M1 · Tamaño S · Depende de LILA-029
- Qué: test que empaqueta `core/` (esbuild o el propio bundler de vitest) y comprueba que no hay imports de `bpmn-moddle`, `node:*`, `zod` ni React.
- Aceptación: el test pasa; añadir `import fs from 'node:fs'` en `sim.ts` lo rompe.
- Archivos: `packages/engine/test/worker-bundle.test.ts`.

### E4 — Nivel 3: recursos, colas, costos, log, comparación (M2)

#### LILA-033 · Pools de recursos y colas FIFO
- Épica E4 · Hito M2 · Tamaño M · Depende de LILA-029
- Qué: `resources[pool] = {capacity, costPerHour, fixedCost, calendar?}`; asignación de un solo pool con `quantity`; cola FIFO global por `(enabledAt, seq)`; lifecycle completo y parcial por `activityInstanceId`. AND/OR multi-pool se rechazan explícitamente hasta LILA-034/035. `calendar` se conserva en el formato pero no se interpreta hasta LILA-041. Las filas raw fijan el desglose de costos; las métricas agregadas de recursos pertenecen a LILA-036 y CSV/streaming a LILA-037.
- Aceptación: pool con `capacity = 2`, tarea que pide `quantity = 2`, llegadas en 0/1/2 s y duración 10 s ⇒ empieza en 0/10/20, espera 0/9/18 y termina en 10/20/30, con filas de lifecycle reconstruibles y orden FIFO exacto. M/M/1 queda en LILA-050, después de las métricas LILA-036.
- Archivos: `packages/engine/src/core/sim.ts`, `resources.ts`.

#### LILA-034 · Asignación AND multi-pool atómica
- Épica E4 · Hito M2 · Tamaño M · Depende de LILA-033
- Qué: la tarea arranca cuando todos los pools tienen capacidad simultáneamente; sin retención parcial. Las solicitudes se agrupan por firma, los pools indexan las firmas afectadas y un heap de cabezas elegibles conserva `(enabledAt, seq)` sin recorrer toda la cola. OR permanece en fail-fast hasta LILA-035.
- Aceptación: 100 000 casos con dos pools en orden adverso de ids no producen deadlock ni reescaneo cuadrático; una AND bloqueada se salta sin retener capacidad, assignments/log conservan el orden del escenario y los costos por pool son reconstruibles.
- Archivos: `packages/engine/src/core/resources.ts`.

#### LILA-035 · Selección OR de recursos
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-033
- Qué: encolar en todos los pools alternativos, arrancar con el primero disponible, retirar de los demás. Cada alternativa es una entrada single-pool más en la cola FIFO de su pool, con el mismo `seq`, así que OR, AND y single conviven sin reordenar nada (ADR-026). Desempate entre alternativas libres a la vez: el orden de declaración en `resources`. Desaparece el fail-fast `E-REC-OR-PENDIENTE`.
- Aceptación: con un pool saturado y otro libre, todas las tareas OR arrancan sin esperar; el log registra el pool usado, con una sola fila por asignación y los costos del pool elegido.
- Archivos: `packages/engine/src/core/resources.ts`.

#### LILA-036 · Métricas de nivel 3
- Épica E4 · Hito M2 · Tamaño M · Depende de LILA-034, LILA-035, LILA-028
- Qué: `resourceWait` min/max/mean/sd/total por elemento; `queueLength` mean/max (ponderada por tiempo); por recurso utilización, busyTime, fixedCost, unitCost, totalCost; por proceso waitTime, costPerCase, totalCost; `bottlenecks` (ranking por `resourceWait.total`, desempate por utilización). Fijar y probar explícitamente si la espera observada de filas `terminated`/`inFlight` entra en métricas agregadas; LILA-033 conserva esas filas raw pero agrega solo actividades completadas.
- Aceptación: caso determinista con dos pools y cantidades conocidas reconstruye desde el log `totalCost = Σ fijo × usos + Σ hora × horas ocupadas`; utilización, longitud de cola y esperas coinciden con el cálculo a mano; el ranking señala al pool saturado. Los oráculos M/M/1 y M/M/c quedan en LILA-050.
- Archivos: `packages/engine/src/core/metrics.ts`.

#### LILA-037 · Event log completo y CSV en streaming
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-036, LILA-046
- Qué: filas planas por asignación, agrupadas por `activityInstanceId`, con sentinel para actividades sin recurso, lifecycle parcial y desglose `elementCost`/`resourceCost`; `toCsv` con timestamps ISO desde `run.start`; desactivable.
- Aceptación: `lila run --csv out/` escribe `log.csv` sin cargar todo en memoria; 30 × 10 000 casos no superan 200 MB de RAM en Node.
- Archivos: `packages/engine/src/core/run.ts`, `csv.ts`.

#### LILA-038 · `compare(results[])`
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-036, LILA-027
- Qué: tabla lado a lado por elemento/recurso/proceso, deltas absolutos y relativos, marca de significancia si los IC95 no se solapan.
- Aceptación: AS-IS vs TO-BE 3 cajeros marca como significativa la reducción de espera en `Task_TomarPedido` y no la de `Task_Preparar`.
- Archivos: `packages/engine/src/core/compare.ts`.

#### LILA-039 · Regresión de degradación (sin recursos)
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-033, LILA-030
- Qué: test que corre el escenario sin `resources` y compara con el golden de M1.
- Aceptación: resultado idéntico bit a bit.
- Archivos: `packages/engine/test/semantics.test.ts`.

### E5 — Nivel 4: calendarios y paridad (M3)

#### LILA-040 · `calendar.ts`
- Épica E5 · Hito M3 · Tamaño M · Depende de LILA-013
- Qué: intervalos semanales `{days, from, to}` relativos a `run.start`; `isOpen(t)`, `nextOpen(t)`, `addWorkingTime(t, d)`; sin DST ni festivos (reservados).
- Aceptación: tarea de 2 h que arranca 17:30 con calendario 9–18 ⇒ termina 10:30 del siguiente día hábil; viernes 17:59 + 2 h ⇒ lunes 10:59.
- Archivos: `packages/engine/src/core/calendar.ts`.

#### LILA-041 · Calendarios en llegadas y recursos
- Épica E5 · Hito M3 · Tamaño L · Depende de LILA-040, LILA-033
- Qué: llegadas desplazadas al siguiente instante abierto; recursos solo asignan en horario abierto; tarea en curso se pausa y reanuda; `offHoursWait` separado de `resourceWait`; matriz recurso × calendario con calendario por defecto; utilización sobre horas disponibles.
- Aceptación: `offHoursWait = 15 h` y `resourceWait = 0` en el caso de 17:30; llegadas 24×7 con recursos L–V 9–18 ⇒ cola máxima el lunes 09:00 y utilización sobre horas abiertas; utilización con calendario 8×5 coincide con 24×7 escalado.
- Archivos: `packages/engine/src/core/sim.ts`, `resources.ts`, `metrics.ts`.

#### LILA-042 · Lint de escenario
- Épica E5 · Hito M3 · Tamaño S · Depende de LILA-013, LILA-025
- Qué: probabilidades que no suman 1 (warning + normalización), normal con masa negativa, calendario sin intervalos, refs colgantes a pools/calendarios, `elements` sobrantes (warning) o faltantes (error).
- Aceptación: cada caso produce el mensaje esperado con el id del elemento.
- Archivos: `packages/engine/src/scenario.ts`.

#### LILA-043 · Regresión de degradación (sin calendarios)
- Épica E5 · Hito M3 · Tamaño S · Depende de LILA-041
- Qué: sin `calendars` el resultado es bit a bit igual al golden de M2.
- Aceptación: test verde.
- Archivos: `packages/engine/test/semantics.test.ts`.

#### LILA-044 · Paridad con los ejemplos oficiales de Bizagi
- Épica E5 · Hito M3 · Tamaño M · Depende de LILA-010, LILA-041
- Qué: correr `examples/bizagi-levels/*` y comparar con `expected.json` (± 5 %); marcar `docs/BIZAGI_PARITY.md`.
- Aceptación: los cuatro niveles dentro de tolerancia o, si no, diferencia documentada con causa (semántica no documentada de Bizagi).
- Archivos: tests, `docs/BIZAGI_PARITY.md`.

### E6 — CLI `lila` (M1–M3)

#### LILA-045 · `lila validate`
- Épica E6 · Hito M0 · Tamaño S · Depende de LILA-021
- Qué: `node:util.parseArgs`; imprime nodos/flujos del IR, errores y warnings con ids; código de salida 1 si hay errores.
- Aceptación: `npx lila validate examples/pedido/model.bpmn` ⇒ 0 errores; con un fixture con boundary event ⇒ error y exit 1.
- Archivos: `packages/engine/src/cli.ts`.

#### LILA-046 · `lila run`
- Épica E6 · Hito M1 · Tamaño M · Depende de LILA-029, LILA-045
- Qué: `lila run model.bpmn scenario.json [--seed n] [--replications n] [--json out] [--csv dir]`; tabla en consola con los nombres de columna de Bizagi + extras; `format.ts` para `baseTimeUnit`.
- Aceptación: salida parecida a la del README del corpus; `--json` dos veces con la misma semilla ⇒ bytes idénticos; `--csv` produce `elements.csv`, `flows.csv`, `resources.csv`, `process.csv`, `log.csv`.
- Archivos: `packages/engine/src/cli.ts`, `format.ts`, `csv.ts`.

#### LILA-047 · `lila compare`
- Épica E6 · Hito M2 · Tamaño S · Depende de LILA-038, LILA-046
- Qué: `lila compare model.bpmn a.json b.json [...]`; tabla lado a lado con diferencias resaltadas y marca de significancia.
- Aceptación: AS-IS vs TO-BE muestra menor utilización y espera del cajero.
- Archivos: `packages/engine/src/cli.ts`.

#### LILA-184 · `lila run` acepta `resources` y avisa de `calendars` como `lila compare`
- Épica E6 · Hito M2 · Tamaño S · Depende de LILA-036, LILA-046, LILA-047
- Qué: el gate `unsupportedM1` de `lila run` seguía rechazando `resources`, `elements[id].resources` y `selection` con `E-NIVEL-M2` aunque el motor simula nivel 3 desde LILA-033…036, y `lila compare` no aplicaba ese gate. Se elimina la parte de recursos del gate. La parte de calendarios (`calendars`, `elements[id].calendar`) deja de ser error `E-NIVEL-M3` y pasa a ser el mismo aviso al pie que ya imprime `lila compare` (el escenario declara calendarios; el motor todavía no los simula, M3/LILA-041; sus números salen 24×7), extraído a un helper compartido por `run` y `compare` (`declaresCalendars`/`calendarsWarning`).
- Aceptación: `lila run examples/pedido/model.bpmn examples/pedido/as-is.scenario.json` sale 0, imprime la tabla Resources y el aviso de calendarios al pie; con `--json` dos corridas producen bytes idénticos y el JSON incluye `resources` y `bottlenecks`. Un escenario con `elements[id].calendar` o `calendars` ya no produce `E-NIVEL-M3`; uno con `resources` ya no produce `E-NIVEL-M2`. `lila run --csv` sobre `examples/pedido` produce `log.csv` con `resourceId` no nulo.
- Archivos: `packages/engine/src/cli.ts`, `packages/engine/test/cli-run.test.ts`, `packages/engine/test/cli-compare.qa.test.ts`.

#### LILA-048 · Publicación en npm y `npx lila`
- Épica E6 · Hito M3 · Tamaño S · Depende de LILA-046, LILA-047, LILA-044
- Qué: `@lila-modeler/engine` con `bin: lila`, `exports` (`.`, `./bpmn`, `./schema`), `files`, versión 0.x; publicación desde CI con tag.
- Aceptación: en una máquina limpia con Node 22, `npx @lila-modeler/engine run …` funciona.
- Archivos: `packages/engine/package.json`, `.github/workflows/release.yml`.

### E7 — Validación numérica y oráculos (M1–M3)

#### LILA-049 · Oráculo SimPy
- Épica E7 · Hito M2 · Tamaño S · Depende de LILA-036
- Qué: `tools/oracles/des_simpy.py` (portar del benchmark) que corre el mismo modelo de 5 tareas; test opcional (`ORACLES=1`) que compara ciclo medio, p95 y utilizaciones dentro del IC95.
- Aceptación: con `ORACLES=1 npm test` el test corre y pasa; sin la variable se salta.
- Archivos: `tools/oracles/des_simpy.py`, test.

#### LILA-050 · M/M/1 y M/M/c en CI
- Épica E7 · Hito M2 · Tamaño S · Depende de LILA-011, LILA-036
- Qué: tests con `examples/mm1` contra `expected.json`, tolerancia 3 %, 30 replicaciones.
- Aceptación: verde en CI en < 10 s.
- Archivos: `packages/engine/test/theory.test.ts`.

#### LILA-051 · Fixture congelado de Scylla
- Épica E7 · Hito M3 · Tamaño M · Depende de LILA-008, LILA-041
- Qué: `tools/oracles/run_scylla.sh` (JDK 17, headless) sobre el benchmark; salida guardada como fixture con tolerancia estadística; ningún jar en el repo.
- Aceptación: test opcional compara dentro de tolerancia; `docs/ORACLES.md` explica cómo regenerarlo.
- Archivos: `tools/oracles/*`, `docs/ORACLES.md`.

#### LILA-052 · Fixture congelado de Prosimos
- Épica E7 · Hito M3 · Tamaño M · Depende de LILA-051
- Qué: `run_prosimos.sh` en venv Python 3.11 aparte con `numpy`/`random` sembrados; conversión a mano del benchmark al JSON de Prosimos; salida como fixture. Ni código ni jar de Prosimos en el repo; fuera de CI pública.
- Aceptación: test opcional dentro de tolerancia; `ORACLES.md` deja claro el estado de licencia de Prosimos.
- Archivos: `tools/oracles/*`.

### E8 — MCP local para agentes (M4)

#### LILA-053 · Servidor MCP stdio con `validate_bpmn` y `describe_process`
- Épica E8 · Hito M4 · Tamaño S · Depende de LILA-021, LILA-018
- Qué: `packages/mcp` con `@modelcontextprotocol/server` 2.x; `validate_bpmn(path|xml)` devuelve el mismo JSON que la CLI; `describe_process(path)` devuelve el IR y un resumen legible (nodos, gateways, recursos referenciados).
- Aceptación: con el cliente MCP de referencia, ambas tools responden; un .bpmn inválido devuelve errores estructurados.
- Archivos: `packages/mcp/src/*`.

#### LILA-054 · `run_simulation` y `compare_scenarios`
- Épica E8 · Hito M4 · Tamaño S · Depende de LILA-053, LILA-046, LILA-047
- Qué: reciben rutas o contenido; devuelven `RunResult`/tabla de comparación idénticos a la CLI; opción de guardar `result.json`.
- Aceptación: `run_simulation` sobre `examples/pedido` con seed 42 devuelve exactamente el golden.
- Archivos: `packages/mcp/src/*`.

#### LILA-055 · `patch_scenario`
- Épica E8 · Hito M4 · Tamaño S · Depende de LILA-053, LILA-013
- Qué: JSON Patch sobre un escenario (o crear uno nuevo con `extends`), validar, escribir a disco, devolver el escenario resultante y warnings de lint.
- Aceptación: un patch que pone `capacity = 3` produce un archivo válido; un patch con `probability: 1.5` se rechaza sin escribir.
- Archivos: `packages/mcp/src/*`.

#### LILA-056 · `lila mcp` y prueba de humo con Claude Code
- Épica E8 · Hito M4 · Tamaño S · Depende de LILA-054, LILA-055
- Qué: subcomando `lila mcp` (stdio); `docs/MCP.md` con la configuración para Claude Code/Desktop; test E2E con el cliente MCP oficial.
- Aceptación: "simula examples/pedido con as-is y dime el cuello de botella" devuelve el mismo `bottlenecks[0]` que `lila run`; "qué pasa si agrego un cajero" produce un escenario con `extends` y una comparación coherente, sin cambios en `@lila-modeler/engine`.
- Archivos: `packages/engine/src/cli.ts`, `docs/MCP.md`, test E2E.

### E9 — App web: editor, escenario, resultados (M5)

#### LILA-057 · `apps/web` con bpmn-js
- Épica E9 · Hito M5 · Tamaño M · Depende de LILA-016, LILA-112
- Qué: Vite + React; `Modeler.tsx` monta `BpmnModeler({ moddleExtensions: { lila } })`; import/export XML; el canvas reserva la esquina inferior derecha para la marca de agua bpmn.io; foco y atajos de bpmn-js 18 verificados.
- Aceptación: abre `examples/pedido/model.bpmn` y un fixture de Bizagi; crear una tarea deja el nombre en edición inmediata sin `Task 1`; exportar produce XML válido que `lila validate` acepta.
- Archivos: `apps/web/src/Modeler.tsx`, `main.tsx`, `app.css`.

#### LILA-058 · `ProjectStore` y `BrowserStore`
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-057
- Qué: interfaz `ProjectStore` (`listProcesses`, `getProcess`, `putProcess`, `listScenarios`, `putScenario`, `putRun`); `BrowserStore` con `<input type=file>` y descarga (demo online, sin persistencia).
- Aceptación: la UI no importa ninguna implementación concreta fuera del punto de arranque; la demo abre y descarga archivos.
- Archivos: `apps/web/src/store/ProjectStore.ts`, `BrowserStore.ts`.

#### LILA-059 · Worker de simulación
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-029, LILA-032, LILA-057
- Qué: `worker.ts` importa `@lila-modeler/engine` core y ejecuta `simulate`; progreso, cancelación, muestreo del log (solo primera replicación en memoria).
- Aceptación: 10 000 × 30 en < 15 s sin congelar la UI; resultado byte a byte igual a `lila run --json` con la misma semilla; el bundle del Worker < 100 KB y sin bpmn-js/React.
- Archivos: `apps/web/src/worker.ts`.

#### LILA-060 · Panel de propiedades propio
- Épica E9 · Hito M5 · Tamaño M · Depende de LILA-057, LILA-022
- Qué: React; lee `selection.changed`; edita nombre, `bpmn:documentation` y `lila:*` vía `modeling.updateProperties`/moddle.
- Aceptación: añadir `lila:responsibility` desde el panel aparece en el XML exportado.
- Archivos: `apps/web/src/PropertiesPanel.tsx`.

#### LILA-061 · Panel de escenario
- Épica E9 · Hito M5 · Tamaño L · Depende de LILA-013, LILA-057
- Qué: `run`, `calendars`, `resources`, y `elements[id]` del elemento seleccionado; formularios generados desde el JSON Schema; validación en vivo con los mismos mensajes del lint; duplicar escenario; `extends`.
- Aceptación: editar `capacity`, guardar ⇒ archivo válido que `lila run` acepta; un valor inválido se marca sin bloquear la escritura.
- Archivos: `apps/web/src/ScenarioPanel.tsx`.

#### LILA-062 · Vista de resultados
- Épica E9 · Hito M5 · Tamaño M · Depende de LILA-059, LILA-036
- Qué: tablas Elementos / Recursos / Proceso (columnas Bizagi + extras) y Flujos; exportar CSV; tablas HTML planas, sin librería de grid ni gráficas en v1.
- Aceptación: los valores coinciden con `lila run`; CSV descargado igual al de la CLI.
- Archivos: `apps/web/src/ResultsView.tsx`.

#### LILA-063 · Vista de comparación
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-062, LILA-038
- Qué: dos o más escenarios lado a lado; celdas distintas resaltadas; significancia.
- Aceptación: AS-IS vs TO-BE marca solo las celdas que cambian.
- Archivos: `apps/web/src/CompareView.tsx`.

#### LILA-064 · Overlay de cuellos de botella
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-057, LILA-062
- Qué: `BaseRenderer` con prioridad 1500 que colorea tareas por `resourceWait` y muestra la utilización del pool.
- Aceptación: tras simular, la tarea con mayor espera queda resaltada; al cambiar de escenario cambia el overlay.
- Archivos: `apps/web/src/BottleneckOverlay.ts`.

#### LILA-065 · Pestaña "validar rutas" con token-simulation
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-057
- Qué: integrar `bpmn-js-token-simulation` como pestaña; texto que aclara que no es DES.
- Aceptación: se puede animar el benchmark paso a paso.
- Archivos: `apps/web/src/TokenSim.tsx`.

#### LILA-066 · UI en español y estado global
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-057
- Qué: `strings.es.ts`; `store.ts` con `useReducer`/`useSyncExternalStore` (`xml`, `scenarios[]`, `results[]`); sin Redux/Zustand.
- Aceptación: no hay literales de UI fuera de `strings.es.ts`.
- Archivos: `apps/web/src/strings.es.ts`, `store.ts`.

#### LILA-067 · Demo online en GitHub Pages
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-058, LILA-062, LILA-002
- Qué: build y deploy desde CI; README con "pruébalo en el navegador".
- Aceptación: la URL pública abre `examples/pedido`, simula y compara sin instalar nada.
- Archivos: `.github/workflows/pages.yml`.

#### LILA-068 · Round-trip de `lila:` en herramientas ajenas
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-060
- Qué: prueba manual documentada: abrir/guardar un .bpmn con `lila:` en Camunda Desktop Modeler (y Signavio/ADONIS si hay acceso); registrar resultado.
- Aceptación: `docs/BPMN_EXTENSION.md` registra qué herramientas conservan `lila:`; si alguna lo descarta, se abre el ticket del plan B (`annotations.json`).
- Archivos: `docs/BPMN_EXTENSION.md`.

#### LILA-069 · Rendimiento de la UI con diagramas grandes
- Épica E9 · Hito M5 · Tamaño S · Depende de LILA-057
- Qué: importar el BPMN más grande que tenga Brito; medir import y mover 100 elementos.
- Aceptación: sin bloqueos > 1 s; si los hay, ticket de seguimiento con perfil.
- Archivos: —

#### LILA-112 · Importar el diseño de Claude Design: tokens, temas y componentes
- Épica E9 · Hito M5 · Tamaño M · Depende de —
- Qué: leer el artefacto de Claude Design (URL que pasa Brito), extraer la tabla de tokens a `apps/web/src/theme/tokens.css` (variables CSS con los nombres exactos del brief `prompts/claude-design-ui.md`), `themes/eva-01.json` y `themes/papel.json`; convertir el inventario de componentes en la lista de componentes React a construir; guardar una captura de cada artboard en `docs/design/` como referencia visual. Los artboards son referencia, no código a copiar.
- Aceptación: todos los tokens del brief existen como variables CSS; cambiar el JSON de tema cambia la UI sin recompilar; hay captura de cada artboard en `docs/design/` y `docs/design/README.md` enlaza el artefacto.
- Archivos: `apps/web/src/theme/*`, `docs/design/*`

#### LILA-113 · Sistema de temas tipo VS Code
- Épica E9 · Hito M5 · Tamaño M · Depende de LILA-112, LILA-057
- Qué: `ThemeProvider` que aplica un tema JSON como variables CSS en `:root`; Eva-01 por defecto; selección persistida (userData en escritorio, localStorage en la demo); tipografía y densidad como tokens; el lienzo de bpmn-js, los marcadores y los overlays de simulación leen los tokens.
- Aceptación: cambiar de Eva-01 a Papel en caliente sin recargar; el lienzo y los overlays toman los colores del tema; un test verifica contraste AA del texto en ambos temas.
- Archivos: `apps/web/src/theme/ThemeProvider.tsx`, `themes/*.json`

#### LILA-114 · Ajustes → Apariencia: editor de tokens, tipografía, importar/exportar
- Épica E9 · Hito M5 · Tamaño L · Depende de LILA-113
- Qué: pantalla con lista de temas (integrados y del usuario), editor de tokens agrupados con selector de color y hex editable, tipografía (UI, mono, diagrama, tamaño base, densidad), vista previa en vivo, restablecer, exportar e importar JSON con el formato documentado en `docs/THEMES.md`.
- Aceptación: editar `accent.primary` se refleja al instante en la vista previa y en la app; exportar e importar el JSON reproduce el tema exacto; un JSON inválido se rechaza con mensaje claro.
- Archivos: `apps/web/src/settings/Appearance.tsx`, `docs/THEMES.md`

### E10 — App de escritorio con Electron (M5)

#### LILA-070 · `apps/desktop`: main, preload, IPC
- Épica E10 · Hito M5 · Tamaño M · Depende de LILA-057
- Qué: proceso principal (ventana, menú, `dialog` + `fs`, `open-file` en macOS y `argv` en Windows/Linux), `preload.ts` con `contextBridge` exponiendo `window.lila.{openFile, saveFile, readProject, recentFiles}`; carga el build de `apps/web`; `contextIsolation` y `sandbox` activos.
- Aceptación: `npm run dev:desktop` abre la app con el editor; abrir y guardar usan diálogos nativos.
- Archivos: `apps/desktop/main.ts`, `preload.ts`, `package.json`.

#### LILA-071 · `DesktopStore`
- Épica E10 · Hito M5 · Tamaño S · Depende de LILA-058, LILA-070
- Qué: implementación de `ProjectStore` sobre `window.lila`; carpeta de proyecto = proceso + escenarios + runs.
- Aceptación: abrir la carpeta `examples/pedido` lista el proceso y sus escenarios; guardar un escenario nuevo crea el archivo.
- Archivos: `apps/web/src/store/DesktopStore.ts`.

#### LILA-072 · electron-builder y asociación de `.bpmn`
- Épica E10 · Hito M5 · Tamaño M · Depende de LILA-070
- Qué: `electron-builder.json` (appId, productName, `fileAssociations` `.bpmn`, targets dmg | nsis | AppImage + deb), iconos; plantilla: el `electron-builder.json` de Camunda Desktop Modeler.
- Aceptación: en cada sistema, doble clic sobre un `.bpmn` abre la app con ese archivo.
- Archivos: `apps/desktop/electron-builder.json`, `resources/icons/*`.

#### LILA-073 · CI de escritorio en matriz macOS / Windows / Linux
- Épica E10 · Hito M5 · Tamaño M · Depende de LILA-072, LILA-002
- Qué: workflow que construye los tres instaladores desde el mismo commit y los publica como artefactos (y en releases con tag); sin firma por ahora (E19).
- Aceptación: un tag produce dmg, exe y AppImage/deb descargables.
- Archivos: `.github/workflows/desktop.yml`.

#### LILA-074 · Recientes, estado de ventana, arranque
- Épica E10 · Hito M5 · Tamaño S · Depende de LILA-070
- Qué: recientes y tamaño/posición de ventana en `userData`; abrir el último proyecto; medir arranque.
- Aceptación: la lista de recientes sobrevive al reinicio; la app abre en < 2 s en la máquina de Brito.
- Archivos: `apps/desktop/main.ts`.

### E11 — Release v1 (M5)

#### LILA-075 · README final
- Épica E11 · Hito M5 · Tamaño S · Depende de LILA-073, LILA-067, LILA-056
- Qué: qué es, descarga por sistema, demo online, `npx lila`, MCP en 3 líneas, marca de agua bpmn.io, instaladores sin firmar (cómo abrirlos), licencias de terceros, cómo contribuir.
- Aceptación: una persona nueva instala y simula el benchmark siguiendo solo el README.
- Archivos: `README.md`.

#### LILA-076 · Nota de licencias de terceros
- Épica E11 · Hito M5 · Tamaño S · Depende de —
- Qué: `THIRD_PARTY_LICENSES.md` (bpmn.io license con la cláusula de marca de agua, MIT de bpmn-moddle/bpmnlint/token-simulation/zod/react/vite/electron, etc.).
- Aceptación: cada dependencia de runtime aparece con su licencia.
- Archivos: `THIRD_PARTY_LICENSES.md`.

#### LILA-077 · Release 1.0.0
- Épica E11 · Hito M5 · Tamaño S · Depende de LILA-075, LILA-076, LILA-044
- Qué: tag, changelog, instaladores, `npm publish`, demo actualizada; `docs/BIZAGI_PARITY.md` con todo lo "MVP" marcado.
- Aceptación: release en GitHub con los tres instaladores y el paquete npm publicado.
- Archivos: `CHANGELOG.md`.

---

## Después de v1 (E12 → E19)

Tickets más gruesos a propósito: se desglosan cuando llegue su turno.

### E12 — Adaptadores y cobertura BPMN extra

#### LILA-078 · `lila import-qbp`
- Tamaño S · Depende de LILA-013, LILA-018
- Qué: BPMN con `qbp:processSimulationInfo` → `model.bpmn` + `scenario.json` (~150 líneas; XSD público; 182 muestras en GitHub).
- Aceptación: `financial.bpmn` (repo de Prosimos) importa y sus métricas caen dentro del IC95 del fixture de Prosimos.

#### LILA-079 · Import/export BPSim 2.0 (`.bpsim` independiente)
- Tamaño M · Depende de LILA-013
- Qué: mapeo 1:1 según la tabla de `SCENARIO_FORMAT.md`; solo cuando haya usuario de Sparx EA o convenga decir "compatible con BPSim".
- Aceptación: round-trip lila → bpsim → lila igual campo a campo.

#### LILA-080 · Export XLSX de resultados
- Tamaño S · Depende de LILA-062
- Qué: una hoja por tabla, una por escenario en what-if; solo si lo piden usuarios reales.

#### LILA-081 · Start quantity / completion quantity, boundary events, message/signal, event-based gateway
- Tamaño L · Depende de LILA-026
- Qué: uno por uno, cuando un usuario real lo pida; cada uno con su sección en `SEMANTICS.md` y su test.

#### LILA-082 · Calendarios mensuales/anuales, festivos y zona horaria
- Tamaño M · Depende de LILA-041
- Qué: activar los campos reservados; DST.

### E13 — Servidor self-hosted para intranet (M6; fase 7 del roadmap)

Consume el contrato por objeto de RM-01/RM-02. No es prerrequisito de E15 ni del repositorio
local. Conservar los IDs siguientes; ampliar REST, almacenamiento y RemoteStore a los objetos
del repositorio versión 3 y adjuntos. La aceptación incluye carpeta → servidor → carpeta sin pérdidas. Los tamaños
históricos de esta sección no estiman el alcance del repositorio.

#### LILA-083 · `packages/server` con REST `/api/v1`
- Tamaño L · Depende de LILA-029, LILA-038
- Qué: hono (o fastify) en Node; sirve la SPA compilada; endpoints de procesos, versiones, escenarios, runs, `simulate`, `compare`; OpenAPI generado.
- Aceptación: `lila run` contra el REST devuelve bytes idénticos a la corrida local con la misma semilla.

#### LILA-084 · Interfaz `Storage` con SQLite y PostgreSQL
- Tamaño L · Depende de LILA-083
- Qué: `process_versions(key, version_tag, bpmn_xml, created_at, author, status)`, `scenarios`, `runs`, `catalog_items`; tablas por elemento como índice derivado vía `parseBpmn`; migraciones.
- Aceptación: mismos tests de integración contra ambas implementaciones.

#### LILA-085 · Autenticación local
- Tamaño M · Depende de LILA-083
- Qué: usuarios y sesiones locales; roles mínimos (lector, editor, admin); OIDC/LDAP como ticket futuro cuando lo pida la primera empresa.
- Aceptación: un usuario sin sesión no ve nada; un lector no puede guardar.

#### LILA-086 · `RemoteStore` en la SPA
- Tamaño M · Depende de LILA-058, LILA-083
- Qué: implementación de `ProjectStore` contra el REST; selección de modalidad por configuración.
- Aceptación: el bundle de la SPA es el mismo artefacto que el de escritorio.

#### LILA-087 · MCP por HTTP con la misma autenticación
- Tamaño S · Depende de LILA-056, LILA-085
- Aceptación: un agente autenticado ejecuta las mismas tools contra el servidor.

#### LILA-088 · Docker y compose
- Tamaño S · Depende de LILA-084
- Qué: `Dockerfile` multi-stage, `docker-compose.yml` (server + postgres), variables de entorno documentadas.
- Aceptación: `docker compose up` en una máquina Linux limpia; dos usuarios en la misma red ven la misma lista de procesos; uno guarda una versión y el otro la ve al recargar.

### E14 — Versiones y gobierno del repositorio (#126; fase 7)

ORG-1 entrega primero el repositorio local. Estas tareas agregan historial y gobierno; una
etiqueta de versión editable no equivale a una versión publicada ni a una aprobación.

#### LILA-089 · Historial de versiones con `lila:versionTag`
- Depende de RM-01, RM-02; el historial local no depende de LILA-084.
- Qué: instantáneas identificables y lista de versiones; conservar la etiqueta ya implementada.
- Aceptación: recuperar una instantánea sin alterar el borrador ni sus escenarios; referencias
  entre versiones no se resuelven por nombre.

#### LILA-090 · Comparación semántica de versiones
- Depende de LILA-089.
- Qué: cambios en BPMN, documentación y relaciones; comparación de resultados por separado.
- Aceptación: mostrar alta/baja/cambio por ID y versión, distinguir cambio visual de semántico;
  no confundir AS-IS/TO-BE de escenarios con historial de modelos.

#### LILA-091 · Revisión, liberación y vigencia
- Depende de LILA-089, LILA-085, RM-18.
- Qué: borrador → revisión → publicación, vigencia, comentarios y portal; contrato en RM-17.
- Aceptación: editor propone, aprobador autorizado publica, lector ve la versión publicada;
  publicación inmutable con historial de decisiones y sin sobrescrituras silenciosas.

### E15 — Catálogo y RACI (#127; fases 1–3)

#### LILA-092 · Catálogo por objeto y editor
- Depende de RM-01, RM-02.
- Qué: `catalog/<tipo>/<id>.json` sustituye el `catalog.json` propuesto; tipos iniciales rol,
  unidad, sistema/aplicación y documento. Riesgos/controles/KPIs se activan en sus fases.
- Aceptación: crear/editar un objeto y compartirlo en dos procesos; renombrarlo actualiza sus
  apariciones; consulta de usos sin duplicar objetos por nombre.

#### LILA-093 · Selectores de referencias `lila:*Ref`
- Depende de LILA-092, RM-03.
- Qué: reutilizar las extensiones existentes con selectores tipados y enlaces al catálogo.
- Aceptación: guardar/abrir conserva IDs y extensiones ajenas; referencias importadas sin objeto
  permanecen visibles como no resueltas, sin inventar objetos.

#### LILA-094 · Matriz RACI agregada y exportación
- Depende de LILA-093, RM-04.
- Base existente: la matriz **por proceso** de #99 (`raciMatrix` en
  `packages/engine/src/process-document.ts`, `lila process raci`, `get_raci_matrix`), con roles
  como IDs `roleRef` sin catálogo y sin vista en la app.
- Qué: consultar responsabilidades de todo el repositorio y del catálogo; vista en la app,
  navegación y exportación.
- Aceptación: filas por actividad y roles con R/A/C/I; abrir actividad/rol desde la matriz;
  incluir elementos documentables fuera del perfil simulable.

#### LILA-095 · Calidad documental y referencias colgantes
- Depende de LILA-093, RM-03.
- Qué: avisos por falta de responsables, referencias no resueltas y objetos utilizados antes
  de borrarlos. No convertir documentación incompleta en error de simulación.
- Aceptación: diagnóstico identifica modelo/versión/elemento y navega al origen; borrar un objeto
  en uso no elimina referencias silenciosamente.

#### LILA-096 · Enlace entre roles y pools de simulación
- Depende de LILA-092, RM-10; fase 3.
- Qué: relación explícita de catálogo a configuración del escenario; contratos antes del código.
- Aceptación: asignar RACI no crea capacidad/coste/calendario; cambiar escenario no cambia la
  definición del rol; corridas conservan sus entradas reproducibles.

### E16 — MCP de modelado para agentes (#128; ampliación al repositorio en fase 8)

LILA-097–099 están cerrados por la épica de agentes #527: `create_process` (lista de pasos → BPMN
con `bpmn-auto-layout`, #97), `edit_process` (operaciones atómicas con dry-run, #98) y
`annotate_element` + `get_raci_matrix` por proceso (#99), también como `lila process
annotate|raci`. No se reabren. Lo pendiente de fase 8 es ampliarlos a objetos de catálogo y a
consultas del repositorio (usos, matriz agregada) cuando existan RM-03 y LILA-094: mismas
respuestas en API/MCP y UI para la misma revisión.

#### LILA-100 · Permisos de herramientas y auditoría
- Depende de LILA-085, RM-18.
- Qué: aplicar autorización de servidor también a herramientas y registrar modificaciones.
- Aceptación: un lector no escribe mediante MCP/REST; el log identifica actor y revisión.

### E17 — Asistencia IA y entrevistas (fase 8)

#### LILA-101 · Contratos `Finding` e `Interview`
- Depende de RM-01, RM-19.
- Qué: documentos con procedencia y referencias al modelo; distinguir propuestas de IA de
  hallazgos operativos de calidad y no duplicar sus identidades.
- Aceptación: cada afirmación extraída conserva fuente; importar/guardar no publica propuestas.

#### LILA-102 · Ingesta de entrevistas y extracción
- Depende de LILA-097, LILA-101.
- Qué: actividades, actores, sistemas, decisiones, tiempos y problemas como propuestas revisables.
- Aceptación: revisar diferencias antes de aplicar y mantener el vínculo con el fragmento fuente.

#### LILA-103 · Contradicciones y faltantes
- Depende de LILA-102.
- Aceptación: señalar fuentes en conflicto sin escoger una como hecho confirmado; registrar
  resolución humana y conservar datos faltantes como tales.

#### LILA-104 · Calidad del proceso y TO-BE sugerido
- Depende de LILA-055, RM-08.
- Aceptación: propuesta explícita de escenario/modelo con procedencia, sin sobrescribir AS-IS;
  resultados simulados identificados como tales, nunca presentados como observaciones reales.

### E18 — Process mining (fase 8; proceso Python separado)

#### LILA-105 · Importar XES/CSV observado
- Depende de RM-12, RM-20.
- Qué: mapeo explícito de actividades, casos, tiempo/unidades y procedencia; pm4py aislado en
  proceso separado, revisar obligaciones de licencia antes de distribuir (no inferir exención).
- Aceptación: fixture sintético con filas inválidas y faltantes produce diagnóstico trazable.

#### LILA-106 · Escenario observado
- Depende de LILA-105.
- Qué: llegadas, distribuciones empíricas y probabilidades con cobertura y supuestos declarados.
- Aceptación: no inventar datos ausentes ni modificar escenario base; reproducción desde fixture.

#### LILA-107 · Documentado frente a observado
- Depende de LILA-106, RM-12.
- Aceptación: alinear unidades, poblaciones y periodos antes de comparar; métricas incompatibles
  se explican, sin fabricar intervalos de confianza para datos que no los tienen.

#### LILA-108 · Adaptadores Simod/OCEL
- Depende de LILA-078, LILA-105, RM-20.
- Aceptación: contrato de mapeo, fixture, versiones probadas y pérdidas explícitas por adaptador;
  no afirmar interoperabilidad por compartir extensión de archivo.

### E19 — Distribución

#### LILA-109 · Firma y notarización (macOS con la cuenta Apple Developer de Brito; certificado Windows)
- Tamaño S · Depende de LILA-073
#### LILA-110 · Auto-update con electron-builder
- Tamaño S · Depende de LILA-109
#### LILA-111 · Evaluar Tauri si los ~150 MB del instalador se vuelven problema
- Tamaño S · Depende de —

## Roadmap organizacional — épicas locales ORG-1…ORG-9 (bajo #497)

**Lo siguiente está planeado, salvo las bases marcadas como existentes.** `ORG-*` y `RM-*` no son
issues de GitHub (E21–E26 ya lo son: ver arriba). Orden y matriz de referencia:
[roadmap](docs/es/ROADMAP.md). Empieza tras el Lote R (#527). Los contratos de fases futuras se
fijan al iniciar cada fase, no se inventan en el primer hito. Tamaños pendientes de desglosar; no
constituyen compromisos de fecha.

Lotes propuestos: **A0** RM-01 · **A1** RM-02, RM-03, RM-05, LILA-092, LILA-093, RM-14 (objetos
documento y bytes de adjuntos, obligatorios en A1 según el contrato § 5.1) · **A2** RM-04, RM-06,
LILA-094, LILA-095, RM-07, RM-08 · **A3** RM-09, RM-10, LILA-096 · **A4** RM-11 · **A5** RM-12,
RM-13 · después ORG-7 (fase 6), ORG-8/E13/E14 (fase 7) y ORG-9/E16–E18 (fase 8).

### ORG-1 — Repositorio local y compatibilidad (fase 1; lotes A0–A1)

Base existente: manifiesto v2 con `processes[]` y `processes/<slug>/` (#498, #521, #614;
`packages/engine/src/project/`, `docs/PROJECT_FORMAT.md` § Version 2), guardado v1 byte a byte con
un solo proceso, pestañas por proceso y escenarios/corridas por proceso.

#### RM-01 · Contrato del repositorio por objeto e identidad (lote A0)
- Depende de ADR-029; leer CONTRIBUTING y contratos antes de cambiar código.
- Hecho como `docs/REPOSITORY_CONTRACT.md` (+ `docs/es/`) y ADR-032, aceptada el 2026-10-14.
- Qué: definir la versión 3 del repositorio sobre la disposición v2 existente (ids de proceso,
  objetos de catálogo, adjuntos), referencias `{ process, element }` con `version` reservado,
  revisiones, list/read/write por objeto, adjuntos, límites y recuperación; conservar las reglas
  actuales de guardado v1/v2 y de slugs.
- Aceptación: fixtures v1/v2, colisiones de IDs, versión no soportada y fallo de guardado;
  decidir presupuestos de rendimiento con hardware y dataset sintético identificados.
- Superficies: formato de proyecto, tipos compartidos, ProjectStore y contratos IPC.

#### RM-02 · Almacén y contenedor por objeto
- Depende de RM-01.
- Ya existe: lector/escritor v2 de varios procesos (carpeta y `.lila`), abrir v1 sin reescribir.
- Qué: `ProjectStore` por objeto con carga diferida (hoy la sesión guarda el `ProjectDocument`
  entero), navegador con persistencia apta para objetos/bytes (IndexedDB), IPC de escritorio por
  objeto solo si fallan los presupuestos (A1 puede mantener el documento entero sin bytes de
  adjuntos ni entradas conservadas, contrato § 5.1);
  lectura/escritura de `catalog/` sin descartarlo como entrada desconocida.
- Aceptación: los casos v1/v2 actuales siguen idénticos byte a byte (más las entradas
  desconocidas, que ahora se conservan, contrato § 1.4); un repositorio con catálogo (versión 3)
  se guarda y reabre en web/escritorio; fallos no destruyen la última versión recuperable.

#### RM-03 · Índice de identidad, relaciones y usos
- Depende de RM-01, RM-02.
- Qué: reconstruir índice derivado; relaciones inversas y resolución contextual de referencias.
- Aceptación: mismo ID BPMN en dos modelos no colisiona; mover carpetas no rompe enlaces;
  advertir referencias faltantes y borrar objetos utilizados sin pérdidas silenciosas.

#### RM-04 · Lectura documental y comandos comunes
- Depende de RM-01, RM-02.
- Qué: proyección del BPMN completo, incluidas construcciones no simulables; comandos semánticos
  de edición y transacciones de lote compartidos por diagrama, tabla y futuras herramientas.
- Aceptación: preservar extensiones ajenas, identidad y undo/redo; lote inválido no deja cambios
  parciales; documentación no depende de ejecutar ni validar el perfil de simulación.

#### RM-05 · Explorador y sesión de repositorio
- Depende de RM-02, RM-03, LILA-092.
- Ya existe: pestañas del lienzo, una por proceso, con crear/renombrar/borrar.
- Qué: explorador de procesos y objetos, carpetas, búsqueda y propietarios/metadatos por modelo.
- Aceptación: abrir dos procesos, cambiar pestaña y guardar sin cruzar escenarios, selección ni
  resultados; indicadores de cambios pendientes y recuperación comprobados.

### ORG-2 — Vista tabular editable (fase 2; lote A2)

#### RM-06 · Tabla de elementos y objetos
- Depende de RM-04, LILA-093.
- Qué: filtros, columnas configurables, navegación al diagrama/objeto, edición múltiple y
  exportación CSV/XLSX; propiedades no aplicables indicadas como tales.
- Aceptación: editar documentación/nombre/referencias y deshacer desde cualquiera de las vistas;
  exportación corresponde a filtros y columnas; teclado y catálogos EN/ES completos.

### ORG-3 — Insights, indicadores y mejora (fases 2 y 5; lotes A2 y A5)

#### RM-07 · Insights iniciales por proceso y objeto
- Depende de RM-03, LILA-094, LILA-095.
- Qué: responsabilidades, documentos/entradas/salidas, sistemas, usos y avisos de datos faltantes.
- Aceptación: widgets derivados, sin segunda copia editable; cada fila abre su origen; un objeto
  renombrado aparece actualizado en los dos procesos del caso sintético.

#### RM-08 · Aceptación integrada del primer hito
- Depende de RM-05, RM-06, RM-07, RM-14.
- Qué: ejecutar el caso de seis pasos del roadmap en web y escritorio con datos sintéticos.
- Aceptación: conservar adjuntos, referencias, escenarios y corridas al cerrar/reabrir; tests de
  identidad, errores, idiomas/teclado y presupuestos de RM-01; regresiones del motor/CLI/MCP verdes.

#### RM-12 · KPIs, madurez y paneles organizacionales
- Depende de RM-07, RM-11; fase 5.
- Qué: contrato de indicadores/metas/mediciones y paneles; distinguir manual, simulado y observado,
  fuente, fecha, unidades, población y vigencia. Clasificación, madurez y potencial de mejora.
- Aceptación: sin dato no equivale a cero; mostrar resultados antiguos como tales; navegar de
  indicador agregado a evidencia; ninguna métrica deducida se etiqueta como observada.

#### RM-13 · Dependencias y mejora continua
- Depende de RM-09, RM-12.
- Qué: análisis de impacto, objetivos, iniciativas, etiquetas/temas, SIPOC, Ishikawa y seguimiento;
  definir contratos por tipo antes de implementar cada análisis.
- Aceptación: cambio de aplicación enumera procesos afectados; una iniciativa enlaza objetivo,
  evidencia y comparación TO-BE sin alterar el AS-IS.

### ORG-4 — Mapas de procesos y organización (fase 3; lote A3)

#### RM-09 · Mapas y navegación jerárquica
- Depende de RM-03, RM-05.
- Qué: contrato versionado de mapas y registro extensible de tipos/relaciones; macroprocesos,
  cadenas de valor y navegación hasta BPMN. Separar objeto y aparición gráfica.
- Aceptación: mover una aparición no duplica el proceso; navegación por ID sobrevive renombrado;
  detectar jerarquías cíclicas y destinos ausentes, sin bucles de navegación.

#### RM-10 · Organización y recursos compartidos
- Depende de RM-09, LILA-092.
- Qué: organigramas, unidades, roles, puestos, personas, colaboradores externos, recursos y
  centros de coste; enlaces a tareas/procesos y consulta de responsabilidades.
- Aceptación: un recurso compartido conserva identidad y usos; reorganizar unidades no reasigna
  silenciosamente tareas ni modifica capacidades de escenarios.

### ORG-5 — Riesgos, controles y cumplimiento (fase 4; lote A4)

#### RM-11 · Catálogo, mapas y evaluaciones de riesgos/controles
- Depende de RM-09, RM-10, RM-14.
- Qué: contrato de riesgos, agrupaciones, controles, objetivos de control, requisitos, responsables,
  evidencias y tratamientos; mapas y matriz de calor con escala explícita e inherente/residual.
- Aceptación: proceso → riesgo → control → dueño/evidencia; reportar cobertura faltante y valoración
  ausente; control asociado no reduce automáticamente el riesgo; evaluación conserva fecha/fuente.
- Dividir en tickets de contrato, catálogo, vistas y evaluación antes de programar.

### ORG-6 — Documentación y archivos (fases 1–2; publicación en fase 7)

#### RM-14 · Documentos y adjuntos portables
- Depende de RM-01, RM-02, LILA-093.
- Qué: metadatos, propietario, tipo, entradas/salidas/referencias y archivos gestionados;
  representación de bytes y límites definidos en RM-01.
- Aceptación: archivo → carpeta → archivo conserva bytes y referencias; archivo faltante o límite
  excedido produce diagnóstico recuperable; no aplicar el descarte de entradas desconocidas a
  las entradas soportadas de la versión 3.

#### RM-15 · Publicación documental y portal
- Depende de LILA-091, RM-14.
- Qué: documentos de proceso con diagramas, responsabilidades, entradas/salidas y referencias;
  exportación PDF/Word/HTML y portal de consulta de versiones aprobadas.
- Aceptación: salida identifica versión/vigencia; referencias navegables y maquetación verificadas;
  usuario lector no accede a borradores sin permiso.

### ORG-7 — Familias de modelos complementarios (fase 6)

#### RM-16 · Tipos de modelos y contratos incrementales
- Depende de RM-09, RM-11, RM-13.
- Qué: entregar por familias: documentos; TI (aplicación/servicio/interfaz/operación/nodo);
  productos/componentes; datos (entidad/atributo); casos de uso/actores; decisiones, datos de
  entrada y fuentes/modelos de conocimiento; colaboración/comunicación y modelos transversales.
- Aceptación: cada familia tiene contrato y fixture antes de implementarse; un objeto se reutiliza
  entre BPMN y mapa sin duplicación; referencias y disposición sobreviven guardar/abrir.
- DMN requiere ADR de estándar antes de código; modelar decisiones no implica ejecutarlas.

### ORG-8 — Colaboración y calidad operativa (fase 7)

#### RM-17 · Contratos de liberación y colaboración
- Depende de RM-01, RM-03, LILA-089.
- Qué: fijar estados/transiciones, revisiones inmutables, permisos y conflictos; precisar CRDT
  propuesto en ADR-029 antes de construir colaboración en tiempo real.
- Aceptación: casos documentados de cambios simultáneos, aprobación sobre versión antigua,
  comentarios y restauración; ninguna escritura pierde trabajo silenciosamente.

#### RM-18 · Servidor, autorización y colaboración
- Depende de RM-17, LILA-083, LILA-084, LILA-085, LILA-086.
- Qué: permisos sobre objetos/acciones, comentarios, auditoría, avisos y colaboración según contrato.
- Aceptación: dos usuarios editan con conflictos gestionados; accesos UI/REST/MCP coherentes;
  restauración y exportación carpeta → servidor → carpeta sin pérdidas.

#### RM-19 · Registros de calidad
- Depende de RM-18, RM-11.
- Qué: auditorías, hallazgos, no conformidades y CAPA con dueño, fechas, estado y enlaces al diseño.
- Aceptación: trazabilidad y notificaciones; registros no cambian la versión publicada del modelo;
  opción local, si se ofrece, conserva advertencia de concurrencia de ADR-029.

### ORG-9 — Integraciones y observaciones (fase 8)

#### RM-20 · Contratos de intercambio y conectores
- Depende de RM-12, LILA-099, LILA-100.
- Qué: import/export de repositorio, conectores de indicadores observados, API/MCP, mapeos y
  adaptadores a motores de workflows externos; documentar cobertura por formato/proveedor.
- Aceptación: fixture sintético por adaptador, unidades/IDs/versiones probadas y pérdidas
  explícitas; errores no modifican parcialmente el repositorio; ningún motor operativo propio.
