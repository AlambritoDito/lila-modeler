# Checklist de paridad con Bizagi

Fuente: `LILA_MODELER_ESTRUCTURA.md`, sección 3 ("Checklist de paridad con Bizagi"). Esta tabla es una copia de esa sección con una columna `Estado` añadida para seguimiento de implementación; el contenido de las columnas `Capacidad`/`Bizagi`/`Lila`/`Hito` es el mismo que en el documento de estructura, que sigue siendo la fuente de verdad — ante cualquier discrepancia entre este archivo y `LILA_MODELER_ESTRUCTURA.md`, gana el documento de estructura y este archivo se corrige para reflejarlo, nunca al revés.

Fuente de la comparación original: ayuda oficial de Bizagi (niveles 1–4, escenarios, elementos no soportados), verificada el 2026-09-03. Bizagi no expone "4 niveles" en el motor: son qué parámetros están rellenos. Lila no reproduce los niveles como concepto de producto; el motor degrada: sin recursos ⇒ capacidad infinita, sin calendario ⇒ 24×7.

`Estado` refleja el estado de implementación en el repositorio, no el de este documento: todas las filas están hoy en **Pendiente** porque el motor (`packages/engine`) aún no existe (ver `BACKLOG.md`, hitos M0–M6). Se actualiza fila por fila conforme cada capacidad quede implementada y probada (ver la prueba de aceptación del hito correspondiente en la sección 7 de `LILA_MODELER_ESTRUCTURA.md`).

| Capacidad | Bizagi | Lila | Hito | Estado |
|---|---|---|---|---|
| Start/End none, task (todas las variantes), sequence flow | ✓ | ✓ | M1 | Pendiente |
| Exclusive gateway con % por flujo (reparto equitativo por defecto) | ✓ | ✓ | M1 | Pendiente |
| Inclusive gateway con % independientes | ✓ | ✓ | M1 | Pendiente |
| Parallel gateway fork/join | ✓ | ✓ | M1 | Pendiente |
| Subproceso embebido (aplanado); reusable = tarea con tiempo global | ✓ | ✓ | M1 | Pendiente |
| Timer intermedio como retardo | ✓ | ✓ | M1 | Pendiente |
| Llegadas: max arrival count + intervalo (constante o distribución) | ✓ | ✓ | M1 | Pendiente |
| Processing time por tarea/evento, constante o distribución | ✓ | ✓ | M1 | Pendiente |
| Distribuciones: las 13 de BPSim 2.0 + constante + empírica | ✓ (subconjunto no documentado) | ✓ todas | M1 | Pendiente |
| Escenario: nombre, descripción, autor, versión, inicio, duración, unidad de tiempo, moneda, replicaciones, semilla | ✓ | ✓ (+ `warmup`, `extends`) | M1 | Pendiente |
| Parada: duración o max arrival count, lo primero | ✓ | ✓ | M1 | Pendiente |
| Recursos: tipo rol/equipo, disponibilidad, costo fijo por token, costo por hora | ✓ | ✓ | M2 | Pendiente |
| Asignación a tarea: uno o varios recursos, cantidad, AND / OR | ✓ | ✓ | M2 | Pendiente |
| Costo fijo por actividad | ✓ | ✓ | M2 | Pendiente |
| Salidas por elemento: started, completed, tiempo min/max/avg/total, espera min/max/avg/std/total, costo fijo | ✓ | ✓ mismos nombres de columna | M2 | Pendiente |
| Salidas por recurso: utilización %, costo fijo, costo unitario, costo total | ✓ | ✓ | M2 | Pendiente |
| Calendarios: recurrencia, hora de inicio, duración, vigencia; matriz recurso × calendario con calendario por defecto | ✓ | ✓ semanal en v1; mensual/anual y festivos reservados | M3 | Pendiente |
| What-if: varios escenarios, lado a lado, diferencias resaltadas | ✓ | ✓ (`lila compare`) | M3 | Pendiente |
| Replicaciones (recomiendan 30) | ✓ solo en what-if | ✓ siempre, con IC 95 % | M2 | Pendiente |
| Export de resultados | Excel | CSV (Excel lo abre; XLSX después si lo piden) | M2 | Pendiente |
| Importar `.bpmn` exportado por Bizagi | — | ✓ solo diagrama: Bizagi **no exporta** parámetros de simulación (verificado en 5 archivos reales, solo colores en `bizagi:`) | M0 | Pendiente |
| **Extras que Bizagi no da** | | | | |
| p50/p90/p95 de ciclo y espera | ✗ | ✓ | M2 | Pendiente |
| Longitud de cola media/máx por actividad | ✗ | ✓ | M2 | Pendiente |
| Throughput por hora, costo por caso | ✗ | ✓ | M2 | Pendiente |
| Ranking de cuellos de botella | ✗ | ✓ | M2 | Pendiente |
| Event log por caso (CSV; XES después) | ✗ | ✓ | M2 | Pendiente |
| Espera fuera de horario separada de espera por recurso | ✗ (queja: "poca granularidad") | ✓ | M3 | Pendiente |
| Determinismo por semilla, byte a byte | parcial | ✓ | M1 | Pendiente |
| macOS / Linux / navegador | ✗ (4.3 sigue Windows-only, sin editor web) | ✓ | M5 | Pendiente |
| **Después** | | | | |
| Animación con contadores en vivo | ✓ | token-simulation (MIT) cubre la parte didáctica; contadores DES en vivo no son prioridad | — | No planificado (v1) |
| Start quantity / completion quantity | ✓ | reservado | — | No planificado (v1) |
| Message/signal/link events, boundary events, event-based gateway | parcial | error de validación explícito hasta que un usuario lo pida | — | No planificado (v1) |
| Parámetros desde event logs (Bizagi 4.0 process mining) | ✓ | fase minería (proceso Python separado) | — | No planificado (v1) |
| **No** (Bizagi tampoco los simula) | | | | |
| Multi-instancia, complex gateway, choreography/conversation, transaccional, ad-hoc; leer `.bpm` propietario | ✗ | ✗ | — | Fuera de alcance |

---

Ver también: `docs/RESULTS_FORMAT.md` (definición de las columnas de salida mencionadas en "Salidas por elemento"/"Salidas por recurso"), `docs/BPMN_EXTENSION.md` (namespace `lila:` e ids), `docs/DECISIONS.md` (ADR que sustentan estas decisiones) y `BACKLOG.md` (desglose en tickets por hito).
