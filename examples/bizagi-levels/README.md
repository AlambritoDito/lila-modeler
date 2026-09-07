# examples/bizagi-levels — réplicas de los ejemplos oficiales de Bizagi

LILA-010, corregido por LILA-187. Cuatro carpetas, una por nivel de simulación
de Bizagi, cada una con `model.bpmn`, `scenario.json`
(`docs/SCENARIO_FORMAT.md`) y `expected.json` citando la URL y los números
publicados. Fuente: los cuatro `level_N_example.htm` de
`help.bizagi.com/platform/en/`.

Las páginas de Bizagi renderizan la mayoría de sus tablas de resultados como
capturas de pantalla (`ProcessValidationNN.png`, `ResourcesAnalysisN.png`,
`CalendarAnalysisN.png`), no como texto. Cada dato de estos ejemplos lleva su
cita: los números que la página da en prosa van con la frase textual en
`expected.json` (`quote`/`quotes`), y los que solo existen en una captura van
transcritos con la URL de la imagen en su campo `source` y una `nota` que dice
de dónde salen. Nada está inventado ni calibrado contra el motor.

**Los cuatro niveles modelan el mismo proceso** («Emergency attendance
process», diagrama en
[simulationexample2.png](https://help.bizagi.com/platform/en/simulationexample2.png)),
con la topología publicada:

```
Receive Emergency Report (4 min) → Classify Triage (5 min) → XOR "Triage type"
  ├ Red    50 % → AND ( Manage patient entry 11 min ‖ Pick up patient 20 min ) → Authorize Entry (4 min) → Red Triage end
  ├ Yellow 30 % → Arrive at patient place QAV (7 min) → Yellow Triage end
  └ Green  20 % → Arrive at patient place BA (10 min) → Green Triage end
```

Y las llegadas de la corrida publicada: **constantes cada 5 min**, 2017 tokens
y sin `duration` (Bizagi deja drenar la corrida: 2017 iniciadas = 2017
completadas). LILA-187 corrigió las tres erratas de la réplica original: la
topología (eran siete tareas en secuencia), las llegadas (eran exponenciales de
media 5 min) y las etiquetas del nivel 1.

## Nivel 1 — [`level_1_example.htm`](https://help.bizagi.com/platform/en/level_1_example.htm)

Validación de rutas: sin tiempos, sin recursos, sin costos. El nivel 1 de
Bizagi solo habilita los porcentajes de los gateways y el «Max. arrival count»
del start, así que `scenario.json` declara `triggerCount: 1000` sin
`interTriggerTimer`: son 1000 llegadas en `t = 0` (`docs/SEMANTICS.md`
R-ARR-1), sin consumir reloj.

`model.bpmn` reproduce la versión **corregida** del tutorial (con el Parallel
Gateway de convergencia añadido); los conteos de la corrida «rota» —el error
que el tutorial enseña a diagnosticar— se guardan en `expected.json` solo como
dato histórico.

Los tres conteos publicados (483 + 315 + 202) van con la etiqueta que les
corresponde: la prosa de la página solo da la suma, pero la tabla fila por fila
([processvalidation42.png](https://help.bizagi.com/platform/en/processvalidation42.png))
publica «Red Triage end 483 · Yellow Triage end 315 · Green Triage end 202», y
con Red 50 % / Yellow 30 % / Green 20 % el 483 solo puede ser la rama del 50 %.
La réplica original los tenía invertidos.

## Nivel 2 — [`level_2_example.htm`](https://help.bizagi.com/platform/en/level_2_example.htm)

Análisis de tiempos con capacidad infinita de recursos (sin `resources`).
`expected.json` cita el ciclo mínimo / máximo / medio publicado en prosa
(16 / 33 min / 25 min 3 s) y transcribe la tabla completa por elemento de
[processvalidation47.png](https://help.bizagi.com/platform/en/processvalidation47.png).
Esa tabla es la que fija las llegadas: 2017 instancias exactas (10080 / 5 + 1)
no salen de un Poisson.

La misma página trae además un «simple process» abstracto (Start → Task 1 →
XOR → Task 2 / Task 3 → End, 100 tokens) con resultados exactos publicados; no
se modela aquí porque el ejemplo por nivel es el «Emergency attendance
process», que es el que se reutiliza en los niveles 2–4.

## Nivel 3 — [`level_3_example.htm`](https://help.bizagi.com/platform/en/level_3_example.htm)

Mismo proceso con recursos, colas y costos. La página compara 2 enfermeras
(cuello de botella: 99,85 % de utilización, ciclo medio 3 h 39 min 38 s) contra
3 enfermeras (69,75 %, 25 min 15 s) y recomienda la segunda; `scenario.json`
modela la configuración final de 3 enfermeras, de la que parte el nivel 4.
Ambas corridas están en `expected.json`.

Sobre los dos vehículos: la tabla de requerimientos en prosa asigna «Arrive at
patient place QAV → Basic ambulance» y «Arrive at patient place BA → Quick
attention vehicle», cruzada respecto al nombre de la tarea. La tabla de costos
([resourcesanalysis3.png](https://help.bizagi.com/platform/en/resourcesanalysis3.png))
solo cuadra con la lectura natural — *Quick Attention Vehicle* 11 124 = 618
(tokens de QAV) × 18, *Basic Ambulance* 9825 = 393 (tokens de BA) × 25 — así
que `scenario.json` usa esa asignación y lo deja escrito en su `description`.

## Nivel 4 — [`level_4_example.htm`](https://help.bizagi.com/platform/en/level_4_example.htm)

Igual que el nivel 3 más tres calendarios de turno (mañana 06–14 h, tarde
14–22 h, noche 22–06 h) con disponibilidad de recursos que varía por turno.

LILA-164 (#164) añadió al formato lo que hacía falta: un mismo pool puede tener
capacidad distinta según el calendario
(`"capacity": [{ "calendar": …, "capacity": … }]`, § 2.4 de
`SCENARIO_FORMAT.md` y R-CAL-11 de `docs/SEMANTICS.md`), que es el
«Resources → Calendars → quantity» de Bizagi. Así que `scenario.json` declara
**un pool por rol** con los tres turnos de la tabla publicada, tramo a tramo;
hasta entonces eran tres pools por rol con `selection: "or"`, y ese workaround
introducía una `offHoursWait` que en Bizagi es 0 (sus tres turnos cubren las
24 h) y repartía utilización y costo por turno en vez de por rol. `Nurse` y
`Ambulance` no varían por turno (3 y 4 en las tres franjas) y siguen con la
forma numérica, sin calendario.

Medido con 30 replicaciones: `offHoursWait` = 0 en las cuatro tareas con recurso
por turno, ciclo medio 1521,5 s contra los 1526 s publicados (−0,30 %), y la
utilización y el costo de los **seis** recursos dentro del ±5 % (peor caso
−2,60 %, `Quick Attention Vehicle`). `Arrive at patient place BA` vuelve a hacer
cola —máx 970 s— porque la capacidad baja a 1 en el turno de tarde: con
capacidad fija era exactamente 0.

Queda **D7** por dos residuos, ninguno del motor: el denominador de la
utilización (Bizagi divide por la duración declarada del escenario, 43 200 min;
Lila por su ventana de medida `[warmup, t_stop]`, 10 862 min — la conversión es
exacta y la aplica el test) y las dos esperas de `Arrive at patient place BA`
(+7,8 % el máximo, −24,5 % la media) contra una corrida única de Bizagi sobre un
pool al 5,6 % de utilización. El detalle está en `docs/BIZAGI_PARITY.md` § D7.

## Cómo se verifica

- `packages/engine/test/bizagi-levels.test.ts`: forma de los archivos, sin
  depender del parser BPMN — XML BPMN 2.0 bien formado con DI, `sequenceFlow`
  con `sourceRef`/`targetRef` que resuelven, R3/R6/R9/R13 de
  `SCENARIO_FORMAT.md` y la URL de `help.bizagi.com` en cada `expected.json`.
- `packages/engine/test/bizagi-parity.test.ts`: simula estas cuatro carpetas
  **tal cual están committeadas** y compara cada número publicado con
  tolerancia ±5 %. Cada fila lleva escrito de qué lado de la tolerancia está,
  así que una que cambie de lado pone el test en rojo.
- `packages/engine/test/bizagi-levels.qa.test.ts`: QA de LILA-186/187 — los
  cuatro `model.bpmn` entran por `parseBpmn` sin nada fuera del perfil y con
  ids NCName, los `scenario.json` validan contra el JSON Schema publicado (no
  solo contra zod), el lint no dice nada salvo `W-ELEMENTO-SIN-PARAMETROS`,
  los XOR suman 1 sin `W-XOR-NORMALIZADA` y ningún número de `expected.json`
  se queda sin `quote`/`quotes` o `source`.

Diferencias vivas hoy: **D2** (nivel 1, la rama Yellow contra la corrida única
de Bizagi, −5,4 %), **D5** y **D6** (nivel 3: el máximo con 3 enfermeras y la
media del caso saturado con 2) y **D7** (nivel 4: el denominador de la
utilización, con conversión exacta, y las dos esperas de `Arrive at patient
place BA`). Todo lo demás de los cuatro niveles cuadra dentro del ±5 %. El
detalle de cada una está en `docs/BIZAGI_PARITY.md` § Diferencias documentadas,
que es la fuente de verdad de esta lista.
