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
| Llegadas: max arrival count + intervalo (constante o distribución) | ✓ | ✓ | M1 | Implementado (LILA-026) **con salvedad**: `triggerCount` sin `interTriggerTimer` no genera ningún caso (R-ARR-1) y Bizagi sí; ver diferencia D1 |
| Processing time por tarea/evento, constante o distribución | ✓ | ✓ | M1 | Implementado (LILA-026); paridad verificada en el nivel 2 |
| Distribuciones: las 13 de BPSim 2.0 + constante + empírica | ✓ (subconjunto no documentado) | ✓ todas | M1 | Implementado (LILA-025) |
| Escenario: nombre, descripción, autor, versión, inicio, duración, unidad de tiempo, moneda, replicaciones, semilla | ✓ | ✓ (+ `warmup`, `extends`) | M1 | Implementado (LILA-013, LILA-014) |
| Parada: duración o max arrival count, lo primero | ✓ | ✓ | M1 | Implementado (LILA-026); paridad verificada (la corrida oficial drena sus 2017 casos, ver D4) |
| Recursos: tipo rol/equipo, disponibilidad, costo fijo por token, costo por hora | ✓ | ✓ | M2 | Implementado (LILA-033); paridad verificada en el nivel 3 ([test](../packages/engine/test/bizagi-parity.test.ts)): utilización de los seis recursos y costo de cuatro de ellos; los dos vehículos no cuadran por D8 |
| Asignación a tarea: uno o varios recursos, cantidad, AND / OR | ✓ | ✓ | M2 | Implementado (LILA-034, LILA-035) |
| Costo fijo por actividad | ✓ | ✓ | M2 | Implementado (LILA-036); paridad verificada en el nivel 3 (8057,6 contra 8063 publicados, −0,07 %) |
| Salidas por elemento: started, completed, tiempo min/max/avg/total, espera min/max/avg/std/total, costo fijo | ✓ | ✓ mismos nombres de columna | M2 | Implementado (LILA-036); paridad verificada en el nivel 3 salvo el caso saturado, ver D6 |
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

## Diferencias documentadas (LILA-044)

`packages/engine/test/bizagi-parity.test.ts` compara, con tolerancia ±5 %, cada número que
`examples/bizagi-levels/level-N/expected.json` cita de la página oficial. El archivo tiene dos
mitades: **A**, las réplicas publicadas tal cual están committeadas, y **B**, la misma comparación
sobre la topología del diagrama oficial (`packages/engine/test/fixtures/bizagi-emergency-oficial.bpmn`)
y las llegadas que la corrida publicada realmente usó. La regla del ticket es reconciliar, no
calibrar: **ningún parámetro de `examples/bizagi-levels/` se ha tocado**; las variantes de la mitad
B viven solo dentro del test.

Cada fila del test asegura de qué lado de la tolerancia está su número. Si una fila cambia de lado,
el test se pone rojo y hay que actualizar el test y esta sección a la vez.

### Resultado

