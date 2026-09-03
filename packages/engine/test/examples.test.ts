import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// LILA-008: verifica examples/pedido/* sin depender del parser BPMN (aún no
// existe, ver LILA_MODELER_ESTRUCTURA.md §6). Basta una expresión regular
// sobre los id="..." del XML, tal como pide el ticket.

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = resolve(here, '../../../examples/pedido');

function bpmnIds(xml: string): Set<string> {
  const ids = new Set<string>();
  const re = /\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) ids.add(m[1]);
  return ids;
}

// Elementos "simulables" del proceso principal (flow nodes + sequence flows)
// que SCENARIO_FORMAT.md §2.5 permite dejar fuera de `elements` porque toman
// sus defaults, o que pertenecen al pool de contexto "Cliente" (no simulado
// por el motor v1, que procesa un único proceso — ver documentation del
// bpmn:process Process_Cliente). Cada id no cubierto por el escenario debe
// estar en esta lista con su justificación.
const justificados: Record<string, string> = {
  Gateway_ANDFork: 'gateway estructural, sin parámetros de escenario',
  Gateway_ANDJoin: 'gateway estructural, sin parámetros de escenario',
  Gateway_Aprobacion: 'gateway estructural; la probabilidad vive en sus sequence flows salientes',
  Task_Empacar: 'sin entrada en elements: toma los defaults de §2.5 (sin tiempo, capacidad infinita)',
  EndEvent_Entregado: 'end event, sin parámetros de escenario',
  EndEvent_Rechazado: 'end event, sin parámetros de escenario',
  StartEvent_ClienteInicio: 'pool de contexto Cliente, no simulada (documentation de Process_Cliente)',
  Task_ClienteRecibe: 'pool de contexto Cliente, no simulada (documentation de Process_Cliente)',
  EndEvent_ClienteFin: 'pool de contexto Cliente, no simulada (documentation de Process_Cliente)',
  // Sequence flows que no salen de un gateway XOR: `probability` (R4) no
  // aplica y sin entrada en elements toman el reparto equitativo por defecto.
  Flow_Start_TomarPedido: 'no sale de un XOR: probability no aplica (R4)',
  Flow_TomarPedido_ANDFork: 'no sale de un XOR: probability no aplica (R4)',
  Flow_ANDFork_Preparar: 'sale de un AND fork, no de un XOR: probability no aplica (R4)',
  Flow_ANDFork_Empacar: 'sale de un AND fork, no de un XOR: probability no aplica (R4)',
  Flow_Preparar_ANDJoin: 'no sale de un XOR: probability no aplica (R4)',
  Flow_Empacar_ANDJoin: 'no sale de un XOR: probability no aplica (R4)',
  Flow_ANDJoin_Revisar: 'no sale de un XOR: probability no aplica (R4)',
  Flow_Revisar_Aprobacion: 'no sale de un XOR: probability no aplica (R4)',
  Flow_Timer_EndEntregado: 'no sale de un XOR: probability no aplica (R4)',
  Flow_ClienteStart_Recibe: 'pool de contexto Cliente, no simulada (documentation de Process_Cliente)',
  Flow_ClienteRecibe_Fin: 'pool de contexto Cliente, no simulada (documentation de Process_Cliente)',
};

const flowNodeRe =
  /<bpmn:(startEvent|endEvent|task|parallelGateway|exclusiveGateway|intermediateCatchEvent)\s+id="([^"]+)"/g;
const sequenceFlowRe =
  /<bpmn:sequenceFlow\s+id="([^"]+)"[^>]*\ssourceRef="([^"]+)"[^>]*\stargetRef="([^"]+)"/g;

function simulableIds(xml: string): string[] {
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  const re1 = new RegExp(flowNodeRe.source, 'g');
  while ((m = re1.exec(xml))) ids.push(m[2]);
  const re2 = new RegExp(sequenceFlowRe.source, 'g');
  while ((m = re2.exec(xml))) ids.push(m[1]);
  return ids;
}

