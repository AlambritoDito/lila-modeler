// @vitest-environment jsdom
/**
 * Lote M, C4 — the Routes step: percentages in, fractions in the file.
 *
 * The acceptance path of the professor's script, step 3 (XOR 70/30): select the gateway, type 70 in
 * «Approved», one click on «Set «Rejected» to 30 %» — and the delta holds exactly 0.7 / 0.3, the
 * same bytes as a hand-written file. Plus ↑×4 on 50 = 70, Escape, the list, the join note and the
 * inclusive gateway that does not need to add up. The model is `examples/pedido`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';

import { borrar, escribir, porRuta, type Contexto } from './escenarioModelo.js';
import { compuertaDeSeleccion, PasoRutas } from './PasoRutas.js';
import { setLocale } from './i18n';
import { ScenarioPanel } from './ScenarioPanel.js';

setLocale('en');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
type Json = Record<string, unknown>;
let ir: ProcessIR;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(RAIZ, 'examples/pedido/model.bpmn'), 'utf8'))).ir;
}, 120_000);

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
let delta: Json = {};

afterEach(() => {
  act(() => { raiz?.unmount(); });
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

/** A host with the panel's delta semantics, without extends (resolved = delta). */
function Anfitrion({ inicial, seleccionInicial }: { inicial: Json; seleccionInicial: string | null }): React.JSX.Element {
  const [d, setD] = useState<Json>(inicial);
  const [sel, setSel] = useState<string | null>(seleccionInicial);
  delta = d;
  const ctx: Contexto = {
    resuelto: d,
    problemas: porRuta([]),
    editar: (ruta, valor) => { setD((x) => escribir(x, ruta, valor)); },
    quitar: (ruta) => { setD((x) => borrar(x, ruta)); },
    editarVarios: (cambios) => {
      setD((x) => cambios.reduce((acc, c) => escribir(acc, c.ruta, c.valor), x));
    },
  };
  return <PasoRutas ctx={ctx} ir={ir} seleccion={sel} onSeleccionar={setSel} />;
}

function montar(inicial: Json, seleccion: string | null): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => { raiz!.render(<Anfitrion inicial={inicial} seleccionInicial={seleccion} />); });
}

const campo = (etiqueta: string): HTMLInputElement =>
  contenedor!.querySelector<HTMLInputElement>(`input[aria-label="Percentage of «${etiqueta}»"]`)!;

