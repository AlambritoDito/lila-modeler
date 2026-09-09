/**
 * The label of the minimap header (LILA-208, made translatable in LILA-210).
 *
 * The header is the plugin's own fold button, dressed by `app.css`. Two of its texts are read by
 * a person and neither of them can come from a React component:
 *
 * - the **caption** is painted by a pseudo-element, and a pseudo-element cannot read a catalog.
 *   `app.css` draws `content: attr(data-titulo)`, so the text is written here on the element and
 *   the stylesheet only shows it (uppercased by `text-transform`). Before this it was a literal
 *   `content: 'Minimapa'` in the stylesheet, which left «MINIMAPA» in the English UI.
 * - the **tooltip** is rewritten in English by `diagram-js-minimap` itself every time the minimap
 *   folds or unfolds, so it has to be put back after each toggle.
 *
 * It lives in its own module — and not inside `Modeler.tsx` — because `Modeler.tsx` pulls in
 * bpmn-js and cannot be imported from a test; here the labelling is checked against a plain DOM.
 * It is idempotent: it is called on mount, on every toggle and on every language change.
 */
import { strings } from './i18n';

/**
 * Writes both texts on the minimap's `.toggle`, in the active language. A missing element is not
 * an error: the effect that watches the language runs before bpmn-js has built the canvas.
 */
export function rotularMinimapa(toggle: Element | null | undefined, abierto: boolean): void {
  if (toggle === null || toggle === undefined) return;
  const S = strings();
  toggle.setAttribute('data-titulo', S.lienzo.minimapa);
  toggle.setAttribute('title', abierto ? S.lienzo.plegarMinimapa : S.lienzo.desplegarMinimapa);
}
