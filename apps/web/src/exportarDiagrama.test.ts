// @vitest-environment jsdom
/**
 * #451: what `limpiarSvg` does to a `saveSVG` result. The fixture has the shape bpmn-js writes —
 * prolog, comment, DOCTYPE, colours in `style` as the browser serialises them (`rgb()`), a marker
 * in `<defs>`, and the selection outline and hit area of a selected task — with Lila Dark's three
 * diagram colours plus one colour of the element's own (#452) that must survive.
 */
import { describe, expect, it, vi } from 'vitest';
import { hojaImpresion, limpiarSvg, nombreArchivo, svgDelLienzo } from './exportarDiagrama';

const DARK = { fill: '#1F1A36', stroke: '#D9D2F0', label: '#ECE9F5', fondo: '#17132A' };
const PROPIO = 'rgb(255, 0, 128)';

const SAVE_SVG = `<?xml version="1.0" encoding="utf-8"?>
<!-- created with bpmn-js / http://bpmn.io -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="320" height="140" viewBox="146 76 320 140" version="1.1"><defs><marker id="sequenceflow-end-_1F1A36-_D9D2F0-x"><path d="M 1 5 L 11 10 L 1 15 Z" style="fill: rgb(217, 210, 240); stroke: rgb(217, 210, 240);"/></marker></defs><g class="djs-group"><g class="djs-element djs-shape selected" data-element-id="Task_1" transform="matrix(1 0 0 1 160 90)"><g class="djs-visual"><rect x="0" y="0" width="100" height="80" rx="10" ry="10" style="stroke-linecap: round; stroke-linejoin: round; stroke: rgb(217, 210, 240); stroke-width: 2px; fill: rgb(31, 26, 54); fill-opacity: 0.95;"/><text lineHeight="1.2" class="djs-label" style="font-family: Arial, sans-serif; font-size: 12px; fill: rgb(236, 233, 245);"><tspan x="20" y="43">Review</tspan></text></g><rect class="djs-hit djs-hit-all" x="0" y="0" width="100" height="80" style="fill: none; stroke-opacity: 0; stroke: white; stroke-width: 15px;"/><rect x="-6" y="-6" rx="14" width="112" height="92" class="djs-outline" style="fill: none;"/></g></g><g class="djs-group"><g class="djs-element djs-shape" data-element-id="Task_2" transform="matrix(1 0 0 1 300 90)"><g class="djs-visual"><rect x="0" y="0" width="100" height="80" style="stroke: ${PROPIO}; fill: #1f1a36;"/></g></g></g><g class="djs-group"><g class="djs-element djs-connection" data-element-id="Flow_1"><g class="djs-visual"><path d="m 260 130 l 40 0" style="stroke: rgb(217, 210, 240); marker-end: url(#sequenceflow-end-_1F1A36-_D9D2F0-x);"/></g></g></g></svg>`;

