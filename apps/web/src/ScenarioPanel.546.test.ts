/**
 * #546 (QA of #560, nit): the panel's live lint gives the same message as Run for an entry of
 * another process of the file, because it gets the same `elsewhere`.
 */
import { readFileSync } from 'node:fs';
import { validateBpmnModel } from '@lila-modeler/engine/bpmn';
import { expect, it } from 'vitest';
import { problemasEscenario } from './ScenarioPanel';

it('an entry of the other pool names its process in the panel too', async () => {
  const xml = readFileSync('examples/pedido/model.bpmn', 'utf8');
  const raw = JSON.parse(readFileSync('examples/pedido/as-is.scenario.json', 'utf8')) as Record<string, unknown>;
  const model = await validateBpmnModel(xml, { locale: 'en', scenarios: [raw] });
  const conCliente = { ...raw, elements: { ...(raw['elements'] as object), Task_ClienteRecibe: {} } };
  const [problema] = problemasEscenario(conCliente, model.ir, 'en', model.elsewhere).filter((p) => p.severidad === 'error');
  expect(problema?.mensaje).toMatch(/^the id Task_ClienteRecibe belongs to the process "Customer" \(Process_Cliente\), but the simulated process is "Restaurant"/);
  // Without `elsewhere`, the plain message, as before.
  expect(problemasEscenario(conCliente, model.ir, 'en').find((p) => p.severidad === 'error')?.mensaje).toBe(
    'the id Task_ClienteRecibe does not exist in the model (elements.Task_ClienteRecibe).',
  );
});
