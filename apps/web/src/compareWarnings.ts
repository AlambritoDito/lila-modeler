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
import type { BaseTimeUnit } from '@lila-modeler/engine/format';
import type { RunResult } from '@lila-modeler/engine';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';
import { strings } from './i18n';

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
  /**
   * `true` cuando `RunResult.replications.kpis` de esa corrida trae entradas sin `n`: se guardó
   * antes de 1.0.0-beta.1 y se calculó con la definición anterior (replicaciones sin observación
   * contaban como cero, `docs/RESULTS_FORMAT.md` § 8, #356/#385). `false` cuando sí trae `n`.
   * `undefined` cuando la corrida no tiene resumen de replicaciones que mirar. Nunca mixto dentro
   * de una misma corrida: el motor calcula sus KPIs todos con la misma definición.
   */
  legacyReplications?: boolean;
}

export interface CompareWarningsResult {
  /**
   * Avisos en el orden en que se detectaron: moneda, unidades, significancia, definiciones de
   * replicación mezcladas, semilla, réplicas.
   */
  warnings: string[];
  /** `false` si mezclar monedas invalida cualquier delta de costo entre corridas. */
  costsComparable: boolean;
  /**
   * `false` si alguna corrida no tiene al menos 2 réplicas (sin IC95) o si las corridas mezclan
   * definiciones de replicación (`mixedReplicationDefinitions`): en ninguno de los dos casos hay
   * una comparación de IC95 en la que confiar.
   */
  significanceAvailable: boolean;
  /** `true` si las corridas no comparten `baseTimeUnit`; cada una se formatea con el suyo. */
  unitsMixed: boolean;
  /**
   * `true` si conviven, entre las corridas comparadas, una calculada antes de 1.0.0-beta.1 (sin
   * `n`) y una calculada después (con `n`), #356/#385. Distinto de "todas legado", que no es una
   * mezcla — es la misma definición en las dos — y no bloquea la significancia. `CompareView` lo
   * usa para elegir el texto exacto de la sección "Significancia" cuando no hay marcador: la razón
   * no es siempre "faltan réplicas".
   */
  mixedReplicationDefinitions: boolean;
}

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
  const S = strings();
  const warnings: string[] = [];

  const currencyLabels = distinct(runs.map((run) => run.currency ?? S.comparar.sinMoneda));
  const costsComparable = currencyLabels.length <= 1;
  if (!costsComparable) {
    warnings.push(S.comparar.avisoMonedas(currencyLabels));
  }

  const units = distinct(runs.map((run) => run.baseTimeUnit).filter((unit): unit is BaseTimeUnit => unit !== undefined));
  const unitsMixed = units.length > 1;
  if (unitsMixed) {
    warnings.push(S.comparar.avisoUnidades(units));
  }

  const sufficientReplications = runs.every((run) => effectiveReplications(run) >= 2);
  if (!sufficientReplications) {
    warnings.push(S.comparar.avisoSignificancia);
  }

  // Mezclar una corrida guardada antes de 1.0.0-beta.1 (sin `n`, replicaciones sin observación
  // contadas como cero) con una corrida nueva (con `n`) produce un IC95 que no compara lo mismo
  // en las dos columnas: `compare()` los resta igual (no conoce la definición), así que una
  // diferencia puede marcarse "significativa" sin serlo (revisión de PR #384). Cuando **todas**
  // las corridas son legado no hay mezcla — es la misma definición en las dos — así que ahí no se
  // bloquea nada; sólo se avisa cuando conviven las dos definiciones.
  const legacyFlags = runs
    .map((run) => run.legacyReplications)
    .filter((flag): flag is boolean => flag !== undefined);
  const mixedReplicationDefinitions = legacyFlags.includes(true) && legacyFlags.includes(false);
  if (mixedReplicationDefinitions) {
    warnings.push(S.comparar.avisoReplicacionesMixtas);
  }

  const significanceAvailable = sufficientReplications && !mixedReplicationDefinitions;

  const seeds = distinct(runs.map(effectiveSeed));
  if (seeds.length > 1) {
    warnings.push(S.comparar.avisoSemillas(seeds));
  }

  const replications = distinct(runs.map(effectiveReplications));
  if (replications.length > 1) {
    warnings.push(S.comparar.avisoReplicas(replications));
  }

  return { costsComparable, mixedReplicationDefinitions, significanceAvailable, unitsMixed, warnings };
}

/**
 * `true` cuando `result.replications.kpis` existe y **alguna** de sus entradas no trae `n`: la
 * corrida se guardó antes de 1.0.0-beta.1 y se calculó con la definición anterior (replicaciones
 * sin observación contadas como cero, `docs/RESULTS_FORMAT.md` § 8, #356/#385). `false` cuando el
 * resumen existe y todas sus entradas traen `n`. `undefined` cuando no hay resumen de
 * replicaciones que mirar (una sola replicación, o cancelada con menos de dos completas) — ese
 * caso no es "legado" ni "nuevo", es "no aplica", y así lo distingue `runMetaFrom` de un `false`
 * real (una corrida legado de 30 réplicas comparada con una corrida nueva de 1 no es una mezcla de
 * definiciones, #385 QA). Mira **todas** las entradas y no solo la primera: si el motor alguna vez
 * emite un resumen con una mezcla, `.some` no se deja engañar por una entrada moderna que salga
 * primero por el orden de inserción del objeto.
 *
 * Único punto de esta comprobación en la app — `ResultsView` la reutiliza para decidir si muestra
 * el aviso de "calculado antes de 1.0.0-beta.1" (#356).
 */
export function hasLegacyReplications(result: RunResult): boolean | undefined {
  const kpis = result.replications?.kpis;
  if (kpis === undefined) return undefined;
  const entries = Object.values(kpis);
  if (entries.length === 0) return undefined;
  return entries.some((kpi) => kpi.n === undefined);
}

/**
 * Construye el `CompareRunMeta` de una corrida a partir de lo que ya guarda `ProjectStore`
 * (`apps/web/src/store/ProjectStore.ts`): un escenario resuelto y su `RunResult`. Pensado para A
 * en OP-13, que conecta `CompareView` al flujo real: la interfaz es `CompareRunMeta` tal como
 * está declarada en este archivo; no hay más contrato que ese.
 */
export function runMetaFrom(name: string, scenario: ResolvedScenario, result: RunResult): CompareRunMeta {
  const legacyReplications = hasLegacyReplications(result);
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
    ...(legacyReplications === undefined ? {} : { legacyReplications }),
  };
}
