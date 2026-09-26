/**
 * `diagram-js-minimap` with a frame that always contains the viewport box.
 *
 * The plugin's `_update` framed the diagram alone, so zooming out or panning away left the
 * viewport box outside the minimap — or spilling over its header, where a click started a drag
 * that threw the canvas far away. This subclass keeps everything else of the plugin (click to
 * centre, drag, Ctrl+wheel, fold) and only replaces the framing with `marcoMinimapa`.
 * ponytail: overrides a private method of the plugin, pinned at ^5.4.1 · re-check on upgrade.
 */
import minimapModule from 'diagram-js-minimap';
import { marcoMinimapa, type Rect } from './minimapa';

interface Viewbox extends Rect {
  inner: Rect;
}

interface MinimapaPlugin {
  _canvas: { viewbox(): Viewbox };
  _parent: HTMLElement;
  _svg: SVGSVGElement;
  _viewport: SVGRectElement;
  _viewportDom: HTMLElement;
  _lastViewbox: Rect;
  _updateTimeout: ReturnType<typeof setTimeout> | null;
  _firstDebounceTime: number | null;
  _state: { _svgClientRect?: DOMRect | null };
  isOpen(): boolean;
}

type Clase = new (...args: unknown[]) => MinimapaPlugin;
const Minimapa = (minimapModule.minimap as ['type', Clase & { $inject: string[] }])[1];

class MinimapaLila extends Minimapa {
  static override $inject = Minimapa.$inject;

  constructor(...args: unknown[]) {
    super(...args);
    // The plugin caches where its SVG is and only re-measures on `canvas.resized`; measure on
    // every press instead, so a moved or refolded minimap never maps a click to the wrong place.
    this._parent.addEventListener('mousedown', () => {
      this._state._svgClientRect = null;
      // The frame stays still while the button is down: the plugin centres on press AND again on
      // release, and a frame that moved in between sends the second centring somewhere else.
      this._congelado = true;
      // `window` bubbles after the plugin's own `document` listener, so the release is handled first.
      window.addEventListener('mouseup', () => { this._congelado = false; this._update(); }, { once: true });
    }, true);
  }

  private _congelado = false;

  _update(): void {
    if (!this.isOpen()) return;
    if (this._updateTimeout) clearTimeout(this._updateTimeout);
    this._updateTimeout = null;
    this._firstDebounceTime = null;

    const visible = this._canvas.viewbox();
    const numeros = [visible.x, visible.y, visible.width, visible.height, visible.inner.x, visible.inner.y];
    if (!numeros.every(Number.isFinite)) return;

    const marco = this._lastViewbox = this._congelado ? this._lastViewbox : marcoMinimapa(visible.inner, visible);
    this._svg.setAttribute('viewBox', `${marco.x} ${marco.y} ${marco.width} ${marco.height}`);
    this._viewport.setAttribute('x', String(visible.x));
    this._viewport.setAttribute('y', String(visible.y));
    this._viewport.setAttribute('width', String(visible.width));
    this._viewport.setAttribute('height', String(visible.height));

    // The draggable box is a DOM twin of the SVG rect, placed over it (as the plugin does).
    const padre = this._parent.getBoundingClientRect();
    const caja = this._viewport.getBoundingClientRect();
    Object.assign(this._viewportDom.style, {
      top: `${caja.top - padre.top}px`,
      left: `${caja.left - padre.left}px`,
      width: `${caja.width}px`,
      height: `${caja.height}px`,
    });
  }
}

/** Drop-in replacement for the plugin's module in `additionalModules`. */
export const moduloMinimapa = { __init__: ['minimap'], minimap: ['type', MinimapaLila] };