const parsear = (svg: string): Document => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('limpiarSvg (#451)', () => {
  it('drops the editing chrome and the prolog, keeps every shape and the SVG namespace', () => {
    const svg = limpiarSvg(SAVE_SVG, { papel: false, colores: DARK });
    const doc = parsear(svg);
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/<\?xml|DOCTYPE|bpmn\.io/);
    expect(doc.querySelectorAll('.djs-outline, .djs-hit')).toHaveLength(0);
    expect([...doc.querySelectorAll('[data-element-id]')].map((e) => e.getAttribute('data-element-id'))).toEqual(['Task_1', 'Task_2', 'Flow_1']);
    expect(doc.querySelector('marker path')).not.toBeNull();
    expect(doc.documentElement.getAttribute('viewBox')).toBe('146 76 320 140');
  });

  it('without paper keeps the theme colours on the theme\'s canvas background (QA of #467, N5)', () => {
    const svg = limpiarSvg(SAVE_SVG, { papel: false, colores: DARK });
    expect(svg).toContain('fill: rgb(31, 26, 54)');
    const fondo = parsear(svg).documentElement.firstElementChild!;
    expect([fondo.tagName, ...['x', 'y', 'width', 'height', 'fill'].map((a) => fondo.getAttribute(a))]).toEqual(['rect', '146', '76', '320', '140', '#17132A']);
  });

  it('on paper lays a white sheet under the viewBox and turns fill/stroke/label into white/black/black', () => {
    const doc = parsear(limpiarSvg(SAVE_SVG, { papel: true, colores: DARK }));
    const hoja = doc.documentElement.firstElementChild!;
    expect([hoja.tagName, ...['x', 'y', 'width', 'height', 'fill'].map((a) => hoja.getAttribute(a))]).toEqual(['rect', '146', '76', '320', '140', '#fff']);
    const estilo = (sel: string): string => doc.querySelector(sel)!.getAttribute('style')!;
    expect(estilo('[data-element-id="Task_1"] .djs-visual rect')).toContain('stroke: #000');
    expect(estilo('[data-element-id="Task_1"] .djs-visual rect')).toContain('fill: #fff');
    expect(estilo('text')).toContain('fill: #000');
    expect(estilo('marker path')).toBe('fill: #000; stroke: #000;');
    // A hex written as-is is the same colour: it is replaced too.
    expect(estilo('[data-element-id="Task_2"] rect')).toContain('fill: #fff');
    // No theme colour is left anywhere, in either notation.
    expect(new XMLSerializer().serializeToString(doc)).not.toMatch(/rgb\((31, 26, 54|217, 210, 240|236, 233, 245)\)|#1f1a36/i);
  });

  it('on paper leaves the colours an element carries of its own and the marker references alone (#452)', () => {
    const svg = limpiarSvg(SAVE_SVG, { papel: true, colores: DARK });
    expect(svg).toContain(`stroke: ${PROPIO}`);
    expect(svg).toContain('url(#sequenceflow-end-_1F1A36-_D9D2F0-x)');
    expect(parsear(svg).querySelector('marker')!.id).toBe('sequenceflow-end-_1F1A36-_D9D2F0-x');
  });

  it('commits a label being typed before drawing the image (QA of #467, N1)', async () => {
    const orden: string[] = [];
    const edicion = { isActive: () => true, complete: vi.fn(() => orden.push('complete')) };
    const lienzo = { get: () => edicion, saveSVG: async () => { orden.push('saveSVG'); return { svg: SAVE_SVG }; } };
    expect(await svgDelLienzo(lienzo, { papel: false, colores: DARK })).toContain('Task_1');
    expect(orden).toEqual(['complete', 'saveSVG']);
  });

  it('refuses something that is not an SVG', () => {
    expect(() => limpiarSvg('<html></html>', { papel: false, colores: DARK })).toThrow();
  });
});

describe('print sheet and file name (#451)', () => {
  it('prints in the orientation of the diagram, with the title escaped', () => {
    expect(hojaImpresion('<svg width="300" height="100"></svg>', 'A & B')).toContain('size:landscape');
    expect(hojaImpresion('<svg width="100" height="300"></svg>', 'x')).toContain('size:portrait');
    expect(hojaImpresion('<svg width="1" height="1"></svg>', '<A & B>')).toContain('<title>&#60;A &#38; B&#62;</title>');
  });

  it('turns the project name into a safe file name', () => {
    expect(nombreArchivo('Pedidos: 2026/09')).toBe('Pedidos- 2026-09');
    expect(nombreArchivo('   ')).toBe('diagram');
    // No trailing dot or space, at most 120 characters (QA of #467, N4).
    expect(nombreArchivo('Pedidos: 2026/09 <x> "q" *?|.')).toBe('Pedidos- 2026-09 -x- -q- -');
    expect(nombreArchivo('a'.repeat(300))).toHaveLength(120);
  });
});
