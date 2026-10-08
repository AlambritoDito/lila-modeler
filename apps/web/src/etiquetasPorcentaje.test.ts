// @vitest-environment jsdom
/**
 * Lote M, C4 — the percentage fields on the canvas, against a fake modeler: jsdom cannot draw
 * bpmn-js (no `getBBox`), and what this module owns is the DOM it hands to `overlays` and how it
 * reacts to keys and to new states. Placement on a real canvas is checked by CDP (PR notes).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Modeler from 'bpmn-js/lib/Modeler';

import { olvidarEtiquetas, posicionDe, sincronizarEtiquetas, type EstadoEtiquetas } from './etiquetasPorcentaje';
import { setLocale } from './i18n';
import type { Reparto } from './repartoRutas';

setLocale('en');

interface Anadido { id: string; elemento: string; html: HTMLElement; position: { left: number; top: number } }

function falsoModeler(): { modeler: Modeler; anadidos: Map<string, Anadido>; disparar: () => void } {
  const anadidos = new Map<string, Anadido>();
  let n = 0;
  const oyentes: (() => void)[] = [];
  const conexiones: Record<string, { waypoints: { x: number; y: number }[] }> = {
    fSi: { waypoints: [{ x: 100, y: 100 }, { x: 200, y: 100 }] },
    fNo: { waypoints: [{ x: 100, y: 100 }, { x: 100, y: 200 }, { x: 200, y: 200 }] },
  };
  const servicios: Record<string, unknown> = {
    overlays: {
      add: (elemento: string, _tipo: string, o: { html: HTMLElement; position: { left: number; top: number } }) => {
        const id = `ov${++n}`;
        anadidos.set(id, { id, elemento, html: o.html, position: o.position });
        document.body.appendChild(o.html);
        return id;
      },
      remove: (filtro: string | { type: string }) => {
        const ids = typeof filtro === 'string' ? [filtro] : [...anadidos.keys()];
        for (const id of ids) { anadidos.get(id)?.html.remove(); anadidos.delete(id); }
      },
    },
    elementRegistry: { get: (id: string) => conexiones[id] },
    eventBus: { on: (_e: string, f: () => void) => { oyentes.push(f); }, off: vi.fn() },
  };
  const modeler = { get: (nombre: string) => servicios[nombre] } as unknown as Modeler;
  return { modeler, anadidos, disparar: () => { for (const f of oyentes) f(); } };
}

const reparto = (si: number | null, no: number | null): Reparto => {
  const efSi = si ?? 100 - (no ?? 50);
  const efNo = no ?? 100 - (si ?? 50);
  const suma = efSi + efNo;
  return {
    id: 'G',
    nombre: 'Approved?',
    clase: 'xor',
    flujos: [
      { id: 'fSi', etiqueta: 'Yes', destino: 'Prepare', porcentaje: si, efectivo: efSi, porDefecto: false },
      { id: 'fNo', etiqueta: 'No', destino: 'End', porcentaje: no, efectivo: efNo, porDefecto: false },
    ],
    suma,
    cuadra: suma === 100,
    diferencia: 100 - suma,
    arreglo: null,
  };
};

const input = (flujo: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`.lila-pct[data-flujo="${flujo}"] input`)!;

function tecla(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

afterEach(() => { document.body.innerHTML = ''; });

describe('canvas percentage fields', () => {
  it('one box per outgoing flow, next to the start of its first segment', () => {
    const { modeler, anadidos } = falsoModeler();
    sincronizarEtiquetas(modeler, { repartos: [reparto(70, 30)], editable: true, seleccion: null, onCambiar: vi.fn() });
    const cajas = [...anadidos.values()];
    expect(cajas.map((c) => c.elemento)).toEqual(['fSi', 'fNo']);
    // Just below the start of the horizontal flow; the vertical one would land on that box, so it
    // goes to the left of its own line instead.
    expect(cajas[0]!.position).toEqual({ left: 6, top: 5 });
    expect(cajas[1]!.position).toEqual({ left: -69, top: 6 });
    expect(input('fSi').value).toBe('70');
    expect(input('fSi').getAttribute('aria-label')).toBe('Percentage of flow «Yes» of «Approved?»');
    olvidarEtiquetas(modeler);
    expect(anadidos.size).toBe(0);
  });

  it('typing writes percent, ↑×4 on 50 gives 70, Escape restores, focus selects the gateway', () => {
    const { modeler } = falsoModeler();
    const onCambiar = vi.fn();
    const onEnfocar = vi.fn();
    const estado: EstadoEtiquetas = { repartos: [reparto(50, 50)], editable: true, seleccion: null, onCambiar, onEnfocar };
    sincronizarEtiquetas(modeler, estado);
    const campo = input('fSi');
    campo.focus();
    expect(onEnfocar).toHaveBeenCalledWith('G', 'fSi');
    for (let i = 0; i < 4; i++) tecla(campo, 'ArrowUp');
    expect(campo.value).toBe('70');
    expect(onCambiar).toHaveBeenLastCalledWith('fSi', 70);
    tecla(campo, 'Escape');
    expect(campo.value).toBe('50');
    expect(onCambiar).toHaveBeenLastCalledWith('fSi', 50);
    expect(document.activeElement).not.toBe(campo);

    campo.focus();
    campo.value = '';
    campo.dispatchEvent(new Event('input'));
    expect(onCambiar).toHaveBeenLastCalledWith('fSi', null);
    campo.value = 'x';
    campo.dispatchEvent(new Event('input'));
    expect(onCambiar).toHaveBeenCalledTimes(6);
  });

  it('a new state updates in place: the focused field keeps focus and its text', () => {
    const { modeler, anadidos } = falsoModeler();
    const base = { editable: true, seleccion: 'G', onCambiar: vi.fn() };
    sincronizarEtiquetas(modeler, { ...base, repartos: [reparto(78, 22)] });
    const campo = input('fSi');
    campo.focus();
    campo.value = '7';
    sincronizarEtiquetas(modeler, { ...base, repartos: [reparto(7, 22)] });
    expect(input('fSi')).toBe(campo);
    expect(document.activeElement).toBe(campo);
    expect(campo.value).toBe('7');
    // Not adding up: red border on both boxes; the other field shows the file's value.
    expect(document.querySelectorAll('.lila-pct-error')).toHaveLength(2);
    expect(document.querySelectorAll('.lila-pct-sel')).toHaveLength(2);
    expect(anadidos.size).toBe(2);
  });

  it('outside Routes it is text; null removes everything', () => {
    const { modeler, anadidos } = falsoModeler();
    sincronizarEtiquetas(modeler, { repartos: [reparto(70, null)], editable: false, seleccion: null, onCambiar: vi.fn() });
    expect(document.querySelector('.lila-pct input')).toBeNull();
    expect([...document.querySelectorAll('.lila-pct-valor')].map((e) => e.textContent)).toEqual(['70 %', '30 %']);
    sincronizarEtiquetas(modeler, { repartos: [reparto(70, null)], editable: true, seleccion: null, onCambiar: vi.fn() });
    expect(input('fNo').placeholder).toBe('30');
    sincronizarEtiquetas(modeler, null);
    expect(anadidos.size).toBe(0);
  });

  it('clicks on a box do not reach the canvas and land in its field', () => {
    const { modeler } = falsoModeler();
    sincronizarEtiquetas(modeler, { repartos: [reparto(70, 30)], editable: true, seleccion: null, onCambiar: vi.fn() });
    const caja = document.querySelector<HTMLElement>('.lila-pct[data-flujo="fNo"]')!;
    const lienzo = vi.fn();
    document.body.addEventListener('mousedown', lienzo);
    caja.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    caja.querySelector<HTMLElement>('.lila-pct-nombre')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lienzo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input('fNo'));
  });

  it('outside Routes one click on a text box selects the gateway and lands in its field once Routes opens', () => {
    const { modeler } = falsoModeler();
    const onEnfocar = vi.fn();
    const base = { repartos: [reparto(78, 22)], seleccion: null, onCambiar: vi.fn(), onEnfocar };
    sincronizarEtiquetas(modeler, { ...base, editable: false });
    document.querySelector<HTMLElement>('.lila-pct[data-flujo="fSi"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onEnfocar).toHaveBeenCalledWith('G', null);
    // The host opened Routes: the boxes become fields and the clicked one has the focus.
    sincronizarEtiquetas(modeler, { ...base, seleccion: 'G', editable: true });
    expect(document.activeElement).toBe(input('fSi'));
    // …and the focused field reports its flow, for the one-click fix.
    expect(onEnfocar).toHaveBeenLastCalledWith('G', 'fSi');
  });

  it('a box avoids the shapes and labels around the start of its flow', () => {
    const flujo = { waypoints: [{ x: 100, y: 100 }, { x: 160, y: 100 }] };
    expect(posicionDe(flujo)).toEqual({ left: 6, top: 5 });
    // A timer right below the line: the box goes above it.
    expect(posicionDe(flujo, [{ x: 104, y: 104, width: 40, height: 40 }])).toEqual({ left: 6, top: -41 });
    // Zoomed out to 50 % the box takes twice the diagram room (it keeps its screen size).
    expect(posicionDe(flujo, [], 0.5)).toEqual({ left: 6, top: 5 });
    expect(posicionDe(flujo, [{ x: 104, y: 104, width: 40, height: 40 }], 0.5)).toEqual({ left: 6, top: -77 });
  });

  it('C7: a flow shorter than the box puts it beside the segment, clear of the gateway and the timer', () => {
    // Sample order: «Approved» goes 980 → 1030 into the timer, 50 units for a 64 px box.
    const flujo = { waypoints: [{ x: 980, y: 220 }, { x: 1030, y: 220 }] };
    const obstaculos = [
      { x: 920, y: 185, width: 70, height: 70 }, // the gateway with its marker
      { x: 926, y: 248, width: 58, height: 22 }, // «Approved?»
      { x: 1030, y: 202, width: 36, height: 36 }, // the timer
      { x: 1031, y: 241, width: 34, height: 22 }, // «Rest»
      { x: 1078, y: 182, width: 72, height: 18 }, // its step label «≈ 10 min»
      { x: 1120, y: 202, width: 36, height: 36 }, // Order delivered
    ];
    for (const zoom of [1, 0.67]) {
      const p = posicionDe(flujo, obstaculos, zoom)!;
      const escala = zoom < 1 ? 1 / zoom : 1;
      const caja = { x: 980 + p.left, y: 220 + p.top, width: 64 * escala, height: 36 * escala };
      for (const o of obstaculos) {
        const w = Math.min(caja.x + caja.width, o.x + o.width) - Math.max(caja.x, o.x);
        const h = Math.min(caja.y + caja.height, o.y + o.height) - Math.max(caja.y, o.y);
        expect(w > 0 && h > 0, `${zoom}: ${JSON.stringify(caja)} on ${JSON.stringify(o)}`).toBe(false);
      }
      // Still beside its own flow: it starts on the segment's span and, of the places that cover
      // nothing, takes the nearest — within three quarters of a box of the usual 5 units (QA of
      // #615: the farther places sent «Bad 50 %» 134 px away from its flow on a dense model).
      expect(caja.x).toBeGreaterThanOrEqual(980);
      expect(caja.x).toBeLessThanOrEqual(1030);
      expect(Math.min(Math.abs(caja.y + caja.height - 220), Math.abs(caja.y - 220))).toBeLessThanOrEqual(5 + 0.75 * caja.height + 1);
    }
    // A flow with room keeps the box right on it (the far candidates only win when they cover less).
    expect(posicionDe({ waypoints: [{ x: 100, y: 100 }, { x: 160, y: 100 }] })).toEqual({ left: 6, top: 5 });
  });

  it('QA of #615: the box never strays more than a box height off its flow, even when only far places are free', () => {
    // A dense model: tasks right above and right below the flow; free space only well above them.
    const flujo = { waypoints: [{ x: 100, y: 100 }, { x: 300, y: 100 }] };
    const obstaculos = [{ x: 0, y: 40, width: 400, height: 55 }, { x: 0, y: 105, width: 400, height: 65 }];
    const p = posicionDe(flujo, obstaculos)!;
    const caja = { y: 100 + p.top, height: 36 };
    expect(Math.min(Math.abs(caja.y + caja.height - 100), Math.abs(caja.y - 100))).toBeLessThanOrEqual(5 + caja.height);
  });

  it('out of range or not a number: invalid, nothing written', () => {
    const { modeler } = falsoModeler();
    const onCambiar = vi.fn();
    sincronizarEtiquetas(modeler, { repartos: [reparto(70, 30)], editable: true, seleccion: null, onCambiar });
    const campo = input('fSi');
    campo.focus();
    for (const malo of ['150', '-5', '0x46', '1e2']) {
      campo.value = malo;
      campo.dispatchEvent(new Event('input'));
      expect(campo.getAttribute('aria-invalid'), malo).toBe('true');
      expect(document.querySelector('.lila-pct[data-flujo="fSi"]')!.classList.contains('lila-pct-invalido')).toBe(true);
    }
    expect(onCambiar).not.toHaveBeenCalled();
    campo.value = '60';
    campo.dispatchEvent(new Event('input'));
    expect(campo.getAttribute('aria-invalid')).toBe('false');
    expect(onCambiar).toHaveBeenCalledWith('fSi', 60);
  });

  it('hides bpmn-js\'s context pad while the boxes are on the canvas', () => {
    const { modeler } = falsoModeler();
    const contenedor = document.createElement('div');
    (modeler as unknown as { get: (n: string) => unknown }).get = ((original) => (n: string) =>
      n === 'canvas' ? { getContainer: () => contenedor, zoom: () => 1 } : original(n))((modeler as unknown as { get: (n: string) => unknown }).get);
    sincronizarEtiquetas(modeler, { repartos: [reparto(70, 30)], editable: true, seleccion: null, onCambiar: vi.fn() });
    expect(contenedor.classList.contains('lila-pct-activas')).toBe(true);
    sincronizarEtiquetas(modeler, null);
    expect(contenedor.classList.contains('lila-pct-activas')).toBe(false);
  });
});
