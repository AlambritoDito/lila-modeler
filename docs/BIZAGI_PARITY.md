# Checklist de paridad con Bizagi

Fuente: `LILA_MODELER_ESTRUCTURA.md`, sección 3 ("Checklist de paridad con Bizagi"). Esta tabla es una copia de esa sección con una columna `Estado` añadida para seguimiento de implementación; el contenido de las columnas `Capacidad`/`Bizagi`/`Lila`/`Hito` es el mismo que en el documento de estructura, que sigue siendo la fuente de verdad — ante cualquier discrepancia entre este archivo y `LILA_MODELER_ESTRUCTURA.md`, gana el documento de estructura y este archivo se corrige para reflejarlo, nunca al revés.

Fuente de la comparación original: ayuda oficial de Bizagi (niveles 1–4, escenarios, elementos no soportados), verificada el 2026-09-03. Bizagi no expone "4 niveles" en el motor: son qué parámetros están rellenos. Lila no reproduce los niveles como concepto de producto; el motor degrada: sin recursos ⇒ capacidad infinita, sin calendario ⇒ 24×7.

`Estado` refleja el estado de implementación en el repositorio, no el de este documento. Se actualiza fila por fila conforme cada capacidad queda implementada y probada (ver la prueba de aceptación del hito correspondiente en la sección 7 de `LILA_MODELER_ESTRUCTURA.md`), y lleva entre paréntesis los tickets que la cierran.

La paridad **numérica** contra las corridas publicadas por Bizagi se comprueba en
`packages/engine/test/bizagi-parity.test.ts` (LILA-044), que simula los cuatro ejemplos de
`examples/bizagi-levels` y compara cada número que `expected.json` cita de la página oficial con
tolerancia ±5 %. Lo que hoy no cuadra está en la sección **Diferencias documentadas** del final,
con su causa y su número: ninguna de esas diferencias se ha cerrado ajustando un parámetro del
escenario publicado.

