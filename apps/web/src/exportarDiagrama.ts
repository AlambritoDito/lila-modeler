/**
 * Diagram export as an image (#451): SVG, PNG, print and PDF. bpmn-js's `saveSVG` gives the
 * drawing; this file turns it into a file a person can use. Pure apart from `aPng`, `descargar`
 * and `imprimirSvg`, which need a browser (canvas, `<a download>`, an iframe).
 *
 * Two looks, fixed (no setting): the SVG keeps the theme's colours on the theme's canvas
 * background, a card that stays readable on any slide (a dark theme's cream lines would vanish on a
 * white one if it were transparent); PNG, PDF and print are «paper» — a white sheet
 * with the theme's three diagram colours turned into white fill and black lines and labels, so a
 * dark theme never prints a dark page. Colours an element carries of its own stay as they are.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The resolved `--diagram-fill`, `--diagram-stroke`, `--diagram-label` and `--canvas-bg` tokens. */
export interface ColoresDiagrama {
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
  readonly fondo: string;
}

/**
 * Editing chrome bpmn-js leaves inside the exported layer: the selection outline, the invisible
 * hit areas, the drag previews and any overlay. None of them is part of the drawing (the
 * bpmn.io mark is an HTML overlay and never reaches `saveSVG`).
 */
const CROMO = '.djs-outline, .djs-hit, .djs-dragger, .djs-overlay, .djs-overlays';

/** A colour as it appears in the attributes: the theme writes hex, the browser serialises `rgb()`. */
const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

/** `#1F1A36`, `#1f1a36ff` and `rgb(31, 26, 54)` are all `31,26,54,1`; anything else is `null`. */
function canonico(color: string): string | null {
  const c = color.trim().toLowerCase();
  let rgba: number[];
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const par = h.length > 4;
    if (![3, 4, 6, 8].includes(h.length)) return null;
    rgba = (par ? h.match(/../g)! : [...h].map((d) => d + d)).map((x) => parseInt(x, 16));
    rgba[3] = rgba.length === 4 ? rgba[3]! / 255 : 1;
  } else {
    const n = c.match(/[\d.]+/g)?.map(Number);
    if (n === undefined || n.length < 3) return null;
    rgba = [n[0]!, n[1]!, n[2]!, n[3] ?? 1];
  }
  return [...rgba.slice(0, 3), Math.round(rgba[3]! * 100) / 100].join(',');
}

/**
 * Removes the editing chrome from a `saveSVG` result and lays a background under the whole
 * viewBox: the theme's canvas colour or, with `papel`, white paper, with the theme's
 * fill/stroke/label colours replaced by white/black/black. Returns the `<svg>` element alone (no XML prolog), valid both as an `.svg`
 * file and inline in an HTML page.
 */
export function limpiarSvg(svg: string, opciones: { papel: boolean; colores: ColoresDiagrama }): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const raiz = doc.documentElement;
  if (raiz.namespaceURI !== SVG_NS || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('saveSVG did not return an SVG document');
  }
  for (const nodo of [...raiz.querySelectorAll(CROMO)]) nodo.remove();
  if (opciones.papel) {
    const { fill, stroke, label } = opciones.colores;
    const papel = new Map<string | null, string>([[canonico(stroke), '#000'], [canonico(fill), '#fff'], [canonico(label), '#000']]);
    papel.delete(null);
    for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
      for (const nombre of ['fill', 'stroke', 'style', 'color']) {
        const valor = el.getAttribute(nombre);
        if (valor !== null) el.setAttribute(nombre, valor.replace(COLOR, (c) => papel.get(canonico(c)) ?? c));
      }
    }
  }
  const [x = '0', y = '0', ancho = '100%', alto = '100%'] = (raiz.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/);
  const hoja = doc.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x, y, width: ancho, height: alto, fill: opciones.papel ? '#fff' : opciones.colores.fondo })) hoja.setAttribute(k, v);
  raiz.insertBefore(hoja, raiz.firstChild);
  // Serialising the element (not the document) drops bpmn-js's prolog, comment and DOCTYPE;
  // XMLSerializer writes the `xmlns` of the root itself.
  return new XMLSerializer().serializeToString(raiz);
}

