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

**Pendiente de LILA-164 (#164)**: `SCENARIO_FORMAT.md` v1 no admite que un
mismo pool tenga capacidad distinta según el calendario, y Bizagi sí. La
réplica lo modela con tres pools —uno por turno, cada uno con su `calendar`—
seleccionados con `selection: "or"`, y el efecto colateral está medido: el
calendario efectivo de la tarea pasa a ser el del turno concedido (R-CAL-4), el
trabajo se pausa al cerrar el turno y aparece una `offHoursWait` que en Bizagi
es 0 (sus tres turnos cubren las 24 h). Es el único nivel que no cuadra dentro
del ±5 %; el detalle está en `docs/BIZAGI_PARITY.md` § D7.

## Cómo se verifica

- `packages/engine/test/bizagi-levels.test.ts`: forma de los archivos, sin
  depender del parser BPMN — XML BPMN 2.0 bien formado con DI, `sequenceFlow`
  con `sourceRef`/`targetRef` que resuelven, R3/R6/R9/R13 de
  `SCENARIO_FORMAT.md` y la URL de `help.bizagi.com` en cada `expected.json`.
- `packages/engine/test/bizagi-parity.test.ts`: simula estas cuatro carpetas
  **tal cual están committeadas** y compara cada número publicado con
  tolerancia ±5 %. Los niveles 1–3 cuadran; el 4 no, por LILA-164.
