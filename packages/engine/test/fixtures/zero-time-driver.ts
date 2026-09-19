/**
 * Synthetic models authored for #368; no external or private source material.
 * Assumptions: one initial case, seed 42, no resources/calendars unless the mode says so.
 * Acceptance: zero-time loops fail with a diagnostic; finite/advancing work still runs.
 * Always launch via zero-time-loop.test.ts, whose parent enforces a timeout and heap limit.
 */
import { parseBpmn } from '../../src/bpmn/parse.js';
import { validate } from '../../src/bpmn/validate.js';
import { simulate } from '../../src/core/run.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';
import type { ProcessIR } from '../../src/core/ir.js';
import type { Locale } from '../../src/core/messages/index.js';

const mode = process.argv[2] ?? 'xor';
const locale = (process.argv[3] ?? 'en') as Locale;
const constant = (value: number) => ({ type: 'constant' as const, value });
const event = mode.startsWith('event') || mode === 'missing-branches';
let xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test:368"><bpmn:process id="Process_Loop">
<bpmn:startEvent id="Start"/><bpmn:sequenceFlow id="Initial" sourceRef="Start" targetRef="Gateway"/>
<${event ? 'bpmn:eventBasedGateway' : 'bpmn:exclusiveGateway'} id="Gateway"/>
<bpmn:sequenceFlow id="Repeat" sourceRef="Gateway" targetRef="Timer"/>
<bpmn:intermediateCatchEvent id="Timer"><bpmn:${mode === 'event-message' ? 'message' : 'timer'}EventDefinition id="Trigger"/></bpmn:intermediateCatchEvent>
<bpmn:sequenceFlow id="Return" sourceRef="Timer" targetRef="Gateway"/>
<bpmn:sequenceFlow id="Exit" sourceRef="Gateway" targetRef="${event ? 'Other' : 'End'}"/>
${event ? '<bpmn:intermediateCatchEvent id="Other"><bpmn:timerEventDefinition id="OtherTrigger"/></bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="Finish" sourceRef="Other" targetRef="End"/>' : ''}
<bpmn:endEvent id="End"/></bpmn:process></bpmn:definitions>`;
if (mode === 'boundary') {
  xml = xml.replace('<bpmn:intermediateCatchEvent id="Timer"><bpmn:timerEventDefinition id="Trigger"/></bpmn:intermediateCatchEvent>',
    '<bpmn:task id="Timer"/><bpmn:boundaryEvent id="Boundary" attachedToRef="Timer"><bpmn:timerEventDefinition id="Trigger"/></bpmn:boundaryEvent>')
    .replace('id="Return" sourceRef="Timer"', 'id="Return" sourceRef="Boundary"');
}
let { ir } = await parseBpmn(xml);
if (validate(ir).errors.length) throw new Error(JSON.stringify(validate(ir).errors));
const scenario: SimScenario = {
  run: { seed: 42, duration: 10, replications: mode === 'replications' ? 3 : 1 },
  elements: {
    Start: { triggerCount: 1 },
    Timer: { processingTime: constant(0) },
    ...(event ? { Other: { processingTime: constant(1) } } : { Repeat: { probability: 1 }, Exit: { probability: 0 } }),
  },
};
if (mode === 'missing' || mode === 'missing-no-duration') scenario.elements!.Timer = {};
if (mode.includes('no-duration')) delete scenario.run.duration;
if (mode === 'boundary') { scenario.elements!.Timer = { processingTime: constant(1) }; scenario.elements!.Boundary = { processingTime: constant(0) }; }
if (mode === 'warmup') scenario.run.warmup = 1;
if (mode === 'missing-branches') { scenario.elements!.Timer = {}; scenario.elements!.Other = {}; }
if (mode === 'positive' || mode === 'tiny') scenario.elements!.Timer = { processingTime: constant(mode === 'tiny' ? 1e-12 : 1) };
if (mode === 'tiny') scenario.run.duration = 4e-8;
if (mode === 'positive') scenario.run.duration = 40_000;
if (mode === 'probabilistic') { scenario.elements!.Repeat = { probability: 0.8 }; scenario.elements!.Exit = { probability: 0.2 }; }
if (mode === 'conditioned') {
  scenario.elements!.Repeat = { probability: 1, conditions: [{ flowTaken: 'Return', probability: 0 }] };
  scenario.elements!.Exit = { probability: 0, conditions: [{ flowTaken: 'Return', probability: 1 }] };
}
if (mode === 'many' || mode === 'chain' || mode === 'and' || mode === 'or') {
  const nodes: ProcessIR['nodes'] = {};
  const flows: ProcessIR['flows'] = {};
  const add = (id: string, type: ProcessIR['nodes'][string]['type']) => { nodes[id] = { name: id, type, incoming: [], outgoing: [] }; };
  const link = (from: string, to: string) => { const id = `f${Object.keys(flows).length}`; flows[id] = { from, to, name: '', isDefault: false }; nodes[from]!.outgoing.push(id); nodes[to]!.incoming.push(id); };
  add('Start', 'start'); add('End', 'end');
  if (mode === 'and' || mode === 'or') {
    add('Fork', mode); add('Join', mode); link('Start', 'Fork'); link('Join', 'End');
    for (let i = 0; i < 200; i++) { const id = `t${i}`; add(id, 'task'); link('Fork', id); link(id, 'Join'); }
  } else {
    let previous = 'Start';
    for (let i = 0; i < (mode === 'chain' ? 2000 : 1); i++) { const id = `t${i}`; add(id, 'task'); link(previous, id); previous = id; }
    link(previous, 'End');
  }
  ir = { ...ir, nodes, flows };
  scenario.elements = { Start: { triggerCount: mode === 'many' ? 30_000 : 1 } };
}
if (mode === 'scaled') {
  // A reachable, unused exit chain makes the graph-scaled budget exceed the floor.
  ir.flows.Exit!.to = 'pad0';
  ir.nodes.End!.incoming = ['padEnd'];
  for (let i = 0; i < 60; i++) {
    const id = `pad${i}`;
    const flow = i === 59 ? 'padEnd' : `padFlow${i}`;
    ir.nodes[id] = { type: 'task', name: id, incoming: [i === 0 ? 'Exit' : `padFlow${i - 1}`], outgoing: [flow] };
    ir.flows[flow] = { from: id, to: i === 59 ? 'End' : `pad${i + 1}`, name: '', isDefault: false };
  }
}
let steps = 0;
let emitted = 0;
let maxReplication = 0;
const begin = performance.now();
try {
  if (mode === 'fixture') {
    console.log(JSON.stringify({ xml, scenario: { version: 1, name: 'Zero-time regression', model: 'model.bpmn', ...scenario, run: { ...scenario.run, start: '2026-09-01T00:00:00Z' } } }));
  } else if (mode === 'worker') {
    const { handleMessage } = await import('../../../../apps/web/src/worker.js');
    const messages: { type: string; message?: string }[] = [];
    handleMessage((message) => { if (message.type !== 'progress') messages.push(message); }, { type: 'run', ir, scenario, locale });
    console.log(JSON.stringify({ messages, elapsedMs: performance.now() - begin }));
  } else if (mode === 'threshold' || mode === 'cancel-at-limit' || mode === 'scaled') {
    const signal = { aborted: false };
    const result = runReplication(ir, scenario, 2, { locale, signal, onStep: () => {
      steps++;
      // One arrival is not charged. Stop before attempting event 100,001.
      if (mode === 'cancel-at-limit' && steps === 100_002) signal.aborted = true;
    } });
    console.log(JSON.stringify({ cancelled: result.cancelled, steps }));
  } else {
    const result = simulate(ir, scenario, {
      locale, log: mode !== 'disabled',
      ...(mode === 'replications' ? { onEvent: () => { emitted++; } } : {}),
      onProgress: (p) => { maxReplication = Math.max(maxReplication, p.replication); },
    });
    console.log(JSON.stringify({ process: result.process, warnings: result.warnings, elapsedMs: performance.now() - begin }));
  }
} catch (error) {
  console.log(JSON.stringify({ error: (error as Error).message, steps, emitted, maxReplication, elapsedMs: performance.now() - begin }));
}