| Nivel | Número publicado | A · réplica tal cual | B · topología oficial | Causa |
|---|---|---|---|---|
| 1 | 1000 tokens creados | 0 (−100 %) | 1000 (0 %) | D1 |
| 1 | rama 50 % = 483 | — | 498,9 (+3,3 %) | — |
| 1 | rama 30 % = 315 | — | 298,1 (−5,4 %) | D2 |
| 1 | rama 20 % = 202 | — | 203,0 (+0,5 %) | — |
| 2 | ciclo mín 16 min | 51 min (+219 %) | 16 min (0 %) | D3 |
| 2 | ciclo máx 33 min | 54 min (+64 %) | 33 min (0 %) | D3 |
| 2 | ciclo medio 25 min 3 s | 52,5 min (+109 %) | 25 min 4 s (+0,06 %) | D3 |
| 3 | ciclo mín 16 min (3 enf.) | 51 min (+219 %) | 16 min (0 %) | D3 |
| 3 | ciclo máx 35 min (3 enf.) | 847 min (+2321 %) | 33,1 min (−5,3 %) | D3, D5 |
| 3 | ciclo medio 25 min 15 s (3 enf.) | 400 min (+1485 %) | 25 min 4 s (−0,74 %) | D3 |
| 3 | utilización nurse 69,75 % | 99,92 % (+43 %) | 69,65 % (−0,14 %) | D3 |
| 3 | utilización nurse 99,85 % (2 enf.) | 99,94 % (+0,09 %) | 99,72 % (−0,13 %) | — |
| 3 | ciclo mín 16 min (2 enf.) | — | 16,07 min (+0,4 %) | — |
| 3 | ciclo máx 10 h 57 min (2 enf.) | — | 665,8 min (+1,3 %) | — |
| 3 | ciclo medio 3 h 39 min 38 s (2 enf.) | 2187 min (+896 %) | 271,3 min (+23,5 %) | D6 |
| 4 | ciclo medio 25 min 26 s | 455 min (+1691 %) | 85,0 min (+234 %) | D7 |
| 4 | Arrive BA espera máx 15 min | 76 min (+407 %) | 18,0 min (+19,8 %) | D7 |
| 4 | Arrive BA espera media 0,74 min | 8,2 min (+1013 %) | 1,0 min (+34,8 %) | D7 |
| 3 | costo fijo de actividades 8063 | — | 8057,6 (−0,07 %) | — |
| 3 | costo `Call center agent` 6051 | — | 6051,0 (0 %) | — |
| 3 | costo `Nurse` 15 115 | — | 15 101,5 (−0,09 %) | — |
| 3 | costo `Ambulance` 30 314,13 | — | 30 232,8 (−0,27 %) | — |
| 3 | costo `Receptionist` 3018 | — | 3009,9 (−0,27 %) | — |
| 3 | costo del pool de la tarea QAV 11 139,86 | — | 15 149,5 (+36,0 %) | D8 |
| 3 | costo del pool de la tarea BA 9844,65 | — | 7369,2 (−25,1 %) | D8 |
| 4 | ciclo medio 25 min 26 s, con **un pool por rol** | — | 25 min 4 s (−1,45 %) | prueba de D7 |

### Causas

**D1 — `triggerCount` sin `interTriggerTimer` no genera ningún caso.** R-ARR-1 dice que genera
casos «cada `start` **con** `interTriggerTimer`», y R-ARR-3 no considera error que falte el timer
mientras haya `triggerCount`. El nivel 1 de Bizagi es exactamente esa configuración (max arrival
count 1000, sin intervalo, porque el nivel 1 no habilita campos de tiempo): la corrida sale con
cero llegadas. **No es silenciosa**: `simulate()` devuelve el aviso `W-START-SIN-LLEGADAS` en
`warnings` y `lila run` lo imprime, tal como documenta SEMANTICS §10; el test lo comprueba. Lo que
falta es la decisión de contrato — no es un desajuste con Bizagi sino un hueco del contrato de Lila —
o el motor trata `triggerCount` a solas como «emitir todos los tokens sin consumir reloj», o la
validación lo rechaza. Está fuera del alcance de LILA-044 (toca `core/` y `scenario.ts`) y va como
ticket aparte. Con un `interTriggerTimer` constante de 0 s dentro del test, el nivel 1 cuadra.