| Capacidad | Bizagi | Lila | Hito | Estado |
|---|---|---|---|---|
| Start/End none, task (todas las variantes), sequence flow | ✓ | ✓ | M1 | Implementado (LILA-018, LILA-021, LILA-026) |
| Exclusive gateway con % por flujo (reparto equitativo por defecto) | ✓ | ✓ | M1 | Implementado (LILA-026); paridad verificada en el nivel 1 ([test](../packages/engine/test/bizagi-parity.test.ts)) |
| Inclusive gateway con % independientes | ✓ | ✓ | M1 | Implementado (LILA-026) |
| Parallel gateway fork/join | ✓ | ✓ | M1 | Implementado (LILA-026); paridad verificada en la rama Red de los niveles 2–4 |
| Subproceso embebido (aplanado); reusable = tarea con tiempo global | ✓ | ✓ | M1 | Implementado (LILA-019) |
| Timer intermedio como retardo | ✓ | ✓ | M1 | Implementado (LILA-026) |
| Llegadas: max arrival count + intervalo (constante o distribución) | ✓ | ✓ | M1 | Implementado (LILA-026). `triggerCount` sin `interTriggerTimer` = N llegadas en `t = 0`, como el nivel 1 de Bizagi (R-ARR-1, LILA-186); ver diferencia D1 |
| Processing time por tarea/evento, constante o distribución | ✓ | ✓ | M1 | Implementado (LILA-026); paridad verificada en el nivel 2 |
| Distribuciones: las 13 de BPSim 2.0 + constante + empírica | ✓ (subconjunto no documentado) | ✓ todas | M1 | Implementado (LILA-025) |
| Escenario: nombre, descripción, autor, versión, inicio, duración, unidad de tiempo, moneda, replicaciones, semilla | ✓ | ✓ (+ `warmup`, `extends`) | M1 | Implementado (LILA-013, LILA-014) |
| Parada: duración o max arrival count, lo primero | ✓ | ✓ | M1 | Implementado (LILA-026); paridad verificada (la corrida oficial drena sus 2017 casos, ver D4) |
| Recursos: tipo rol/equipo, disponibilidad, costo fijo por token, costo por hora | ✓ | ✓ | M2 | Implementado (LILA-033); paridad verificada en el nivel 3 ([test](../packages/engine/test/bizagi-parity.test.ts)): utilización de los seis recursos y costo de cuatro de ellos; los dos vehículos no cuadran por D8 |
| Asignación a tarea: uno o varios recursos, cantidad, AND / OR | ✓ | ✓ | M2 | Implementado (LILA-034, LILA-035) |
| Costo fijo por actividad | ✓ | ✓ | M2 | Implementado (LILA-036); paridad verificada en el nivel 3 (8057,6 contra 8063 publicados, −0,07 %) |
| Salidas por elemento: started, completed, tiempo min/max/avg/total, espera min/max/avg/std/total, costo fijo | ✓ | ✓ mismos nombres de columna | M2 | Implementado (LILA-036); nombres de columna revisados contra `RESULTS_FORMAT.md`. La paridad numérica que hay probada es la del **proceso** y la de los recursos del nivel 3 (ver D6 para el caso saturado); las columnas por elemento no están ancladas fila por fila |
| Salidas por recurso: utilización %, costo fijo, costo unitario, costo total | ✓ | ✓ | M2 | Implementado (LILA-036); paridad verificada en el nivel 3 (nurse 69,65 % contra 69,75 % publicado) |
| Calendarios: recurrencia, hora de inicio, duración, vigencia; matriz recurso × calendario con calendario por defecto | ✓ | ✓ semanal en v1; mensual/anual y festivos reservados | M3 | Implementado (LILA-040, LILA-041) **con salvedad**: falta capacidad por turno dentro de un mismo pool (LILA-164), sin la cual el nivel 4 no cuadra; ver D7 |
| What-if: varios escenarios, lado a lado, diferencias resaltadas | ✓ | ✓ (`lila compare`) | M3 | Implementado (LILA-038, LILA-047) |
| Replicaciones (recomiendan 30) | ✓ solo en what-if | ✓ siempre, con IC 95 % | M2 | Implementado (LILA-027) |
| Export de resultados | Excel | CSV (Excel lo abre; XLSX después si lo piden) | M2 | Implementado (LILA-037, LILA-046) |
| Importar `.bpmn` exportado por Bizagi | — | ✓ solo diagrama: Bizagi **no exporta** parámetros de simulación (verificado en 5 archivos reales, solo colores en `bizagi:`) | M0 | Implementado (LILA-020) |
| **Extras que Bizagi no da** | | | | |
| p50/p90/p95 de ciclo y espera | ✗ | ✓ | M2 | Implementado (LILA-028) |
| Longitud de cola media/máx por actividad | ✗ | ✓ | M2 | Implementado (LILA-036) |
| Throughput por hora, costo por caso | ✗ | ✓ | M2 | Implementado (LILA-028) |
| Ranking de cuellos de botella | ✗ | ✓ | M2 | Implementado (LILA-036) |
| Event log por caso (CSV; XES después) | ✗ | ✓ | M2 | Implementado (LILA-037) |
| Espera fuera de horario separada de espera por recurso | ✗ (queja: "poca granularidad") | ✓ | M3 | Implementado (LILA-041); es justo la métrica que delata la diferencia D7 del nivel 4 |
| Determinismo por semilla, byte a byte | parcial | ✓ | M1 | Implementado (LILA-030, LILA-039, LILA-043) |
| macOS / Linux / navegador | ✗ (4.3 sigue Windows-only, sin editor web) | ✓ | M5 | Pendiente (shell web en LILA-057 y worker en LILA-059; empaquetado en M5) |
| **Después** | | | | |
| Animación con contadores en vivo | ✓ | token-simulation (MIT) cubre la parte didáctica; contadores DES en vivo no son prioridad | — | No planificado (v1) |
| Start quantity / completion quantity | ✓ | reservado | — | No planificado (v1) |
| Message/signal/link events, boundary events, event-based gateway | parcial | error de validación explícito hasta que un usuario lo pida | — | No planificado (v1) |
| Parámetros desde event logs (Bizagi 4.0 process mining) | ✓ | fase minería (proceso Python separado) | — | No planificado (v1) |
| **No** (Bizagi tampoco los simula) | | | | |
| Multi-instancia, complex gateway, choreography/conversation, transaccional, ad-hoc; leer `.bpm` propietario | ✗ | ✗ | — | Fuera de alcance |

