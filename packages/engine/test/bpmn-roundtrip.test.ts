/**
 * Acceptance of LILA-068: a `.bpmn` with `lila:` survives an open/save round trip in another
 * BPMN tool.
 *
 * Camunda Desktop Modeler is bpmn-js on top of bpmn-moddle, and that pair is what reads and
 * writes the XML there — the canvas never touches the tree that gets serialized (bpmn-js's
 * `importXML` is `moddle.fromXML`, its `saveXML` is `moddle.toXML`; see
 * `node_modules/bpmn-js/lib/BaseViewer.js`). So the round trip is measured headless against that
 * same core, twice:
 *
 * - **with** `lila.moddle.json`, which is what Lila's own editor and CLI do, and
 * - **without** it, which is what any foreign tool sees: an undeclared namespace that bpmn-moddle
 *   keeps as generic content (`$attrs`/`$children`) with no descriptor to interpret it.
 *
 * Both have to give back every `lila:` element, on the same owner, with the same values. The whole
 * file is not compared byte for byte: bpmn-moddle reformats the document it reserializes (see the
 * ponytail note in `src/bpmn/annotate.ts`), and `docs/BPMN_EXTENSION.md` § 7 does not promise
 * byte fidelity — it promises the content.
 *
 * The bpmn-js half lives in `apps/web/src/bpmnRoundtrip.test.ts`, next to the other jsdom tests.
 */
import { BpmnModdle } from 'bpmn-moddle';
import { beforeAll, describe, expect, it } from 'vitest';
import lila from '../src/bpmn/lila.moddle.json' with { type: 'json' };
import {
  LILA_URI,
  V1_TAGS,
  annotatedPedido,
  lilaInventory,
  lilaPrefix,
  renameLilaPrefix,
} from './bpmn-roundtrip.fixture.js';

/** One open/save round trip, as any bpmn-moddle-based tool does it. */
async function roundtrip(xml: string, descriptor: boolean): Promise<string> {
  const moddle = descriptor ? BpmnModdle({ lila }) : BpmnModdle();
  const { rootElement, warnings } = await moddle.fromXML(xml, 'bpmn:Definitions');
  expect(warnings).toEqual([]);
  const { xml: out } = await moddle.toXML(rootElement, { format: true });
  return out;
}

let source: string;
let expected: string[];

beforeAll(async () => {
  source = await annotatedPedido();
  expected = lilaInventory(source);
});

describe('the fixture', () => {
  it('carries one `lila:` element of every v1 type', () => {
    const tags = new Set(expected.map((entry) => /<lila:(\w+)/.exec(entry)?.[1]));
    expect([...tags].sort()).toEqual([...V1_TAGS].sort());
  });

  it('spreads them over several elements, with repetitions', () => {
    const owners = new Set(expected.map((entry) => entry.split(' ')[0]));
    expect(owners).toEqual(new Set(['Process_Restaurante', 'Task_TomarPedido', 'Task_Preparar']));
    expect(expected.length).toBeGreaterThan(owners.size);
    // Two `lila:responsibility` on the same task: a tool that keeps only the first one fails.
    expect(expected.filter((e) => e.includes('<lila:responsibility'))).toHaveLength(3);
  });
});

describe.each([
  ['with the lila descriptor', true],
  ['without the lila descriptor (what a foreign tool sees)', false],
])('bpmn-moddle %s', (_name, descriptor) => {
  it('gives every `lila:` element back, on the same element and with the same values', async () => {
    const out = await roundtrip(source, descriptor);

    expect(lilaInventory(out)).toEqual(expected);
  });

  it('keeps the namespace declared in `bpmn:definitions`', async () => {
    const out = await roundtrip(source, descriptor);

    expect(lilaPrefix(out)).toBe('lila');
    // Declared once, and on the root element: `docs/BPMN_EXTENSION.md` § 1.
    expect(out.split(`="${LILA_URI}"`)).toHaveLength(2);
    expect(out.indexOf(LILA_URI)).toBeLessThan(out.indexOf('<bpmn:collaboration'));
  });

  it('is stable across two round trips (open, save, open, save)', async () => {
    const once = await roundtrip(source, descriptor);
    const twice = await roundtrip(once, descriptor);

    expect(lilaInventory(twice)).toEqual(expected);
    // The second pass no longer reformats: from here on the file is a fixed point.
    expect(twice).toBe(once);
  });

  it('does not lose them when the tool writes a prefix of its own', async () => {
    // Nothing forces a tool to keep the prefix `lila`: only the IRI is normative (§ 1).
    const renamed = renameLilaPrefix(source, 'ext');
    expect(renamed).not.toContain('lila:');
    expect(lilaPrefix(renamed)).toBe('ext');

    const out = await roundtrip(renamed, descriptor);

    expect(lilaInventory(out)).toEqual(expected);
  });

  it('keeps `bpmn:documentation`, the ids and the diagram of the annotated elements', async () => {
    const out = await roundtrip(source, descriptor);

    expect(out).toContain('The cashier takes the order at the counter.');
    for (const id of ['Process_Restaurante', 'Task_TomarPedido', 'Task_Preparar']) {
      expect(out).toContain(`id="${id}"`);
    }
    expect(out).toContain('bpmndi:BPMNDiagram');
  });
});

describe('the inventory itself', () => {
  it('reports a dropped element, a changed value and a moved one', () => {
    const dropped = source.replace(/\s*<lila:systemRef ref="sys-crm"\s*\/>/, '');
    expect(lilaInventory(dropped)).not.toEqual(expected);

    const changed = source.replace('roleRef="rol-cajero"', 'roleRef="otro-rol"');
    expect(lilaInventory(changed)).not.toEqual(expected);

    // Same elements, different owner: what `Task_Preparar` carries now hangs off `Task_Empacar`.
    const moved = source
      .replace('id="Task_Preparar" name="Prepare food"', 'id="Task_Empacar" name="Prepare food"')
      .replace('id="Task_Empacar" name="Pack order"', 'id="Task_Preparar" name="Pack order"');
    expect(lilaInventory(moved)).not.toEqual(expected);
  });
});
