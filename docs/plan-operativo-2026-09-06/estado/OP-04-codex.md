# OP-04 — checkpoint Codex

- Dueño: agente D (`codex/op-d-engine`).
- Base: `71e653edfdaa19943048a352c4ba7df3072eddbd`.
- Integración comprobada antes de este reporte: `64ab62f888d5bfab0dd1d85fdc92e7366ce165a5`.
- Archivos: cambios heredados en `packages/engine/src/core`, `packages/engine/src/scenario.ts`, pruebas del motor, `examples/bizagi-levels`, schema, CLI, README y documentación. No se modificaron parser, shell, Modeler ni paneles.
- Objetivo cumplido: integrar #229 (`ab5f458`), #230 (`9f94b14`) y #235 (`7c9c20d`) en ese orden; #222 (`a351f67`) resultó una integración simple y también quedó incluida. #231 permanece pospuesto.

## Contrato publicado de `capacity`

- `resources[pool].capacity` acepta un entero `>= 1` o una lista no vacía de `{ calendar, capacity }`, con cada capacidad entera `>= 1` y calendarios existentes. La forma variable es excluyente con `resources[pool].calendar`.
- La apertura del pool variable es la unión de calendarios y la capacidad instantánea es la suma de los tramos abiertos; los solapes suman. Durante un cierre total se conserva la capacidad del siguiente instante abierto para mantener reservas ya concedidas.
- Una bajada no interrumpe tareas: `used` puede superar temporalmente la capacidad actual y no se conceden unidades nuevas hasta volver a caber. Solo las subidas despiertan la cola.
- `quantity` se valida contra el máximo simultáneo de la semana, no contra la suma declarada de turnos disjuntos.
- La utilización es `busyTime / sum(capacity_i * openTime_i)` sobre `[warmup, t_stop]`. La forma numérica equivale byte a byte a un único tramo con el mismo calendario y capacidad.

## Llegadas y parada

- Un start con `triggerCount: N` y sin `interTriggerTimer` emite N llegadas en `t = 0`.
- `interTriggerTimer` y `triggerCount` solo se admiten en starts, incluidos starts con timer. Un timer intermedio es un retardo: su `triggerCount` produce `E-CAMPO-NO-APLICA` y no satisface R6; sin `run.duration` ni un `triggerCount` de start también se emite `E-SIN-PARADA`.

## Divergencias Bizagi visibles

- D2: en nivel 1 la rama Yellow publicada pertenece a una sola corrida y se desvía +5 % de su probabilidad; contra `1000 * p`, las tres ramas quedan entre -0,63 % y +1,52 %.
- D5: en nivel 3 con tres enfermeras, el máximo de ciclo queda -5,3 % porque el máximo aleatorio de Bizagi incluye 2 min de espera; media y utilización sí cuadran.
- D6: en nivel 3 con dos enfermeras, el sistema saturado deja la media de ciclo +23,5 %; mínimo, máximo y utilización cuadran aproximadamente dentro de 1,3 %.
- D7: nivel 4 ya reproduce capacidad por turno, ciclo, costos y utilización convertida dentro de +/-5 %, pero Bizagi divide utilización por la duración declarada y Lila por `[warmup, t_stop]`. La conversión es `util_bizagi = util_lila * ventana_lila / duracion_declarada`. Persisten además las esperas de `Arrive at patient place BA` (máx +7,78 %, media -24,5 %).

## Verificación

- `npm ci`: 144 paquetes instalados, 0 vulnerabilidades.
- `npx vitest run` sobre motor/T0/capacidad fija y variable/calendarios/escenarios/Bizagi/ejemplos/CLI: 13 archivos y 219 pruebas, todas verdes.
- El caso adversarial del timer intermedio pasó dentro de `sim.arrivals-t0.qa.test.ts`.
- `npm run build --workspace @lila/engine`: TypeScript del motor verde. El primer intento chocó con el sandbox al escribir `dist`; la repetición autorizada en el worktree propio pasó.
- No se ejecutó la suite completa porque el integrador A la serializa.

## Artefactos y siguiente paso

- Rama consumible: `codex/op-d-engine`.
- Commits de merge: `8df8107` (#229), `2ce739d` (#230), `d58c62a` (#235), `64ab62f` (#222).
- Próximo comando para A: `git merge --no-ff codex/op-d-engine`.
