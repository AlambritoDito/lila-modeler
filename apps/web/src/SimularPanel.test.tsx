// @vitest-environment jsdom
/**
 * Lote M, C1 — the guided Simulate panel: «▶ Simulate» takes you to the first problem, the step
 * keys (Alt+1…6, ←/→), Esc clears the selection without stealing the run's Esc, the selected
 * element shows only this step, the compact header of the detached window, and the shell's hooks
 * (`onSimular`, `onConteoProblemas`, `irAlProblema`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';

import type { PasoId } from './ids';
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
  raiz = null;
  contenedor = null;
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

interface Opciones {
  inicial: Json;
  seleccionInicial?: string | null;
  onSimular?: () => void;
  onConteoProblemas?: (n: number) => void;
  irAlProblema?: number | null;
  enVentana?: boolean;
}

let seleccionActual: string | null = null;

function Anfitrion({ inicial, seleccionInicial = null, onSimular, onConteoProblemas, irAlProblema, enVentana }: Opciones): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({ [ARCHIVO]: inicial });
  const [seleccion, setSeleccion] = useState<string | null>(seleccionInicial);
  seleccionActual = seleccion;
  return (
    <>
      <button type="button" onClick={() => { setSeleccion('Task_RegisterRequest'); }}>sel:task</button>
      <button type="button" onClick={() => { setSeleccion('End_ServiceCompleted'); }}>sel:end</button>
      <input aria-label="campo-externo" />
      <ScenarioPanel
        archivo={ARCHIVO}
        escenarios={escenarios}
        onCambio={(a, e) => { setEscenarios((p) => ({ ...p, [a]: e })); }}
        onGuardar={() => {}}
        onDuplicar={() => {}}
        ir={ir}
        seleccion={seleccion}
        onSeleccionar={setSeleccion}
        {...(onSimular === undefined ? {} : { onSimular })}
        {...(onConteoProblemas === undefined ? {} : { onConteoProblemas })}
        {...(irAlProblema === undefined ? {} : { irAlProblema })}
        enVentana={enVentana ?? false}
      />
    </>
  );
}

const paso = (p: PasoId): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.pasos button[data-paso="${p}"]`)!;
const abierto = (): string | undefined => document.querySelector('.pasos button[aria-selected="true"]')?.getAttribute('data-paso') ?? undefined;
const texto = (): string => document.querySelector('.escenario')?.textContent ?? '';
function boton(t: string): HTMLButtonElement {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === t);
  if (b === undefined) throw new Error(`no button «${t}»`);
  return b;
}
const simular = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.sim-cabecera .sim-simular')!;
function tecla(init: KeyboardEventInit, destino: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    destino.dispatchEvent(e);
  });
  return e;
}

/** The AS-IS with `Task_PrepareService` taking a pool that does not exist: an error (E-REC-DESCONOCIDO) in Resources. */
function conError(): Json {
  const escenario = asIs();
  const elementos = { ...(escenario['elements'] as Json) };
  elementos['Task_PrepareService'] = { ...(elementos['Task_PrepareService'] as Json), resources: [{ ref: 'nobody', quantity: 1 }] };
  return { ...escenario, elements: elementos };
}

