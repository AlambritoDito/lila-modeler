// @vitest-environment jsdom
/**
 * Acceptance of LILA-068, bpmn-js half: `lila:` survives an open/save round trip through
 * bpmn-js, the editor Camunda Desktop Modeler is built on.
 *
 * The bpmn-moddle half is `packages/engine/test/bpmn-roundtrip.test.ts`, and both read the same
 * annotated copy of `examples/pedido/model.bpmn` and compare the same inventory.
 *
 * **What is exercised, and why it is bpmn-js and not an imitation.** A real `Modeler` is built
 * here, with the same `moddleExtensions: { lila }` as `Modeler.tsx`, and the round trip goes
 * through `modeler.get('moddle')`. That service is not a lookalike: `BaseViewer` builds one
 * moddle in its constructor, publishes it to the injector as `moddle: [ 'value', moddle ]`, and
 * that is the object its `importXML` reads the XML with (`this._moddle.fromXML(xml,
 * 'bpmn:Definitions')`) and its `saveXML` writes it back with (`this._moddle.toXML(definitions,
 * options)`) — see `node_modules/bpmn-js/lib/BaseViewer.js`. Nothing between those two calls
 * touches the tree that gets serialized: what the canvas does is draw it. The test pins that
 * identity (`_moddle` is the injected service) so this stops being an assumption.
 *
 * **What is not exercised.** `importXML`'s rendering, which in jsdom means diagram-js drawing on
 * an SVG that does not implement `getBBox`, `getComputedTextLength` or `transform.baseVal`. The
 * same wall the sibling suites hit (`BottleneckOverlay.test.ts`, `PropertiesPanel.qa.test.tsx`,
 * `ValidationMarkers.test.ts`): shimming those makes `Canvas` compute viewboxes over invented
 * geometry, and measured here it does not even fail cleanly — the label layout loop never
 * converges and the run dies of heap exhaustion. `docs/BPMN_EXTENSION.md` § 8 records that gap,
 * and why it does not touch the XML: the canvas draws the tree, it does not serialize it.
 */
import Modeler from 'bpmn-js/lib/Modeler';
import type { Moddle } from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import {
  LILA_URI,
  annotatedPedido,
  lilaInventory,
  lilaPrefix,
  renameLilaPrefix,
} from '../../../packages/engine/test/bpmn-roundtrip.fixture.js';

/**
 * The moddle bpmn-js reads and writes XML with, built the way the app builds it (with the
 * descriptor) or the way a foreign tool has it (without).
 */
function moddleDeBpmnJs(descriptor: boolean): Moddle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const opciones = descriptor ? { container, moddleExtensions: { lila } } : { container };
  const modeler = new Modeler(opciones);
  const moddle = modeler.get('moddle') as Moddle;

  // `importXML`/`saveXML` go through `this._moddle`; the injector's `moddle` is that same object.
  expect(moddle).toBe((modeler as unknown as { _moddle: Moddle })._moddle);

  return moddle;
}

/** `importXML` + `saveXML`, minus the canvas: the two moddle calls, with their own arguments. */
async function roundtrip(moddle: Moddle, xml: string): Promise<string> {
  const { rootElement, warnings } = await moddle.fromXML(xml, 'bpmn:Definitions');
  expect(warnings).toEqual([]);
  return (await moddle.toXML(rootElement, { format: true })).xml;
}

describe.each([
  ['with the lila descriptor, as the app builds it', true],
  ['without it, as a foreign tool has it', false],
])('bpmn-js %s', (_name, descriptor) => {
  it('gives every `lila:` element back, on the same element and with the same values', async () => {
    const source = await annotatedPedido();

    const out = await roundtrip(moddleDeBpmnJs(descriptor), source);

    expect(lilaInventory(out)).toEqual(lilaInventory(source));
    expect(lilaPrefix(out)).toBe('lila');
  });

  it('does not lose them when the tool writes a prefix of its own', async () => {
    const source = await annotatedPedido();

    const out = await roundtrip(moddleDeBpmnJs(descriptor), renameLilaPrefix(source, 'ext'));

    expect(lilaInventory(out)).toEqual(lilaInventory(source));
  });
});

describe('what the descriptor changes, and what it does not', () => {
  it('reads typed elements with it and generic ones without it, and writes both back', async () => {
    const source = await annotatedPedido();
    const tipos = async (descriptor: boolean): Promise<string[]> => {
      const { rootElement } = await moddleDeBpmnJs(descriptor).fromXML(source, 'bpmn:Definitions');
      const proceso = rootElement.rootElements?.find((r) => r.id === 'Process_Restaurante');
      const tarea = proceso?.flowElements?.find((f) => f.id === 'Task_TomarPedido');
      return (tarea?.extensionElements?.values ?? []).map((v) => v.$type);
    };

    // With the descriptor the tree carries the declared types; without it, moddle keeps the tag
    // as it read it (`lila:responsibility`, lower case) and the attributes as plain properties.
    expect(await tipos(true)).toContain('lila:Responsibility');
    expect(await tipos(false)).toContain('lila:responsibility');
    // Either way the file comes out the same, which is the whole point of LILA-068.
    const [con, sin] = await Promise.all([
      roundtrip(moddleDeBpmnJs(true), source),
      roundtrip(moddleDeBpmnJs(false), source),
    ]);
    expect(lilaInventory(sin)).toEqual(lilaInventory(con));
    expect(con).toContain(`xmlns:lila="${LILA_URI}"`);
    expect(sin).toContain(`xmlns:lila="${LILA_URI}"`);
  });
});