---

## Diferencias documentadas (LILA-044, corregidas en LILA-187)

`packages/engine/test/bizagi-parity.test.ts` simula `examples/bizagi-levels/level-{1..4}` **tal
cual están committeados** y compara, con tolerancia ±5 %, cada número que su `expected.json` cita
de la página oficial. Hasta LILA-187 el test tenía dos mitades —las réplicas publicadas, que no
cuadraban, y la misma comparación sobre un fixture aparte con la topología del diagrama oficial—
porque LILA-044 tenía prohibido tocar los ejemplos. LILA-187 llevó esa topología, las
probabilidades del gateway y las llegadas constantes a los propios `model.bpmn` y `scenario.json`,
así que la segunda mitad y su fixture desaparecieron: hoy hay una sola tabla.

Cada fila del test asegura de qué lado de la tolerancia está su número. Si una fila cambia de lado,
el test se pone rojo y hay que actualizar el test y esta sección a la vez.

### Resultado

Medido con 30 replicaciones en el test (los `scenario.json` publicados siguen en 1: las
replicaciones son una técnica de medición del test, no un parámetro de los ejemplos).

| Nivel | Número publicado | Lila | Causa |
|---|---|---|---|
| 1 | 1000 tokens creados y completados | 1000 (0 %) | — |
| 1 | rama Red (50 %) = 483 | 498,9 (+3,3 %) | — |
| 1 | rama Yellow (30 %) = 315 | 298,1 (−5,4 %) | D2 |
| 1 | rama Green (20 %) = 202 | 203,0 (+0,5 %) | — |
| 1 | ramas contra `1000 × p` (500 / 300 / 200) | −0,23 % / −0,63 % / +1,52 % | — |
| 2 | 2017 instancias iniciadas y completadas | 2017 (0 %) | — |
| 2 | ciclo mín 16 min | 16 min (0 %) | — |
| 2 | ciclo máx 33 min | 33 min (0 %) | — |
| 2 | ciclo medio 25 min 3 s | 25 min 4 s (+0,06 %) | — |
| 3 | ciclo mín 16 min (3 enf.) | 16 min (0 %) | — |
| 3 | ciclo máx 35 min (3 enf.) | 33,1 min (−5,3 %) | D5 |
| 3 | ciclo medio 25 min 15 s (3 enf.) | 25 min 4 s (−0,74 %) | — |
| 3 | utilización nurse 69,75 % (3 enf.) | 69,65 % (−0,14 %) | — |
| 3 | utilización nurse 99,85 % (2 enf.) | 99,72 % (−0,13 %) | — |
| 3 | ciclo mín 16 min (2 enf.) | 16,07 min (+0,42 %) | — |
| 3 | ciclo máx 10 h 57 min (2 enf.) | 665,8 min (+1,34 %) | — |
| 3 | ciclo medio 3 h 39 min 38 s (2 enf.) | 271,3 min (+23,5 %) | D6 |
| 3 | costo fijo de actividades 8063 | 8057,6 (−0,07 %) | — |
| 3 | costo `Call center agent` 6051 | 6051,0 (0 %) | — |
| 3 | costo `Nurse` 15 115 | 15 101,5 (−0,09 %) | — |
| 3 | costo `Ambulance` 30 314,13 | 30 232,8 (−0,27 %) | — |
| 3 | costo `Receptionist` 3018 | 3009,9 (−0,27 %) | — |
| 3 | costo `Quick attention vehicle` 11 139,86 | 10 907,9 (−2,08 %) | — |
| 3 | costo `Basic ambulance` 9844,65 | 10 234,6 (+3,96 %) | — |
| 4 | ciclo medio 25 min 26 s, con pools por turno | 84,4 min (+232 %) | D7 |
| 4 | Arrive BA espera máx 15 min, con pools por turno | 13,3 min (−11,1 %) | D7 |
| 4 | Arrive BA espera media 0,74 min, con pools por turno | 0,30 min (−59,1 %) | D7 |
| 4 | ciclo medio 25 min 26 s, con **un pool por rol** | 25 min 4 s (−1,45 %) | prueba de D7 |
| 4 | Arrive BA espera media 0,74 min, con **un pool por rol** | 0 (−100 %) | D7 (pide LILA-164) |