describe('«▶ Simulate» of the panel', () => {
  it('a task without duration (a warning) marks Times and its banner, and Simulate still runs at the first click', () => {
    const onSimular = vi.fn();
    montar(<Anfitrion inicial={sinTiempo()} onSimular={onSimular} />);
    expect(paso('times').querySelector('.paso-problemas')?.textContent).toBe('! 1');
    expect(document.querySelector('.sim-banner')?.textContent).toContain(en.pasosSim.bannerUno);
    // Warnings do not stop the run: no badge on the button, and the click runs.
    expect(simular().querySelector('.sim-insignia')).toBeNull();
    act(() => { paso('calendars').click(); });
    act(() => { simular().click(); });
    expect(onSimular).toHaveBeenCalledTimes(1);
    expect(abierto()).toBe('calendars');
    expect(document.querySelector('.sim-aviso')).toBeNull();
  });

  it('with an error (E-*), one click opens its step, selects its element and shows the banner', () => {
    const onSimular = vi.fn();
    montar(<Anfitrion inicial={conError()} onSimular={onSimular} />);
    act(() => { paso('calendars').click(); });
    expect(simular().querySelector('.sim-insignia')?.textContent).toBe('1');

    act(() => { simular().click(); });

    expect(onSimular).not.toHaveBeenCalled();
    expect(abierto()).toBe('resources');
    expect(seleccionActual).toBe('Task_PrepareService');
    expect(document.querySelector('.sim-banner')?.textContent).toContain('nobody');
    expect(document.querySelector('[role="status"].sim-aviso')?.textContent).toBe(en.pasosSim.noSePuede(1));
    // Only this step's fields of the task: its resources, not its duration.
    expect(document.getElementById('campo-elements.Task_PrepareService.resources[0].ref')).not.toBeNull();
    expect(document.getElementById('campo-elements.Task_PrepareService.processingTime')).toBeNull();
  });

  it('runs when nothing holds it back', () => {
    const onSimular = vi.fn();
    montar(<Anfitrion inicial={asIs()} onSimular={onSimular} />);
    expect(simular().querySelector('.sim-insignia')).toBeNull();
    act(() => { simular().click(); });
    expect(onSimular).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.sim-aviso')).toBeNull();
  });

  it('does not report a warning to the shell as something to fix', () => {
    const conteo = vi.fn();
    montar(<Anfitrion inicial={sinTiempo()} onConteoProblemas={conteo} irAlProblema={null} />);
    // A warning alone is not counted: nothing stops the run.
    expect(conteo).toHaveBeenLastCalledWith(0);
  });

  it('counts the errors for the shell and goes to the first one when the shell asks', () => {
    const conteo = vi.fn();
    montar(<Anfitrion inicial={conError()} onConteoProblemas={conteo} irAlProblema={null} />);
    expect(conteo).toHaveBeenLastCalledWith(1);
    act(() => { paso('run').click(); });
    act(() => { raiz!.render(<Anfitrion inicial={conError()} onConteoProblemas={conteo} irAlProblema={1} />); });
    expect(abierto()).toBe('resources');
    expect(seleccionActual).toBe('Task_PrepareService');
  });

  it('the banner lists the step\'s problems with a «Go» that selects the element', () => {
    montar(<Anfitrion inicial={sinTiempo()} />);
    expect(abierto()).toBe('times');
    const banner = document.querySelector('.sim-banner')!;
    expect(banner.textContent).toContain('Prepare the service');
    act(() => { banner.querySelector('button')!.click(); });
    expect(seleccionActual).toBe('Task_PrepareService');
  });
});

