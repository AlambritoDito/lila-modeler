/**
 * Nits of #645 (QA of #643/#630 and of Lote Q) in the modelling tools: `moveToLane` and its end
 * events, `annotate` on events and loose annotations, the outline reader's `cancelActivity` and
 * `instantiate` literals, a model whose simulated process is not drawn (`drawMissingDiagram`,
 * `create_project`, `put_process_bpmn`, `export_diagram`), `put_process_bpmn`'s arguments and dry
 * run, `annotate_element` and `define_attribute` names and defaults, text annotations in the
 * process document, the CLI's `-p` and positional project, and two plurals.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn, readAnnotations, readTextNotes } from '../src/bpmn/index.js';
import { drawMissingDiagram, editBpmn, EditError } from '../src/bpmn/edit.js';
import { bpmnToOutline, outlineToBpmn } from '../src/bpmn/outline.js';
import { main } from '../src/cli.js';
import { coreEn } from '../src/core/messages/en.js';
import { coreEs } from '../src/core/messages/es.js';
import { messages } from '../src/messages/index.js';
import { buildProcessDocument } from '../src/process-document.js';
import { encodeLila, processesOf } from '../src/project/index.js';
import {
  annotateLilaElement,
  createLilaProcess,
  createLilaProject,
  defineLilaAttribute,
  exportDiagram,
  openLilaProcess,
  putLilaProcessBpmn,
  readLilaFile,
} from '../src/project-fs/index.js';
import { CREDIT } from './fixtures/outlines.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const exampleLila = join(repo, 'examples/pedido.lila');
const bizagi = (name: string): string => readFileSync(join(repo, `examples/bizagi-exports/bizagi-miwg-${name}-roundtrip.bpmn`), 'utf8');
/** `xml` without its diagram (BPMN DI). */
const withoutDiagram = (xml: string): string => xml.replace(/<(\w+:)?BPMNDiagram[\s\S]*<\/(\w+:)?BPMNDiagram>/, '');

let scratch: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-645-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => void out.push(String(chunk)) || true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

async function laneOf(xml: string, id: string): Promise<string | undefined> {
  const { rootElement } = await BpmnModdle().fromXML(xml);
  const lanes = (rootElement as any).rootElements.find((e: any) => e.$type === 'bpmn:Process').laneSets?.[0]?.lanes ?? [];
  return lanes.find((l: any) => (l.flowNodeRef ?? []).some((n: any) => n.id === id))?.id;
}

async function refusal(xml: string, ops: unknown): Promise<EditError> {
  try {
    await editBpmn(xml, ops);
  } catch (error) {
    expect(error).toBeInstanceOf(EditError);
    return error as EditError;
  }
  throw new Error('the edit was not refused');
}

describe.each([true, false])('moveToLane and its end event (layout %s)', (layout) => {
  test('the end event moves with its step only while it sits in the step\'s lane', async () => {
    const { xml } = await outlineToBpmn(CREDIT);
    expect(await laneOf(xml, 'EndEvent_issue')).toBe(await laneOf(xml, 'issue'));
    const together = await editBpmn(xml, [{ op: 'addLane', name: 'Back office', id: 'Lane_back' }, { op: 'moveToLane', id: 'issue', lane: 'Lane_back' }], { layout });
    expect(await laneOf(together.xml, 'EndEvent_issue')).toBe('Lane_back');

    // Moved by hand to the customer's lane first: it stays there.
    const apart = await editBpmn(
      xml,
      [
        { op: 'moveToLane', id: 'EndEvent_issue', lane: 'Customer' },
        { op: 'addLane', name: 'Back office', id: 'Lane_back' },
        { op: 'moveToLane', id: 'issue', lane: 'Lane_back' },
      ],
      { layout },
    );
    expect(await laneOf(apart.xml, 'issue')).toBe('Lane_back');
    expect(await laneOf(apart.xml, 'EndEvent_issue')).toBe(await laneOf(xml, 'reject'));
  });
});

