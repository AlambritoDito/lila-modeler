// @vitest-environment jsdom
/**
 * Lote M, C6 — the Simulate steps in the main window's full-width sub-bar (design 1a/1b): the
 * panel draws its six named steps there through `barraPasos` (one step state, the panel's), the
 * docked panel is then only the step's content, and the detached window keeps the compact header.
 * Plus the two figures the Results summary gained (throughput and total cost, QA of #604).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ProcessIR, RunResult } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';

import { PASO_IDS, type PasoId } from './ids';
import { PanelResumen, partirDuracion } from './PanelResumen';
import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { en } from './strings.en';

setLocale('en');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');
const CASO = 'packages/engine/test/fixtures/service-request';
const ARCHIVO = 'as-is.scenario.json';

type Json = Record<string, unknown>;
let ir: ProcessIR;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(RAIZ, `${CASO}/model.bpmn`), 'utf8'))).ir;
}, 120_000);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
/** The sub-bar slot of the shell, outside the panel's own tree like the real one. */
let ranura: HTMLDivElement | null = null;

function montar(nodo: React.JSX.Element): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(nodo);
  });
}

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  ranura?.remove();
  raiz = null;
  contenedor = null;
  ranura = null;
});

function asIs(): Json {
  return JSON.parse(readFileSync(resolve(RAIZ, `${CASO}/as-is.scenario.json`), 'utf8')) as Json;
}

/** The AS-IS without the time of `Task_PrepareService`: one problem, in Times. */
function sinTiempo(): Json {
  const escenario = asIs();
  const elementos = { ...(escenario['elements'] as Json) };
  const tarea = { ...(elementos['Task_PrepareService'] as Json) };
  delete tarea['processingTime'];
  elementos['Task_PrepareService'] = tarea;
  return { ...escenario, elements: elementos };
}

function Anfitrion({ inicial, enVentana = false, conRanura = true, onElegirPaso, pasoInicial = null }: { inicial: Json; enVentana?: boolean; conRanura?: boolean; onElegirPaso?: () => void; pasoInicial?: PasoId | null }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({ [ARCHIVO]: inicial });
  const [seleccion, setSeleccion] = useState<string | null>(null);
  return (
    <ScenarioPanel
      archivo={ARCHIVO}
      escenarios={escenarios}
      onCambio={(a, e) => { setEscenarios((p) => ({ ...p, [a]: e })); }}
      onGuardar={() => {}}
      onDuplicar={() => {}}
      ir={ir}
      seleccion={seleccion}
      onSeleccionar={setSeleccion}
      enVentana={enVentana}
      barraPasos={conRanura ? ranura : null}
      pasoInicial={pasoInicial}
      {...(onElegirPaso === undefined ? {} : { onElegirPaso })}
    />
  );
}

function conRanura(): HTMLDivElement {
  ranura = document.createElement('div');
  ranura.className = 'c6-ranura-pasos';
  document.body.appendChild(ranura);
  return ranura;
}

const enRanura = (): HTMLButtonElement[] => [...ranura!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const abiertoEn = (raizBusqueda: ParentNode): string | null | undefined =>
  raizBusqueda.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-paso');
const titulo = (): string => contenedor!.querySelector('.sim-paso-titulo')?.textContent ?? '';
function tecla(init: KeyboardEventInit, destino: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    destino.dispatchEvent(e);
  });
  return e;
}

