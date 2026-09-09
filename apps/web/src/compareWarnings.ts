/**
 * Avisos derivados de los metadatos de las corridas comparadas en `CompareView` (OP-05, issues
 * #63/#210). Función pura: sin React, sin `node:*`, para que tanto `CompareView` como quien
 * construya sus props (`runMetaFrom`, para A en OP-13) puedan reutilizarla sin arrastrar el DOM.
 *
 * `compare()` (`packages/engine/src/core/compare.ts`) resta y divide números crudos sin mirar en
 * qué moneda ni con qué unidad de tiempo se generaron: un delta entre dos `totalCost` en monedas
 * distintas es aritméticamente válido pero económicamente falso, y un IC95 de una corrida con una
 * sola replicación no existe aunque `significant` venga en `false` (nunca `true`, ver
 * docs/RESULTS_FORMAT.md §11). Este módulo detecta esas condiciones a partir de los metadatos de
 * `run` (`packages/engine/src/scenario.ts`, `RunSchema`) para que `CompareView` decida qué no
 * mostrar como si fuera comparable.
 */
import type { BaseTimeUnit } from '@lila/engine/format';
import type { RunResult } from '@lila/engine';
import type { ResolvedScenario } from '@lila/engine/schema';
import { S } from './strings.es';

/**
 * Metadatos de una corrida comparada, en el mismo orden que `scenarioNames`/`comparison` de
 * `CompareView` (el índice 0 es la base). Todos los campos son opcionales porque el llamador
 * puede no tenerlos a mano (p. ej. un `RunResult` cargado de un CSV viejo sin escenario asociado);
 * su ausencia se trata como "no declarado", nunca como un valor por defecto inventado, salvo donde
 * se documenta lo contrario más abajo.
 */
export interface CompareRunMeta {
  name: string;
  currency?: string;
  seed?: number;
  replications?: number;
  baseTimeUnit?: BaseTimeUnit;
  /** `RunResult.warnings` de esa corrida; se listan bajo su columna sin perderse. */
  warnings?: readonly string[];
}

export interface CompareWarningsResult {
  /** Avisos en el orden en que se detectaron: moneda, unidades, significancia, semilla, réplicas. */
  warnings: string[];
  /** `false` si mezclar monedas invalida cualquier delta de costo entre corridas. */
  costsComparable: boolean;
  /** `false` si alguna corrida no tiene al menos 2 réplicas: sin IC95, sin significancia. */
  significanceAvailable: boolean;
  /** `true` si las corridas no comparten `baseTimeUnit`; cada una se formatea con el suyo. */
  unitsMixed: boolean;
}

const NO_CURRENCY = S.comparar.sinMoneda;

/**
 * `run.replications` tiene default en `RunSchema` (1) y `run.seed` lo aplica el motor (`?? 1`,
 * R-DEG-4): una corrida sin el campo declarado en sus metadatos de comparación se trata como si
 * valiera ese default, no como "desconocido", porque es lo mismo que produciría el motor. `currency` no tiene default (una
 * corrida sin moneda no tiene costos en ninguna), así que ahí sí se distingue de un valor real.
 */
function effectiveSeed(run: CompareRunMeta): number {
  return run.seed ?? 1;
}

function effectiveReplications(run: CompareRunMeta): number {
  return run.replications ?? 1;
}

/** Valores distintos preservando el orden de primera aparición, para listarlos en un aviso. */
function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function compareWarnings(runs: readonly CompareRunMeta[]): CompareWarningsResult {
  const warnings: string[] = [];

  const currencyLabels = distinct(runs.map((run) => run.currency ?? NO_CURRENCY));
  const costsComparable = currencyLabels.length <= 1;
  if (!costsComparable) {
    warnings.push(S.comparar.avisoMonedas(currencyLabels));
  }

  const units = distinct(runs.map((run) => run.baseTimeUnit).filter((unit): unit is BaseTimeUnit => unit !== undefined));
  const unitsMixed = units.length > 1;
  if (unitsMixed) {
    warnings.push(S.comparar.avisoUnidades(units));
  }

  const significanceAvailable = runs.every((run) => effectiveReplications(run) >= 2);
  if (!significanceAvailable) {
    warnings.push(S.comparar.avisoSignificancia);
  }

  const seeds = distinct(runs.map(effectiveSeed));
  if (seeds.length > 1) {
    warnings.push(S.comparar.avisoSemillas(seeds));
  }

  const replications = distinct(runs.map(effectiveReplications));
  if (replications.length > 1) {
    warnings.push(S.comparar.avisoReplicas(replications));
  }

  return { costsComparable, significanceAvailable, unitsMixed, warnings };
}

/**
 * Construye el `CompareRunMeta` de una corrida a partir de lo que ya guarda `ProjectStore`
 * (`apps/web/src/store/ProjectStore.ts`): un escenario resuelto y su `RunResult`. Pensado para A
 * en OP-13, que conecta `CompareView` al flujo real — ver la interfaz documentada en
 * `docs/plan-operativo-2026-09-06/estado/OP-05-claude.md`.
 */
export function runMetaFrom(name: string, scenario: ResolvedScenario, result: RunResult): CompareRunMeta {
  return {
    baseTimeUnit: scenario.run.baseTimeUnit as BaseTimeUnit,
    name,
    replications: scenario.run.replications,
    warnings: result.warnings,
    // `run.seed` dejó de tener default en `RunSchema` (LILA-198: sin él no se puede avisar
    // `W-SIN-SEED`), así que se omite igual que `currency` cuando el escenario no lo declara;
    // `effectiveSeed` sigue leyéndolo como 1, que es lo que usa el motor.
    ...(scenario.run.seed === undefined ? {} : { seed: scenario.run.seed }),
    // `run.currency` no tiene default en `RunSchema` (a diferencia de seed/replications/
    // baseTimeUnit): con `exactOptionalPropertyTypes` un campo opcional no admite `undefined`
    // explícito, así que se omite del todo en vez de escribir `currency: undefined`.
    ...(scenario.run.currency === undefined ? {} : { currency: scenario.run.currency }),
  };
}