describe('step keys', () => {
  it('Alt+5 opens Calendars from anywhere, with the focus on its tab; Alt+1…6 by position', () => {
    montar(<Anfitrion inicial={asIs()} />);
    const e = tecla({ key: '∞', code: 'Digit5', altKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(abierto()).toBe('calendars');
    tecla({ key: '¡', code: 'Digit1', altKey: true });
    expect(abierto()).toBe('arrivals');
    // Not with ⌘/Ctrl: those are the modes.
    tecla({ key: '6', code: 'Digit6', altKey: true, metaKey: true });
    expect(abierto()).toBe('arrivals');
  });

  it('←/→ walk the tabs cyclically and Home/End jump to the ends', () => {
    montar(<Anfitrion inicial={asIs()} />);
    const lista = document.querySelector('.pasos')!;
    tecla({ key: 'ArrowRight' }, lista);
    expect(abierto()).toBe('routes');
    tecla({ key: 'End' }, lista);
    expect(abierto()).toBe('run');
    tecla({ key: 'ArrowRight' }, lista);
    expect(abierto()).toBe('arrivals');
    tecla({ key: 'ArrowLeft' }, lista);
    expect(abierto()).toBe('run');
    tecla({ key: 'Home' }, lista);
    expect(abierto()).toBe('arrivals');
  });

  it('Esc clears the selection, but not inside a field nor when the run already took it', () => {
    montar(<Anfitrion inicial={asIs()} seleccionInicial="Task_RegisterRequest" />);
    tecla({ key: 'Escape' }, document.querySelector('input[aria-label="campo-externo"]')!);
    expect(seleccionActual).toBe('Task_RegisterRequest');
    // `App.tsx` cancels a run on Esc and marks the event handled: the panel leaves it alone.
    const tomado = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    tomado.preventDefault();
    act(() => { document.body.dispatchEvent(tomado); });
    expect(seleccionActual).toBe('Task_RegisterRequest');
    tecla({ key: 'Escape' });
    expect(seleccionActual).toBeNull();
  });

  it('previous / next walk the steps, and the last one offers «▶ Simulate»', () => {
    const onSimular = vi.fn();
    montar(<Anfitrion inicial={asIs()} onSimular={onSimular} />);
    act(() => { boton(en.pasosSim.siguiente(en.escenario.paso['routes']!)).click(); });
    expect(abierto()).toBe('routes');
    act(() => { boton(en.pasosSim.anterior(en.escenario.paso['times']!)).click(); });
    expect(abierto()).toBe('times');
    act(() => { paso('run').click(); });
    const ultimo = document.querySelector<HTMLButtonElement>('.sim-navegacion .primario')!;
    act(() => { ultimo.click(); });
    expect(onSimular).toHaveBeenCalledTimes(1);
  });
});

describe('the selected element shows only this step', () => {
  it('an end event in Routes says it has nothing there; a task in Routes offers the way to Times', () => {
    montar(<Anfitrion inicial={asIs()} />);
    act(() => { paso('routes').click(); });
    act(() => { boton('sel:end').click(); });
    expect(texto()).toContain(en.pasosSim.consejos['end']);
    act(() => { boton('sel:task').click(); });
    expect(texto()).toContain(en.pasosSim.consejos['task']);
    act(() => { boton(en.pasosSim.irA(en.escenario.paso['times']!)).click(); });
    expect(abierto()).toBe('times');
    expect(document.getElementById('campo-elements.Task_RegisterRequest.processingTime')).not.toBeNull();
    expect(texto()).toContain(en.pasosSim.duracionMedia);
  });

  it('«Show all» clears the selection and brings the step\'s overview back', () => {
    montar(<Anfitrion inicial={asIs()} seleccionInicial="Task_RegisterRequest" />);
    act(() => { paso('resources').click(); });
    expect(document.getElementById('campo-resources.executive.capacity')).toBeNull();
    act(() => { boton(en.pasosSim.verTodo).click(); });
    expect(seleccionActual).toBeNull();
    expect(document.getElementById('campo-resources.executive.capacity')).not.toBeNull();
  });

  it('Arrivals with a single start event is its card: pattern, rate and limits', () => {
    montar(<Anfitrion inicial={asIs()} />);
    act(() => { paso('arrivals').click(); });
    expect(texto()).toContain(en.pasosSim.patron);
    expect(texto()).toContain(en.pasosSim.limites);
    expect(document.getElementById('campo-elements.StartEvent_Request.interTriggerTimer')).not.toBeNull();
    expect(document.getElementById('campo-elements.StartEvent_Request.triggerCount')).not.toBeNull();
    expect(document.querySelector('.sim-dato')?.textContent).toMatch(/^≈ /);
  });

  it('Run keeps every run field in three groups', () => {
    montar(<Anfitrion inicial={asIs()} />);
    act(() => { paso('run').click(); });
    for (const campo of ['baseTimeUnit', 'start', 'duration', 'warmup', 'replications', 'seed', 'serviceLevel', 'currency']) {
      expect(document.getElementById(`campo-run.${campo}`), campo).not.toBeNull();
    }
    expect(texto()).toContain(en.pasosSim.confianza);
  });
});

describe('compact header of the detached window', () => {
  it('names only the open step; the others carry a bare «!» when they have problems', () => {
    montar(<Anfitrion inicial={sinTiempo()} enVentana />);
    act(() => { paso('run').click(); });
    const nombres = [...document.querySelectorAll('.pasos .paso-nombre')].map((n) => n.textContent);
    expect(nombres).toEqual(['Run']);
    expect(paso('times').querySelector('.paso-problemas')?.textContent).toBe('!');
    expect(paso('times').getAttribute('title')).toContain(en.pasosSim.titulos['times']);
    expect(document.querySelector('.sim-cabecera .sim-simular')).not.toBeNull();
  });
});

describe('problems the steps do not own, and flows in Times (QA of C1a)', () => {
  it('an entry for an element the diagram does not have is listed at the foot, and holds Simulate back', () => {
    const escenario = asIs();
    montar(<Anfitrion inicial={{ ...escenario, elements: { ...(escenario['elements'] as Json), Ghost_1: { fixedCost: 1 } } }} />);
    const pie = document.querySelector('.sim-sinpaso');
    expect(pie?.textContent).toContain(en.pasosSim.sinPaso);
    expect(pie?.textContent).toContain('Ghost_1');
    expect(simular().querySelector('.sim-insignia')).not.toBeNull();
  });

  it('a flow selected in Times says it is edited in Routes, with the way there', () => {
    montar(<Anfitrion inicial={asIs()} seleccionInicial="Flow_ScreeningGood" />);
    expect(abierto()).toBe('times');
    expect(texto()).toContain(en.pasosSim.consejos['flow']);
    act(() => { boton(en.pasosSim.irA(en.escenario.paso['routes']!)).click(); });
    expect(abierto()).toBe('routes');
    expect(document.getElementById('campo-elements.Flow_ScreeningGood.probability')).not.toBeNull();
  });
});
