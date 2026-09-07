# OP-05 — estado (dueño E, Sonnet)

- Worktree: `/Users/brito/development/lila-wt-e-paneles`
- Rama: `codex/op-e-paneles`
- HEAD al iniciar: `71e653e` (docs(plan): checkpoint común operativo 2026-09-06)
- HEAD final: `3f5ecef`
- Incremento: 1 — **cerrado**, verificado con tests y typecheck en verde.

## Commits (orden)

1. `f54a6d9` docs(plan): OP-05 estado inicial (dueño E) — este archivo, antes de tocar código.
2. `3bdc646` Merge branch 'lila-63-compare-view' into codex/op-e-paneles — merge (no cherry-pick)
   del PR #209 (rama `lila-63-compare-view`, punta `7b6acec`), trae `CompareView.tsx` y sus dos
   tests. El merge también trajo cambios de `ResultsView.tsx`/`vite.config.ts`/`compare-demo.tsx`
   propios de ese PR — no los edité, llegaron con el merge tal como A los integrará en OP-01.
3. `7f931fb` feat(web): helper `compareWarnings` (moneda, unidades, réplicas, semilla) + su test.
4. `bd322a5` feat(web): `CompareView` con `runs?: readonly CompareRunMeta[]`, panel de avisos,
   costos no comparables entre monedas y significancia bloqueada sin réplicas suficientes.
5. `3f5ecef` test(web): pruebas de aceptación (a)-(d) del ticket + fix de dos errores de
   `exactOptionalPropertyTypes` que solo salieron con `tsc`, no con vitest.

## Decisiones

| Decisión | Razón | Prueba |
|---|---|---|
| `runs` es opcional y todo el código nuevo cae a "todo comparable, sin avisos" cuando falta | Backward-compat total: los 34 tests del PR #209 no pasan `runs` y deben seguir viendo exactamente el HTML de antes. | Los 34 tests originales de `CompareView.test.tsx`/`.qa.test.tsx` pasan sin tocar sus aserciones; test nuevo "sin `runs` la vista es idéntica a antes de OP-05". |
| Fila de costo = metric ∈ `{fixedCostTotal, fixedCost, unitCost, totalCost, costPerCase}` (nombre exacto, no regex de sufijo) | Son los únicos 5 campos monetarios reales de `RunResult` (docs/RESULTS_FORMAT.md §§2,4,5); un regex `/Cost$/` se comía `fixedCostTotal` (termina en "Total") y colaba falsos positivos si algún día aparece un KPI que solo *contenga* "Cost". | Test (a): `process.totalCost` con monedas distintas → "no comparable"; el resto de filas de costo comparten la misma función `isCostMetric`. |
| `seed`/`replications` ausentes en `CompareRunMeta` se tratan como el default de `RunSchema` (1 y 1); `currency` ausente NO tiene default y cuenta como "sin moneda" | `RunSchema.seed`/`replications` sí tienen `.default(1)` en el motor — una corrida sin el campo declarado en su meta se comporta igual que produciría `simulate()`. `currency` es `.optional()` sin default: no hay moneda real que asumir. | `compareWarnings.test.ts`: "replications ausente cuenta como 1", "una corrida con moneda y otra sin ella también bloquea". |
| Significancia se bloquea con una bandera de vista (`significanceAvailable`), independiente de lo que `compare()` calculó en `CompareRow.significant` | La vista no puede confiar ciegamente en `significant[i]`: si los metadatos de la corrida dicen `replications < 2`, ningún IC real la respalda aunque el `RunResult` traiga `ci95` (motor mal alimentado, dato viejo, etc.). "La vista no fabrica significancia" es un criterio de aceptación literal del ticket. | Test (b): fixture con `ci95` disjuntos que hacen `significant[1] === true` de verdad, pero `runs[0].replications = 1` → sin asterisco en el HTML. |
| Costo no comparable: la celda no se resalta ni se marca "no comparable" nunca lleva el estilo de resaltado, independientemente de si el texto formateado difiere de la base | Evita literalmente "un ahorro que no es tal" (aceptación del ticket): aunque 500 MXN "se vea distinto" de 100 USD, no es una mejora real. | Test (a): la celda con "no comparable" no contiene `background:var(--bg-hover)`. |
| Unidad de tiempo por columna = `runs[i]?.baseTimeUnit ?? baseTimeUnit` (el prop global, no un default fijo) | Mantiene compatibilidad exacta cuando no hay `runs`, y dentro de `runs` cada corrida puede declarar su propia unidad sin que las demás columnas se vean afectadas. | Test (d): AS-IS en `min`, TO-BE en `h`, mismo elemento, cada celda con su propia conversión. |
| `Intl.NumberFormat({style:'currency'})` con `try/catch` a número plano | `RunSchema.currency` valida `/^[A-Z]{3}$/`, más laxo que la lista real ISO 4217 — un código de prueba que `Intl` no reconozca no debe tirar la vista entera. | No hay test directo del `catch` (ningún caso de prueba usa un código inválido); es defensivo, documentado en el comentario de `formatMoney`. |
| Panel de "Avisos" solo se renderiza si hay algo que mostrar (`compareWarnings(...).warnings.length > 0` o algún `run.warnings` no vacío) | Igual que `ResultsView`, que tampoco muestra la sección "Avisos" si `result.warnings` está vacío; no hay que agregar ruido visual sin runs. | Test "sin `runs`...": no aparece la palabra "Avisos" en el HTML. |

