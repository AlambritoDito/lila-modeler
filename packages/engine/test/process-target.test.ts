/**
 * #546 — the simulated process is the one the scenario targets, not the first pool of the file.
 *
 * `examples/pedido` has two pools: Restaurant (simulated) and Customer (context). Deleting the
 * Restaurant pool in the editor and pasting it back leaves Customer first in the document; the
 * scenario still configures the Restaurant elements, so that is the process that has to run.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { parseBpmn, scenarioElementIds } from '../src/bpmn/parse.js';
import { validateBpmnModel, validateBpmnXml } from '../src/bpmn/validate-report.js';
import { validatedModelOf, withRunOverrides } from '../src/cli-shared.js';
import { simulate } from '../src/index.js';
import { scenarioErrors, validateScenario, type ResolvedScenario } from '../src/scenario.js';

const PEDIDO = readFileSync(new URL('../../../examples/pedido/model.bpmn', import.meta.url), 'utf8');
const AS_IS = JSON.parse(
  readFileSync(new URL('../../../examples/pedido/as-is.scenario.json', import.meta.url), 'utf8'),
) as ResolvedScenario;

/** The same model with the Customer participant and process first, as a delete + paste leaves it. */
function customerFirst(xml: string): string {
  const process = /\s*<bpmn:process id="Process_Cliente"[\s\S]*?<\/bpmn:process>/.exec(xml)![0];
  const participant = /\s*<bpmn:participant id="Participant_Cliente"[^>]*\/>/.exec(xml)![0];
  return xml
    .replace(process, '')
    .replace(participant, '')
    .replace(/(\s*<bpmn:participant id="Participant_Restaurante")/, `${participant}$1`)
    .replace(/(\s*<bpmn:process id="Process_Restaurante")/, `${process}$1`);
}

const REORDERED = customerFirst(PEDIDO);
/** A short run: the point is that it is the same run, not a long one. */
const SHORT = withRunOverrides({ ...AS_IS, run: { ...AS_IS.run, duration: 86_400, warmup: 0 } }, { replications: 2 });

describe('#546: the scenario picks the process', () => {
  test('the fixture really puts Customer first, and without a scenario the old rule still applies', async () => {
    expect(REORDERED.indexOf('id="Process_Cliente"')).toBeLessThan(REORDERED.indexOf('id="Process_Restaurante"'));
    const { ir, ignoredProcessIds } = await parseBpmn(REORDERED);
    expect(ir.id).toBe('Process_Cliente');
    expect(ignoredProcessIds).toEqual(['Process_Restaurante']);
  });

  test('with the AS-IS ids, the reordered file gives the same IR as the original', async () => {
    const original = await parseBpmn(PEDIDO);
    const reordered = await parseBpmn(REORDERED, { scenarioIds: scenarioElementIds(AS_IS) });
    expect(reordered.ir.id).toBe('Process_Restaurante');
    expect(reordered.ignoredProcessIds).toEqual(['Process_Cliente']);
    expect(reordered.ir.nodes).toEqual(original.ir.nodes);
    expect(reordered.ir.flows).toEqual(original.ir.flows);
    expect(reordered.ir.source.originalIds).toEqual(original.ir.source.originalIds);
    // The original order is unchanged by the option.
    const same = await parseBpmn(PEDIDO, { scenarioIds: scenarioElementIds(AS_IS) });
    expect(same.ir).toEqual(original.ir);
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

  test('a few seeds of the other pool do not take the run away from the process the scenario configures', async () => {
    // What the editor leaves after deleting Restaurant: the Customer start and task seeded (#420).
    const seeded = { elements: { ...AS_IS.elements, StartEvent_ClienteInicio: {}, Task_ClienteRecibe: {} } };
    const { ir } = await parseBpmn(REORDERED, { scenarioIds: scenarioElementIds(seeded) });
    expect(ir.id).toBe('Process_Restaurante');
  });

  test('ids the file does not know, or none, keep the document-order rule', async () => {
    expect((await parseBpmn(REORDERED, { scenarioIds: ['Fantasma'] })).ir.id).toBe('Process_Cliente');
    expect((await parseBpmn(REORDERED, { scenarioIds: [] })).ir.id).toBe('Process_Cliente');
  });

  test('scenarioElementIds is the union of the scenarios, ignoring what is not an object', () => {
    expect(scenarioElementIds({ elements: { A: {}, B: {} } }, { elements: { B: {}, C: {} } }, {}, undefined, { elements: 3 })).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  test('validateBpmnXml keeps its documented report: no `elsewhere` in `lila validate --json`', async () => {
    const report = await validateBpmnXml(REORDERED, { scenarioIds: scenarioElementIds(AS_IS) });
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
      'the id StartEvent_Pedido belongs to the process "Restaurant" (Process_Restaurante), but the simulated process is "Customer" (Process_Cliente). A run simulates the process that holds most of the elements its scenario configures: remove from the scenario the entries of the process you do not want to simulate (elements.StartEvent_Pedido).',
    ],
    [
      'es',
      'el id StartEvent_Pedido pertenece al proceso «Restaurant» (Process_Restaurante), pero el proceso simulado es «Customer» (Process_Cliente). Una corrida simula el proceso que contiene la mayoría de los elementos que configura su escenario: quita del escenario las entradas del proceso que no quieres simular (elements.StartEvent_Pedido).',
    ],
  ] as const)('%s', async (locale, message) => {
    const model = await validateBpmnModel(REORDERED, { locale, scenarioIds: scenarioElementIds(tie) });
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
