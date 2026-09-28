// @vitest-environment jsdom
/**
 * #449 (f): importing scenario parameters from a spreadsheet, from the panel. Pick a CSV, read the
 * report (what changes, what did not match), apply, and undo; cancelling changes nothing. The
 * engine side (matching, validation, round trip) is covered in
 * `packages/engine/test/scenario-sheets.test.ts`; this is the gesture and the delta it writes.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';

import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { es } from './strings.es';

setLocale('es');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Json = Record<string, unknown>;

const node = (type: ProcessIR['nodes'][string]['type'], name: string) => ({ type, name, incoming: [], outgoing: [] });
const IR: ProcessIR = {
  id: 'P',
  name: 'P',
  nodes: {
    Start: node('start', 'Llega'),
    Task_A: node('task', 'Atender'),
    End: node('end', 'Fin'),
  },
  flows: {},
  source: { exporter: 'test', exporterVersion: '0', originalIds: {}, warnings: [] },
};

const ORIGINAL: Json = {
  version: 1,
  name: 'Base',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00-06:00', duration: 86400, baseTimeUnit: 'min' },
  resources: { cajero: { name: 'Cajero', capacity: 1 } },
  elements: {
    Start: { interTriggerTimer: { type: 'exponential', mean: 600 } },
    Task_A: { processingTime: { type: 'constant', value: 300 }, resources: [{ ref: 'cajero' }] },
  },
};

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
let actual: Json | null = null;
/** Edits the scenario from outside the import, as the form would. */
let editarFuera: ((escenario: Json) => void) | null = null;

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

function Arnes(): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Record<string, Json>>({ 'base.scenario.json': ORIGINAL });
  actual = escenarios['base.scenario.json']!;
  editarFuera = (escenario) => setEscenarios((previos) => ({ ...previos, 'base.scenario.json': escenario }));
  return (
    <ScenarioPanel
      archivo="base.scenario.json"
      escenarios={escenarios}
      onCambio={(archivo, escenario) => setEscenarios((previos) => ({ ...previos, [archivo]: escenario }))}
      onGuardar={() => {}}
      onDuplicar={() => {}}
      ir={IR}
      seleccion={null}
      onSeleccionar={() => {}}
    />
  );
}

function montar(): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz!.render(<Arnes />));
}

async function elegirArchivo(nombre: string, contenido: string): Promise<void> {
  const entrada = contenedor!.querySelector<HTMLInputElement>('input[type="file"]');
  if (entrada === null) throw new Error('no hay input de archivo');
  Object.defineProperty(entrada, 'files', { configurable: true, value: [new File([contenido], nombre)] });
  await act(async () => {
    entrada.dispatchEvent(new Event('change', { bubbles: true }));
    // The file is read asynchronously: let the reader and the state update land.
    for (let i = 0; i < 20 && contenedor!.querySelector('.informe-importar, [role="alert"]') === null; i++) {
      await new Promise((resolver) => setTimeout(resolver, 5));
    }
  });
}

function pulsar(texto: string): void {
  const boton = [...contenedor!.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
  if (boton === undefined) throw new Error(`no hay botón «${texto}»`);
  act(() => boton.click());
}

const CSV = 'id;name;distribution;unit;mean\n;atender;exponencial;min;7,5\nTask_Nope;;constant;;1\n';

test('import a CSV: see the report, apply it, then undo it', async () => {
  montar();
  await elegirArchivo('elementos.csv', CSV);

  const informe = contenedor!.querySelector('.informe-importar');
  expect(informe?.textContent).toContain(es.escenario.importarTitulo('elementos.csv'));
  expect(informe?.textContent).toContain(es.escenario.importarCambios(1));
  // In the unit of the row (min), as typed, and with the sheet and row it came from.
  expect(informe?.textContent).toContain('constant(value=5) min → exponential(mean=7.5) min (elementos, fila 2)');
  expect(informe?.textContent).toContain(es.escenario.importarNoEmparejadas(1));
  expect(informe?.textContent).toContain('elementos, fila 3, columna id: «Task_Nope» no coincide');
  // Nothing is written until «Apply».
  expect(actual).toBe(ORIGINAL);

  pulsar(es.escenario.importarAplicar);
  const elementos = actual!['elements'] as Record<string, Json>;
  expect(elementos['Task_A']).toEqual({ processingTime: { type: 'exponential', mean: 450 }, resources: [{ ref: 'cajero' }] });
  expect(contenedor!.querySelector('.informe-importar')).toBeNull();
  expect(contenedor!.querySelector('[role="status"]')?.textContent).toContain(es.escenario.importarAplicado(1));

  pulsar(es.escenario.importarDeshacer);
  expect(actual).toBe(ORIGINAL);
  expect(contenedor!.querySelector('[role="status"]')).toBeNull();
});

test('cancel leaves the scenario untouched, and an unreadable file says so', async () => {
  montar();
  await elegirArchivo('elementos.csv', CSV);
  pulsar(es.escenario.importarCancelar);
  expect(contenedor!.querySelector('.informe-importar')).toBeNull();
  expect(actual).toBe(ORIGINAL);

  await elegirArchivo('parametros.xlsx', 'this is not a zip');
  expect(contenedor!.querySelector('[role="alert"]')?.textContent).toBe(es.escenario.importarIlegible);
  expect(actual).toBe(ORIGINAL);
});

test('the template is offered only with a diagram', () => {
  montar();
  const plantilla = [...contenedor!.querySelectorAll('button')].find((b) => b.textContent === es.escenario.plantilla);
  expect(plantilla?.disabled).toBe(false);
});

function boton(texto: string): HTMLButtonElement {
  const encontrado = [...contenedor!.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
  if (encontrado === undefined) throw new Error(`no hay botón «${texto}»`);
  return encontrado;
}

test('a __proto__ row is refused and cancelling leaves Object.prototype untouched', async () => {
  montar();
  await elegirArchivo('elementos.csv', 'id;fixedCost\n__proto__;7\n');
  expect(contenedor!.querySelector('.informe-importar')?.textContent).toContain('«__proto__» no se puede usar como id');
  pulsar(es.escenario.importarCancelar);
  expect(({} as Record<string, unknown>)['fixedCost']).toBeUndefined();
  expect(actual).toBe(ORIGINAL);
});

test('the report takes the focus, Escape cancels and the focus goes back to the button', async () => {
  montar();
  await elegirArchivo('elementos.csv', CSV);
  const informe = contenedor!.querySelector<HTMLElement>('.informe-importar')!;
  expect(informe.getAttribute('role')).toBe('region');
  expect(document.activeElement).toBe(informe);
  act(() => {
    informe.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(contenedor!.querySelector('.informe-importar')).toBeNull();
  expect(document.activeElement).toBe(boton(es.escenario.importar));
  expect(actual).toBe(ORIGINAL);
});

test('errors the result would have block Apply, and so does an edit made after reading the file', async () => {
  montar();
  await elegirArchivo('elementos.csv', 'id;probability\nTask_A;0,5\n');
  expect(contenedor!.querySelector('.informe-importar')?.textContent).toContain(es.escenario.importarLint(1));
  expect(boton(es.escenario.importarAplicar).disabled).toBe(true);
  pulsar(es.escenario.importarCancelar);

  await elegirArchivo('elementos.csv', CSV);
  expect(boton(es.escenario.importarAplicar).disabled).toBe(false);
  act(() => editarFuera!({ ...ORIGINAL, name: 'Editado' }));
  expect(contenedor!.querySelector('.informe-importar')?.textContent).toContain(es.escenario.importarCaducado);
  expect(boton(es.escenario.importarAplicar).disabled).toBe(true);
});
