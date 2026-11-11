/**
 * Acceptance of #724: a model that imports and simulates can also be annotated and edited by
 * agents. `annotate_element` / `lila process annotate` and `edit_process` / `lila process edit`
 * used to refuse every file bpmn-moddle read with a warning (3 of the 7 Bizagi exports); now what
 * the reader cannot interpret is carried to the output, and what cannot be carried is named.
 *
 * The invariant, checked on every Bizagi export and on fixtures made after the BPMN MIWG reference
 * files that failed (those are not vendored in this repository): after an annotation or an edit,
 * everything that was in the file and was not the target is still there (the same XML, compared as
 * a tree by `canonical` below, which is written apart from the code under test), and the file
 * reads back as the same model, with the same simulation results.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';
import { afterAll, describe, expect, test } from 'vitest';

import { annotateElement, parseBpmn, readAnnotations, validateBpmnXml, writeAttributeDefinitions } from '../src/bpmn/index.js';
import { editBpmn, EditError } from '../src/bpmn/edit.js';
import { simulate } from '../src/index.js';
import { ScenarioSchema } from '../src/scenario.js';
import { annotateLilaElement, createLilaProject, editLilaProcess, readLilaProcessBpmn } from '../src/project-fs/index.js';

const BIZAGI_DIR = fileURLToPath(new URL('../../../examples/bizagi-exports/', import.meta.url));
const BIZAGI = readdirSync(BIZAGI_DIR).filter((f) => f.endsWith('.bpmn')).sort();
const bizagi = (name: string): string => readFileSync(BIZAGI_DIR + name, 'utf8');

/* ------------------------------------------------------------------------------------------- */
/* An XML document as a tree that does not depend on prefixes, formatting or sibling order      */
/* ------------------------------------------------------------------------------------------- */

interface Node {
  name: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, ref: string) =>
    ref.startsWith('#x') ? String.fromCodePoint(parseInt(ref.slice(2), 16)) : ref.startsWith('#') ? String.fromCodePoint(Number(ref.slice(1))) : (ENTITIES[ref] ?? whole));

function parseXml(xml: string): Node {
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const root: Node = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: { node: Node; ns: Map<string, string> }[] = [{ node: root, ns: new Map() }];
  for (const m of xml.matchAll(token)) {
    const top = stack.at(-1)!;
    if (m[1] !== undefined) top.node.text += m[1];
    else if (m[6] !== undefined) top.node.text += decode(m[6]);
    else if (m[2] !== undefined) stack.pop();
    else if (m[3] !== undefined) {
      const raw = [...(m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1]!, decode(a[2] ?? a[3] ?? '')] as const);
      const ns = new Map(top.ns);
      for (const [name, value] of raw) {
        if (name === 'xmlns') ns.set('', value);
        else if (name.startsWith('xmlns:')) ns.set(name.slice(6), value);
      }
      const qualify = (name: string, attribute: boolean): string => {
        const colon = name.indexOf(':');
        if (colon === -1) return attribute ? name : `{${ns.get('') ?? ''}}${name}`;
        return `{${ns.get(name.slice(0, colon)) ?? `?${name.slice(0, colon)}`}}${name.slice(colon + 1)}`;
      };
      const node: Node = { name: qualify(m[3], false), attrs: {}, children: [], text: '' };
      for (const [name, value] of raw) if (name !== 'xmlns' && !name.startsWith('xmlns:')) node.attrs[qualify(name, true)] = value;
      top.node.children.push(node);
      if (m[5] === '') stack.push({ node, ns });
    }
  }
  expect(stack).toHaveLength(1);
  return root.children[0]!;
}

function* nodes(node: Node): Generator<Node> {
  yield node;
  for (const child of node.children) yield* nodes(child);
}

const byId = (root: Node, id: string): Node => {
  const found = [...nodes(root)].filter((node) => node.attrs['id'] === id);
  expect(found, `elements with id ${id}`).toHaveLength(1);
  return found[0]!;
};

const MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const PREFIXES: Record<string, string> = {
  [MODEL]: 'bpmn',
  'http://www.omg.org/spec/BPMN/20100524/DI': 'bpmndi',
  'http://www.omg.org/spec/DD/20100524/DC': 'dc',
  'http://www.omg.org/spec/DD/20100524/DI': 'di',
};
const schema = BpmnModdle() as unknown as { getType(name: string): { $descriptor: { properties: { name: string; isAttr?: boolean; default?: unknown }[] } } };

/**
 * Whether `name="value"` on `element` is one of the two things bpmn-moddle has always normalised
 * when it writes a file: an attribute that only states the default of the BPMN schema
 * (`startQuantity="1"`, `isForCompensation="false"`) is left out, and `xsi:type` is its own.
 */
function assumed(element: string, name: string, value: string): boolean {
  // `xsi:type` is bpmn-moddle's to write: it names the type it read, with its own prefix.
  if (name === '{http://www.w3.org/2001/XMLSchema-instance}type') return true;
  const [, uri, local] = /^\{(.*)\}(.*)$/.exec(element)!;
  const prefix = PREFIXES[uri!];
  if (prefix === undefined) return false;
  try {
    const type = schema.getType(`${prefix}:${local![0]!.toUpperCase()}${local!.slice(1)}`);
    const property = type.$descriptor.properties.find((p) => p.isAttr === true && p.name === name);
    return property?.default !== undefined && String(property.default) === value;
  } catch {
    return false;
  }
}