describe('examples/pedido', () => {
  const bpmnXml = readFileSync(resolve(exampleDir, 'model.bpmn'), 'utf8');
  const asIs = JSON.parse(readFileSync(resolve(exampleDir, 'as-is.scenario.json'), 'utf8'));
  const toBe = JSON.parse(readFileSync(resolve(exampleDir, 'to-be-3-cajeros.scenario.json'), 'utf8'));

  test('el .bpmn es XML bien formado con DOCTYPE/namespaces BPMN 2.0', () => {
    expect(bpmnXml).toMatch(/<bpmn:definitions[^>]*xmlns:bpmn="http:\/\/www\.omg\.org\/spec\/BPMN\/20100524\/MODEL"/);
    expect(bpmnXml).toContain('<bpmndi:BPMNDiagram');
  });

  test('toda sequenceFlow tiene sourceRef/targetRef que resuelven a un id del documento', () => {
    const allIds = bpmnIds(bpmnXml);
    const re = new RegExp(sequenceFlowRe.source, 'g');
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(bpmnXml))) {
      count++;
      expect(allIds.has(m[2])).toBe(true); // sourceRef
      expect(allIds.has(m[3])).toBe(true); // targetRef
    }
    expect(count).toBeGreaterThan(0);
  });

  test('todo elemento simulable y toda sequenceFlow tienen su BPMNShape/BPMNEdge', () => {
    const diRefs = new Set(
      [...bpmnXml.matchAll(/bpmnElement="([^"]+)"/g)].map((m) => m[1]),
    );
    for (const id of simulableIds(bpmnXml)) {
      expect(diRefs.has(id)).toBe(true);
    }
  });

  test('toda clave de as-is.scenario.json#elements existe como id en model.bpmn', () => {
    const allIds = bpmnIds(bpmnXml);
    for (const id of Object.keys(asIs.elements)) {
      expect(allIds.has(id)).toBe(true);
    }
  });

  test('todo elemento simulable del .bpmn está en elements o justificado', () => {
    const covered = new Set(Object.keys(asIs.elements));
    for (const id of simulableIds(bpmnXml)) {
      const ok = covered.has(id) || Object.prototype.hasOwnProperty.call(justificados, id);
      expect(ok, `id sin cobertura ni justificación: ${id}`).toBe(true);
    }
  });

  test('ids exactos del escenario (LILA-008) están presentes', () => {
    const allIds = bpmnIds(bpmnXml);
    for (const id of [
      'StartEvent_Pedido',
      'Task_TomarPedido',
      'Task_Preparar',
      'Task_Revisar',
      'Timer_Reposo',
      'Flow_Aprobado',
      'Flow_Rechazado',
    ]) {
      expect(allIds.has(id)).toBe(true);
    }
  });

  test('as-is.scenario.json sigue el contrato de SCENARIO_FORMAT.md', () => {
    expect(asIs.version).toBe(1);
    expect(asIs.model).toBe('model.bpmn');
    expect(asIs.run.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(asIs.run.duration).toBeGreaterThan(0);
    // R6: al menos uno de run.duration o triggerCount (aquí están los dos).
    expect(asIs.elements.StartEvent_Pedido.triggerCount).toBeGreaterThan(0);
    // R10: 0.78 + 0.22 = 1, sin normalización.
    expect(asIs.elements.Flow_Aprobado.probability + asIs.elements.Flow_Rechazado.probability).toBeCloseTo(1, 10);
    // R9: toda ref de resources existe en resources; todo calendar existe en calendars.
    for (const key of Object.keys(asIs.elements)) {
      const el = asIs.elements[key];
      for (const r of el.resources ?? []) {
        expect(asIs.resources).toHaveProperty(r.ref);
      }
      if (el.calendar) expect(asIs.calendars).toHaveProperty(el.calendar);
    }
    for (const key of Object.keys(asIs.resources)) {
      const cal = asIs.resources[key].calendar;
      if (cal) expect(asIs.calendars).toHaveProperty(cal);
    }
  });

  test('to-be-3-cajeros.scenario.json es un delta válido sobre as-is (extends)', () => {
    expect(toBe.version).toBe(1);
    expect(toBe.extends).toBe('as-is.scenario.json');
    expect(toBe.resources.cajero.capacity).toBe(3);
    // El delta no repite run/model/elements: se heredan de as-is (§6 de SCENARIO_FORMAT.md).
    expect(toBe.run).toBeUndefined();
    expect(toBe.model).toBeUndefined();
    // Resuelto a mano (merge profundo, sin resolveScenario() todavía): idéntico
    // al AS-IS salvo resources.cajero.capacity = 3.
    const resolved = structuredClone(asIs);
    resolved.name = toBe.name;
    resolved.extends = toBe.extends;
    resolved.resources.cajero.capacity = toBe.resources.cajero.capacity;
    expect(resolved.resources.cajero.capacity).toBe(3);
    expect(resolved.resources.cocinero).toEqual(asIs.resources.cocinero);
    expect(resolved.resources.horno).toEqual(asIs.resources.horno);
    expect(resolved.elements).toEqual(asIs.elements);
  });
});
