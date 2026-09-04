import { describe, expect, test } from 'vitest';

import { toCsv } from '../src/csv.js';
import { formatDuration, formatNumber, formatTable } from '../src/format.js';

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