/** One line per element: its place, its attributes in order of name, its text when it is a leaf. */
function canonical(node: Node): string {
  // bpmn-moddle reads numbers as doubles and prints them back as JavaScript does: the same number.
  const value = (text: string): string => (/^-?\d+\.\d+$/.test(text) ? String(Number(text)) : text);
  const attrs = Object.keys(node.attrs).filter((name) => !assumed(node.name, name, node.attrs[name]!)).sort().map((name) => `${name}=${JSON.stringify(value(node.attrs[name]!))}`).join(' ');
  const text = node.children.length === 0 ? node.text.trim() : '';
  const children = node.children.map(canonical).sort();
  return [`<${node.name} ${attrs}>${JSON.stringify(text)}`, ...children.flatMap((child) => child.split('\n').map((line) => `  ${line}`))].join('\n');
}


/** A task of the process the simulator reads: the element the tests annotate and rename. */
async function targetOf(xml: string): Promise<string> {
  const { ir } = await parseBpmn(xml);
  const id = Object.entries(ir.nodes).find(([, node]) => node.type === 'task')?.[0];
  expect(id).toBeDefined();
  return id!;
}

/** The `exporter` marks are rewritten by every edit (`marcarExportador`): not content of the model. */
function withoutExporter(root: Node): Node {
  delete root.attrs['exporter'];
  delete root.attrs['exporterVersion'];
  return root;
}

/** The model as the simulator reads it, and what a short run of it gives. */
async function modelOf(xml: string): Promise<{ ir: unknown; run: unknown }> {
  const parsed = await parseBpmn(xml);
  // `source` is about the file (its exporter, the reader's warnings with their line numbers), not the model.
  const ir = { ...parsed.ir, source: undefined };
  const report = await validateBpmnXml(xml);
  if (report.errors.length > 0) return { ir, run: report.errors.map((e) => `${e.code} ${e.id}`) };
  const start = Object.entries(parsed.ir.nodes).find(([, node]) => node.type === 'start')![0];
  const scenario = ScenarioSchema.parse({
    version: 1,
    name: 'w724',
    run: { start: '2026-09-07T00:00:00+00:00', duration: 86400, replications: 2, seed: 7, baseTimeUnit: 's' },
    elements: { [start]: { interTriggerTimer: { type: 'exponential', mean: 600 }, triggerCount: 40 } },
  });
  let run: unknown;
  try {
    run = simulate(parsed.ir, scenario as never, { log: false });
  } catch (error) {
    run = String(error);
  }
  return JSON.parse(JSON.stringify({ ir, run })) as { ir: unknown; run: unknown };
}

const NOTE = 'Checked by an agent (#724).';

/** `annotateElement` on `id` kept everything else: taking the note out gives the input back. */
function expectOnlyAnnotated(input: string, output: string, id: string): void {
  const before = parseXml(input);
  const after = parseXml(output);
  const target = byId(after, id);
  const added = target.children.filter((child) => child.name === `{${MODEL}}documentation` && child.text === NOTE);
  expect(added).toHaveLength(1);
  target.children = target.children.filter((child) => child !== added[0]);
  // The note replaces the documentation the element had.
  const original = byId(before, id);
  original.children = original.children.filter((child) => child.name !== `{${MODEL}}documentation`);
  expect(canonical(after)).toBe(canonical(before));
}

/* ------------------------------------------------------------------------------------------- */
/* Fixtures after the MIWG reference files that failed (not vendored)                           */
/* ------------------------------------------------------------------------------------------- */

/**
 * After MIWG `C.8.1` (`triso:unspecified` as the message of an operation), the reference `A.*` and
 * `B.*` (declared as ISO-8859-1) and Bizagi `B.2.0` (`<LoopCounter>`), plus a foreign element
 * outside `extensionElements` and a dangling id in the middle of a list of references.
 */
const HAND_MADE = `<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>
<semantic:definitions xmlns:semantic="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:triso="http://www.trisotech.com/2015/triso/modeling" xmlns:vendor="urn:vendor" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_1" targetNamespace="urn:w724">
  <semantic:interface id="Interface_1" name="Billing">
    <semantic:operation id="Operation_1" name="charge">
      <semantic:inMessageRef>triso:unspecified</semantic:inMessageRef>
      <semantic:outMessageRef>triso:unspecified</semantic:outMessageRef>
    </semantic:operation>
  </semantic:interface>
  <semantic:collaboration id="Collaboration_1">
    <semantic:participant id="Participant_1" name="Caf&#233;" processRef="Process_1"/>
    <semantic:participant id="Participant_2" name="Customer"/>
    <semantic:messageFlow id="MessageFlow_1" sourceRef="Task_1" targetRef="Participant_2" messageRef="Message_1373649949207"/>
  </semantic:collaboration>
  <semantic:process id="Process_1" isExecutable="true">
    <semantic:laneSet id="LaneSet_1">
      <semantic:lane id="Lane_1" name="Bar">
        <semantic:flowNodeRef>Start_1</semantic:flowNodeRef>
        <semantic:flowNodeRef>Ghost_1</semantic:flowNodeRef>
        <semantic:flowNodeRef>Task_1</semantic:flowNodeRef>
        <semantic:flowNodeRef>Task_2</semantic:flowNodeRef>
        <semantic:flowNodeRef>End_1</semantic:flowNodeRef>
      </semantic:lane>
    </semantic:laneSet>
    <semantic:startEvent id="Start_1"><semantic:outgoing>Flow_1</semantic:outgoing></semantic:startEvent>
    <semantic:task id="Task_1" name="Take the order" vendor:colour="red">
      <semantic:incoming>Flow_1</semantic:incoming>
      <semantic:outgoing>Flow_2</semantic:outgoing>
      <vendor:hint level="2"><vendor:text>kept &amp; untouched</vendor:text></vendor:hint>
    </semantic:task>
    <semantic:serviceTask id="Task_2" name="Charge" operationRef="Operation_404">
      <semantic:incoming>Flow_2</semantic:incoming>
      <semantic:outgoing>Flow_3</semantic:outgoing>
      <semantic:multiInstanceLoopCharacteristics isSequential="true">
        <LoopCounter xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">0</LoopCounter>
      </semantic:multiInstanceLoopCharacteristics>
    </semantic:serviceTask>
    <semantic:endEvent id="End_1"><semantic:incoming>Flow_3</semantic:incoming></semantic:endEvent>
    <semantic:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>
    <semantic:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Task_2"/>
    <semantic:sequenceFlow id="Flow_3" sourceRef="Task_2" targetRef="End_1"/>
  </semantic:process>
</semantic:definitions>
`;

