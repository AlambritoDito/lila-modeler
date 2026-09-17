// @vitest-environment jsdom
/**
 * #357, #358 — the footnotes of the results view.
 *
 * The notes live on the tab whose number they explain, so the suite mounts the view and clicks the
 * tab instead of rendering to a string (`ResultsView.test.tsx` renders with `react-dom/server`,
 * which cannot click). Same mounting helpers as `LaneAssign.test.tsx`: `react-dom/client` + `act`,
 * no `@testing-library`.
 *
 * Both catalogs are checked, because the whole point of the change is text the reader understands:
 * a note that only exists in English would be worse than no note at all.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR, RunResult } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import type { ResolvedScenario } from '@lila/engine/schema';

import { ResultsView } from './ResultsView.js';
import { setLocale } from './i18n';
import { en } from './strings.en';
import { es } from './strings.es';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');

let ir: ProcessIR;
let golden: RunResult;

beforeAll(async () => {
  const xml = readFileSync(resolve(REPOSITORY_ROOT, 'examples/pedido/model.bpmn'), 'utf8');
  ir = (await parseBpmn(xml)).ir;
  golden = JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, 'packages/engine/test/golden/pedido.seed-42.json'), 'utf8'),
  ) as RunResult;
}, 120_000);

const scenario = {
  model: 'model.bpmn',
  name: 'AS-IS',
  run: { baseTimeUnit: 'min', currency: 'MXN', replications: 30, seed: 42, start: '2026-09-07T08:00:00-06:00' },
} as unknown as ResolvedScenario;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(result: RunResult): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ResultsView ir={ir} scenario={scenario} result={result} />);
  });
}

afterEach(() => {
  if (root !== null) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  setLocale('en');
});

function press(text: string): void {
  const target = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (target === undefined) throw new Error(`no button «${text}»`);
  act(() => {
    target.click();
  });
}

function text(): string {
  return container?.textContent ?? '';
}

describe('footnotes of the results view (#357, #358)', () => {
  it('the Process tab says Cost per case is a mean over completed cases', () => {
    setLocale('en');
    mount(golden);
    // The note belongs to the number it explains: it is not on the tab that opens by default.
    expect(text()).not.toContain(en.resultados.notaCostoPorCaso);
    press(en.resultados.secciones.process);
    expect(text()).toContain(en.resultados.notaCostoPorCaso);
    expect(en.resultados.notaCostoPorCaso).toContain('not Total cost divided by');
  });

  it('the Resources tab separates hours occupied from availability', () => {
    setLocale('en');
    mount(golden);
    press(en.resultados.secciones.resources);
    expect(text()).toContain(en.resultados.notaCostoRecursos);
  });

  it('the notes follow the catalog: in Spanish they are the Spanish ones', () => {
    setLocale('es');
    mount(golden);
    press(es.resultados.secciones.process);
    expect(text()).toContain(es.resultados.notaCostoPorCaso);
    expect(text()).not.toContain(en.resultados.notaCostoPorCaso);
  });

  it('explains the saturation ratio only when a pool reported it', () => {
    setLocale('en');
    const saturated: RunResult = {
      ...golden,
      warnings: ['W-RECURSO-SATURADO: cajero: the queue grows without settling (λ/μ·c ≈ 1.9)'],
    };
    mount(saturated);
    expect(text()).toContain(en.resultados.notaSaturacion);
    // And it does not explain a ratio nobody is looking at.
    act(() => root!.render(<ResultsView ir={ir} scenario={scenario} result={{ ...golden, warnings: ['W-SIN-SEED: run.seed'] }} />));
    expect(text()).toContain('W-SIN-SEED');
    expect(text()).not.toContain(en.resultados.notaSaturacion);
  });
});