function teclear(input: HTMLInputElement, texto: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    input.focus();
    setter.call(input, texto);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function tecla(input: HTMLInputElement, key: string): void {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

function boton(texto: string): HTMLButtonElement {
  const b = [...contenedor!.querySelectorAll('button')].find((x) => x.textContent === texto);
  if (b === undefined) throw new Error(`no button «${texto}»: ${contenedor!.textContent}`);
  return b;
}

const probabilidades = (): Json => delta['elements'] as Json;
const AS_IS = { elements: { Flow_Aprobado: { probability: 0.78 }, Flow_Rechazado: { probability: 0.22 } } };

describe('Routes step', () => {
  it('XOR 70/30: one field and one click, the file keeps 0.7 / 0.3', () => {
    montar(AS_IS, 'Gateway_Aprobacion');
    expect(campo('Approved').value).toBe('78');
    expect(contenedor!.textContent).toContain('Adds up to 100 %');

    teclear(campo('Approved'), '70');
    expect(contenedor!.querySelector('[role=status]')!.textContent).toContain('Adds up to 92 %: 8 points missing');
    act(() => { boton('Set «Rejected» to 30 %').click(); });

    expect(probabilidades()).toEqual({ Flow_Aprobado: { probability: 0.7 }, Flow_Rechazado: { probability: 0.3 } });
    expect(JSON.stringify(delta)).toBe(
      '{"elements":{"Flow_Aprobado":{"probability":0.7},"Flow_Rechazado":{"probability":0.3}}}',
    );
    expect(contenedor!.querySelector('[role=status]')!.textContent).toContain('Adds up to 100 %');
    expect(contenedor!.querySelector('[role=img]')!.getAttribute('aria-label')).toBe(
      'Split: Approved 70 % · Rejected 30 %. Adds up to 100 %',
    );
  });

  it('↑ four times on 50 leaves 70; Escape restores the value it had on focus', () => {
    montar({ elements: { Flow_Aprobado: { probability: 0.5 }, Flow_Rechazado: { probability: 0.5 } } }, 'Gateway_Aprobacion');
    const input = campo('Approved');
    act(() => { input.focus(); });
    for (let i = 0; i < 4; i++) tecla(input, 'ArrowUp');
    expect(probabilidades()['Flow_Aprobado']).toEqual({ probability: 0.7 });
    tecla(input, 'Escape');
    expect(probabilidades()['Flow_Aprobado']).toEqual({ probability: 0.5 });
  });

  it('emptying a field removes the value; the flow then takes the remainder', () => {
    montar(AS_IS, 'Gateway_Aprobacion');
    teclear(campo('Rejected'), '');
    expect(probabilidades()['Flow_Rechazado']).toEqual({});
    expect(campo('Rejected').placeholder).toBe('22');
  });

  it('split evenly writes explicit shares', () => {
    montar({ elements: { Flow_Aprobado: { probability: 0.9 }, Flow_Rechazado: { probability: 0.3 } } }, 'Flow_Rechazado');
    act(() => { boton('Split evenly').click(); });
    expect(probabilidades()).toEqual({ Flow_Aprobado: { probability: 0.5 }, Flow_Rechazado: { probability: 0.5 } });
  });

  it('without a selection lists the gateways with their split and sum; picking one opens it', () => {
    montar(AS_IS, null);
    const fila = contenedor!.querySelector<HTMLButtonElement>('button[data-id="Gateway_Aprobacion"]')!;
    expect(fila.textContent).toContain('Approved?');
    expect(fila.textContent).toContain('Approved 78 % · Rejected 22 %');
    expect(fila.textContent).toContain('100 %');
    // The AND gateways do not split by percentage.
    expect(contenedor!.querySelector('button[data-id="Gateway_ANDFork"]')).toBeNull();
    act(() => { fila.click(); });
    expect(campo('Approved')).not.toBeNull();
    act(() => { boton('← Gateways').click(); });
    expect(contenedor!.querySelector('button[data-id="Gateway_Aprobacion"]')).not.toBeNull();
  });

  it('a selected outgoing flow opens its gateway; other selections do not', () => {
    expect(compuertaDeSeleccion(ir, 'Flow_Rechazado')).toBe('Gateway_Aprobacion');
    expect(compuertaDeSeleccion(ir, 'Gateway_Aprobacion')).toBe('Gateway_Aprobacion');
    expect(compuertaDeSeleccion(ir, 'Task_Preparar')).toBeNull();
    expect(compuertaDeSeleccion(ir, 'Gateway_ANDFork')).toBeNull();
  });

  it('Spanish labels', () => {
    setLocale('es');
    try {
      montar({ elements: { Flow_Aprobado: { probability: 0.7 }, Flow_Rechazado: { probability: 0.22 } } }, 'Gateway_Aprobacion');
      expect(contenedor!.textContent).toContain('Suma 92 %: faltan 8 puntos');
      expect(boton('Poner «Rejected» en 30 %')).not.toBeNull();
    } finally {
      act(() => { setLocale('en'); });
    }
  });
});

describe('the one-click fix never undoes the flow just edited (QA #602)', () => {
  /** A host whose selection and delta can also change from outside, like the canvas boxes do. */
  let fuera: { seleccionar: (id: string) => void; escribir: (flujo: string, p: number) => void } | null = null;
  function Externo({ inicial }: { inicial: Json }): React.JSX.Element {
    const [d, setD] = useState<Json>(inicial);
    const [sel, setSel] = useState<string | null>('Gateway_Aprobacion');
    delta = d;
    fuera = {
      seleccionar: setSel,
      escribir: (flujo, p) => { setD((x) => escribir(x, ['elements', flujo, 'probability'], p / 100)); },
    };
    const ctx: Contexto = {
      resuelto: d,
      problemas: porRuta([]),
      editar: (ruta, valor) => { setD((x) => escribir(x, ruta, valor)); },
      quitar: (ruta) => { setD((x) => borrar(x, ruta)); },
    };
    return <PasoRutas ctx={ctx} ir={ir} seleccion={sel} onSeleccionar={setSel} />;
  }
  function montarExterno(inicial: Json): void {
    contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    raiz = createRoot(contenedor);
    act(() => { raiz!.render(<Externo inicial={inicial} />); });
  }
  const arreglo = (): string | undefined =>
    contenedor!.querySelector('.rutas-arreglos .boton.primario')?.textContent ?? undefined;

  it('typed on the canvas in the LAST flow: the fix moves the other one', () => {
    montarExterno(AS_IS);
    // The canvas box of «Rejected» got the focus (it selects its flow) and 40 was typed.
    act(() => { fuera!.seleccionar('Flow_Rechazado'); fuera!.escribir('Flow_Rechazado', 40); });
    expect(arreglo()).toBe('Set «Approved» to 60 %');
  });

  it('after a panel edit, a later canvas edit is the one the fix respects', () => {
    montarExterno(AS_IS);
    teclear(campo('Approved'), '60');
    expect(arreglo()).toBe('Set «Rejected» to 40 %');
    act(() => { fuera!.seleccionar('Flow_Rechazado'); fuera!.escribir('Flow_Rechazado', 30); });
    expect(arreglo()).toBe('Set «Approved» to 70 %');
  });

  it('the panel field selects its content on focus and shows an invalid value instead of clamping it', () => {
    montarExterno(AS_IS);
    const input = campo('Approved');
    act(() => { input.focus(); });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
    teclear(input, '4045');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(contenedor!.textContent).toContain('Write a number from 0 to 100.');
    expect(probabilidades()['Flow_Aprobado']).toEqual({ probability: 0.78 });
    teclear(input, '45');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(probabilidades()['Flow_Aprobado']).toEqual({ probability: 0.45 });
  });
});

describe('ScenarioPanel and Routes', () => {
  function Panel({ inicial }: { inicial: string | null }): React.JSX.Element {
    const [esc, setEsc] = useState<Record<string, Json>>({ 'a.scenario.json': { version: 1, ...AS_IS } });
    const [sel, setSel] = useState<string | null>(inicial);
    delta = esc['a.scenario.json']!;
    return (
      <>
        <button type="button" id="elegir-g" onClick={() => { setSel('Gateway_Aprobacion'); }}>g</button>
        <ScenarioPanel
          archivo="a.scenario.json"
          escenarios={esc}
          onCambio={(a, e) => { setEsc((x) => ({ ...x, [a]: e })); }}
          onGuardar={() => {}}
          onDuplicar={() => {}}
          ir={ir}
          seleccion={sel}
          onSeleccionar={setSel}
          onPasoVisible={(p) => { pasos.push(p); }}
        />
      </>
    );
  }
  const pasos: string[] = [];

  it('picking a splitting gateway on the canvas opens Routes with its fields; the file gets 0.7/0.3', () => {
    pasos.length = 0;
    contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    raiz = createRoot(contenedor);
    act(() => { raiz!.render(<Panel inicial={null} />); });
    expect(pasos).toEqual(['times']);
    act(() => { contenedor!.querySelector<HTMLButtonElement>('#elegir-g')!.click(); });
    expect(pasos.at(-1)).toBe('routes');
    teclear(campo('Approved'), '70');
    act(() => { boton('Set «Rejected» to 30 %').click(); });
    expect(probabilidades()).toEqual({ Flow_Aprobado: { probability: 0.7 }, Flow_Rechazado: { probability: 0.3 } });
    // No second, fraction-scaled probability field for the same value.
    expect(contenedor!.querySelector('[id="campo-elements.Flow_Aprobado.probability"]')).toBeNull();
  });
});
