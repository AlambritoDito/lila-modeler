// @vitest-environment jsdom
/**
 * Lote M, C7 (final polish): the KPIs' 95 % CI in the scenario's unit, the selected task's durations
 * on one line like the KPIs, the time bar as a row under the map, and a pool or a lane selected in
 * Simulate read by its name (never its raw id), with a lane in Resources answered by the step.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR, RunResult } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';

import { elegirCarril, publicarCarriles, publicarContenedores, type ContenedorVisual } from './carrilClic';
import { kpisDe, PanelResumen, tituloKpi } from './PanelResumen';
import { ScenarioPanel } from './ScenarioPanel';
import { exactDuration } from './formatDisplay';
import { setLocale } from './i18n';
import { en } from './strings.en';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let irPedido: ProcessIR;

beforeAll(async () => {
  setLocale('en');
  irPedido = (await parseBpmn(readFileSync(resolve(RAIZ, 'examples/pedido/model.bpmn'), 'utf8'))).ir;
}, 120_000);

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  publicarCarriles(null);
  publicarContenedores(null);
  elegirCarril(null);
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

/** The engine keeps durations in seconds: a cycle of 11117.2 min is 667032 s. */
const resultado = {
  process: {
    completed: 120, inFlight: 3, costPerCase: 54.06, throughputPerHour: 2.07, totalCost: 6487.2,
    cycleTime: { mean: 667_032 }, waitTime: { mean: 11_700 },
  },
  resources: { cocina: { utilization: 0.81 } },
  elements: { T: { completed: 118, processing: { mean: 600 }, resourceWait: { mean: 11_700 } } },
  bottlenecks: [],
  replications: {
    kpis: {
      'process.cycleTime.mean': { mean: 667_032, n: 30, sd: 1, ci95: [660_477.21, 673_586.95] },
      'process.waitTime.mean': { mean: 11_700, n: 30, sd: 1, ci95: [11_100, 12_300] },
      'process.completed': { mean: 120, n: 30, sd: 1, ci95: [118.4, 121.6] },
      'process.costPerCase': { mean: 54.06, n: 30, sd: 1, ci95: [53.5, 54.6] },
    },
  },
} as unknown as RunResult;
const escenario = { run: { baseTimeUnit: 'min', currency: 'MXN' } } as unknown as ResolvedScenario;
const ir = { nodes: { T: { type: 'task', name: 'Prepare food' } }, flows: {} } as unknown as ProcessIR;