Los niveles 1, 2 y 3 cuadran dentro del ±5 % salvo los dos residuos documentados (D5 y D6, ambos
del nivel 3). El nivel 4 entero está pendiente de LILA-164.

### Causas

**D1 — `triggerCount` sin `interTriggerTimer` (resuelta en LILA-186).** Era un hueco del contrato
de Lila, no un desajuste con Bizagi: R-ARR-1 solo generaba casos en un `start` **con**
`interTriggerTimer`, así que el nivel 1 (max arrival count 1000 y ningún campo de tiempo, porque el
nivel 1 no los habilita) salía con cero llegadas y el aviso `W-START-SIN-LLEGADAS`. R-ARR-1 dice
ahora que `triggerCount` sin `interTriggerTimer` equivale al default `constant 0`, es decir N
llegadas en `t = 0`, que es lo que hace Bizagi. El aviso queda para el `start` que no declara
ninguno de los dos campos.

**D2 — la rama del 30 % contra una corrida única de Bizagi.** Los tres conteos publicados
(483 + 315 + 202) son una sola corrida de 1000 tokens; el 315 se desvía por sí mismo un +5 % de su
propia probabilidad configurada (30 %). Contra `1000 × p`, que es lo que de verdad valida el nivel
1, las tres ramas cuadran (−0,23 %, −0,63 %, +1,52 %). Anotado además: `level-1/expected.json`
etiquetaba los tres conteos como `green`/`yellow`/`red` **al revés** (corregido en LILA-187). La
prosa de la página solo da la suma «(483+315+202)», pero la tabla de resultados que la acompaña
([processvalidation42.png](https://help.bizagi.com/platform/en/processvalidation42.png)) los publica
fila por fila: «Red Triage end 483 · Yellow Triage end 315 · Green Triage end 202». La corrida rota
([processvalidation43.png](https://help.bizagi.com/platform/en/processvalidation43.png)) confirma la
lectura: «Red Triage end 1006 · Yellow Triage end 311 · Green Triage end 186», y el 1006 solo puede
ser la rama del Parallel Gateway sin convergencia.

**D3 — la topología reconstruida de los niveles 2–4 no era la del diagrama oficial (resuelta en
LILA-187).** `examples/bizagi-levels/level-{2,3,4}/model.bpmn` reconstruía el «Emergency attendance
process» como siete tareas en secuencia con un XOR de vehículo al final. El diagrama de la página
(`simulationexample2.png`, el mismo proceso en los cuatro niveles), que es el que reproducen hoy
los cuatro `model.bpmn`, es:

```
Recieve Emergency Report (4 min) → Classify Triage (5 min) → XOR "Triage type"
  ├ Red    50 % → AND ( Manage patient entry 11 min ‖ Pick up patient 20 min ) → Authorize Entry 4 min → fin
  ├ Yellow 30 % → Arrive at patient place QAV  7 min → fin
  └ Green  20 % → Arrive at patient place BA  10 min → fin
```

Consecuencias medidas: con la secuencia hay un solo camino de 51–54 min (contra 16 / 33 / 25 min
publicados) y la enfermera consume 16 min por caso en vez de 10,5 (5 min siempre + 11 min solo en
el 50 % Red), o sea 3,2 enfermeras de carga contra 2,1 — por eso satura al 99,9 % con tres, cuando
Bizagi publica 69,75 %. Con la topología oficial los tres números del nivel 2 salen exactos y la
utilización de los seis recursos del nivel 3 cuadra dentro del 4 %. Era una errata de la réplica
(LILA-010), no del motor: LILA-187 la corrigió en `model.bpmn` y añadió al escenario las
probabilidades del gateway `Triage type` publicadas en prosa en `level_1_example.htm`.

**D4 — llegadas constantes y drenado (resuelta en LILA-187).** La corrida publicada
([processvalidation47.png](https://help.bizagi.com/platform/en/processvalidation47.png)) trae
exactamente **2017** instancias iniciadas y 2017 completadas (10080 / 5 + 1), con `Duration`
`030,00:00:00` en la cabecera del informe: 30 días de reloj para una semana de llegadas, o sea que
Bizagi dejó drenar la corrida: imposible con un Poisson de media 5 min, y prueba de
que el ejemplo usó el control de intervalo **constante** de 5 min, no la distribución exponencial
que declara el escenario publicado. Además Bizagi drena la corrida (0 casos en vuelo) mientras el
escenario publicado corta a la semana y deja casos en vuelo que, por LILA-036, no entran en las
medias. Con `interTriggerTimer` constante de 300 s, `triggerCount` 2017 y sin `duration` (R-ARR-3:
la corrida acaba al vaciarse el heap) —que es lo que declaran hoy los `scenario.json` de los
niveles 2, 3 y 4— Lila reproduce las 2017 instancias y el denominador de utilización de Bizagi:
`callCenterAgent` sale 39,91 % contra 39,91 % publicado.

**D5 — el máximo del nivel 3 con 3 enfermeras (−5,3 %).** Bizagi publica 35 min = los 33 min del
camino Red más 2 min de espera de enfermera que en su corrida cayeron en el camino crítico. En la
nuestra la espera máxima de `Classify Triage` es de segundos y el máximo se queda en los 33 min del
camino puro. Es la cola de la distribución de un único máximo, no una diferencia de definición: la
media cuadra al 0,74 % y la utilización al 0,14 %.

**D6 — el caso saturado del nivel 3 (2 enfermeras), media +23,5 %.** Con 2 enfermeras el sistema
está por encima de su capacidad (ρ ≈ 1,05) y la cola crece durante toda la corrida, así que la media
depende de la **forma** del transitorio, no del estado estacionario. Mínimo (+0,4 %), máximo
(+1,3 %) y utilización (−0,13 %) cuadran; la media no, porque en Bizagi la razón media/máximo de la
espera vale 0,40 y en Lila 0,49 — es decir, la cola de Bizagi crece sublinealmente y la de Lila
linealmente, que es lo que produce una acumulación de trabajo constante desde t = 0. Sin la corrida
original de Bizagi no se puede ir más allá; queda como el único residuo del nivel 3.

**D7 — el nivel 4 necesita LILA-164 (capacidad por turno dentro de un mismo pool).** Bizagi hace
variar la **plantilla** por turno (2 / 2 / 1 agentes de call center, etc.) sin que el recurso deje
de existir: los tres turnos cubren las 24 h y no hay tiempo cerrado. `SCENARIO_FORMAT.md` v1 no
admite eso, así que la réplica lo modela con tres pools —uno por turno, cada uno con su
`calendar`— seleccionados con `selection: "or"`. El efecto colateral está medido: el calendario
efectivo de la tarea pasa a ser el del turno concedido (R-CAL-4), así que el trabajo se **pausa**
al cerrar el turno y aparece una `offHoursWait` que bajo la semántica de Bizagi tiene que ser 0.
Media por caso: 59,7 min, que es exactamente el desvío del ciclo (el test lo comprueba: el desvío y
la espera fuera de horario coinciden dentro del 5 %). Quitando el reparto por turno —un solo pool
por rol, sin calendario— el ciclo medio del nivel 4 pasa de +234 % a **−1,45 %**. Lo que queda sin
cubrir es justamente lo que pide LILA-164: con un pool de capacidad fija 2 la tarea `Arrive at
patient place BA` nunca hace cola (espera media 0 contra los 0,74 min publicados), y hacen falta las
capacidades 2 / 1 / 2 por turno **dentro del mismo pool** para reproducirla. Además, Bizagi publica
**una** utilización por rol calculada sobre la capacidad media ponderada por turno —
`Call center agent` 11,21 % = 8068 min / ((2+2+1)/3 × 43200 min), exacto en los seis recursos —
mientras Lila publica una por turno; también eso lo arregla LILA-164. La fórmula se ha comprobado
contra [calendaranalysis2.png](https://help.bizagi.com/platform/en/calendaranalysis2.png) en los seis
recursos, con el trabajo ocupado que la propia tabla de proceso publica: 11,21 · 16,21 · 11,49 ·
7,55 · 5,60 · 6,90 %, todos exactos al segundo decimal.

Con un detalle que la aceptación de LILA-164 tiene que tener en cuenta: en el nivel 4 el
denominador de Bizagi es la **duración declarada del escenario** (43 200 min = los 30 días del campo
`Duration` del informe), no el instante de fin de corrida (≈ 10 100 min) que sí usa en el nivel 3 y
que es lo que fija R-CAL-9. Son 4,27× de diferencia: aunque LILA-164 dé capacidad por turno dentro
de un mismo pool, las utilizaciones del nivel 4 no coincidirán con las publicadas mientras el
denominador se calcule sobre `[warmup, t_stop]`. Es una decisión de contrato aparte, no un bug.

**Nota de mapeo (corregida en LILA-187).** `expected.json` llamaba `waitTimeSeconds` a lo que la
tabla de Bizagi titula «Min./Max./Avg. time» del proceso. Esa columna es **tiempo de ciclo**
(procesamiento + espera), y su equivalente en Lila es `process.cycleTime`, no `process.waitTime`
(que es solo `resourceWait + offHoursWait` y en el nivel 2, sin recursos, vale 0 por R-DEG-1). El
campo se llama hoy `cycleTimeSeconds` en los cuatro `expected.json`.

**D8 — los dos vehículos están cruzados en la tabla de requerimientos de la página (resuelta en
LILA-187).** La tabla «Activity | Resource | Quantity» del nivel 3 asigna «Arrive at patient place
QAV → Basic ambulance» y «Arrive at patient place BA → Quick attention vehicle», y la réplica lo
reproducía verbatim. Los
carriles del diagrama y los resultados publicados dicen lo contrario: en
[resourcesanalysis3.png](https://help.bizagi.com/platform/en/resourcesanalysis3.png) *Quick
Attention Vehicle* sale al 21,40 %, que es 618 × 7 min / (2 × 10 108 min) — la tarea QAV — y *Basic
Ambulance* al 19,44 % = 393 × 10 min / (2 × 10 108 min) — la tarea BA. Con esa lectura los **seis**
denominadores dan el mismo instante de fin de corrida (10 108 min con 3 enfermeras, 10 591 con 2),
lo que confirma a la vez la fórmula `busy / (capacidad × t_fin)` y el cruce.

Para la **utilización** el cruce solo intercambia dos etiquetas, porque los dos pools tienen
capacidad 2. Para el **costo** no: los precios difieren (25 y 0,3 /h contra 18 y 0,22 /h), así que
con el cruce la réplica cobraba la tarea QAV a 25/token en vez de 18 y la tarea BA a 18 en vez de
25 (medido entonces: +36,0 % y −25,1 %). LILA-187 puso en `scenario.json` la asignación que cuadra
con los costos publicados, y los dos costos pasan a −2,08 % y +3,96 %.

---

Ver también: `docs/RESULTS_FORMAT.md` (definición de las columnas de salida mencionadas en "Salidas por elemento"/"Salidas por recurso"), `docs/BPMN_EXTENSION.md` (namespace `lila:` e ids), `docs/DECISIONS.md` (ADR que sustentan estas decisiones) y `BACKLOG.md` (desglose en tickets por hito).
