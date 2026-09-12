import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { loadResolvedScenario, loadValidatedModel, withRunOverrides } from '../src/cli-shared.js';
import { simulate } from '../src/index.js';
import { scenarioErrors, validateScenario } from '../src/scenario.js';

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

// LILA-318: humo de examples/tarjeta-credito por el mismo camino que el CLI
// (parseBpmn -> resolveExtends/parseScenario -> validateScenario -> simulate), con pocas
// réplicas para que el suite siga siendo rápido. Los números de referencia de 30 réplicas
// viven en examples/tarjeta-credito/README.md; aquí solo se fija lo estructural.
const tarjetaDir = resolve(here, '../../../examples/tarjeta-credito');

async function runTarjeta(scenarioFile: string) {
  const { ir, validation } = await loadValidatedModel(resolve(tarjetaDir, 'model.bpmn'));
  expect(validation.errors).toEqual([]);

  const scenario = withRunOverrides(loadResolvedScenario(resolve(tarjetaDir, scenarioFile)), {
    seed: 42,
    replications: 5,
  });
  expect(scenarioErrors(validateScenario(scenario, ir))).toEqual([]);

  return simulate(ir, scenario, { log: false });
}

describe('examples/tarjeta-credito', () => {
  test(
    'el AS-IS satura al analista y el TO-BE con tres analistas lo descongestiona',
    async () => {
      const asIs = await runTarjeta('as-is.scenario.json');
      const toBe = await runTarjeta('to-be-3-analistas.scenario.json');

      // ~10 solicitudes/h durante 8 h; el rango es tolerante porque las llegadas son exponenciales.
      for (const result of [asIs, toBe]) {
        expect(result.process.started).toBeGreaterThan(60);
        expect(result.process.started).toBeLessThan(100);
      }

      // El analista es el cuello de botella del AS-IS: rho analítico 1,39 con dos analistas.
      expect(asIs.resources['analyst']!.utilization).toBeGreaterThan(0.9);
      // Question 5: the 30-minute promise (`run.serviceLevel: 1800`, #316) is measured on delivered
      // cards only; it is not met in either scenario (analyst path alone takes 27 min of work).
      for (const result of [asIs, toBe]) {
        const delivered = result.process.byEndEvent['End_CardDelivered']!;
        expect(delivered.completed).toBe(result.elements['End_CardDelivered']!.completed);
        expect(delivered.withinServiceLevel).toBeLessThan(0.05);
        expect(delivered.cycleTime.mean).toBeGreaterThan(1800);
      }
      expect(asIs.bottlenecks[0]!.elementId).toBe('Task_CheckBureau');

      // Tres analistas: menos espera, menos casos abiertos al cierre y ninguna alerta de pool
      // sin estado estacionario.
      expect(toBe.resources['analyst']!.utilization).toBeLessThan(
        asIs.resources['analyst']!.utilization,
      );
      expect(toBe.process.inFlight).toBeLessThan(asIs.process.inFlight);
      expect(toBe.elements['Task_CheckBureau']!.resourceWait.mean).toBeLessThan(
        asIs.elements['Task_CheckBureau']!.resourceWait.mean / 2,
      );
      // #320: the analyst pool is self-gated (most of its tasks sit behind another task it
      // serves), so it throttles its own attributed demand and ρ stays under 1,1; the 95 %
      // utilization branch is what catches it. `executive` and `operator` stay well below.
      const saturated = asIs.warnings
        .filter((warning) => warning.startsWith('W-RECURSO-SATURADO'))
        .join('\n');
      expect(saturated).toContain('analyst');
      expect(saturated).not.toContain('executive');
      expect(saturated).not.toContain('operator');

      // Las tres salidas se ejercitan en ambos escenarios.
      for (const result of [asIs, toBe]) {
        for (const endId of ['End_BureauRejected', 'End_DebtRejected', 'End_CardDelivered']) {
          expect(result.elements[endId]!.completed).toBeGreaterThan(0);
        }
      }
    },
    120_000, // ponytail: dos corridas de 5 réplicas; techo holgado, no es una medida de rendimiento
  );

  test('el escenario TO-BE es un delta de extends que solo mueve la capacidad del analista', () => {
    const toBe = JSON.parse(
      readFileSync(resolve(tarjetaDir, 'to-be-3-analistas.scenario.json'), 'utf8'),
    );
    expect(toBe.extends).toBe('as-is.scenario.json');
    expect(toBe.resources.analyst.capacity).toBe(3);
    expect(toBe.run).toBeUndefined();
    expect(toBe.model).toBeUndefined();
  });

  test('todo elemento simulable del modelo está en elements o justificado', () => {
    const xml = readFileSync(resolve(tarjetaDir, 'model.bpmn'), 'utf8');
    const asIs = JSON.parse(readFileSync(resolve(tarjetaDir, 'as-is.scenario.json'), 'utf8'));
    const covered = new Set(Object.keys(asIs.elements));
    const diRefs = new Set([...xml.matchAll(/bpmnElement="([^"]+)"/g)].map((m) => m[1]));
    // Gateways, end events y los flujos que no salen de un XOR toman sus defaults (§ 2.5, R4).
    const sinParametros = /^(Gateway_|End_)/;
    const flowsSinProbabilidad = /^Flow_(?!BureauBad|BureauGood|DebtNotEligible|DebtEligible)/;
    for (const id of simulableIds(xml)) {
      const ok =
        covered.has(id) || sinParametros.test(id) || flowsSinProbabilidad.test(id);
      expect(ok, `id sin cobertura ni justificación: ${id}`).toBe(true);
      expect(diRefs.has(id), `id sin BPMNShape/BPMNEdge: ${id}`).toBe(true);
    }
  });
});
