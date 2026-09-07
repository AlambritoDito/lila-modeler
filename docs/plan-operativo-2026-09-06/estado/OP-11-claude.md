# OP-11 — estado final (agente E, Sonnet)

## Rama y SHA

- Rama: `codex/op-e-paneles`.
- SHA base (antes del merge): `93a16f6` (HEAD de `codex/op-e-paneles` antes de esta sesión, con
  OP-05 y OP-12 ya entregados por este mismo agente).
- Merge: `git checkout codex/op-e-paneles && git merge --no-edit codex/claude-entrega-20260906`.
  Fue fast-forward (sin commit de merge) porque `op-e-paneles` era ancestro directo de
  `codex/claude-entrega-20260906`. Trajo OP-12, el checkpoint OP-13 de A con `App.tsx` conectado
  y `capacity` por turno del motor (OP-04). Sin conflictos.
- SHA final: `a4f22ef`.
- Commits de este incremento:
  - `9f00279` — arranque (este archivo).
  - `1b48f74` — `feat(web): OP-11 capacidad Fija/Por turno con select de calendario`.
  - `a4f22ef` — `test(web): OP-11 aceptación de capacidad por turno y null en reservados`.

Nota de higiene: el commit `1b48f74` agrupa tres cambios que hubiera preferido separar
(capacidad Fija/Por turno, campos reservados con «Quitar heredado», etiquetas humanas de id) —
los edité en el mismo `ScenarioPanel.tsx` sin `git add -p` entre medias y el mensaje solo describe
el primero. Los tres están descritos en las decisiones de abajo.

## Punto de partida

`npx vitest run apps/web/src/ScenarioPanel.test.tsx` fallaba en «editar capacity y guardar
produce un archivo que lila run acepta» con `no hay input con id campo-resources.cajero.capacity`.
Causa: OP-04 cambió `ResourceSchema.capacity` a `z.union([z.int().min(1), z.array(...)])`
(LILA-164), y el selector genérico de uniones de `Campo` (el que ya dibuja las 14 distribuciones)
empezó a dibujar `capacity` como un `<select>` de variante en ese mismo id, no como el `<input>`
numérico que el test y la UX anterior esperaban.

## Decisiones

1. **Capacidad Fija/Por turno con un componente dedicado, no el selector genérico de uniones.**
   `esCapacidadRecurso(ruta, esquema)` detecta `['resources', <id>, 'capacity']` con una unión y
   `Campo` la intercepta antes del selector genérico. Razón: (a) el id
   `campo-resources.<id>.capacity` tenía que sobrevivir para la variante Fija —es el que cita el
   ticket y el que ya usaba el test de aceptación—, y el selector genérico lo hubiera puesto en el
   `<select>` de variante, no en el input; (b) cada tramo `{calendar, capacity}` necesita que
   `calendar` sea un `<select>` de los ids ya declarados en `calendars` del escenario resuelto
   (con la opción actual añadida al principio si ya no existe, para no perderla en silencio), no
   la caja de texto libre que el formulario genérico de objetos hubiera dibujado. El selector
   genérico de `anyOf` (test «uniones del esquema») sigue intacto y sin tocar: la intercepción es
   solo por la forma exacta de la ruta, así que la unión sintética de LILA-164 en el test (que
   vive en `ruta=['capacity']`, no bajo `resources`) sigue usando el camino genérico sin cambios.
   Prueba: `capacidad de recursos: Fija y Por turno` en `ScenarioPanel.test.tsx` — cambia `horno`
   (sin `calendar` de pool, para no chocar con R16) a Por turno, valida el JSON con
   `ScenarioSchema.safeParse` + `validateScenario` (nunca una réplica de esa semántica en React),
   y comprueba que volver a Fija deja un número puro en el id original.

2. **Cambiar de variante nunca deja restos**, sin lógica nueva: `ctx.editar(ruta, valorVacio(...))`
   escribe un número o un array completos, y `deepMerge` (motor) reemplaza entero cualquier valor
   que no sea objeto-sobre-objeto — no hay `conBorrados` que mezclar porque ni el número ni el
   array son objetos. Verificado por la misma prueba del punto 1 (el `capacity` de `horno` vuelve
   a ser `1`, sin array detrás).

