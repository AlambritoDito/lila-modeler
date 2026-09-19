/**
 * Shared material for the `lila:` round-trip tests (LILA-068): the annotated source file and a
 * prefix-agnostic inventory of everything the round trip has to give back.
 *
 * Used by `packages/engine/test/bpmn-roundtrip.test.ts` (bpmn-moddle) and by
 * `apps/web/src/bpmnRoundtrip.test.ts` (the moddle instance bpmn-js itself reads and writes XML
 * with), so both halves measure the same thing against the same file.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateElement } from '../src/bpmn/annotate.js';

/** The namespace of `docs/BPMN_EXTENSION.md` § 1. A prefix is not part of it. */
export const LILA_URI = 'https://lila-modeler.org/schema/bpmn/1';

/**
 * `examples/pedido/model.bpmn`, resolved from this file and not from the working directory.
 *
 * Deliberately `dirname(fileURLToPath(import.meta.url))` and not `new URL(relative,
 * import.meta.url)`, the same way `apps/web/src/BottleneckOverlay.test.ts` reads its golden: in
 * the web app's suites Vite rewrites that second form into its own asset URL, which is no longer
 * a `file:` one, and `fileURLToPath` then refuses it.
 */
const PEDIDO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../examples/pedido/model.bpmn',
);

/**
 * `examples/pedido/model.bpmn` with one `lila:` element of every v1 type
 * (`docs/BPMN_EXTENSION.md` § 2) written into it by the engine's own writer, so the source of the
 * round trip is a real example file and not a hand-written snippet. The example itself carries no
 * `lila:` (it is a simulation benchmark), and annotating it here keeps it that way on disk.
 *
 * Deliberately spread over several elements, and with repeated elements on one of them: a foreign
 * tool that kept only the first child, or that hoisted the extensions to the wrong element, has to
 * fail the inventory.
 */
export async function annotatedPedido(): Promise<string> {
  let xml = readFileSync(PEDIDO, 'utf8');
  xml = await annotateElement(xml, 'Process_Restaurante', { versionTag: '1.3.0' });
  xml = await annotateElement(xml, 'Task_TomarPedido', {
    documentation: 'The cashier takes the order at the counter.',
    responsibilities: [
      { type: 'R', roleRef: 'rol-cajero' },
      { type: 'A', roleRef: 'rol-gerente' },
    ],
    refs: {
      systemRef: ['sys-pos', 'sys-crm'],
      documentRef: ['doc-pedido'],
      input: ['doc-pedido'],
      output: ['doc-comanda'],
      kpiRef: ['kpi-tiempo-atencion'],
    },
  });
  xml = await annotateElement(xml, 'Task_Preparar', {
    responsibilities: [{ type: 'C', roleRef: 'rol-cocinero' }],
    refs: { riskRef: ['riesgo-plato-frio'], controlRef: ['control-termometro'] },
  });
  return xml;
}

/** Every v1 element type, as `annotatedPedido` writes them. Guards the fixture from shrinking. */
export const V1_TAGS = [
  'responsibility',
  'systemRef',
  'documentRef',
  'riskRef',
  'controlRef',
  'kpiRef',
  'input',
  'output',
  'versionTag',
] as const;

/** The prefix bound to {@link LILA_URI} in this document, or `undefined` if it is not declared. */
export function lilaPrefix(xml: string): string | undefined {
  const declaration = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)="${LILA_URI}"`).exec(xml);
  return declaration?.[1];
}

/** Rewrites the fixture's `lila` prefix, which is what a tool free to choose its own would do. */
export function renameLilaPrefix(xml: string, to: string): string {
  return xml
    .replaceAll('xmlns:lila=', `xmlns:${to}=`)
    .replaceAll('<lila:', `<${to}:`)
    .replaceAll('</lila:', `</${to}:`);
}

/**
 * Every `lila:` element of the document, as `<owner id> <lila:tag attr="value" …>` lines, sorted.
 *
 * Canonical on purpose, so the comparison survives what a serializer is free to change and only
 * what `docs/BPMN_EXTENSION.md` promises is compared:
 *
 * - the prefix is normalized to `lila`, because only the namespace IRI is normative;
 * - attributes are sorted by name, because XML attribute order carries no meaning;
 * - indentation, line breaks and self-closing style are dropped;
 * - the id of the nearest enclosing element with one is kept, so moving an extension from one task
 *   to another is a difference, not a match.
 *
 * Reading the XML text rather than the moddle tree is the point: it is the file that travels to
 * another tool, and a tree can hold what the serializer then fails to write.
 */
export function lilaInventory(xml: string): string[] {
  const prefix = lilaPrefix(xml);
  if (prefix === undefined) throw new Error(`the document does not declare ${LILA_URI}`);

  // Attribute values may contain `>`, so quoted runs are consumed before the closing bracket.
  const tags = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  const attributes = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;
  const found: string[] = [];
  // The id in scope for the element being read, one entry per open tag.
  const owners: (string | undefined)[] = [];

  // `qualified` maps the document's prefix onto the literal `lila`, in a tag or in an attribute.
  const isLila = (name: string): boolean => name.startsWith(`${prefix}:`);
  const qualified = (name: string): string =>
    isLila(name) ? `lila:${name.slice(prefix.length + 1)}` : name;

  for (const match of xml.matchAll(tags)) {
    const [, closing = '', name = '', rest = '', selfClosing = ''] = match;
    if (closing === '/') {
      owners.pop();
      continue;
    }
    if (isLila(name)) {
      const attrs = [...rest.matchAll(attributes)]
        .map(([, attribute = '', value = '']) => ` ${qualified(attribute)}="${value}"`)
        .sort();
      found.push(`${owners[owners.length - 1] ?? '(root)'} <${qualified(name)}${attrs.join('')}>`);
    }
    if (selfClosing !== '/') {
      const id = /(?:^|\s)id\s*=\s*"([^"]*)"/.exec(rest);
      owners.push(id?.[1] ?? owners[owners.length - 1]);
    }
  }

  return found.sort();
}
