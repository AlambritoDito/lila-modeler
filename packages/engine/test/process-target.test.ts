/**
 * #546 — the simulated process is the one the scenarios target, not the first pool of the file,
 * and every reader of a process (parse, run, compare, validate, exports) picks the same one.
 *
 * `examples/pedido` has two pools: Restaurant (simulated) and Customer (context). Deleting the
 * Restaurant pool in the editor and pasting it back leaves Customer first in the document; the
 * scenarios still configure the Restaurant elements, so that is the process that has to run.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validateBpmnModel, validateBpmnXml } from '../src/bpmn/validate-report.js';
import { main } from '../src/cli.js';
import { validatedModelOf, withRunOverrides } from '../src/cli-shared.js';
import { simulate } from '../src/index.js';
import { editLilaProcess, exportDocument, exportResults } from '../src/project-fs/index.js';
import { scenarioErrors, validateScenario, type ResolvedScenario } from '../src/scenario.js';
import { customerFirst, customerFirstLila } from './customer-first.js';

const PEDIDO = readFileSync(new URL('../../../examples/pedido/model.bpmn', import.meta.url), 'utf8');
const AS_IS = JSON.parse(
  readFileSync(new URL('../../../examples/pedido/as-is.scenario.json', import.meta.url), 'utf8'),
) as ResolvedScenario;

const REORDERED = customerFirst(PEDIDO);
/** A short run: the point is that it is the same run, not a long one. */
const SHORT = withRunOverrides({ ...AS_IS, run: { ...AS_IS.run, duration: 86_400, warmup: 0 } }, { replications: 2 });

describe('#546: the scenarios pick the process (parseBpmn)', () => {
  test('the fixture really puts Customer first, and without scenarios the old rule still applies', async () => {
    expect(REORDERED.indexOf('id="Process_Cliente"')).toBeLessThan(REORDERED.indexOf('id="Process_Restaurante"'));
    const { ir, ignoredProcessIds } = await parseBpmn(REORDERED);
    expect(ir.id).toBe('Process_Cliente');
    expect(ignoredProcessIds).toEqual(['Process_Restaurante']);
  });

  test('with the AS-IS scenario, the reordered file gives the same IR as the original', async () => {
    const original = await parseBpmn(PEDIDO);
    const reordered = await parseBpmn(REORDERED, { scenarios: [AS_IS] });
    expect(reordered.ir.id).toBe('Process_Restaurante');
    expect(reordered.ignoredProcessIds).toEqual(['Process_Cliente']);
    expect(reordered.ir.nodes).toEqual(original.ir.nodes);
    expect(reordered.ir.flows).toEqual(original.ir.flows);
    expect(reordered.ir.source.originalIds).toEqual(original.ir.source.originalIds);
    // The original order is unchanged by the option.
    expect((await parseBpmn(PEDIDO, { scenarios: [AS_IS] })).ir).toEqual(original.ir);
  });

  test('the reordered Sample order runs, and gives the same result as the original', async () => {
    const [original, reordered] = await Promise.all([
      validatedModelOf({ path: 'model.bpmn', xml: PEDIDO }, 'en', [SHORT]),
      validatedModelOf({ path: 'model.bpmn', xml: REORDERED }, 'en', [SHORT]),
    ]);
    expect(reordered.validation.errors).toEqual([]);
    expect(scenarioErrors(validateScenario(SHORT, reordered.ir, { elsewhere: reordered.elsewhere }))).toEqual([]);
    expect(simulate(reordered.ir, SHORT, { log: false })).toEqual(simulate(original.ir, SHORT, { log: false }));
  });

  test('the union of the scenarios decides, by majority: a few seeds of the other pool do not take the run away', async () => {
    // What the editor leaves after deleting Restaurant: the Customer start and task seeded (#420),
    // here in a second scenario so the union is what counts.
    const seeds = { elements: { StartEvent_ClienteInicio: {}, Task_ClienteRecibe: {} } };
    expect((await parseBpmn(REORDERED, { scenarios: [AS_IS, seeds] })).ir.id).toBe('Process_Restaurante');
    // Alone, the Customer scenario targets Customer (a `.bpmn` run with just that scenario).
    expect((await parseBpmn(PEDIDO, { scenarios: [seeds] })).ir.id).toBe('Process_Cliente');
  });

  test('ids the file does not know, none, or what is not an object keep the document-order rule', async () => {
    expect((await parseBpmn(REORDERED, { scenarios: [{ elements: { Fantasma: {} } }] })).ir.id).toBe('Process_Cliente');
    expect((await parseBpmn(REORDERED, { scenarios: [] })).ir.id).toBe('Process_Cliente');
    expect((await parseBpmn(REORDERED, { scenarios: [null, undefined, {}, { elements: 3 }] })).ir.id).toBe('Process_Cliente');
  });

  test('validateBpmnXml keeps its documented report: no `elsewhere` in `lila validate --json`', async () => {
    const report = await validateBpmnXml(REORDERED, { scenarios: [AS_IS] });
    expect(Object.keys(report).sort()).toEqual(['errors', 'ignoredProcessIds', 'ir', 'warnings']);
    expect(report.ir.id).toBe('Process_Restaurante');
  });
});