**D2 — la rama del 30 % contra una corrida única de Bizagi.** Los tres conteos publicados
(483 + 315 + 202) son una sola corrida de 1000 tokens; el 315 se desvía por sí mismo un +5 % de su
propia probabilidad configurada (30 %). Contra `1000 × p`, que es lo que de verdad valida el nivel
1, las tres ramas cuadran (−0,23 %, −0,63 %, +1,52 %). Anotado además: `level-1/expected.json`
etiqueta los tres conteos como `green`/`yellow`/`red` **al revés**. La prosa de la página solo da la
suma «(483+315+202)», pero la tabla de resultados que la acompaña
([processvalidation42.png](https://help.bizagi.com/platform/en/processvalidation42.png)) los publica
fila por fila: «Red Triage end 483 · Yellow Triage end 315 · Green Triage end 202». La corrida rota
([processvalidation43.png](https://help.bizagi.com/platform/en/processvalidation43.png)) confirma la
lectura: «Red Triage end 1006 · Yellow Triage end 311 · Green Triage end 186», y el 1006 solo puede
ser la rama del Parallel Gateway sin convergencia. Corregir `expected.json` es LILA-187.

**D3 — la topología reconstruida de los niveles 2–4 no es la del diagrama oficial.**
`examples/bizagi-levels/level-{2,3,4}/model.bpmn` reconstruye el «Emergency attendance process»
como siete tareas en secuencia con un XOR de vehículo al final. El diagrama de la página
(`simulationexample2.png`, el mismo proceso en los cuatro niveles) es:

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
utilización de los seis recursos del nivel 3 cuadra dentro del 4 %. Es una errata de la réplica
(LILA-010), no del motor; corregirla es un ticket aparte porque exige tocar `model.bpmn` y añadir
al escenario publicado las probabilidades del gateway, y LILA-044 tiene prohibido cambiar el
escenario publicado.

**D4 — llegadas constantes y drenado.** La corrida publicada
([processvalidation47.png](https://help.bizagi.com/platform/en/processvalidation47.png)) trae
exactamente **2017** instancias iniciadas y 2017 completadas (10080 / 5 + 1), con `Duration`
`030,00:00:00` en la cabecera del informe: 30 días de reloj para una semana de llegadas, o sea que
Bizagi dejó drenar la corrida: imposible con un Poisson de media 5 min, y prueba de
que el ejemplo usó el control de intervalo **constante** de 5 min, no la distribución exponencial
que declara el escenario publicado. Además Bizagi drena la corrida (0 casos en vuelo) mientras el
escenario publicado corta a la semana y deja casos en vuelo que, por LILA-036, no entran en las
medias. Con `interTriggerTimer` constante de 300 s, `triggerCount` 2017 y sin `duration` (R-ARR-3:
la corrida acaba al vaciarse el heap), Lila reproduce las 2017 instancias y el denominador de
utilización de Bizagi: `callCenterAgent` sale 39,91 % contra 39,91 % publicado.

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

**Nota de mapeo.** `expected.json` llama `waitTimeSeconds` a lo que la tabla de Bizagi titula
«Min./Max./Avg. time» del proceso. Esa columna es **tiempo de ciclo** (procesamiento + espera), y
su equivalente en Lila es `process.cycleTime`, no `process.waitTime` (que es solo
`resourceWait + offHoursWait`). El nivel 2, sin recursos, tiene `process.waitTime.mean = 0` por
R-DEG-1; el test deja esa fila anclada para que el mapeo quede escrito.

**D8 — los dos vehículos están cruzados en la tabla de requerimientos de la página.** La tabla
«Activity | Resource | Quantity» del nivel 3 asigna «Arrive at patient place QAV → Basic ambulance»
y «Arrive at patient place BA → Quick attention vehicle», y la réplica lo reproduce verbatim. Los
carriles del diagrama y los resultados publicados dicen lo contrario: en
[resourcesanalysis3.png](https://help.bizagi.com/platform/en/resourcesanalysis3.png) *Quick
Attention Vehicle* sale al 21,40 %, que es 618 × 7 min / (2 × 10 108 min) — la tarea QAV — y *Basic
Ambulance* al 19,44 % = 393 × 10 min / (2 × 10 108 min) — la tarea BA. Con esa lectura los **seis**
denominadores dan el mismo instante de fin de corrida (10 108 min con 3 enfermeras, 10 591 con 2),
lo que confirma a la vez la fórmula `busy / (capacidad × t_fin)` y el cruce.

Para la **utilización** el cruce solo intercambia dos etiquetas, porque los dos pools tienen
capacidad 2. Para el **costo** no: los precios difieren (25 y 0,3 /h contra 18 y 0,22 /h), así que la
réplica cobra la tarea QAV a 25/token en vez de 18 y la tarea BA a 18 en vez de 25. Medido: 15 149,5
contra 11 139,86 publicados (+36,0 %) y 7369,2 contra 9844,65 (−25,1 %); los otros cuatro recursos
cuadran entre 0 % y −0,27 %, y el costo fijo de actividades al −0,07 %. Es la corrección que falta
en LILA-187 y el único número del nivel 3 que no se explica por la topología.

---

Ver también: `docs/RESULTS_FORMAT.md` (definición de las columnas de salida mencionadas en "Salidas por elemento"/"Salidas por recurso"), `docs/BPMN_EXTENSION.md` (namespace `lila:` e ids), `docs/DECISIONS.md` (ADR que sustentan estas decisiones) y `BACKLOG.md` (desglose en tickets por hito).