/**
 * The BPMN MIWG reference files are not in this repository. With `LILA_MIWG_DIR` set to a folder
 * of `.bpmn` files (a checkout of the test suite's `Reference/`), they join the corpus, without the
 * comparison as a tree: bpmn-moddle rewrites more of those files than the three things `assumed`
 * knows (`formalExpression` becomes `expression` with an `xsi:type`, for one), with or without #724.
 */
const MIWG_DIR = process.env['LILA_MIWG_DIR'];
const MIWG = MIWG_DIR === undefined || MIWG_DIR === '' ? [] : readdirSync(MIWG_DIR).filter((f) => f.endsWith('.bpmn')).sort();

const CORPUS: readonly (readonly [name: string, read: () => string, asTree: boolean])[] = [
  ...BIZAGI.map((name) => [name, () => bizagi(name), true] as const),
  ['hand-made (after MIWG C.8.1, A.1.0, Bizagi B.2.0)', () => HAND_MADE, true],
  ...MIWG.map((name) => [`MIWG ${name}`, () => readFileSync(join(MIWG_DIR!, name), 'utf8'), false] as const),
];

/** How often each id no element has, and each element bpmn-moddle drops, stands in `xml`. */
async function carried(xml: string, from: string = xml): Promise<Record<string, number>> {
  const { warnings } = await BpmnModdle().fromXML(from);
  const counts: Record<string, number> = {};
  for (const warning of warnings as { message: string; value?: unknown }[]) {
    const dropped = /^unparsable content <([^>]+)> detected[\s\S]*(?:unrecognized element|unknown type)/.exec(warning.message)?.[1];
    const text = dropped !== undefined ? `<${dropped}` : typeof warning.value === 'string' && warning.message.startsWith('unresolved reference') ? warning.value : undefined;
    if (text !== undefined) counts[text] = xml.split(text).length - 1;
  }
  return counts;
}

/* ------------------------------------------------------------------------------------------- */

test('the corpus is the seven Bizagi exports, and the comparison of models does run a simulation', async () => {
  expect(BIZAGI).toHaveLength(7);
  const { run } = await modelOf(bizagi('bizagi-miwg-A.1.0-roundtrip.bpmn'));
  expect(run).toMatchObject({ warnings: expect.any(Array) as unknown });
  expect(JSON.stringify(run).length).toBeGreaterThan(500);
});

describe.each(CORPUS)('%s', (_name, read, asTree) => {
  test('annotateElement keeps everything else, and the model reads back the same', async () => {
    const xml = read();
    const id = await targetOf(xml);
    const out = await annotateElement(xml, id, { documentation: NOTE });
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    if (asTree) expectOnlyAnnotated(xml, out, id);
    expect(await carried(out, xml)).toEqual(await carried(xml));
    expect((await readAnnotations(out))[id]?.documentation).toBe(NOTE);
    expect(await modelOf(out)).toEqual(await modelOf(xml));
    // Annotating again changes nothing: what was carried once is carried the same way after.
    expect(await annotateElement(out, id, { documentation: NOTE })).toBe(out);
  });

  test('writeAttributeDefinitions keeps everything else', async () => {
    const xml = read();
    const out = await writeAttributeDefinitions(xml, []);
    if (asTree) expect(canonical(parseXml(out))).toBe(canonical(parseXml(xml)));
    expect(await carried(out, xml)).toEqual(await carried(xml));
  });

  test.each([false, true])('editBpmn (layout: %s) renames a task and keeps everything else', async (layout) => {
    const xml = read();
    const id = await targetOf(xml);
    const edit = await editBpmn(xml, [{ op: 'rename', id, name: 'Renamed by an agent' }], { layout });
    const before = withoutExporter(parseXml(xml));
    const after = withoutExporter(parseXml(edit.xml));
    expect(byId(after, id).attrs['name']).toBe('Renamed by an agent');
    const name = byId(before, id).attrs['name'];
    if (name === undefined) delete byId(after, id).attrs['name'];
    else byId(after, id).attrs['name'] = name;
    expect(await carried(edit.xml, xml)).toEqual(await carried(xml));
    if (!asTree) expect(edit.xml).toContain('Renamed by an agent');
    else if (!layout) expect(canonical(after)).toBe(canonical(before));
    else {
      // A new layout redraws the diagram: the semantic part is what has to stay.
      const semantic = (root: Node): string => canonical({ ...root, children: root.children.filter((child) => !child.name.endsWith('}BPMNDiagram')) });
      expect(semantic(after)).toBe(semantic(before));
    }
    if (name !== undefined) {
      const renamed = JSON.parse(JSON.stringify(await modelOf(edit.xml)), (_key, value: unknown) =>
        typeof value === 'string' ? value.replaceAll('Renamed by an agent', name) : value) as unknown;
      expect(renamed).toEqual(await modelOf(xml));
    }
  });
});

