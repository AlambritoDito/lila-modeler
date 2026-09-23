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

  it('states the saturation criterion only when a pool reported it, for both variants', () => {
    setLocale('en');
    const saturated: RunResult = {
      ...golden,
      warnings: ['W-RECURSO-SATURADO: cajero: the queue grows without settling (λ/μ·c ≈ 1.9)'],
    };
    mount(saturated);
    expect(text()).toContain(en.resultados.notaSaturacion);

    // The criterion as `docs/SEMANTICS.md` § 17 fixes it: two doors, and neither of them alone.
    const note = en.resultados.notaSaturacion;
    expect(note).toContain('reaches 1.1');
    expect(note).toContain('utilization reaches 90 %');
    expect(note).toContain('the queue grows or work is left pending');
    expect(note).toContain('neither number decides alone');
    // Attributed demand, § 17's term: only the instances that waited while the pool was full, not
    // everything the pool received (#357).
    expect(note).toContain('Attributed demand counts only the instances that waited');
    expect(note).toContain('while the pool was full');
    expect(note).not.toContain('the demand this pool received');
    // And it never calls the number beside it a ratio, because one variant shows a percentage.
    expect(note).not.toMatch(/the ratio is/);

    // The utilization variant prints no ratio at all: the same note has to read correctly under a
    // warning whose only number is `96 %`.
    const byUtilization: RunResult = {
      ...golden,
      warnings: ['W-RECURSO-SATURADO: cajero: the queue grows without settling (utilization ≈ 96 %)'],
    };
    act(() => root!.render(<ResultsView ir={ir} scenario={scenario} result={byUtilization} />));
    expect(text()).toContain('utilization ≈ 96 %');
    expect(text()).toContain(note);

    // And it does not explain a warning nobody is looking at.
    act(() => root!.render(<ResultsView ir={ir} scenario={scenario} result={{ ...golden, warnings: ['W-SIN-SEED: run.seed'] }} />));
    expect(text()).toContain('W-SIN-SEED');
    expect(text()).not.toContain(note);
  });

  // #356/#385: results stored before 1.0.0-beta.1 have no `n` in their replications.kpis and were
  // computed with the previous definition (replications without an observation counted as zero).
  it('warns when the result was calculated before 1.0.0-beta.1 (no n in replications.kpis)', () => {
    setLocale('en');
    // Legacy results carry no `n` at runtime even though the type declares it required
    // (`packages/engine/src/core/result.ts`); the cast mirrors that documented mismatch.
    const legacy = {
      ...golden,
      replications: {
        ...golden.replications!,
        kpis: Object.fromEntries(
          Object.entries(golden.replications!.kpis).map(([kpi, summary]) => [
            kpi,
            { ci95: summary.ci95, mean: summary.mean, sd: summary.sd },
          ]),
        ),
      },
    } as unknown as RunResult;
    mount(legacy);
    expect(text()).toContain(en.resultados.notaReplicacionesLegado);
    expect(en.resultados.notaReplicacionesLegado).toContain('before 1.0.0-beta.1');
  });

  it('does not warn about legacy replications when every kpi carries n', () => {
    setLocale('en');
    mount(golden);
    expect(text()).not.toContain(en.resultados.notaReplicacionesLegado);
  });

  it('explains W-REPLICACIONES-SIN-OBSERVACIONES the same way it explains W-RECURSO-SATURADO', () => {
    setLocale('en');
    const partial: RunResult = {
      ...golden,
      warnings: [
        'W-REPLICACIONES-SIN-OBSERVACIONES: Task: no instance completed in 12 of 30 replications; ' +
          'its time statistics average only the other 18.',
      ],
    };
    mount(partial);
    expect(text()).toContain(en.resultados.notaReplicacionesSinObservaciones);
    // And it does not explain a warning nobody is looking at.
    act(() => root!.render(<ResultsView ir={ir} scenario={scenario} result={{ ...golden, warnings: ['W-SIN-SEED: run.seed'] }} />));
    expect(text()).not.toContain(en.resultados.notaReplicacionesSinObservaciones);
  });

  it('the legacy and W-REPLICACIONES-SIN-OBSERVACIONES notes follow the catalog in Spanish', () => {
    setLocale('es');
    const legacy = {
      ...golden,
      replications: {
        ...golden.replications!,
        kpis: Object.fromEntries(
          Object.entries(golden.replications!.kpis).map(([kpi, summary]) => [
            kpi,
            { ci95: summary.ci95, mean: summary.mean, sd: summary.sd },
          ]),
        ),
      },
      warnings: [
        'W-REPLICACIONES-SIN-OBSERVACIONES: Tarea: ninguna instancia terminó en 12 de 30 replicaciones; ' +
          'sus estadísticas de tiempo promedian solo las otras 18.',
      ],
    } as unknown as RunResult;
    mount(legacy);
    expect(text()).toContain(es.resultados.notaReplicacionesLegado);
    expect(text()).toContain(es.resultados.notaReplicacionesSinObservaciones);
    expect(text()).not.toContain(en.resultados.notaReplicacionesLegado);
    expect(text()).not.toContain(en.resultados.notaReplicacionesSinObservaciones);
  });

  it('the saturation note says the same criterion in Spanish', () => {
    setLocale('es');
    const saturated: RunResult = {
      ...golden,
      warnings: ['W-RECURSO-SATURADO: cajero: la cola crece sin estabilizarse (ocupación ≈ 96 %)'],
    };
    mount(saturated);
    const note = es.resultados.notaSaturacion;
    expect(text()).toContain(note);
    expect(text()).not.toContain(en.resultados.notaSaturacion);
    expect(note).toContain('llega a 1,1');
    expect(note).toContain('ocupación llega al 90 %');
    expect(note).toContain('la cola crece o queda trabajo pendiente');
    expect(note).toContain('ningún número decide solo');
    expect(note).toContain('La demanda atribuida cuenta solo las instancias que esperaron');
    expect(note).toContain('con el pool lleno');
  });
});