describe('annotate and associations', () => {
  test('annotate refuses start, end and boundary events, which the outline does not read notes from', async () => {
    const { xml, scenario } = await outlineToBpmn(CREDIT);
    const timed = await editBpmn(xml, [{ op: 'addBoundary', on: 'check', boundary: { id: 'cut', type: 'timer', duration: '1h', end: true } }], { scenario });
    for (const on of ['StartEvent', 'EndEvent_issue', 'cut']) {
      const error = await refusal(timed.xml, [{ op: 'annotate', on, text: 'Note' }]);
      expect(error.issues[0]).toMatchObject({ op: 0, path: 'on' });
      expect(error.issues[0]!.message).toContain(`"${on}" is a`);
      expect(error.issues[0]!.message).toContain('a text annotation goes on a step');
    }
    // A gateway is a step: its note reads back.
    const noted = await editBpmn(timed.xml, [{ op: 'annotate', on: 'ok', text: 'Policy 7' }]);
    const reading = await bpmnToOutline(noted.xml);
    expect(reading.outline.steps.find((s) => s.id === 'ok')?.notes).toEqual(['Policy 7']);
    expect(reading.warnings).toEqual([]);
  });

  test('removing one of two associations of an annotation keeps it', async () => {
    const { xml } = await outlineToBpmn(CREDIT);
    const noted = await editBpmn(xml, [{ op: 'annotate', on: 'check', text: 'Shared' }]);
    // A second association, from another step to the same annotation, written by hand.
    const twice = noted.xml.replace(
      /(<bpmn:association id="Association_check"[^>]*\/>)/,
      '$1<bpmn:association id="Association_extra" sourceRef="receive" targetRef="TextAnnotation_check" />',
    );
    expect(twice).toContain('Association_extra');
    const edit = await editBpmn(twice, [{ op: 'remove', id: 'Association_extra' }]);
    expect(edit.changes.map((c) => c.message)).toEqual(['removed Association "Association_extra"']);
    expect(edit.xml).toContain('TextAnnotation_check');
  });
});

describe('the outline reads cancelActivity and instantiate as the simulator does', () => {
  test('a boundary\'s "1" interrupts, "0" does not, and any other literal is left out with a warning', async () => {
    const { xml } = await outlineToBpmn(CREDIT);
    const base = await editBpmn(xml, [{ op: 'addBoundary', on: 'check', boundary: { id: 'late', type: 'timer', interrupting: false, to: 'reject' } }]);
    expect(base.xml).toContain('cancelActivity="false"');
    const literal = (value: string) => base.xml.replace('cancelActivity="false"', `cancelActivity="${value}"`);
    const boundary = async (value: string) => {
      const reading = await bpmnToOutline(literal(value));
      return { boundary: reading.outline.steps.find((s) => s.id === 'check')?.boundary?.[0], warnings: reading.warnings };
    };
    expect((await boundary('1')).boundary).toMatchObject({ id: 'late' });
    expect((await boundary('1')).boundary?.interrupting).not.toBe(false);
    expect((await boundary('0')).boundary).toMatchObject({ id: 'late', interrupting: false });
    for (const value of ['TRUE', 'yes']) {
      const read = await boundary(value);
      expect(read.boundary, value).toBeUndefined();
      expect(read.warnings.join('\n'), value).toContain('late');
    }
  });

  test('an event gateway with instantiate="1" instantiates: left out with a warning; "0" is read', async () => {
    const { xml, scenario } = await outlineToBpmn(CREDIT);
    const edit = await editBpmn(
      xml,
      [
        { op: 'add', step: { id: 'wait', type: 'eventGateway', name: 'Reply?' }, between: ['ok', 'reject'] },
        { op: 'add', step: { id: 'answer', type: 'message', name: 'Answer', duration: '1d' }, between: ['wait', 'reject'] },
        { op: 'add', step: { id: 'late', type: 'timer', name: '5 days', duration: '5d' } },
        { op: 'connect', from: 'wait', to: 'late' },
        { op: 'connect', from: 'late', to: 'reject' },
      ],
      { scenario },
    );
    const withInstantiate = (value: string) => edit.xml.replace(/<bpmn:eventBasedGateway id="wait"/, `<bpmn:eventBasedGateway id="wait" instantiate="${value}"`);
    const zero = await bpmnToOutline(withInstantiate('0'));
    expect(zero.warnings).toEqual([]);
    expect(zero.outline.steps.find((s) => s.id === 'wait')?.type).toBe('eventGateway');
    for (const value of ['1', 'TRUE']) {
      const reading = await bpmnToOutline(withInstantiate(value));
      expect(reading.outline.steps.find((s) => s.id === 'wait'), value).toBeUndefined();
      expect(reading.warnings.join('\n'), value).toContain('wait');
    }
  });
});

