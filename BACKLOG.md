# Lila Modeler — Backlog (épicas y tickets)

Fecha: 2026-09-03. Complementa `LILA_MODELER_ESTRUCTURA.md` (decisiones, diseño, hitos). Aquí está el trabajo desglosado para que agentes y personas sepan qué hacer, en qué orden y cuándo está terminado.

**Dónde se gestiona**: en GitHub Issues del repo privado `AlambritoDito/lila-modeler`. El número de issue coincide con el id del ticket (`LILA-026` = `#26`); las 20 épicas son los issues `#112`–`#131` con su lista de tareas; los hitos M0–M6 son milestones. Este archivo es la fuente que generó los issues; si cambia el alcance, se edita aquí y se actualiza el issue, no al revés.

**Convenciones**

- `LILA-nnn` es el id del ticket. Las épicas son `E0`…`E19`. Los hitos `M0`…`M6` son los de la sección 7 del documento de estructura.
- Cada ticket tiene: qué, aceptación (la prueba que lo cierra), de qué depende, tamaño (S ≤ medio día, M ≤ 2 días, L ≤ 1 semana) y archivos que toca.
- **Reglas para agentes**: (1) leer `docs/SEMANTICS.md`, `SCENARIO_FORMAT.md` y `RESULTS_FORMAT.md` antes de tocar el motor; (2) `packages/engine/src/core/` no importa nada fuera de `core/` (ni `bpmn-moddle`, ni `node:*`, ni React); (3) ningún ticket cierra sin su prueba de aceptación en verde; (4) nombres de columna de resultados = los de Bizagi (ver `docs/BIZAGI_PARITY.md`); (5) todo tiempo en segundos, dinero en `run.currency`; (6) el `id` BPMN es la única clave; nunca el nombre.
- **v1 = "como Bizagi"**: épicas E0–E11 (hitos M0–M5). **Después**: E12–E19.
- **Cuándo arranca la UI**: la épica E9 puede correr como workstream paralelo a M2/M3 en cuanto cierre M1 (`simulate` y `lila run` existen), empezando por LILA-112 (importar el diseño) y LILA-057 (shell con bpmn-js). Resultados, comparar y overlay (LILA-062…064) esperan a M2; el panel de escenario (LILA-061) conviene después de M3; Electron (E10) al final.

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
- Épica E4 · Hito M2 · Tamaño M · Depende de LILA-026
- Qué: `resources[pool] = {capacity, costPerHour, fixedCost, calendar?}`; cola FIFO por `enabledAt` con desempate por `seq`; `enabled/started/ended` por token.
- Aceptación: M/M/1 ρ = 0,8, 30 replicaciones ⇒ espera media dentro del 3 % de la fórmula y utilización 0,80 ± 0,02.
- Archivos: `packages/engine/src/core/sim.ts`, `resources.ts`.

#### LILA-034 · Asignación AND multi-pool atómica
- Épica E4 · Hito M2 · Tamaño M · Depende de LILA-033
- Qué: la tarea arranca cuando todos los pools tienen capacidad simultáneamente; sin retención parcial.
- Aceptación: 100 000 casos con dos pools en orden adverso de ids no producen deadlock; costos por pool correctos.
- Archivos: `packages/engine/src/core/resources.ts`.

#### LILA-035 · Selección OR de recursos
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-033
- Qué: encolar en todos los pools alternativos, arrancar con el primero disponible, retirar de los demás.
- Aceptación: con un pool saturado y otro libre, todas las tareas OR arrancan sin esperar; el log registra el pool usado.
- Archivos: `packages/engine/src/core/resources.ts`.

#### LILA-036 · Métricas de nivel 3
- Épica E4 · Hito M2 · Tamaño M · Depende de LILA-033, LILA-028
- Qué: `resourceWait` min/max/mean/sd/total por elemento; `queueLength` mean/max (ponderada por tiempo); por recurso utilización, busyTime, fixedCost, unitCost, totalCost; por proceso waitTime, costPerCase, totalCost; `bottlenecks` (ranking por `resourceWait.total`, desempate por utilización).
- Aceptación: M/M/3 dentro del 3 % de Erlang-C; `totalCost = Σ fijo × usos + Σ hora × horas ocupadas` verificado desde el log; el ranking del benchmark señala al pool saturado.
- Archivos: `packages/engine/src/core/metrics.ts`.

#### LILA-037 · Event log completo y CSV en streaming
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-033, LILA-029
- Qué: filas `{replication, caseId, elementId, resourceId, enabledAt, startedAt, endedAt, resourceWait, offHoursWait, cost}` por callback; `toCsv` con timestamps ISO desde `run.start`; desactivable.
- Aceptación: `lila run --csv out/` escribe `log.csv` sin cargar todo en memoria; 30 × 10 000 casos no superan 200 MB de RAM en Node.
- Archivos: `packages/engine/src/core/run.ts`, `csv.ts`.

