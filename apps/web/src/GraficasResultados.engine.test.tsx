// @vitest-environment jsdom
/**
 * #636: the engine's `chartsSvg` (what `export_document` puts in the HTML) draws the same charts
 * as the app's process document (`graficasDelDocumento`), over a real engine run with a fixed
 * seed (`examples/pedido`, AS-IS, three days, one replication): the same titles and values in the
 * alt text, the same size, the same bars and the same texts, in English and in Spanish.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { chartsSvg } from '@lila-modeler/engine/charts';
import { resolveExtends, type ResolvedScenario } from '@lila-modeler/engine/schema';
import { simulate, type ProcessIR, type RunResult } from '@lila-modeler/engine';

import { graficasDelDocumento } from './GraficasResultados';
import { setLocale } from './i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const PEDIDO = resolve(HERE, '../../../examples/pedido');
const leer = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

let ir: ProcessIR;
let scenario: ResolvedScenario;
let result: RunResult;
let ciclos: number[] = [];

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(PEDIDO, 'model.bpmn'), 'utf8'))).ir;
  const base = resolveExtends(resolve(PEDIDO, 'as-is.scenario.json'), leer) as unknown as ResolvedScenario;
  scenario = { ...base, run: { ...base.run, duration: 3 * 86_400, replications: 1, seed: 42 } };
  result = simulate(ir, scenario as never, { log: false, onCycleTimes: (_, times) => (ciclos = times) });
}, 60_000);

afterAll(() => setLocale('en'));

/**
 * What a reader sees of a chart: every drawn element in order, with its attributes and text.
 * Left out: what only works on screen (hover titles, transparent hit areas, the groups that hold
 * them), ids and accessibility wiring.
 */
function dibujo(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  const fuera = /^(id|class|role|xmlns|aria-.*|data-.*)$/;
  return [doc.documentElement, ...doc.documentElement.querySelectorAll('*')]
    .filter((el) => !['title', 'desc'].includes(el.tagName) || el.parentElement === doc.documentElement)
    .filter((el) => !(el.tagName === 'rect' && el.getAttribute('fill') === 'transparent'))
    .filter((el) => el.tagName !== 'g' || el.hasAttribute('transform'))
    .map((el) => {
      const attrs = [...el.attributes].filter((a) => !fuera.test(a.name)).map((a) => `${a.name}=${a.value}`).sort();
      const texto = ['text', 'title', 'desc'].includes(el.tagName) ? ` ${el.textContent}` : '';
      return `${el.tagName}[${attrs.join(' ')}]${texto}`;
    });
}

describe.each(['en', 'es'] as const)('the engine draws the app’s document charts (%s)', (locale) => {
  test('same titles and values, same bars and texts, with and without per-case times', () => {
    setLocale(locale);
    for (const log of [{ rows: [], truncated: false, ciclos }, undefined]) {
      let app: ReturnType<typeof graficasDelDocumento> = [];
      act(() => {
        app = graficasDelDocumento({ ir, scenario, result, log });
      });
      const engine = chartsSvg({ ir, scenario, result, locale, cycleTimes: log?.ciclos });
      expect(engine.map((c) => c.alt)).toEqual(app.map((c) => c.alt));
      expect(engine.map((c) => dibujo(c.svg))).toEqual(app.map((c) => dibujo(c.svg)));
    }
  });
});
