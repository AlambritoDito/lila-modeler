import { describe, expect, test } from 'vitest';
import { parseBpmn } from '../../src/bpmn/parse.js';
import { validateBpmnXml } from '../../src/bpmn/validate-report.js';
import { validate } from '../../src/bpmn/validate.js';
import { simulate } from '../../src/core/run.js';
import { boundaryIncomingXml } from '../fixtures/boundary-incoming.js';

const variants = [undefined, 'true', '1', 'false', '0'];
const layouts = [
  { declareIncoming: false, flowFirst: false },
  { declareIncoming: false, flowFirst: true },
  { declareIncoming: true, flowFirst: false },
  { declareIncoming: true, flowFirst: true },
];

describe.each(variants)('boundary incoming, cancelActivity=%s (#364)', (cancelActivity) => {
  const variant = cancelActivity === undefined ? {} : { cancelActivity };

  test.each(layouts)('rejects real incoming flows: %j', async (layout) => {
    const xml = boundaryIncomingXml({ ...variant, ...layout });
    const { ir, unsupported } = await parseBpmn(xml);
    expect(unsupported.filter((element) => element.id === 'Boundary')).toEqual([
      { id: 'Boundary', qname: 'bpmn:BoundaryEvent', name: 'Deadline', construction: 'boundaryEvent' },
    ]);
    expect(ir.nodes.Boundary).toBeUndefined();

    for (const locale of ['en', 'es'] as const) {
      const errors = [{
        code: 'E-NOSOP',
        id: 'Boundary',
        message: locale === 'en'
          ? 'Boundary (bpmn:boundaryEvent, "Deadline"): event attached to an activity (boundary event) not supported by the simulator.'
          : 'Boundary (bpmn:boundaryEvent, "Deadline"): evento adjunto a actividad (boundary event) no soportado por el simulador.',
      }];
      // The shared end stays reachable through the host: only the boundary is invalid, and
      // discarded adjacent flows must not duplicate its diagnostic.
      expect(validate(ir, { unsupported, locale }).errors).toEqual(errors);
      // CLI and MCP consume this report; the parser's unsupported metadata must reach them.
      expect((await validateBpmnXml(xml, { locale })).errors).toEqual(errors);
    }
  });

  test('accepts a boundary with no incoming flow', async () => {
    const xml = boundaryIncomingXml({ ...variant, incoming: false });
    const { ir, unsupported } = await parseBpmn(xml);
    expect(unsupported).toEqual([]);
    expect(validate(ir, { unsupported }).errors).toEqual([]);
    expect(ir.nodes.Boundary).toEqual({
      type: 'timer', name: 'Deadline', attachedTo: 'Host', incoming: [],
      outgoing: ['Flow_Boundary'],
      ...(['false', '0'].includes(cancelActivity ?? '') ? { interrupting: false } : {}),
    });
    expect((await validateBpmnXml(xml)).errors).toEqual([]);
  });
});

test.each(['true', 'false'])('multiple outlets retain first-flow semantics (%s)', async (cancelActivity) => {
  const xml = boundaryIncomingXml({ cancelActivity, incoming: false }).replace(
    '</bpmn:process>',
    '<bpmn:sequenceFlow id="Flow_Second" sourceRef="Boundary" targetRef="End" /></bpmn:process>',
  );
  const { ir, unsupported } = await parseBpmn(xml);
  expect(validate(ir, { unsupported })).toEqual({ errors: [], warnings: [] });
  expect(ir.nodes.Boundary?.outgoing).toEqual(['Flow_Boundary', 'Flow_Second']);
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start: { triggerCount: 1 },
      Host: { processingTime: { type: 'constant', value: 10 } },
      Boundary: { processingTime: { type: 'constant', value: 1 } },
    },
  });
  // R-BND-6/R-BND-11: this fix adds no fan-out or warning for multiple outgoing flows.
  expect(result.elements.Boundary).toMatchObject({ started: 1, completed: 1 });
  expect(result.flows.Flow_Boundary?.count).toBe(1);
  expect(result.flows.Flow_Second?.count).toBe(0);
});