/** The slice of a bpmn-js modeler `svgDelLienzo` needs. */
export interface LienzoExportable {
  get(nombre: 'directEditing'): { isActive(): boolean; complete(): void };
  saveSVG(): Promise<{ svg?: string }>;
}

/**
 * `saveSVG` cleaned by `limpiarSvg`. A label being typed is committed first, or the image would
 * show the old one (QA of #467, N1): ⌘P moves the focus to the print frame, which commits it only
 * after the sheet was drawn.
 */
export async function svgDelLienzo(lienzo: LienzoExportable, opciones: { papel: boolean; colores: ColoresDiagrama }): Promise<string> {
  const edicion = lienzo.get('directEditing');
  if (edicion.isActive()) edicion.complete();
  return limpiarSvg((await lienzo.saveSVG()).svg ?? '', opciones);
}

/**
 * Rasterises an SVG at `escala`× its own size (2× by default: sharp on a slide or a retina
 * screen). The SVG goes through an `<img>`, so web fonts it names are not loaded there and the
 * labels fall back to the system's sans-serif — the same one a viewer without Archivo would use.
 */
export async function aPng(svg: string, escala = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.naturalWidth * escala);
    canvas.height = Math.ceil(img.naturalHeight * escala);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, falla) => canvas.toBlob((b) => (b === null ? falla(new Error('toBlob')) : ok(b)), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saves `blob` through the browser's download (web only; the desktop app has a save dialog). */
export function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  // Revoked on the next task, not now: some browsers start reading the URL after `click()` returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A file name from the project's: no path separators or characters the OS rejects, no trailing
 * dot or space (Windows drops them), and at most 120 characters (the desktop bridge refuses names
 * past 255, and the extension still has to fit).
 */
export const nombreArchivo = (nombre: string): string =>
  nombre.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 120).replace(/[. ]+$/, '').trim() || 'diagram';

/**
 * The page a paper SVG is printed on: one sheet, the diagram scaled to fit it whole, in the
 * orientation of the diagram. `apps/desktop/src/main.ts` builds the same page for its PDF (it
 * cannot import this file).
 */
export function hojaImpresion(svg: string, titulo: string): string {
  const ancho = Number(/\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 1);
  const alto = Number(/\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 1);
  const orientacion = ancho > alto ? 'landscape' : 'portrait';
  const escape = titulo.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape}</title><style>`
    + `@page{size:${orientacion};margin:10mm}html,body{margin:0;height:100%;overflow:hidden;background:#fff}`
    + `svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
}

/**
 * Prints a paper SVG with the browser's own dialog (where «Save as PDF» lives on the web) from a
 * throwaway iframe, so the sheet holds the diagram alone and not the app around it. The iframe is
 * `about:blank` written in place: no navigation, nothing for a CSP to refuse.
 */
export function imprimirSvg(svg: string, titulo: string): void {
  // A browser that never fires `afterprint` (headless, some embedded ones) leaves the last one behind.
  document.querySelector('iframe.lila-impresion')?.remove();
  // The frame takes the focus to print; the app's keys need it back (QA of #467, S2).
  // The canvas is an `SVGElement` (bpmn-js focuses the `<svg>`), not an `HTMLElement`: without it
  // the keyboard died after printing from the canvas (seams QA of #476).
  const activo = document.activeElement;
  const previo = activo instanceof HTMLElement || activo instanceof SVGElement ? activo : null;
  const marco = document.createElement('iframe');
  marco.className = 'lila-impresion';
  marco.setAttribute('aria-hidden', 'true');
  marco.tabIndex = -1;
  // Off screen but laid out: a `display: none` frame prints blank in some browsers.
  marco.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0';
  document.body.append(marco);
  const ventana = marco.contentWindow!;
  const d = ventana.document;
  d.open();
  d.write(hojaImpresion(svg, titulo));
  d.close();
  const cerrar = (): void => { marco.remove(); previo?.focus(); };
  ventana.addEventListener('afterprint', cerrar, { once: true });
  ventana.focus();
  ventana.print();
  // `print()` blocks until the dialog closes in Chrome, Firefox and Electron; where it does not,
  // the focus comes back now and the frame goes on `afterprint`, or at the next print at the latest.
  previo?.focus();
}