describe('#546: an ambiguous scenario says which process ran and how to fix it', () => {
  // One entry in each pool: a tie, so the first pool in the document (Customer) is simulated.
  const tie = {
    ...SHORT,
    elements: { StartEvent_Pedido: AS_IS.elements!['StartEvent_Pedido']!, Task_ClienteRecibe: {} },
  } as ResolvedScenario;

  test.each([
    [
      'en',
      `the id StartEvent_Pedido belongs to the process "Restaurant" (Process_Restaurante), but the simulated process is "Customer" (Process_Cliente). The simulated process is the one that holds most of the elements the process's scenarios configure, and on a tie the first one in the file: remove from the scenarios the entries of the process you do not want to simulate (elements.StartEvent_Pedido).`,
    ],
    [
      'es',
      'el id StartEvent_Pedido pertenece al proceso «Restaurant» (Process_Restaurante), pero el proceso simulado es «Customer» (Process_Cliente). Se simula el proceso que contiene la mayoría de los elementos que configuran los escenarios del proceso, y en un empate el primero del archivo: quita de los escenarios las entradas del proceso que no quieres simular (elements.StartEvent_Pedido).',
    ],
  ] as const)('%s', async (locale, message) => {
    const model = await validateBpmnModel(REORDERED, { locale, scenarios: [tie] });
    expect(model.ir.id).toBe('Process_Cliente');
    const errors = scenarioErrors(validateScenario(tie, model.ir, { locale, elsewhere: model.elsewhere }));
    expect(errors).toEqual([
      { code: 'E-ELEMENTO-DESCONOCIDO', path: 'elements.StartEvent_Pedido', severity: 'error', message },
    ]);
  });

  test('an id in no process keeps the plain message', async () => {
    const model = await validateBpmnModel(PEDIDO);
    const [error] = scenarioErrors(
      validateScenario({ ...SHORT, elements: { Fantasma: {} } } as ResolvedScenario, model.ir, { elsewhere: model.elsewhere }),
    );
    expect(error?.message).toBe('the id Fantasma does not exist in the model (elements.Fantasma).');
  });
});

describe('#546: a Customer-first .lila, through the CLI and the exports', () => {
  let dir: string;
  let file: string;
  let out: string[];
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lila-546-'));
    file = join(dir, 're.lila');
    await customerFirstLila(file, { run: true });
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => void out.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => void out.push(args.join(' ')));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  test('lila run, compare and validate all take Restaurant', async () => {
    expect(await main(['run', file, 'as-is', '--replications', '1'])).toBe(0);
    expect(out.join('\n')).toContain('Process Process_Restaurante (Restaurant)');
    out.length = 0;
    expect(await main(['compare', file, 'as-is', 'to-be-3-cajeros', '--replications', '1'])).toBe(0);
    out.length = 0;
    await main(['validate', file]);
    expect(out.join('\n')).toContain('Process_Restaurante (Restaurant)');
  });

  test('lila process show reads the Restaurant outline, not the first pool (QA of #560, round 2)', async () => {
    expect(await main(['process', 'show', '-p', file, '--json'])).toBe(0);
    const { outline, warnings } = JSON.parse(out.join('\n')) as { outline: { steps: { name?: string }[] }; warnings: string[] };
    expect(outline.steps.map((step) => step.name)).toContain('Take order');
    expect(outline.steps.map((step) => step.name)).not.toContain('Receive notification');
    expect(warnings.join(' ')).toContain('Customer');
  });

  test('edit_process edits Restaurant and reads Restaurant back (with #557)', async () => {
    const edited = await editLilaProcess(file, [{ op: 'add', step: { id: 'Task_Cobrar', name: 'Charge' }, after: 'Task_TomarPedido' }], { dryRun: true });
    const names = edited.outline.steps.map((step) => step.name);
    expect(names).toEqual(expect.arrayContaining(['Take order', 'Charge']));
    expect(names).not.toContain('Receive notification');
  });

  test('exported results name the elements and the document describes Restaurant', async () => {
    const results = await exportResults({ file, format: 'csv' });
    const elements = (results.data as Record<string, string>)['elements.csv']!;
    expect(elements).toMatch(/^StartEvent_Pedido,Order received,start,/m);
    const doc = await exportDocument({ file, format: 'html', date: '2026-10-01' });
    const html = typeof doc.data === 'string' ? doc.data : new TextDecoder().decode(doc.data);
    expect(html).toContain('Order received');
    expect(html).toContain('Take order');
  });
});
