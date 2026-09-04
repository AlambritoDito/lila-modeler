/**
 * Comparación what-if entre corridas (LILA-038).
 *
 * Toma varios `RunResult` ya simulados —el primero es la **base**— y produce una fila por KPI
 * escalar con el valor de cada corrida, su delta absoluto y relativo contra la base, y una marca
 * de significancia estadística. `compare` no imprime nada: la tabla de consola es LILA-047
 * (`lila compare`) y la vista lado a lado de la web es LILA-064.
 *
 * Función pura de `core/`: sin `node:*`, sin dependencias externas, sin reloj ni estado global.
 *
 * Significancia: los intervalos de confianza al 95 % de la base y del otro resultado **no se
 * solapan** (`replications.kpis[kpi].ci95`, RESULTS_FORMAT.md § 8). Dos intervalos que solo se
 * tocan en un extremo se consideran solapados, es decir, **no** significativos. Un resultado sin
 * `replications` —una sola replicación, o una corrida cancelada con menos de dos completas— no
 * tiene IC y por tanto nunca marca significancia: `significant` vale `false`, no `null`. Esa
 * degradación es deliberada: comparar sin replicaciones sigue dando deltas útiles, solo que sin
 * respaldo estadístico. La lectura limpia de los deltas descansa además en los números aleatorios
 * comunes de R-DET-3: cambiar una capacidad no altera el stream de los elementos no tocados.
 */

import { numericKpis } from './replications.js';
import type { RunResult } from './result.js';

/** Colección de `RunResult` de la que sale un KPI (RESULTS_FORMAT.md §§ 2-5). */
export type CompareScope = 'elements' | 'flows' | 'resources' | 'process';

/** Un KPI escalar comparado a lo largo de todos los resultados. */
export interface CompareRow {
  /** Path del KPI, idéntico al de `replications.kpis`: `elements.Task_A.resourceWait.mean`. */
  kpi: string;
  /** Colección de origen, para agrupar la tabla por elemento / recurso / proceso. */
  scope: CompareScope;
  /** id BPMN **sin escapar** del elemento, flujo o recurso; `null` cuando `scope` es `process`. */
  id: string | null;
  /** Ruta de la métrica dentro de su objeto, p. ej. `resourceWait.mean` o `cycleTime.p95`. */
  metric: string;
  /** Valor en el resultado base; `null` si el KPI no existe ahí (pool nuevo en el TO-BE). */
  base: number | null;
  /** Valor por resultado, en el mismo orden que el array de entrada; `values[0] === base`. */
  values: (number | null)[];
  /** `values[i] − base`; `null` si falta cualquiera de los dos. */
  deltaAbs: (number | null)[];
  /** `(values[i] − base) / base`; `null` si falta alguno **o si la base es 0** (nunca ±Infinity). */
  deltaRel: (number | null)[];
  /** IC 95 % de la base y del resultado `i` disjuntos. `significant[0]` es siempre `false`. */
  significant: boolean[];
}

/** Salida de `compare(results)`. */
export interface CompareResult {
  /** Número de resultados comparados; el índice 0 de cada array es la base. */
  count: number;
  /**
   * Una fila por KPI escalar. Orden: primero los KPI del resultado base en su orden de aparición
   * (elementos, flujos, recursos, proceso; RESULTS_FORMAT.md § 1), después los que solo existan en
   * los resultados siguientes, en orden de resultado y de aparición dentro de él.
   */
  rows: CompareRow[];
}

/**
 * Parte un path de KPI en sus segmentos deshaciendo el escape de `numericKpis` (`\.` es un punto
 * literal del id BPMN, `\\` una barra invertida). Es la inversa exacta de `escapeId`.
 */
function splitKpiPath(path: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let index = 0; index < path.length; index++) {
    const char = path[index]!;
    if (char === '\\') {
      current += path[++index] ?? '';
    } else if (char === '.') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Deriva `scope`, `id` y `metric` del path. `process` no tiene id; el resto lo lleva en [1]. */
function describeKpi(path: string): Pick<CompareRow, 'scope' | 'id' | 'metric'> {
  const parts = splitKpiPath(path);
  const scope = parts[0] as CompareScope;
  if (scope === 'process') return { scope, id: null, metric: parts.slice(1).join('.') };
  return { scope, id: parts[1] ?? '', metric: parts.slice(2).join('.') };
}

/** Dos intervalos cerrados son disjuntos solo si uno termina estrictamente antes de que empiece el otro. */
function disjoint(left: readonly [number, number], right: readonly [number, number]): boolean {
  return left[1] < right[0] || right[1] < left[0];
}

/**
 * Compara resultados de `simulate` contra el primero de la lista.
 *
 * @param results al menos un `RunResult`; `results[0]` es la base.
 * @throws RangeError `E-COMPARE-VACIO` si la lista viene vacía.
 */
export function compare(results: readonly RunResult[]): CompareResult {
  if (results.length === 0) {
    throw new RangeError('E-COMPARE-VACIO: compare() necesita al menos un resultado.');
  }

  const kpisByResult = results.map((result) => numericKpis(result));
  const ci95ByResult = results.map((result) => result.replications?.kpis);

  // Orden estable y determinista: el orden de aparición del base manda; los KPI que solo existen
  // en otro resultado se agregan detrás, sin reordenar los anteriores.
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const kpis of kpisByResult) {
    for (const path of Object.keys(kpis)) {
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }

  const rows: CompareRow[] = paths.map((path) => {
    const base = kpisByResult[0]![path] ?? null;
    const baseCi95 = ci95ByResult[0]?.[path]?.ci95;
    const values: (number | null)[] = [];
    const deltaAbs: (number | null)[] = [];
    const deltaRel: (number | null)[] = [];
    const significant: boolean[] = [];

    for (let index = 0; index < results.length; index++) {
      const value = kpisByResult[index]![path] ?? null;
      values.push(value);
      const absolute = base === null || value === null ? null : value - base;
      deltaAbs.push(absolute);
      // Base 0: el cambio relativo no está definido. `null` en vez de ±Infinity o NaN para que el
      // JSON siga siendo válido y la CLI pueda imprimir un guion sin caso especial.
      deltaRel.push(absolute === null || base === null || base === 0 ? null : absolute / base);
      const ci95 = ci95ByResult[index]?.[path]?.ci95;
      // `index > 0` sostiene el invariante documentado `significant[0] === false` sin depender de
      // que el IC de la base esté bien formado: un `ci95` invertido ([hi, lo]) sería disjunto de
      // sí mismo y marcaría a la base como significativa contra sí misma.
      significant.push(index > 0 && baseCi95 !== undefined && ci95 !== undefined && disjoint(baseCi95, ci95));
    }

    return { kpi: path, ...describeKpi(path), base, values, deltaAbs, deltaRel, significant };
  });

  return { count: results.length, rows };
}