describe('what bpmn-moddle cannot interpret survives, by name', () => {
  test('ids no element has stay where they were (Bizagi A.4.0, B.1.0; triso:unspecified)', async () => {
    for (const name of ['bizagi-miwg-A.4.0-roundtrip.bpmn', 'bizagi-miwg-B.1.0-roundtrip.bpmn']) {
      const xml = bizagi(name);
      const refs = xml.match(/(?:messageRef|dataStoreRef)="[^"]+"/g) ?? [];
      expect(refs.length).toBeGreaterThan(0);
      const id = await targetOf(xml);
      const edit = await editBpmn(xml, [{ op: 'rename', id, name: 'Renamed' }], { layout: false });
      expect((edit.xml.match(/(?:messageRef|dataStoreRef)="[^"]+"/g) ?? []).sort()).toEqual([...refs].sort());
    }
    const out = await annotateElement(HAND_MADE, 'Task_1', { documentation: NOTE });
    expect(out).toContain('<semantic:inMessageRef>triso:unspecified</semantic:inMessageRef>');
    expect(out).toContain('<semantic:outMessageRef>triso:unspecified</semantic:outMessageRef>');
    expect(out).toContain('messageRef="Message_1373649949207"');
    expect(out).toContain('operationRef="Operation_404"');
    // The dangling one keeps its place in the list.
    expect([...out.matchAll(/<semantic:flowNodeRef>([^<]+)</g)].map((m) => m[1])).toEqual(['Start_1', 'Ghost_1', 'Task_1', 'Task_2', 'End_1']);
  });

  test('elements bpmn-moddle does not know go back, verbatim, into their parent (Bizagi B.2.0)', async () => {
    const xml = bizagi('bizagi-miwg-B.2.0-roundtrip.bpmn');
    const parents = (text: string): string[] => [...text.matchAll(/<(\w+) id="([^"]+)"[^>]*>\s*<LoopCounter>0<\/LoopCounter>\s*<\/\1>/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(parents(xml)).toHaveLength(4);
    const id = await targetOf(xml);
    const annotated = await annotateElement(xml, id, { documentation: NOTE });
    expect(parents(annotated)).toEqual(parents(xml));
    const edit = await editBpmn(annotated, [{ op: 'rename', id, name: 'Renamed' }]);
    expect(parents(edit.xml)).toEqual(parents(xml));

    const out = await annotateElement(HAND_MADE, 'Task_1', { documentation: NOTE });
    expect(out).toContain('<vendor:hint level="2"><vendor:text>kept &amp; untouched</vendor:text></vendor:hint>');
    expect(out).toContain('<LoopCounter xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">0</LoopCounter>');
    expect(out).toContain('vendor:colour="red"');
    expect(out).toContain('name="Café"');
  });

  test('a fragment keeps its namespaces, declared on any element around it', async () => {
    const xml = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <b:process id="P" xmlns:v="urn:v" xmlns="urn:other"><b:task id="T"><v:thing a="1"><inner/></v:thing><b:Unknown/><plain v:q="1"/></b:task><b:task id="U"/></b:process></b:definitions>`;
    for (const id of ['T', 'U']) expectOnlyAnnotated(xml, await annotateElement(xml, id, { documentation: NOTE }), id);
  });

  test('removing the element that holds a fragment removes the fragment with it', async () => {
    const edit = await editBpmn(HAND_MADE, [{ op: 'remove', id: 'Task_2' }], { layout: false });
    expect(edit.xml).not.toContain('LoopCounter');
    expect(edit.xml).toContain('<vendor:hint level="2">');
  });
});

describe('what cannot be carried is refused by name, with its repair', () => {
  const model = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <process id="P" isExecutable="true">
    <startEvent id="S"/>
${body}
    <endEvent id="E"/>
    <sequenceFlow id="F1" sourceRef="S" targetRef="T"/>
    <sequenceFlow id="F2" sourceRef="T" targetRef="E"/>
  </process>
</definitions>`;

  const refusal = async (xml: string): Promise<{ annotate: string; edit: string }> => {
    const annotate = await annotateElement(xml, 'T', { documentation: NOTE }).then(
      () => 'written',
      (error: { detail: string }) => error.detail,
    );
    const edit = await editBpmn(xml, [{ op: 'rename', id: 'T', name: 'x' }]).then(
      () => 'written',
      (error: unknown) => (error instanceof EditError ? error.message : String(error)),
    );
    return { annotate, edit };
  };

  test('a repeated id', async () => {
    const { annotate, edit } = await refusal(model('    <task id="T"/>\n    <task id="T" name="again"/>'));
    expect(annotate).toBe(
      'line 6: <task> repeats the id "T" of an earlier element, and the id is the only key of an element; give one of the two an id of its own (and point at it the references meant for it)',
    );
    expect(edit).toContain(`the model has content the BPMN reader cannot write back, so editing it would lose it: ${annotate}`);
  });

  test('an id that is not an XML name', async () => {
    const { annotate, edit } = await refusal(model('    <task id="T"/>\n    <task id="7 up"/>'));
    expect(annotate).toMatch(/^line 6: the id "7 up" of <task> is not an XML name; rename it, and the references to it, /);
    expect(edit).toContain(annotate);
  });

  test('text where BPMN has none', async () => {
    const { annotate, edit } = await refusal(model('    <task id="T">stray words</task>'));
    expect(annotate).toBe('line 5: the text "stray words" stands where BPMN has no text; remove it, or move it into a <documentation> element');
    expect(edit).toContain(annotate);
  });

  test('in Spanish too', async () => {
    const error = await editBpmn(model('    <task id="T"/>\n    <task id="T"/>'), [{ op: 'rename', id: 'T', name: 'x' }], { locale: 'es' }).catch((e: Error) => e);
    expect((error as Error).message).toContain('línea 6: <task> repite el id "T" de un elemento anterior');
  });
});

describe('through a .lila, as the CLI and the MCP server do', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lila-724-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test.each(BIZAGI)('%s: annotate_element and edit_process write the model', async (name) => {
    const file = join(dir, `${name}.lila`);
    await createLilaProject({ path: file, name: 'Imported', bpmn: BIZAGI_DIR + name, allowUnsimulatable: true });
    const stored = (await readLilaProcessBpmn(file)).xml;
    const id = await targetOf(stored);

    const annotated = await annotateLilaElement({ file, elementId: id, documentation: NOTE });
    expect(annotated.elementId).toBe(id);
    const afterAnnotate = (await readLilaProcessBpmn(file)).xml;
    expectOnlyAnnotated(stored, afterAnnotate, id);

    const edited = await editLilaProcess(file, [{ op: 'rename', id, name: 'Renamed by an agent' }], { layout: false });
    expect(edited.dryRun).toBe(false);
    const afterEdit = (await readLilaProcessBpmn(file)).xml;
    expect(afterEdit).toContain('name="Renamed by an agent"');
    for (const kept of stored.match(/(?:messageRef|dataStoreRef)="[^"]+"|<LoopCounter>0<\/LoopCounter>/g) ?? []) expect(afterEdit).toContain(kept);
  });
});

/* ------------------------------------------------------------------------------------------- */
/* Regressions from the adversarial QA of #724: kept in the same place, or refused by name      */
/* ------------------------------------------------------------------------------------------- */

describe('kept exactly where it was, or refused by name (QA of #724)', () => {
  /** S1 → T1 → E1 with its drawing; the pieces are spliced in. */
  const m = ({ defs = '', t1 = '<bpmn:task id="T1" name="Do it">', inT1 = '', inProcess = '', top = '', di = '', incoming = '<bpmn:incoming>F1</bpmn:incoming>' } = {}): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:x="urn:x" id="Defs_1" targetNamespace="urn:qa"${defs}>${top}
  <bpmn:process id="P1" isExecutable="true">${inProcess}
    <bpmn:startEvent id="S1" name="Start">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    ${t1}
      ${incoming}
      <bpmn:outgoing>F2</bpmn:outgoing>${inT1}
    </${t1.slice(1, t1.indexOf(' '))}>
    <bpmn:endEvent id="E1" name="End">
      <bpmn:incoming>F2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T1" />
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="E1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D1">
    <bpmndi:BPMNPlane id="Pl1" bpmnElement="P1">
      <bpmndi:BPMNShape id="S1_di" bpmnElement="S1"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="200" y="78" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E1_di" bpmnElement="E1"><dc:Bounds x="360" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="136" y="118" /><di:waypoint x="200" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="300" y="118" /><di:waypoint x="360" y="118" /></bpmndi:BPMNEdge>${di}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
  const edit = async (xml: string, operations: unknown[], layout = false): Promise<string> => (await editBpmn(xml, operations, { layout })).xml;
  /** Why the annotation and the edit were refused: the same reason, with nothing written. */
  const refused = async (xml: string, operations: unknown[] = [{ op: 'rename', id: 'E1', name: 'x' }]): Promise<string> => {
    const annotate = await annotateElement(xml, 'E1', { documentation: NOTE }).then(() => 'written', (error: { detail: string }) => error.detail);
    const edited = await editBpmn(xml, operations, { layout: false }).then(() => 'written', (error: Error) => error.message);
    expect(edited).toContain(annotate);
    expect(await editBpmn(xml, operations, { layout: false, locale: 'es' }).then(() => 'written', (error: Error) => error.message)).toMatch(/^la edición se rechazó; no se cambió nada/);
    return annotate;
  };
  /** The names (`name` or id) of the elements that hold a child called `child`. */
  const holders = (xml: string, child: string): string[] =>
    [...nodes(parseXml(xml))].filter((node) => node.children.some((c) => c.name.endsWith(`}${child}`))).map((node) => node.attrs['name'] ?? node.attrs['id'] ?? node.name);

  test('D1: a fragment under a parent without an id follows that parent through the edit', async () => {
    const lanes = m({
      inProcess:
        '\n    <bpmn:laneSet id="LS"><bpmn:lane name="a"><bpmn:flowNodeRef>S1</bpmn:flowNodeRef></bpmn:lane><bpmn:lane name="b"><x:foo note="belongs to lane b"/><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane><bpmn:lane name="c"><bpmn:flowNodeRef>E1</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>',
    });
    for (const operation of [{ op: 'moveLane', lane: 'b', before: 'a' }, { op: 'removeLane', lane: 'a', moveStepsTo: 'c' }, { op: 'addLane', name: 'z', before: 'a' }]) {
      for (const layout of [false, true]) {
        const out = await edit(lanes, [operation], layout);
        expect(holders(out, 'foo'), JSON.stringify(operation)).toEqual(['b']);
        expect(out).toContain('<x:foo note="belongs to lane b"/>');
        expect(out).not.toContain('lilaKept');
      }
    }

    const associations = m({
      inProcess: ['A', 'B', 'C'].map((n) => `\n    <bpmn:dataObject id="DO_${n}"/><bpmn:dataObjectReference id="Ref_${n}" name="${n}" dataObjectRef="DO_${n}"/>`).join(''),
      inT1: `\n      <bpmn:property id="Prop" name="p"/>${['A', 'B', 'C'].map((n) => `<bpmn:dataInputAssociation><bpmn:sourceRef>Ref_${n}</bpmn:sourceRef><bpmn:targetRef>Prop</bpmn:targetRef>${n === 'B' ? '<x:foo note="belongs to B"/>' : ''}</bpmn:dataInputAssociation>`).join('')}`,
    });
    const out = await edit(associations, [{ op: 'removeDataObject', name: 'A' }]);
    const holder = [...nodes(parseXml(out))].filter((node) => node.children.some((c) => c.name === '{urn:x}foo'));
    expect(holder).toHaveLength(1);
    expect(holder[0]!.children.find((c) => c.name.endsWith('}sourceRef'))?.text).toBe('Ref_B');
  });

  test('D1: the fragment of a parent the change makes anew is refused, not moved', async () => {
    // `remove` then `add` of the same id: another task, not the one that held <bpmn:bogus>.
    const xml = m({ inT1: '\n      <bpmn:extensionElements><bpmn:bogus/></bpmn:extensionElements>' });
    const error = await editBpmn(xml, [{ op: 'remove', id: 'T1' }, { op: 'add', step: { id: 'T1', name: 'again' }, after: 'S1' }], { layout: false }).catch((e: Error) => e.message);
    expect(error).toMatch(/<bpmn:bogus> \(line \d+\) is not BPMN and was kept as it is inside "T1", which this change rebuilds; leave "T1" out of the change, or remove <bpmn:bogus> from the model first/);
    // Removed on purpose, it goes with what held it.
    expect(await edit(xml, [{ op: 'remove', id: 'T1' }])).not.toContain('bogus');
  });

  test('D2: an id inside another vendor\'s extension never stands for the element of that id', async () => {
    const camunda = m({
      defs: ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
      inT1: '\n      <bpmn:extensionElements><camunda:formData><camunda:formField id="T1" label="x"/></camunda:formData></bpmn:extensionElements>\n      <LoopCounter xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">1</LoopCounter>',
    });
    for (const out of [await annotateElement(camunda, 'E1', { documentation: NOTE }), await edit(camunda, [{ op: 'rename', id: 'E1', name: 'x' }])]) {
      expect(holders(out, 'LoopCounter')).toEqual(['Do it']);
      expect(holders(out, 'formField')).toEqual(['{http://camunda.org/schema/1.0/bpmn}formData']);
    }
    const before = m({ inT1: '\n      <x:foo a="belongs-to-T1"/>' }).replace('<bpmn:startEvent id="S1" name="Start">', '<bpmn:startEvent id="S1" name="Start">\n      <bpmn:extensionElements><x:ref id="T1"/></bpmn:extensionElements>');
    expect(holders(await annotateElement(before, 'E1', { documentation: NOTE }), 'foo')).toEqual(['Do it']);
  });

  test('D3: setType hands the ids no element has to the new element, or is refused', async () => {
    const task = m({ t1: '<bpmn:task id="T1" name="Do it" default="Gone">', incoming: '<bpmn:incoming>X1</bpmn:incoming><bpmn:incoming>F1</bpmn:incoming><bpmn:incoming>X2</bpmn:incoming>' });
    const user = await edit(task, [{ op: 'setType', id: 'T1', type: 'userTask' }]);
    expect(user).toContain('<bpmn:userTask id="T1" name="Do it" default="Gone">');
    expect([...user.matchAll(/<bpmn:incoming>([^<]+)</g)].map((match) => match[1])).toEqual(['X1', 'F1', 'X2', 'F2']);

    const send = m({ t1: '<bpmn:sendTask id="T1" name="Do it" messageRef="Message_gone" operationRef="Op_gone">' });
    const receive = await edit(send, [{ op: 'setType', id: 'T1', type: 'receiveTask' }]);
    expect(receive).toMatch(/<bpmn:receiveTask id="T1" name="Do it" (?=[^>]*messageRef="Message_gone")(?=[^>]*operationRef="Op_gone")/);

    // An exclusive gateway has a default flow; a plain task has no message.
    const error = await editBpmn(send, [{ op: 'setType', id: 'T1', type: 'task' }], { layout: false }).catch((e: Error) => e.message);
    expect(error).toContain(
      '"T1" refers to "Message_gone" (messageRef), an id no element has, and what this change makes of "T1" has no place for that reference; remove the reference from the model first, or leave "T1" out of the change',
    );
    expect(error).toContain('"T1" refers to "Op_gone" (operationRef)');
  });

  test('D4: an unknown element in the middle of text is refused', async () => {
    const reason = await refused(m({ inT1: '\n      <bpmn:documentation>before <b>bold</b> after</bpmn:documentation>' }));
    expect(reason).toMatch(/^line \d+: <b> stands in the middle of the text of <bpmn:documentation>, where BPMN has text only, .*write it as text \(&lt;b&gt;…\) or put the text in a CDATA section$/);
    // Text in a CDATA section is text.
    const cdata = m({ inT1: '\n      <bpmn:documentation><![CDATA[before <b>bold</b> after]]></bpmn:documentation>' });
    expect(await annotateElement(cdata, 'E1', { documentation: NOTE })).toContain('before &lt;b&gt;bold&lt;/b&gt; after');
  });

  test('a refusal through a .lila leaves the file as it was', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lila-724-refused-'));
    try {
      const file = join(dir, 'mixed.lila');
      await createLilaProject({ path: file, name: 'Mixed', bpmn: m({ inT1: '\n      <bpmn:documentation>before <b>bold</b> after</bpmn:documentation>' }), allowUnsimulatable: true });
      const bytes = readFileSync(file);
      await expect(annotateLilaElement({ file, elementId: 'E1', documentation: NOTE })).rejects.toThrow(/cannot be annotated: line \d+: <b> stands in the middle of the text of <bpmn:documentation>/);
      await expect(editLilaProcess(file, [{ op: 'rename', id: 'E1', name: 'x' }], { layout: false, locale: 'es' })).rejects.toThrow(/línea \d+: <b> está en medio del texto de <bpmn:documentation>/);
      await expect(editLilaProcess(file, [{ op: 'setType', id: 'T1', type: 'userTask' }])).rejects.toThrow(/<b> stands in the middle/);
      expect(readFileSync(file).equals(bytes)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('D5: attributes that differ only in their prefix are kept both, or refused', async () => {
    // The dangling `default` is what makes bpmn-moddle warn: without a warning the file is written as in 1.0.1.
    const twin = m({ t1: '<bpmn:task id="T1" name="Do it" default="Gone">', inT1: '\n      <bpmn:extensionElements><x:keep/><x:outer><x:allowed x:kind="A" kind="B"/></x:outer></bpmn:extensionElements>' });
    for (const out of [await annotateElement(twin, 'E1', { documentation: NOTE }), await annotateElement(twin, 'T1', { documentation: NOTE }), await edit(twin, [{ op: 'rename', id: 'T1', name: 'x' }])]) {
      expect(out).toContain('<x:outer><x:allowed x:kind="A" kind="B"/></x:outer>');
      expect(holders(out, 'outer')).toEqual(['{http://www.omg.org/spec/BPMN/20100524/MODEL}extensionElements']);
      expect(out).toContain('<x:keep/>');
    }
    const known = m({ t1: '<bpmn:task id="T1" bpmn:name="A" name="B" default="Gone">' });
    expect(await refused(known)).toMatch(/^line \d+: <bpmn:task> has two attributes that differ only in their prefix \(bpmn:name, name\), and the BPMN reader keeps one of them; rename or remove one$/);
  });

  test('D6: an unknown attribute with the prefix of a namespace bpmn-moddle knows is refused; without a prefix it is kept', async () => {
    expect(await refused(m({ t1: '<bpmn:task id="T1" name="Do it" bpmn:bogusAttr="v">' }))).toBe(
      'the attribute bpmn:bogusAttr of "T1" is not BPMN and would be written without its prefix; remove it, write it without the prefix, or give it a namespace of its own',
    );
    expect(await annotateElement(m({ t1: '<bpmn:task id="T1" name="Do it" bogus="v" x:other="w">' }), 'E1', { documentation: NOTE })).toContain('<bpmn:task id="T1" name="Do it" bogus="v" x:other="w">');
  });

  test('D7: ids inside what was set aside, and ids only references name, are taken', async () => {
    const hidden = m({ inT1: '\n      <bpmn:bogus><bpmn:task id="Hidden"/></bpmn:bogus>' });
    await expect(edit(hidden, [{ op: 'add', step: { id: 'Hidden', name: 'n' }, after: 'T1' }])).rejects.toThrow('operations[0].step.id: id "Hidden" is already used in the model.');

    const message = m({ t1: '<bpmn:sendTask id="T1" name="Do it" messageRef="NewStep">' });
    await expect(edit(message, [{ op: 'add', step: { id: 'NewStep', name: 'n' }, after: 'T1' }])).rejects.toThrow('id "NewStep" is already used in the model.');

    const group = m({ top: '\n  <bpmn:category id="Cat"><bpmn:categoryValue id="CV"/></bpmn:category>', inProcess: '\n    <bpmn:group id="G1" categoryValueRef="Lane_1"/>' });
    const out = await edit(group, [{ op: 'addLane', name: 'L' }]);
    expect(out).toContain('<bpmn:group id="G1" categoryValueRef="Lane_1" />');
    expect(out).not.toContain('<bpmn:lane id="Lane_1"');
    expect(out).toMatch(/<bpmn:lane id="Lane_1_2" name="L"/);
  });

  test('D8: ids no element has keep their exact place in a list where another reference repeats', async () => {
    const xml = m({ incoming: ['X1', 'F1', 'X2', 'F1', 'X3'].map((id) => `<bpmn:incoming>${id}</bpmn:incoming>`).join('') });
    for (const out of [await annotateElement(xml, 'T1', { documentation: NOTE }), await edit(xml, [{ op: 'rename', id: 'T1', name: 'x' }])]) {
      expect([...out.matchAll(/<bpmn:incoming>([^<]+)</g)].map((match) => match[1])).toEqual(['X1', 'F1', 'X2', 'F1', 'X3', 'F2']);
    }
  });

  test('D9: a shape that draws an id no element has does not break an edit that keeps the layout', async () => {
    const ghost = m({ di: '\n      <bpmndi:BPMNShape id="Ghost_di" bpmnElement="Ghost"><dc:Bounds x="1" y="2" width="3" height="4" /></bpmndi:BPMNShape>' });
    const out = await edit(ghost, [{ op: 'add', step: { id: 'N1', name: 'n' }, after: 'T1' }]);
    expect(out).toContain('<bpmndi:BPMNShape id="Ghost_di" bpmnElement="Ghost">');
    expect(out).toContain('<bpmn:task id="N1" name="n">');
  });

  test('N1: another vendor\'s extension is never rewritten, and `lila:` is read and written next to it', async () => {
    const W = '<bpmn:task id="T1" name="Do it" default="Gone">';
    const lilaNs = ' xmlns:lila="https://lila-modeler.org/schema/bpmn/1" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
    const vendor = ['<x:plain x:k="1"/>', '<x:mixed>text<x:in/>more</x:mixed>', '<camunda:field name="a" camunda:name="b"><camunda:string>v</camunda:string></camunda:field>', '<x:spaced xml:space="preserve">  two  </x:spaced>'];
    const xml = m({
      defs: lilaNs,
      t1: W,
      inT1: `\n      <bpmn:extensionElements>\n        ${vendor[0]}\n        <lila:responsibility type="R" roleRef="rol-1" />\n        ${vendor[1]}\n        ${vendor[2]}\n        ${vendor[3]}\n      </bpmn:extensionElements>`,
    });
    expect((await readAnnotations(xml))['T1']?.responsibilities).toEqual([{ type: 'R', roleRef: 'rol-1' }]);

    const responsibilities = [{ type: 'R', roleRef: 'rol-1' }, { type: 'A', roleRef: 'rol-2' }];
    const once = await annotateElement(xml, 'T1', { documentation: NOTE, responsibilities });
    for (const piece of vendor) expect(once).toContain(piece);
    expect(holders(once, 'plain')).toEqual(['{http://www.omg.org/spec/BPMN/20100524/MODEL}extensionElements']);
    expect(once.match(/<bpmn:extensionElements/g)).toHaveLength(1);
    expect((await readAnnotations(once))['T1']).toEqual({ documentation: NOTE, responsibilities });
    expect(once).not.toMatch(/lilaKept|urn:lila-modeler:kept/);
    // Written again, nothing moves: not a space more.
    expect(await annotateElement(once, 'T1', { documentation: NOTE, responsibilities })).toBe(once);
    expect(await annotateElement(once, 'E1', { documentation: NOTE })).toBe(await annotateElement(await annotateElement(once, 'E1', { documentation: NOTE }), 'E1', { documentation: NOTE }));

    // Clearing the `lila:` data leaves the vendor's alone, and an edit keeps both.
    const cleared = await annotateElement(once, 'T1', { responsibilities: [] });
    for (const piece of vendor) expect(cleared).toContain(piece);
    expect((await readAnnotations(cleared))['T1']?.responsibilities).toBeUndefined();
    for (const layout of [false, true]) {
      const edited = await edit(once, [{ op: 'setType', id: 'T1', type: 'userTask' }, { op: 'add', step: { id: 'N1', name: 'n' }, after: 'T1' }], layout);
      for (const piece of vendor) expect(edited).toContain(piece);
      expect((await readAnnotations(edited))['T1']?.responsibilities).toEqual(responsibilities);
      expect(holders(edited, 'mixed')).toEqual(['{http://www.omg.org/spec/BPMN/20100524/MODEL}extensionElements']);
    }

    // Attribute definitions on the process, next to a vendor's extension there.
    const withProcessExtension = xml.replace('<bpmn:process id="P1" isExecutable="true">', '<bpmn:process id="P1" isExecutable="true">\n    <bpmn:extensionElements><x:plain x:k="2"/></bpmn:extensionElements>');
    const defined = await writeAttributeDefinitions(withProcessExtension, [{ id: 'Attr_cost', name: 'Cost', type: 'number', appliesTo: 'task' }]);
    expect(defined).toContain('<x:plain x:k="2"/>');
    expect(defined).toContain('<lila:attributeDefinition id="Attr_cost"');
    const undefinedAgain = await writeAttributeDefinitions(defined, []);
    expect(undefinedAgain).toContain('<x:plain x:k="2"/>');
    expect(undefinedAgain).not.toContain('lila:attributeDefinition');
  });

  test('N2: a file that uses the names of the marks itself keeps them, and is written', async () => {
    const cases = [
      // the URI of the marks under another prefix, on the parent of a fragment and elsewhere
      m({ t1: '<bpmn:task id="T1" name="Do it" xmlns:k="urn:lila-modeler:kept" k:at="1">', inT1: '\n      <x:a/>' }),
      m({ defs: ' xmlns:k="urn:lila-modeler:kept"', inT1: '\n      <x:a/>' }).replace('<bpmn:startEvent id="S1"', '<bpmn:startEvent k:at="1" id="S1"'),
      // the prefix of the marks, for another namespace
      m({ defs: ' xmlns:lilaKept="urn:other"', t1: '<bpmn:task id="T1" name="Do it" lilaKept:at="mine">', inT1: '\n      <x:a/>' }),
      m({ defs: ' xmlns:lilaKept="urn:other"', inT1: '\n      <x:a/>' }),
      m({ inT1: '\n      <bpmn:documentation>lilaKept:at="1" lilaKept1: urn:lila-modeler:kept</bpmn:documentation>\n      <x:a/>' }),
    ];
    for (const xml of cases) {
      for (const out of [await annotateElement(xml, 'E1', { documentation: NOTE }), await edit(xml, [{ op: 'rename', id: 'E1', name: 'x' }]), await edit(xml, [{ op: 'rename', id: 'E1', name: 'x' }], true)]) {
        expect(holders(out, 'a')).toEqual(['Do it']);
        // What the file said with those names is still there, and nothing of the marks is.
        for (const own of xml.match(/(?:xmlns:k|k:at|xmlns:lilaKept|lilaKept:at)="[^"]*"/g) ?? []) expect(out).toContain(own);
        expect(out.split('lilaKept').length).toBe(xml.split('lilaKept').length);
        expect(out.split('urn:lila-modeler:kept').length).toBe(xml.split('urn:lila-modeler:kept').length);
      }
    }
  });

  test('an element set aside may open on several lines; stray text on several lines is named with its line', async () => {
    for (const fragment of ['<x:foo\n         a="1"\n         b="2">t</x:foo>', '<x:foo a="1">t</x:foo\n      >', '<x:foo\n        a="1"\n      />']) {
      expect(await annotateElement(m({ inT1: `\n      ${fragment}` }), 'E1', { documentation: NOTE })).toContain(fragment);
    }
    expect(await refused(m({ inProcess: '\n    stray\n    words' }))).toMatch(/^line \d+: the text "stray words" stands where BPMN has no text/);
  });
});