#### LILA-038 · `compare(results[])`
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-036, LILA-027
- Qué: tabla lado a lado por elemento/recurso/proceso, deltas absolutos y relativos, marca de significancia si los IC95 no se solapan.
- Aceptación: AS-IS vs TO-BE 3 cajeros marca como significativa la reducción de espera en `Task_TomarPedido` y no la de `Task_Preparar`.
- Archivos: `packages/engine/src/core/compare.ts`.

#### LILA-039 · Regresión de degradación (sin recursos)
- Épica E4 · Hito M2 · Tamaño S · Depende de LILA-033
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

#### LILA-048 · Publicación en npm y `npx lila`
- Épica E6 · Hito M3 · Tamaño S · Depende de LILA-046, LILA-047, LILA-044
- Qué: `@lila/engine` con `bin: lila`, `exports` (`.`, `./bpmn`, `./schema`), `files`, versión 0.x; publicación desde CI con tag.
- Aceptación: en una máquina limpia con Node 22, `npx @lila/engine run …` funciona.
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
- Aceptación: "simula examples/pedido con as-is y dime el cuello de botella" devuelve el mismo `bottlenecks[0]` que `lila run`; "qué pasa si agrego un cajero" produce un escenario con `extends` y una comparación coherente, sin cambios en `@lila/engine`.
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
- Qué: `worker.ts` importa `@lila/engine` core y ejecuta `simulate`; progreso, cancelación, muestreo del log (solo primera replicación en memoria).
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

### E13 — Servidor self-hosted para intranet (M6)

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

### E14 — Repositorio y versiones

#### LILA-089 · Versiones con `lila:versionTag` y lista de versiones
- Tamaño M · Depende de LILA-084
#### LILA-090 · Comparar versiones (diff XML + `compare()` de resultados)
- Tamaño M · Depende de LILA-089
#### LILA-091 · Flujo de liberación (Draft → Released → Valid until), comentarios, búsqueda
- Tamaño L · Depende de LILA-089

### E15 — Catálogo y RACI

#### LILA-092 · `catalog.json` y editor de catálogo (roles, sistemas, documentos, riesgos, controles, KPIs)
- Tamaño M · Depende de LILA-060
#### LILA-093 · Referencias `lila:*Ref` con selector desde el catálogo en el panel de propiedades
- Tamaño S · Depende de LILA-092
#### LILA-094 · Matriz RACI (consulta sobre IR × responsabilidades) y export
- Tamaño M · Depende de LILA-093
#### LILA-095 · Lint "actividad sin responsable" y referencias colgantes
- Tamaño S · Depende de LILA-093
#### LILA-096 · Pools de recursos del escenario referenciando roles del catálogo
- Tamaño S · Depende de LILA-092

### E16 — MCP de modelado para agentes

#### LILA-097 · `create_process_draft` (IR mínimo → .bpmn con `bpmn-auto-layout`)
- Tamaño M · Depende de LILA-053
#### LILA-098 · `create_activity`, `connect_elements`, `create_gateway`, `delete_element`, `rename`
- Tamaño M · Depende de LILA-097
#### LILA-099 · `annotate_element` (documentation, RACI, refs) y `get_raci_matrix`
- Tamaño S · Depende de LILA-022, LILA-094
#### LILA-100 · Permisos por tool (`process:read`, `process:write`, `simulation:run`, …) y audit log
- Tamaño M · Depende de LILA-085

### E17 — Asistencia IA y agente de entrevistas

#### LILA-101 · `Finding` e `Interview` como documentos JSON en `processes/<clave>/findings/`
- Tamaño S
#### LILA-102 · Ingesta de transcripciones y extracción (actividades, actores, sistemas, decisiones, tiempos, dolores)
- Tamaño L · Depende de LILA-097, LILA-101
#### LILA-103 · Detección de contradicciones entre entrevistas y solicitud de faltantes
- Tamaño M · Depende de LILA-102
#### LILA-104 · Revisión de calidad del proceso y TO-BE sugerido como escenario con `extends`
- Tamaño M · Depende de LILA-055

### E18 — Process mining (proceso Python separado, AGPL aislado)

#### LILA-105 · `mining/` con pm4py: importar XES/CSV con las columnas del event log de Lila
- Tamaño M
#### LILA-106 · Descubrimiento ligero de escenario observado (llegadas, empíricas por actividad, probabilidades de gateway)
- Tamaño L · Depende de LILA-105
#### LILA-107 · "Documentado vs observado" con el mismo `compare()`; desviaciones y rework
- Tamaño M · Depende de LILA-106
#### LILA-108 · Puente opcional a Simod y salida OCEL 2.0
- Tamaño M · Depende de LILA-078, LILA-105

### E19 — Distribución

#### LILA-109 · Firma y notarización (macOS con la cuenta Apple Developer de Brito; certificado Windows)
- Tamaño S · Depende de LILA-073
#### LILA-110 · Auto-update con electron-builder
- Tamaño S · Depende de LILA-109
#### LILA-111 · Evaluar Tauri si los ~150 MB del instalador se vuelven problema
- Tamaño S · Depende de —