describe('Results summary polish (Lote M, C7)', () => {
  it('the CI of a duration KPI is in the same unit as its value, not in the engine\'s seconds', () => {
    const por = Object.fromEntries(kpisDe(resultado, escenario).map((k) => [k.id, k]));
    const ciclo = tituloKpi(por['ciclo']!, resultado);
    expect(ciclo).toBe([en.c5.resultados.kpiTitulos.ciclo, '11117.2 min', en.c5.resultados.ic95('11007.95 min', '11226.45 min')].join(' · '));
    expect(ciclo).not.toContain('660477');
    expect(tituloKpi(por['espera']!, resultado)).toContain(en.c5.resultados.ic95('185 min', '205 min'));
    // Non-durations keep their own format: cases as they are, the cost with its currency.
    expect(tituloKpi(por['completados']!, resultado)).toContain(en.c5.resultados.ic95('118.4', '121.6'));
    expect(tituloKpi(por['costoCaso']!, resultado)).toContain(en.c5.resultados.ic95('53.5 MXN', '54.6 MXN'));
  });

  it('the selected task\'s mean wait reads like the KPIs: one line in the narrow panel, exact value in the title', () => {
    contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    raiz = createRoot(contenedor);
    act(() => { raiz!.render(<PanelResumen ir={ir} result={resultado} scenario={escenario} seleccion="T" onSeleccionar={() => {}} />); });
    const datos = [...contenedor.querySelectorAll('.c5-tarea-datos > div')];
    const espera = datos.find((d) => d.querySelector('dt')?.textContent === en.c5.resultados.espera)!;
    const dd = espera.querySelector('dd')!;
    expect(dd.title).toBe(exactDuration(11_700, 'min'));
    // «3.25 h» first, «(195 min)» in the same span the KPIs hide when the panel is narrow.
    expect(dd.firstChild?.textContent).toBe('3.25 h');
    expect(dd.querySelector('.c6-kpi-paren')?.textContent).toBe(' (195 min)');
    const kpi = contenedor.querySelector('.c5-kpis > div:nth-child(2) dd')!;
    expect(kpi.innerHTML).toBe(dd.innerHTML);
  });

  const css = (): string => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');

  it('CSS: the narrow panel hides the parenthesis of the selected task too, and its values do not wrap', () => {
    expect(css()).toContain('.panel:not(.ancho) .c5-tarea-datos .c6-kpi-paren');
    expect(css()).toMatch(/\.c5-tarea-datos dd \{ white-space: nowrap;/);
  });

  it('CSS: the time bar is a 48 px row under the map, and its «Partial replay…» note is read whole', () => {
    expect(css()).toMatch(/\.app\.modo-resultados \.zona-modelo:has\(> \.c5-tiempo\) \{ display: flex; flex-direction: column; \}/);
    const fila = /\.app\.modo-resultados \.zona-modelo > \.c5-tiempo \{([^}]*)\}/.exec(css())?.[1] ?? '';
    expect(fila).toContain('position: static');
    expect(fila).toContain('height: 48px');
    // The zoom buttons move up by the row, so they keep their distance from the bpmn.io mark.
    expect(css()).toContain('.app.modo-resultados .zona-modelo:has(> .c5-tiempo) > .zoom { bottom: calc(46px + 48px); }');
    // The note folds by the row's own width, not the window's: at 1280 px with the 320 px panel the
    // row is 960 px wide and the note is read whole (it used to hide below a 1400 px window).
    expect(css()).toMatch(/\.c5-tiempo \{ container-type: inline-size; \}/);
    const pliegue = /@container \(max-width: (\d+)px\) \{\s*\.c5-tiempo > \.aviso \{ display: none; \}/.exec(css());
    expect(Number(pliegue?.[1])).toBeLessThan(960);
    expect(css()).not.toMatch(/@media \(max-width: 1399px\) \{\s*\.c5-tiempo > \.aviso/);
  });
});

describe('a pool or a lane selected in Simulate (Lote M, C7)', () => {
  const escenario = JSON.parse(readFileSync(resolve(RAIZ, 'examples/pedido/as-is.scenario.json'), 'utf8')) as Record<string, unknown>;
  /** What `carrilClic.apply` publishes for Sample order, plus an unnamed pool and a lane. */
  const CAJAS: ContenedorVisual[] = [
    { id: 'Participant_Restaurante', tipo: 'bpmn:Participant', nombre: 'Restaurant' },
    { id: 'Participant_X', tipo: 'bpmn:Participant', nombre: null },
    { id: 'Lane_Cocina', tipo: 'bpmn:Lane', nombre: 'Kitchen' },
  ];

  function panel(seleccion: string | null): React.JSX.Element {
    return (
      <ScenarioPanel archivo="as-is.scenario.json" escenarios={{ 'as-is.scenario.json': escenario }} onCambio={() => {}}
        onGuardar={() => {}} onDuplicar={() => {}} ir={irPedido} seleccion={seleccion} onSeleccionar={() => {}} />
    );
  }
  function montar(seleccion: string | null): void {
    contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    raiz = createRoot(contenedor);
    act(() => { raiz!.render(panel(seleccion)); });
  }
  function irAPaso(paso: string): void {
    const boton = contenedor!.querySelector<HTMLButtonElement>(`.pasos button[data-paso="${paso}"]`)!;
    act(() => { boton.click(); });
  }
  const encabezado = (): string | null | undefined => contenedor!.querySelector('details.sim-elemento > p.vacio')?.textContent;

  it('the pool reads its name and kind, with no element fields to fill', () => {
    act(() => { publicarContenedores(CAJAS); });
    montar('Participant_Restaurante');
    irAPaso('resources');
    expect(encabezado()).toBe('Restaurant');
    expect(contenedor!.textContent).not.toContain('Participant_Restaurante');
    expect(contenedor!.querySelector('.sim-seleccion-tipo')?.textContent).toBe(en.pasosSim.soloEstePaso('Pool'));
    // The scenario has nothing for a pool: the step says so instead of a generic «Resources» form.
    expect(contenedor!.querySelector('.sim-nota')?.textContent).toContain(en.pasosSim.nada('Pool', en.escenario.paso['resources']!));
    expect(contenedor!.querySelector('details.sim-elemento input, details.sim-elemento select')).toBeNull();
    // An unnamed pool reads as such, not as its id.
    act(() => { raiz!.render(panel('Participant_X')); });
    expect(encabezado()).toBe(en.c7.sinNombre['bpmn:Participant']);
  });

  it('a lane picked by its name in Resources opens «Lane X · n tasks → resource», not the lane as an element', () => {
    act(() => {
      publicarContenedores(CAJAS);
      publicarCarriles([{ id: 'Lane_Cocina', nombre: 'Kitchen', nodos: ['Task_Preparar'] }]);
    });
    montar(null);
    irAPaso('resources');
    // The click on the lane's name (carrilClic) picks it, and the canvas then selects the lane.
    act(() => { elegirCarril('Lane_Cocina'); });
    act(() => { raiz!.render(panel('Lane_Cocina')); });
    expect(contenedor!.textContent).toContain(en.recursos.carrilTitulo('Kitchen', 1));
    expect(contenedor!.querySelector('details.sim-elemento')).toBeNull();
    expect(contenedor!.textContent).not.toContain('Lane_Cocina');
    // In another step the lane is just named, like the pool.
    irAPaso('times');
    expect(encabezado()).toBe('Kitchen');
  });
});