/** Two pools: `Process_A` (start → task → end) and `Process_B` (start → end); `drawn` picks the DI. */
function twoPools(drawn: 'B' | 'A-start-and-B'): string {
  const aStart = drawn === 'A-start-and-B'
    ? '<bpmndi:BPMNShape id="S_a_start" bpmnElement="a_start"><dc:Bounds x="100" y="50" width="36" height="36" /></bpmndi:BPMNShape>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs" targetNamespace="http://example.com">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="Pool_A" name="Claims" processRef="Process_A" />
    <bpmn:participant id="Pool_B" name="Customer" processRef="Process_B" />
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="true">
    <bpmn:startEvent id="a_start"><bpmn:outgoing>fa1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="a_task" name="Assess"><bpmn:incoming>fa1</bpmn:incoming><bpmn:outgoing>fa2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="a_end"><bpmn:incoming>fa2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="fa1" sourceRef="a_start" targetRef="a_task" />
    <bpmn:sequenceFlow id="fa2" sourceRef="a_task" targetRef="a_end" />
  </bpmn:process>
  <bpmn:process id="Process_B">
    <bpmn:startEvent id="b_start"><bpmn:outgoing>fb1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="b_end"><bpmn:incoming>fb1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="fb1" sourceRef="b_start" targetRef="b_end" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="S_pool_b" bpmnElement="Pool_B" isHorizontal="true"><dc:Bounds x="0" y="400" width="400" height="150" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="S_b_start" bpmnElement="b_start"><dc:Bounds x="100" y="450" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="S_b_end" bpmnElement="b_end"><dc:Bounds x="300" y="450" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="E_fb1" bpmnElement="fb1"><di:waypoint x="136" y="468" /><di:waypoint x="300" y="468" /></bpmndi:BPMNEdge>
      ${aStart}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

async function shapeIds(xml: string): Promise<Set<string>> {
  const { rootElement } = await BpmnModdle().fromXML(xml);
  const ids = new Set<string>();
  for (const d of (rootElement as any).diagrams ?? []) for (const el of d.plane.planeElement ?? []) if (el.$type === 'bpmndi:BPMNShape') ids.add(el.bpmnElement.id);
  return ids;
}

describe('a model whose simulated process is not drawn', () => {
  test('only the other pool drawn: the simulated process is laid out, the other pool stays', async () => {
    const xml = twoPools('B');
    const { ir } = await parseBpmn(xml);
    expect(ir.id).toBe('Process_A');
    const drawn = await drawMissingDiagram(xml, { processId: ir.id });
    expect(drawn.gap).toBeUndefined();
    const shapes = await shapeIds(drawn.xml!);
    for (const id of ['a_start', 'a_task', 'a_end', 'b_start', 'b_end']) expect(shapes.has(id), id).toBe(true);
    // Drawn whole now: nothing more to do.
    expect(await drawMissingDiagram(drawn.xml!, { processId: ir.id })).toEqual({});
  });

  test('partly drawn: kept as given, and the gap names the nodes without a shape', async () => {
    const xml = twoPools('A-start-and-B');
    expect(await drawMissingDiagram(xml, { processId: 'Process_A' })).toEqual({ gap: { kind: 'partial', missing: ['a_task', 'a_end'] } });
  });

  test('a model bpmn-moddle cannot read whole (bizagi-miwg A.4.0 without DI): kept as given, with the reason', async () => {
    const xml = withoutDiagram(bizagi('A.4.0'));
    const { ir } = await parseBpmn(xml);
    const drawn = await drawMissingDiagram(xml, { processId: ir.id });
    expect(drawn.xml).toBeUndefined();
    expect(drawn.gap).toMatchObject({ kind: 'unreadable', detail: expect.stringContaining('unresolved reference') });
  });

  test('create_project and put_process_bpmn come back with laidOut: false and a note; export_diagram says why', async () => {
    const lila = join(scratch, 'miwg.lila');
    const bpmn = join(scratch, 'a40.bpmn');
    writeFileSync(bpmn, withoutDiagram(bizagi('A.4.0')));
    const created = await createLilaProject({ path: lila, name: 'MIWG', bpmn, allowUnsimulatable: true });
    expect(created.laidOut).toBe(false);
    expect(created.notes.at(-1)).toMatch(/^the process it simulates has no diagram \(BPMN DI\) and was saved as given: bpmn-moddle cannot read the model whole \(unresolved reference/);

    const pedido = join(scratch, 'pedido.lila');
    copyFileSync(exampleLila, pedido);
    const put = await putLilaProcessBpmn({ file: pedido, mode: 'add', bpmn, allowUnsimulatable: true, dryRun: true, locale: 'es' });
    expect(put.laidOut).toBe(false);
    expect(put.notes.at(-1)).toMatch(/^el proceso que simula no tiene diagrama \(BPMN DI\) y se guardó como llegó/);
    const partial = await putLilaProcessBpmn({ file: pedido, mode: 'add', bpmn: twoPools('A-start-and-B'), allowUnsimulatable: true, dryRun: true });
    expect(partial.notes.at(-1)).toBe(
      'only part of the process it simulates is drawn: a_task, a_end have no shape (BPMN DI). The diagram was saved as given; draw them in a BPMN editor, or redraw the process with edit_process (layout: true).',
    );
    // `layout: false` asked for it: no note.
    const asked = await putLilaProcessBpmn({ file: pedido, mode: 'add', bpmn, allowUnsimulatable: true, dryRun: true, layout: false });
    expect(asked.notes.some((n) => n.includes('BPMN DI'))).toBe(false);

    await expect(exportDiagram({ file: lila })).rejects.toThrow(
      /^the model has no diagram \(BPMN DI\) to draw, and none can be laid out for it: bpmn-moddle cannot read the model whole \(unresolved reference/,
    );
    await expect(exportDiagram({ file: bpmn, locale: 'es' })).rejects.toThrow(/^el modelo no tiene diagrama \(BPMN DI\) que dibujar, y no se le puede maquetar uno/);
    const plain = join(scratch, 'plain.bpmn');
    writeFileSync(plain, withoutDiagram(bizagi('A.1.0')));
    await expect(exportDiagram({ file: plain })).rejects.toThrow(/^the model has no diagram \(BPMN DI\) to draw\. put_process_bpmn and create_project/);
  });
});

describe('put_process_bpmn arguments', () => {
  test('a blank name, a blank bpmn: refused before anything is read as a path', async () => {
    const file = join(scratch, 'pedido.lila');
    copyFileSync(exampleLila, file);
    const before = readFileSync(file);
    await expect(putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0'), name: '  ' })).rejects.toThrow(/^`name` cannot be blank/);
    for (const bpmn of ['', '   ']) await expect(putLilaProcessBpmn({ file, mode: 'add', bpmn })).rejects.toThrow(/^`bpmn` is empty/);
    await expect(createLilaProject({ path: join(scratch, 'new.lila'), name: 'New', bpmn: '', locale: 'es' })).rejects.toThrow(/^`bpmn` está vacío/);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  test('a replace dry run on a one-process version 2 file reports the slug and name the write gives', async () => {
    const file = join(scratch, 'pedido.lila');
    copyFileSync(exampleLila, file);
    // A version 2 archive whose manifest lists one process, `mostrador` (as in written-slug.test.ts).
    const { document } = await readLilaFile(file);
    const copia = { ...processesOf(document)[0]!, slug: 'copia', name: 'Copia' };
    const entries = unzipSync(encodeLila({ ...document, process: { slug: 'mostrador', name: 'Mostrador' }, processes: [copia] }));
    const manifest = JSON.parse(strFromU8(entries['lila-project.json']!)) as { processes: { slug: string }[] };
    manifest.processes = manifest.processes.filter((p) => p.slug === 'mostrador');
    const kept = Object.fromEntries(Object.entries(entries).filter(([name]) => !name.startsWith('processes/copia/')));
    writeFileSync(file, zipSync({ ...kept, 'lila-project.json': strToU8(JSON.stringify(manifest)) }));
    const opened = await openLilaProcess(file);
    expect(opened.process.slug).toBe('mostrador');

    const bpmn = opened.process.model.xml;
    const dry = await putLilaProcessBpmn({ file, mode: 'replace', bpmn, dryRun: true });
    const real = await putLilaProcessBpmn({ file, mode: 'replace', bpmn });
    const after = await openLilaProcess(file);
    expect(real).toMatchObject({ slug: after.process.slug, name: after.process.name });
    expect(dry).toMatchObject({ slug: real.slug, name: real.name, slugs: real.slugs });
    expect(dry.slug).not.toBe('mostrador');
    expect(dry.summary).toContain(`(${real.slug})`);
  });
});

describe('annotate_element and define_attribute', () => {
  test('an attribute is found by its name regardless of case; the exact spelling wins; the default is trimmed', async () => {
    const file = join(scratch, 'pedido.lila');
    copyFileSync(exampleLila, file);
    const cost = await defineLilaAttribute({ file, name: 'Cost Center', type: 'text', appliesTo: 'task', default: '  CC-1  ' });
    expect(cost.after).toMatchObject({ name: 'Cost Center', default: 'CC-1' });
    const blank = await defineLilaAttribute({ file, name: 'Owner', type: 'text', appliesTo: 'task', default: '   ' });
    expect(blank.after).not.toHaveProperty('default');

    const annotated = await annotateLilaElement({ file, elementId: 'Task_Revisar', attributes: { ' cost center ': 'CC-9' } });
    expect(annotated.written).toBe(true);
    const lila = await openLilaProcess(file);
    const values = (await readAnnotations(lila.process.model.xml))['Task_Revisar']?.attributes;
    expect(values).toEqual([{ ref: cost.after!.id, value: 'CC-9' }]);
    // The stored name keeps its spelling.
    expect((await defineLilaAttribute({ file, name: 'cost center', type: 'text', appliesTo: 'task', default: 'CC-1', dryRun: true })).before?.name).toBe('Cost Center');

    // Two definitions that differ only in case on different element types: the exact spelling picks one.
    await defineLilaAttribute({ file, name: 'cost center', type: 'text', appliesTo: 'gateway' });
    const exact = await annotateLilaElement({ file, elementId: 'Task_Revisar', attributes: { 'Cost Center': 'CC-2' } });
    expect(exact.written).toBe(true);
    await expect(annotateLilaElement({ file, elementId: 'Task_Revisar', attributes: { 'COST CENTER': 'CC-3' } })).rejects.toThrow(/COST CENTER/);
  });
});

describe('text annotations in the process document', () => {
  test('each element lists its notes; the loose ones go under the process description', async () => {
    const outline = { ...CREDIT, steps: CREDIT.steps.map((s) => (s.id === 'check' ? { ...s, notes: ['Within 48 h', 'Bureau B as fallback'] } : s)) };
    const { xml } = await outlineToBpmn(outline);
    const loose = xml.replace('</bpmn:process>', '<bpmn:textAnnotation id="Loose"><bpmn:text>Pilot only</bpmn:text></bpmn:textAnnotation></bpmn:process>');
    const notes = await readTextNotes(loose);
    expect(notes).toEqual({ check: ['Within 48 h', 'Bureau B as fallback'], '': ['Pilot only'] });
    const { ir } = await parseBpmn(loose);
    const doc = buildProcessDocument({ ir, annotations: {}, textNotes: notes, title: 'Credit', date: '2026-10-19' });
    const paragraphs = doc.blocks.filter((b) => b.kind === 'paragraph') as { label?: string; text: string }[];
    expect(paragraphs.filter((p) => p.label === 'Note').map((p) => p.text)).toEqual(['Pilot only', 'Within 48 h', 'Bureau B as fallback']);
    const description = doc.blocks.findIndex((b) => b.kind === 'paragraph' && (b as { text: string }).text === 'Pilot only');
    const check = doc.blocks.findIndex((b) => b.kind === 'heading' && (b as { text: string }).text === 'Check bureau');
    expect(description).toBeLessThan(check);
    const es = buildProcessDocument({ ir, annotations: {}, textNotes: notes, title: 'Credit', date: '2026-10-19', locale: 'es' });
    expect(es.blocks.some((b) => b.kind === 'paragraph' && (b as { label?: string }).label === 'Nota')).toBe(true);
  });

  test('lila export doc puts them in the HTML prose', async () => {
    const file = join(scratch, 'credit.lila');
    const outline = { ...CREDIT, steps: CREDIT.steps.map((s) => (s.id === 'check' ? { ...s, notes: ['Within 48 h'] } : s)) };
    await createLilaProcess(file, outline);
    const html = join(scratch, 'credit.html');
    expect(await main(['export', 'doc', file, '--out', html])).toBe(0);
    const prose = readFileSync(html, 'utf8').replace(/<svg[\s\S]*?<\/svg>/g, '');
    expect(prose).toContain('Within 48 h');
  });
});

describe('the CLI takes the project as -p or positionally (additive)', () => {
  test('process raci, attribute list, export-bpmn and import accept both forms; both at once is refused', async () => {
    const file = join(scratch, 'pedido.lila');
    copyFileSync(exampleLila, file);
    expect(await main(['process', 'raci', file, '--json'])).toBe(0);
    const positional = out.join('\n');
    out.length = 0;
    expect(await main(['process', 'raci', '-p', file, '--json'])).toBe(0);
    expect(out.join('\n')).toBe(positional);

    expect(await main(['process', 'attribute', 'list', '--project', file, '--json'])).toBe(0);
    expect(await main(['process', 'export-bpmn', file])).toBe(0);
    out.length = 0;
    const bpmn = join(scratch, 'a10.bpmn');
    writeFileSync(bpmn, bizagi('A.1.0'));
    expect(await main(['process', 'import', file, '--bpmn', bpmn, '--dry-run'])).toBe(0);
    expect(out.join('\n')).toContain('Dry run: would add process');

    for (const args of [
      ['process', 'raci', file, '-p', file],
      ['process', 'attribute', 'list', file, '-p', file],
      ['process', 'export-bpmn', file, '-p', file],
      ['process', 'import', file, '-p', file, '--bpmn', bpmn],
    ]) {
      expect(await main(args), args.join(' ')).not.toBe(0);
    }
  });
});

describe('plurals', () => {
  test('editRemoveAmbiguous: «2 incoming flows and 1 outgoing flow»', () => {
    const en = messages('en').cli.editRemoveAmbiguous;
    expect(en('g', 2, 1)).toContain('with 2 incoming flows and 1 outgoing flow it is not clear');
    expect(en('g', 1, 2)).toContain('with 1 incoming flow and 2 outgoing flows it is not clear');
    expect(messages('es').cli.editRemoveAmbiguous('g', 1, 2)).toContain('con 1 flujo de entrada y 2 de salida');
  });

  test('W-REPLICACIONES-SIN-OBSERVACIONES: «la otra replicación», and the singular of one replication', () => {
    const es = coreEs.codes['W-REPLICACIONES-SIN-OBSERVACIONES'];
    expect(es('Task', '1', '2', '1')).toBe('Task: ninguna instancia se completó en 1 de 2 replicaciones; sus estadísticas de tiempo promedian solo la otra replicación.');
    expect(es('Task', '12', '30', '18')).toBe('Task: ninguna instancia se completó en 12 de 30 replicaciones; sus estadísticas de tiempo promedian solo las otras 18.');
    expect(es('Task', '1', '1', '0')).toContain('en 1 de 1 replicación;');
    expect(coreEn.codes['W-REPLICACIONES-SIN-OBSERVACIONES']('Task', '1', '1', '0')).toContain('in 1 of 1 replication;');
    expect(coreEn.codes['W-REPLICACIONES-SIN-OBSERVACIONES/proceso']('1', '2', '1')).toBe(
      'process: no case completed in 1 of 2 replications; its cycle time, wait time, cost per case and service level average only the other 1.',
    );
    expect(coreEs.codes['W-REPLICACIONES-SIN-OBSERVACIONES/desenlace']('End', '1', '2', '1')).toContain('solo la otra replicación.');
  });
});