## Comandos y resultados

```
cd /Users/brito/development/lila-wt-e-paneles && npx vitest run apps/web/src/CompareView apps/web/src/compareWarnings
```
→ **3 archivos, 51 tests, todos en verde** (16 + 18 del PR #209 sin tocar sus aserciones, más 12 de
`compareWarnings.test.ts` y 5 nuevos de aceptación OP-05 en `CompareView.test.tsx`).

```
cd /Users/brito/development/lila-wt-e-paneles && npm run typecheck -w @lila/web
```
→ **limpio**, tras corregir dos errores de `exactOptionalPropertyTypes` (`ColumnContext.currency`
en `CompareView.tsx`, y el spread condicional de `currency` en `runMetaFrom` de
`compareWarnings.ts`) que `vitest` no detectaba pero `tsc --noEmit` sí.

Nota de infraestructura: `packages/engine` no traía `dist/` en este worktree (worktree nuevo, nunca
compilado); tuve que correr `npm run build -w @lila/engine` una vez para que `@lila/engine`/
`@lila/engine/schema`/`@lila/engine/format` resolvieran en Vite/vitest. No es un cambio de código,
no generó commit.

## Interfaz para A (OP-13: conectar `CompareView` al flujo real)

`apps/web/src/store/ProjectStore.ts` guarda pares `{ scenario: Scenario, result: RunResult }` (no
`ResolvedScenario` — `Scenario.run` es opcional ahí). Antes de construir `runs` hay que tener el
escenario **resuelto** (con `extends` aplicado y `run` garantizado), que es lo que ya produce
`resolveExtends()` de `@lila/engine/schema` en el flujo de ejecución real (mismo helper que usan
los tests de este ticket).

```ts
import { runMetaFrom, type CompareRunMeta } from './compareWarnings.js';
// scenario: ResolvedScenario (post-resolveExtends), result: RunResult, en el mismo orden
// que los RunResult pasados a compare() — el índice 0 es la base.
const runs: CompareRunMeta[] = pares.map(({ scenario, result }, i) =>
  runMetaFrom(nombresDeEscenario[i], scenario, result),
);

<CompareView
  ir={ir}
  comparison={compare(pares.map((p) => p.result))}
  scenarioNames={nombresDeEscenario}
  baseTimeUnit={pares[0].scenario.run.baseTimeUnit}
  resourceNames={...}
  runs={runs}
/>
```

`runMetaFrom(name, scenario, result)` (exportado de `apps/web/src/compareWarnings.ts`) rellena:

- `currency` ← `scenario.run.currency` (omitido si no está declarado, nunca `undefined` explícito).
- `seed` ← `scenario.run.seed`.
- `replications` ← `scenario.run.replications`.
- `baseTimeUnit` ← `scenario.run.baseTimeUnit`.
- `warnings` ← `result.warnings` (los mismos que ya lista `ResultsView`).

`CompareRunMeta` también se re-exporta desde `apps/web/src/CompareView.js` (`export type {
CompareRunMeta }`), así que A no necesita importar de `compareWarnings.ts` si ya importa desde
`CompareView.tsx`.

## Peticiones a otros dueños

- Ninguna bloqueante. No toqué `ResultsView.tsx`, `main.tsx`, `compare-demo.tsx`,
  `vite.config.ts` ni `packages/engine/**` más allá de lo que trajo el merge del PR #209.
- Para A (OP-01/OP-13): al integrar `lila-63-compare-view`, verificar que el merge de A reconozca
  los mismos commits que ya mezclé aquí (mismo SHA de origen `7b6acec`), para que no haya
  conflicto ni duplicado de historia.

## Qué queda del ticket

- **Conexión al flujo real** (construir `runs` desde el estado vivo de la app, UI del selector de
  escenarios a comparar): explícitamente delegado a A en OP-13 según el ticket. La interfaz de
  arriba ya está lista para ese consumo.
- No se tocó el criterio de significancia de `compare()` en sí (sigue siendo IC95 disjuntos, sin
  cambios), solo se le agregó una capa de "no lo muestres si los metadatos no lo respaldan".
- Limitación conocida y documentada en el código (no bloqueante): si dos corridas declaran
  `baseTimeUnit` distinto pero el mismo valor subyacente en segundos, el resaltado de "celda
  cambiada" puede marcar la celda como cambiada solo por la diferencia de texto entre unidades
  (p. ej. "10" en min vs "600" en s para el mismo dato). El ticket pide explícitamente formatear
  cada corrida con su propia unidad y no pide resolver ese caso, así que se dejó así; el aviso de
  `unitsMixed` ya informa al usuario de que las unidades no coinciden.