describe('the steps in the Simulate sub-bar', () => {
  it('draws the six steps named, with their marks, in the slot; the docked panel keeps only the step', () => {
    conRanura();
    montar(<Anfitrion inicial={sinTiempo()} />);
    const tabs = enRanura();
    expect(tabs.map((t) => t.dataset['paso'])).toEqual([...PASO_IDS]);
    expect(tabs.map((t) => t.querySelector('.paso-nombre')?.textContent)).toEqual(PASO_IDS.map((p) => en.escenario.paso[p]));
    expect(tabs.map((t) => t.querySelector('.paso-num')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(ranura!.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe(en.c6.pasosBarra);
    // The problem of Times marks its tab; the others say ✓.
    expect(tabs[1]!.querySelector('.paso-problemas')?.textContent).toBe('! 1');
    expect(tabs[0]!.querySelector('.paso-ok')?.textContent).toBe('✓');
    // The hint of the keys sits at the end of the bar.
    expect(ranura!.querySelector('.c6-pista')?.textContent).toMatch(/1…6/);
    // The panel: no header, no tabs of its own; the step's title, banner and navigation stay.
    expect(contenedor!.querySelector('.sim-cabecera')).toBeNull();
    expect(contenedor!.querySelector('[role="tab"]')).toBeNull();
    expect(contenedor!.querySelector('.sim-panel')!.classList.contains('c6-sin-cabecera')).toBe(true);
    expect(contenedor!.querySelector('.sim-paso-n')?.textContent).toContain('2');
    expect(titulo()).toBe(en.pasosSim.titulos.times);
    expect(contenedor!.querySelector('.sim-banner')).not.toBeNull();
    expect(contenedor!.querySelector('.sim-navegacion')).not.toBeNull();
    // The tabs control the panel's body (same document).
    expect(tabs[1]!.getAttribute('aria-controls')).toBe('sim-cuerpo');
    expect(document.getElementById('sim-cuerpo')!.getAttribute('aria-labelledby')).toBe('sim-paso-times');
  });

  it('one step state: a tab of the sub-bar opens the step in the panel and «Next» moves the sub-bar', () => {
    conRanura();
    const onElegirPaso = vi.fn();
    montar(<Anfitrion inicial={asIs()} onElegirPaso={onElegirPaso} />);
    act(() => enRanura()[3]!.click());
    expect(abiertoEn(ranura!)).toBe('resources');
    expect(titulo()).toBe(en.pasosSim.titulos.resources);
    expect(onElegirPaso).toHaveBeenCalled();
    const siguiente = contenedor!.querySelector<HTMLButtonElement>('.sim-siguiente')!;
    act(() => siguiente.click());
    expect(abiertoEn(ranura!)).toBe('calendars');
  });

  it('is a tablist: ←/→, Home and End move and focus inside the sub-bar; Alt+n focuses its tab', async () => {
    conRanura();
    montar(<Anfitrion inicial={asIs()} />);
    const lista = ranura!.querySelector('[role="tablist"]')!;
    const tabs = enRanura();
    expect(tabs.filter((t) => t.tabIndex === 0).map((t) => t.dataset['paso'])).toEqual(['times']);
    tabs[1]!.focus();
    tecla({ key: 'ArrowRight' }, tabs[1]!);
    expect(abiertoEn(ranura!)).toBe('routes');
    await Promise.resolve();
    expect(document.activeElement).toBe(ranura!.querySelector('[data-paso="routes"]'));
    tecla({ key: 'End' }, lista);
    expect(abiertoEn(ranura!)).toBe('run');
    await Promise.resolve();
    expect(document.activeElement).toBe(ranura!.querySelector('[data-paso="run"]'));
    tecla({ key: 'Home' }, lista);
    expect(abiertoEn(ranura!)).toBe('arrivals');
    tecla({ key: 'ArrowLeft' }, lista);
    expect(abiertoEn(ranura!)).toBe('run');
    expect(tecla({ key: '4', code: 'Digit4', altKey: true }).defaultPrevented).toBe(true);
    expect(abiertoEn(ranura!)).toBe('resources');
    await Promise.resolve();
    expect(document.activeElement).toBe(ranura!.querySelector('[data-paso="resources"]'));
  });

  it('detached: the window keeps the compact header and the main sub-bar follows the same step', () => {
    conRanura();
    montar(<Anfitrion inicial={asIs()} enVentana />);
    const cabecera = contenedor!.querySelector('.sim-cabecera')!;
    expect(cabecera).not.toBeNull();
    expect(cabecera.querySelectorAll('[role="tab"]')).toHaveLength(6);
    // Compact: only the open step is named on screen.
    expect(cabecera.querySelectorAll('.paso-nombre')).toHaveLength(1);
    expect(enRanura()).toHaveLength(6);
    // The body is in the other document: the sub-bar's tabs point at nothing there.
    expect(enRanura().every((t) => !t.hasAttribute('aria-controls'))).toBe(true);
    act(() => enRanura()[4]!.click());
    expect(abiertoEn(cabecera)).toBe('calendars');
    act(() => cabecera.querySelector<HTMLButtonElement>('[data-paso="routes"]')!.click());
    expect(abiertoEn(ranura!)).toBe('routes');
  });

  it('without a slot (Model\'s Simulation tab) the panel keeps its own header and steps, as before', () => {
    montar(<Anfitrion inicial={asIs()} conRanura={false} />);
    expect(contenedor!.querySelector('.sim-cabecera [role="tablist"]')).not.toBeNull();
    expect(contenedor!.querySelectorAll('.sim-cabecera .paso-nombre')).toHaveLength(6);
  });
});

describe('the step survives a remount', () => {
  it('opens on `pasoInicial` (the shell\'s last step) instead of Times', () => {
    conRanura();
    montar(<Anfitrion inicial={asIs()} pasoInicial="calendars" />);
    expect(abiertoEn(ranura!)).toBe('calendars');
    expect(titulo()).toBe(en.pasosSim.titulos.calendars);
  });

  it('the sub-bar tabs drop aria-controls while the panel is hidden behind another tab', () => {
    conRanura();
    contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    raiz = createRoot(contenedor);
    act(() => {
      raiz!.render(<ScenarioPanel archivo={ARCHIVO} escenarios={{ [ARCHIVO]: asIs() }} onCambio={() => {}} onGuardar={() => {}} onDuplicar={() => {}}
        ir={ir} seleccion={null} onSeleccionar={() => {}} barraPasos={ranura} cuerpoOculto />);
    });
    expect(enRanura().every((t) => !t.hasAttribute('aria-controls'))).toBe(true);
  });
});

describe('the Results summary', () => {
  it('splits a duration into the hours and the exact minutes, for the one-line narrow summary', () => {
    expect(partirDuracion('187.09 h (11225.46 min)')).toEqual(['187.09 h', '(11225.46 min)']);
    expect(partirDuracion('8 min')).toEqual(['8 min', '']);
  });

  it('shows throughput and total cost without a click, under the design\'s six KPIs', () => {
    const resultado = {
      process: {
        completed: 1485.23, inFlight: 3, costPerCase: 54.06, throughputPerHour: 2.0712, totalCost: 80287.987,
        cycleTime: { mean: 11224.66 }, waitTime: { mean: 120 },
      },
      resources: { cocina: { utilization: 0.81 } },
      elements: {},
      bottlenecks: [],
    } as unknown as RunResult;
    const escenario = { run: { baseTimeUnit: 'min', currency: 'MXN' } } as unknown as ResolvedScenario;
    montar(<PanelResumen ir={ir} result={resultado} scenario={escenario} seleccion={null} onSeleccionar={() => {}} />);
    expect(contenedor!.querySelectorAll('.c5-kpis > div')).toHaveLength(6);
    const extra = [...contenedor!.querySelectorAll('.c6-kpis-extra > div')].map((d) => [d.querySelector('dt')?.textContent, d.querySelector('dd')?.textContent]);
    expect(extra).toEqual([
      [en.c6.throughput, '2.07 / h'],
      [en.c6.costoTotal, '80287.99 MXN'],
    ]);
  });
});
