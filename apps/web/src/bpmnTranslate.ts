/**
 * bpmn-js's `translate` service, fed from the app catalogs (#456).
 *
 * bpmn-js writes its context pad, replace menu and popup search in English and runs every such
 * text through the `translate` service. This module replaces that service: the English template is
 * the key of `strings().bpmnJs`, and `{name}` placeholders are filled the way diagram-js's own
 * `translate` fills them. A template that is not in the catalog comes back as bpmn-js wrote it.
 *
 * The catalog is read on every call, not captured when the modeler is built: bpmn-js asks for the
 * context pad and replace menu entries each time they open, so they follow a language change
 * without remounting the canvas (which would take the undo stack with it, LILA-113).
 */
import { strings } from './i18n';

export function traducir(plantilla: string, reemplazos: Readonly<Record<string, string>> = {}): string {
  const catalogo: Readonly<Record<string, string>> = strings().bpmnJs;
  const texto = Object.hasOwn(catalogo, plantilla) ? catalogo[plantilla]! : plantilla;
  return texto.replace(/{([^}]+)}/g, (hueco, clave: string) => reemplazos[clave] ?? hueco);
}

/** didi module: the last definition of a service wins, so this one overrides bpmn-js's. */
export const moduloTraduccion = { translate: ['value', traducir] };
