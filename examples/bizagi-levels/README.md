# examples/bizagi-levels — réplicas de los ejemplos oficiales de Bizagi

LILA-010. Cuatro carpetas, una por nivel de simulación de Bizagi
(`docs.bizagi.com` → Modeler → Simulación), cada una con `model.bpmn`,
`scenario.json` (`docs/SCENARIO_FORMAT.md`) y `expected.json` citando la URL
y los números publicados en texto en cada página. Fuente: los cuatro
`level_N_example.htm` de `help.bizagi.com/platform/en/`.

Las páginas de Bizagi renderizan la mayoría de sus tablas de resultados como
capturas de pantalla (`ProcessValidationNN.png`, `ResourcesAnalysisN.png`,
`CalendarAnalysisN.png`), no como texto — no son accesibles vía fetch/scraping
de texto. Cada `expected.json` transcribe **solo los números que la página da
en prosa** (citados textualmente), y documenta en su campo `nota` qué tablas
existen únicamente como imagen y no se transcribieron, para no inventar
cifras.

## Nivel 1 — [`level_1_example.htm`](https://help.bizagi.com/platform/en/level_1_example.htm)

Validación de rutas (sin tiempos, sin recursos, sin costos): ejemplo
"Validating the Emergency attendance process" — gateway XOR `Triage type`
(Green 20% / Yellow 30% / Red 50%) seguido de un Parallel Gateway de
divergencia sin convergencia (el error que enseña el tutorial). `model.bpmn`
reproduce la versión **corregida** (con el Parallel Gateway de convergencia
añadido), ya que es el diagrama BPMN válido que el resto del repo usa como
referencia; los conteos de la corrida "rota" (antes del fix) se guardan en
`expected.json` solo como dato histórico/pedagógico. Los nombres de tarea
dentro de cada rama de triage no están publicados en texto (solo en
capturas): se usan nombres representativos, documentados como tales en el
propio `.bpmn`.

## Nivel 2 — [`level_2_example.htm`](https://help.bizagi.com/platform/en/level_2_example.htm)

Análisis de tiempos de proceso con recursos infinitos: ejemplo "Performing a
time analysis for the Emergency attendance process" (7 tareas en secuencia,
llegadas cada 5 min en promedio, 1 semana simulada). `expected.json` cita el
tiempo de espera mínimo/máximo/promedio publicado (16 / 33 / 25 min 3 s).

La misma página también trae un "simple process" abstracto (Start → Task 1
(1h) → XOR → Task 2 (2h) / Task 3 (3h) → End, 100 tokens) con resultados
exactos publicados (min/max/avg/total por tarea y por proceso) — no se
modela aquí porque este ticket pide un ejemplo por nivel y el "Emergency
attendance process" es el que se reutiliza consistentemente en los niveles
2–4 de la documentación oficial; queda como referencia citable para quien
quiera reproducirlo aparte.

## Nivel 3 — [`level_3_example.htm`](https://help.bizagi.com/platform/en/level_3_example.htm)

Mismo proceso, con recursos, colas y costos (tablas completas de recursos,
requerimientos por actividad y costos, todas publicadas en texto). La página
compara 2 enfermeras (cuello de botella: 99,85% de utilización, espera media
3h 39min 38s) contra 3 enfermeras (69,75% de utilización, espera media 25min
15s) y recomienda la segunda; `scenario.json` modela la configuración final
(3 enfermeras), de la que parte el nivel 4. Ambas corridas están citadas en
`expected.json`.

Nota curiosa conservada tal cual de la fuente: la tabla de requerimientos de
recursos por actividad asigna "Arrive at patient place QAV → Basic
ambulance" y "Arrive at patient place BA → Quick attention vehicle" — los
nombres de tarea y de recurso están cruzados respecto a lo que uno
esperaría. Se reproduce verbatim (no es un error nuestro).

## Nivel 4 — [`level_4_example.htm`](https://help.bizagi.com/platform/en/level_4_example.htm)

Igual que el nivel 3 (3 enfermeras) más 3 calendarios de turno (mañana
06–14h, tarde 14–22h, noche 22–06h) con disponibilidad de recursos que varía
por turno (tabla publicada íntegra). `SCENARIO_FORMAT.md` v1 no admite que un
mismo pool de recursos tenga capacidad distinta según el calendario (Bizagi
sí); los 4 recursos cuya disponibilidad varía por turno se modelan como 3
pools — uno por turno, cada uno con su propio `calendar` — seleccionados con
`selection: "or"` en la tarea (documentado en el `.bpmn` y en `scenario.json`).
`expected.json` cita el único resultado agregado publicado en texto (espera
media sube de 25min15s a 25min26s) y el detalle de la tarea "Arrive at
patient place BA" (espera máxima 15 min, media 0,74 min).

## Cómo se verificó

`packages/engine/test/bizagi-levels.test.ts` valida, sin depender del parser
BPMN (que aún no existe): que cada `.bpmn` es XML BPMN 2.0 bien formado con
DI, que todo `sequenceFlow` resuelve `sourceRef`/`targetRef`, que cada
`scenario.json` cumple R3/R6/R9/R13 de `SCENARIO_FORMAT.md`, y que cada
`expected.json` cita una URL de `help.bizagi.com`.