3. **Reservados heredados (`priority`, `preempt`, y cualquier otro de § 4 que el esquema traiga
   vacío) con estado visible y «Quitar heredado».** Antes, `Campo` devolvía `null` para todo
   esquema vacío (`{}` — lo que `z.unknown()` produce en JSON Schema) y esos campos eran
   invisibles. Añadí `CampoReservado`, que solo aparece cuando hay algo que mostrar (heredado,
   propio o eliminado; `ausente` sigue sin pintar nada) y reutiliza el `ctx.quitar()` que el panel
   ya tenía: si el padre define el campo escribe `null` (borra según § 6); si es solo propio del
   hijo, borra la clave. Añadí `ctx.restaurar()` (nuevo, opcional en la interfaz) para deshacer un
   «eliminado» sin volver a heredar por accidente: borra el `null` propio en vez de escribirlo.
   `Contexto.delta`/`Contexto.padre` son **opcionales** a propósito: la sonda de test de uniones
   genéricas (`Sonda` en `ScenarioPanel.test.tsx`) construye un `Contexto` a mano sin ellos y no
   los necesita porque nunca toca un campo reservado; hacerlos obligatorios hubiera forzado a
   tocar ese test sin necesidad.
   Prueba: `campos reservados: quitar heredado` — un padre con `resources.cajero.priority: 1`, un
   hijo vacío que hereda; se ve «heredado: 1», se pulsa «Quitar heredado», el delta guardado trae
   `priority: null`, y el resuelto (`resolveExtends` + `ScenarioSchema.parse` +
   `validateScenario`) no lleva la clave y no dispara `E-RESERVADO`.

4. **Etiquetas humanas de id, sin pedir nada nuevo a A.** `ProcessIR.nodes[id].name` y
   `ProcessIR.flows[id].name` ya existen en el `ir` que el panel recibe (`packages/engine/src/core/ir.ts`);
   no hizo falta una prop nueva. El nombre se pinta **junto** al botón/párrafo que muestra el id,
   nunca dentro del texto del botón: los gestos de test seleccionan por el texto exacto del botón
   (`pulsar('Task_TomarPedido')`), y meter el nombre ahí rompía tres pruebas existentes
   (`no hay botón «Task_TomarPedido»` etc.) hasta que lo saqué a un `<span>` hermano.

5. **Editor semanal de calendarios: pospuesto**, como autoriza el ticket. Hoy `calendars` se edita
   con el mismo formulario genérico derivado del esquema (`esRegistro` + `Propiedades`): cada
   calendario es un registro de `intervals[]`, cada intervalo un `{days[], from, to}` con `days`
   como lista de checkboxes/selects por el `enum` de `WEEKDAYS` y `from`/`to` como texto libre
   validado en vivo por el regex del motor (`HHMM`/`HHMM_TO`, incluido `"24:00"` en `to` — el
   esquema ya lo acepta, el panel no le pone una restricción propia). Limitación comprobada: no
   hay una grilla semanal clic-y-arrastra; añadir/quitar intervalos es una lista de fieldsets con
   botones «Añadir intervals»/«quitar», que ya persiste correctamente `to: "24:00"` porque no es
   más que un string que pasa por el mismo camino de `EntradaNumero`/input de texto que cualquier
   otro campo string del esquema — lo validé a mano montando el panel con un calendario con
   `to: "24:00"` y confirmando que el valor sobrevive a editar y releer `ctx.resuelto`.

## Comandos y resultados

```
git checkout codex/op-e-paneles
git merge --no-edit codex/claude-entrega-20260906   # fast-forward, sin conflictos
npm ci --no-audit --no-fund                          # 416 paquetes
npm run build -w @lila/engine                        # tsc --build, sin errores
npx vitest run apps/web/src/ScenarioPanel.test.tsx apps/web/src/ScenarioPanel.qa.test.tsx
  # 21 passed (21) — antes de empezar: 1 failed | 8 passed en ScenarioPanel.test.tsx
npm run typecheck -w @lila/web                       # tsc --noEmit, sin errores
npx vitest run apps/web                              # 233 passed (233), 20 archivos
```

## Limitaciones

- Editor semanal visual de calendarios: pospuesto (ver decisión 5). La edición estructurada actual
  ya cubre `intervals[].to = "24:00"` y persiste correctamente; falta la grilla visual.
- El commit `1b48f74` agrupa tres cambios (ver nota de higiene arriba).
- No corrí la suite completa de `packages/engine` (fuera del alcance de los archivos permitidos
  de este ticket y ya cubierta por OP-04/OP-01); solo `npm run build -w @lila/engine` para poder
  compilar contra el `capacity` por turno nuevo.

## Peticiones a A

Ninguna: `ProcessIR` ya trae `nodes[id].name`/`flows[id].name`, así que las etiquetas humanas de
id (punto 3 del ticket) no necesitaron una prop nueva del lado de `App.tsx`/OP-13.
