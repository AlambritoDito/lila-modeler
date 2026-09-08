import { describe, expect, test } from 'vitest';

import { PROCESS_COLUMNS, toCsv } from '../src/csv.js';
import {
  COLUMN_LABELS,
  columnHeader,
  columnLabel,
  formatDuration,
  formatNumber,
  formatTable,
} from '../src/format.js';

describe('CSV RFC 4180 (LILA-046)', () => {
  test('escapa comas, comillas, CR/LF y valores vacíos con terminadores CRLF', () => {
    expect(
      toCsv(
        ['plain', 'quoted'],
        [
          ['a,b', 'dice "hola"'],
          ['dos\nlíneas', null],
          ['retorno\rde carro', ''],
        ],
      ),
    ).toBe(
      'plain,quoted\r\n"a,b","dice ""hola"""\r\n"dos\nlíneas",\r\n"retorno\rde carro",\r\n',
    );
  });
});

describe('formato de consola (LILA-046)', () => {
  test('baseTimeUnit convierte solo la presentación y redondea de forma estable', () => {
    expect(formatDuration(90, 's')).toBe('90');
    expect(formatDuration(90, 'min')).toBe('1.5');
    expect(formatDuration(3_600, 'h')).toBe('1');
    expect(formatDuration(86_400, 'day')).toBe('1');
    expect(formatNumber(-0)).toBe('0');
  });

  test('la tabla alinea columnas sin locale ni dependencias de terminal', () => {
    expect(formatTable(['A', 'Long'], [['x', '1'], ['yy', '22']])).toBe(
      ['A   Long', '--  ----', 'x   1', 'yy  22'].join('\n'),
    );
  });
});

describe('mapa único de nombres de columna (LILA-201)', () => {
  test('los nombres son los de RESULTS_FORMAT.md § 10 y no hay dos rutas con el mismo rótulo por ámbito', () => {
    expect(columnLabel('elements', 'resourceWait.sd')).toBe('Standard deviation (waiting for resource)');
    expect(columnLabel('elements', 'fixedCostTotal')).toBe('Total fixed cost');
    expect(columnLabel('flows', 'count')).toBe('Instances/Tokens completed');
    expect(columnLabel('resources', 'busyTime')).toBe('Busy time');
    expect(columnLabel('process', 'cycleTime.mean')).toBe('Cycle time average');
    expect(columnLabel('process', 'waitTime.p50')).toBe('Wait time p50');
    expect(columnLabel('process', 'throughputPerHour')).toBe('Throughput per hour');
    expect(columnLabel('process', 'totalCost')).toBe('Total cost');

    // Una métrica sin nombre en § 10 conserva su ruta interna en vez de estrenar uno inventado.
    expect(columnLabel('elements', 'queueLength.mean')).toBe('queueLength.mean');

    // Dentro de un ámbito, dos rutas distintas no pueden compartir rótulo: la tabla dejaría de
    // ser legible y el CSV tendría columnas homónimas.
    const byScope = new Map<string, Set<string>>();
    for (const [key, label] of Object.entries(COLUMN_LABELS)) {
      const scope = key.split(':')[0]!;
      const labels = byScope.get(scope) ?? new Set<string>();
      expect(labels.has(label), `${scope}: ${label} repetido`).toBe(false);
      labels.add(label);
      byScope.set(scope, labels);
    }
  });

  test('el sufijo de unidad lo pone solo quien convierte: el CSV va en segundos y sin sufijo', () => {
    expect(columnHeader('resources', 'busyTime', 'min')).toBe('Busy time (min)');
    expect(columnHeader('process', 'cycleTime.p50', 'h')).toBe('Cycle time p50 (h)');
    // Las columnas que no son duraciones no reciben sufijo en ninguna superficie.
    expect(columnHeader('process', 'throughputPerHour', 'min')).toBe('Throughput per hour');
    expect(columnHeader('resources', 'utilization', 'min')).toBe('Utilization (%)');
    // `process.csv` es exactamente el mapa aplicado a `PROCESS_COLUMNS`, sin unidades.
    expect(PROCESS_COLUMNS.map((metric) => columnLabel('process', metric))).toContain('Total cost');
  });
});
