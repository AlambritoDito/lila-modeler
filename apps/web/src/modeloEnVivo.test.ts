/**
 * #722: the model errors shown while editing are the ones Run raises — same list, same order.
 *
 * Each case is validated twice: live (`erroresDeModeloEnVivo` over `validateBpmnModel`, what the
 * canvas reparse does) and at Run time (`prepareSimulation`, the gate), and the two must agree.
 * That covers the false positives too: whatever sequence flow never reaches by design is flagged
 * live only if Run flags it.
 */
import { readFileSync } from 'node:fs';
import { validateBpmnModel } from '@lila-modeler/engine/bpmn';
import { describe, expect, it } from 'vitest';

import { setLocale } from './i18n';
import { erroresDeModeloEnVivo, problemasDeModelo, type ErrorDeModelo } from './modeloEnVivo';
import { agruparPorPaso } from './pasoDeProblema';
import { newModelXml } from './project';
import { prepareSimulation, sinRepetir } from './simulationGate';

setLocale('en');

const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
/** A valid start → task → end, plus `extra` inside the process and `fuera` next to it. */
const modelo = (extra = '', fuera = ''): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} id="D" targetNamespace="x">${fuera}<bpmn:process id="Process_1" isExecutable="false">
<bpmn:startEvent id="Start_A"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
<bpmn:task id="Task_A" name="Prepare"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
<bpmn:endEvent id="End_A"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
<bpmn:sequenceFlow id="F1" sourceRef="Start_A" targetRef="Task_A"/><bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="End_A"/>
${extra}</bpmn:process></bpmn:definitions>`;

const ESCENARIO = { version: 1, name: 'AS-IS', model: 'model.bpmn', run: { start: '2026-09-07T08:00:00Z', duration: 3600, warmup: 0, replications: 1, seed: 1 } };
const CODIGO_DE_MODELO = /^E-(NOSOP|PARSE-INCOMPLETO|FLUJO-COLGANTE|ID-DUPLICADO|REF-INEXISTENTE|GATEWAY-SIN-ARISTAS|INALCANZABLE|SIN-START|SIN-END): /;

const enVivo = async (xml: string): Promise<ErrorDeModelo[]> => erroresDeModeloEnVivo(await validateBpmnModel(xml, { locale: 'en' }));
/** The model errors Run stops with for `xml`, as the status bar prints them; `[]` when it runs. */
async function alEjecutar(xml: string): Promise<string[]> {
  try {
    await prepareSimulation(xml, 'as-is.scenario.json', { 'as-is.scenario.json': ESCENARIO }, 'model.bpmn', { locale: 'en' });
    return [];
  } catch (error) {
    return (error as Error).message.split('\n').filter((linea) => CODIGO_DE_MODELO.test(linea));
  }
}
const comoLaBarra = (errores: readonly ErrorDeModelo[]): string[] => errores.map((p) => sinRepetir(p.code, p.id, p.message));

describe('erroresDeModeloEnVivo', () => {
  it('a task no sequence flow reaches: the name in the text, the id in the field', async () => {
    const errores = await enVivo(modelo('<bpmn:task id="Activity_14428r5" name="Review order"/>'));
    expect(errores).toEqual([
      { code: 'E-INALCANZABLE', id: 'Activity_14428r5', message: 'Review order (Activity_14428r5): the node is not reachable from any start event.', proceso: false },
    ]);
    // Run says the same thing, once: the id is not printed again in front of the name.
    expect(await alEjecutar(modelo('<bpmn:task id="Activity_14428r5" name="Review order"/>'))).toEqual([
      'E-INALCANZABLE: Review order (Activity_14428r5): the node is not reachable from any start event.',
    ]);
  });

  it('without a name the id is the fallback', async () => {
    expect((await enVivo(modelo('<bpmn:task id="Activity_14428r5"/>'))).map((p) => p.message)).toEqual([
      'Activity_14428r5: the node is not reachable from any start event.',
    ]);
  });

  it('a clean model has none, and neither has the released example', async () => {
    expect(await enVivo(modelo())).toEqual([]);
    expect(await enVivo(readFileSync('examples/pedido/model.bpmn', 'utf8'))).toEqual([]);
    expect(await enVivo(readFileSync('examples/mm1/mm1-rho08/model.bpmn', 'utf8'))).toEqual([]);
  });

  it('an empty «New» is not an error until something is drawn (#409); one shape is', async () => {
    expect(await enVivo(newModelXml())).toEqual([]);
    const soloTarea = `<bpmn:definitions ${BPMN} id="D" targetNamespace="x"><bpmn:process id="Process_1"><bpmn:task id="Task_A" name="Prepare"/></bpmn:process></bpmn:definitions>`;
    expect((await enVivo(soloTarea)).map((p) => [p.code, p.id, p.proceso])).toEqual([
      ['E-SIN-START', 'Process_1', true],
      ['E-SIN-END', 'Process_1', true],
    ]);
  });

  // What sequence flow never reaches by design, and the structural defects of the same pass.
  const CASOS: Record<string, string> = {
    'boundary timer and its exception path': modelo(`<bpmn:boundaryEvent id="Limit" attachedToRef="Task_A"><bpmn:outgoing>F3</bpmn:outgoing><bpmn:timerEventDefinition id="TD"/></bpmn:boundaryEvent>
<bpmn:endEvent id="End_Late"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="F3" sourceRef="Limit" targetRef="End_Late"/>`),
    'non-interrupting boundary timer': modelo(`<bpmn:boundaryEvent id="Limit" attachedToRef="Task_A" cancelActivity="false"><bpmn:outgoing>F3</bpmn:outgoing><bpmn:timerEventDefinition id="TD"/></bpmn:boundaryEvent>
<bpmn:endEvent id="End_Late"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="F3" sourceRef="Limit" targetRef="End_Late"/>`),
    'text annotation, association, group and data': modelo(`<bpmn:textAnnotation id="Note"><bpmn:text>note</bpmn:text></bpmn:textAnnotation><bpmn:association id="Assoc" sourceRef="Task_A" targetRef="Note"/>
<bpmn:group id="Group"/><bpmn:dataObjectReference id="Data" dataObjectRef="DO"/><bpmn:dataObject id="DO"/><bpmn:dataStoreReference id="Store"/>`),
    'a participant reached only by message flow': modelo('', `<bpmn:collaboration id="C"><bpmn:participant id="P1" name="Us" processRef="Process_1"/><bpmn:participant id="P2" name="Customer"/>
<bpmn:messageFlow id="M1" sourceRef="Task_A" targetRef="P2"/></bpmn:collaboration>`),
    'event sub-process': modelo(`<bpmn:subProcess id="Sub_Evento" triggeredByEvent="true"><bpmn:startEvent id="Start_Msg"><bpmn:outgoing>F5</bpmn:outgoing><bpmn:messageEventDefinition id="MD"/></bpmn:startEvent>
<bpmn:task id="Task_Sub" name="Handle"><bpmn:incoming>F5</bpmn:incoming><bpmn:outgoing>F6</bpmn:outgoing></bpmn:task><bpmn:endEvent id="End_Sub"><bpmn:incoming>F6</bpmn:incoming></bpmn:endEvent>
<bpmn:sequenceFlow id="F5" sourceRef="Start_Msg" targetRef="Task_Sub"/><bpmn:sequenceFlow id="F6" sourceRef="Task_Sub" targetRef="End_Sub"/></bpmn:subProcess>`),
    'compensation handler': modelo(`<bpmn:boundaryEvent id="Comp" attachedToRef="Task_A"><bpmn:compensateEventDefinition id="CD"/></bpmn:boundaryEvent>
<bpmn:task id="Task_Undo" name="Undo" isForCompensation="true"/><bpmn:association id="Assoc" associationDirection="One" sourceRef="Comp" targetRef="Task_Undo"/>`),
    'link throw and catch': modelo(`<bpmn:intermediateCatchEvent id="Link_In" name="A"><bpmn:outgoing>F7</bpmn:outgoing><bpmn:linkEventDefinition id="LD1" name="A"/></bpmn:intermediateCatchEvent>
<bpmn:endEvent id="End_Link"><bpmn:incoming>F7</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="F7" sourceRef="Link_In" targetRef="End_Link"/>`),
    'unsupported catch event and the end behind it': modelo(`<bpmn:intermediateCatchEvent id="Msg_1" name="Wait"><bpmn:outgoing>F8</bpmn:outgoing><bpmn:messageEventDefinition id="MD"/></bpmn:intermediateCatchEvent>
<bpmn:endEvent id="End_Msg"><bpmn:incoming>F8</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="F8" sourceRef="Msg_1" targetRef="End_Msg"/>`),
    'gateway with no flows': modelo('<bpmn:exclusiveGateway id="Gw" name="OK?"/>'),
    'dangling flow': modelo('<bpmn:sequenceFlow id="F9" sourceRef="Task_A" targetRef="Nowhere"/>'),
    'no end event': modelo().replace(/<bpmn:endEvent[^]*?<\/bpmn:endEvent>/, '').replace(/<bpmn:sequenceFlow id="F2"[^>]*\/>/, '').replace('<bpmn:outgoing>F2</bpmn:outgoing>', ''),
    'Bizagi sample A.1.0': readFileSync('examples/bizagi-exports/bizagi-miwg-A.1.0-roundtrip.bpmn', 'utf8'),
    'Bizagi sample A.3.0': readFileSync('examples/bizagi-exports/bizagi-miwg-A.3.0-roundtrip.bpmn', 'utf8'),
    'engine fixture: boundary event': readFileSync('packages/engine/test/fixtures/boundary-event.bpmn', 'utf8'),
    'engine fixture: boundary timer': readFileSync('packages/engine/test/fixtures/boundary-timer.bpmn', 'utf8'),
    'engine fixture: sub-process': readFileSync('packages/engine/test/fixtures/subproceso-and.bpmn', 'utf8'),
    'engine fixture: lost elements': readFileSync('packages/engine/test/fixtures/parse-incompleto.bpmn', 'utf8'),
  };
  it.each(Object.entries(CASOS))('live equals Run: %s', async (_caso, xml) => {
    expect(comoLaBarra(await enVivo(xml))).toEqual(await alEjecutar(xml));
  });

  it('the legitimately unreached are not flagged; the genuinely broken are', async () => {
    const codigos = async (caso: string) => (await enVivo(CASOS[caso]!)).map((p) => `${p.code} ${p.id}`);
    expect(await codigos('boundary timer and its exception path')).toEqual([]);
    expect(await codigos('non-interrupting boundary timer')).toEqual([]);
    expect(await codigos('text annotation, association, group and data')).toEqual([]);
    expect(await codigos('a participant reached only by message flow')).toEqual([]);
    expect(await codigos('Bizagi sample A.1.0')).toEqual([]);
    expect(await codigos('gateway with no flows')).toEqual(['E-GATEWAY-SIN-ARISTAS Gw', 'E-INALCANZABLE Gw']);
    const a30 = await enVivo(CASOS['Bizagi sample A.3.0']!);
    expect(a30.map((p) => p.code)).toEqual(['E-NOSOP', 'E-NOSOP', ...Array<string>(5).fill('E-INALCANZABLE')]);
    for (const p of a30.filter((x) => x.code === 'E-INALCANZABLE')) expect(p.message.startsWith(`${p.id}:`)).toBe(false);
  });
});

describe('problemasDeModelo', () => {
  const inalcanzable: ErrorDeModelo = { code: 'E-INALCANZABLE', id: 'Task_B', message: 'Review (Task_B): the node is not reachable from any start event.', proceso: false };
  const sinFin: ErrorDeModelo = { code: 'E-SIN-END', id: 'Process_1', message: 'Process_1: the process has no end event and no terminate.', proceso: true };
  const nosop: ErrorDeModelo = { code: 'E-NOSOP', id: 'Msg_1', message: 'Msg_1 (bpmn:intermediateCatchEvent): …', proceso: false };

  it('a structural error is an error in every mode, on its element, with the engine text verbatim', () => {
    for (const enModelar of [true, false]) {
      expect(problemasDeModelo([inalcanzable, sinFin], enModelar)).toEqual([
        { ruta: 'elements.Task_B', mensaje: inalcanzable.message, severidad: 'error', codigo: 'E-INALCANZABLE' },
        { ruta: 'model', mensaje: sinFin.message, severidad: 'error', codigo: 'E-SIN-END' },
      ]);
    }
  });

  it('next to an unsupported construct they follow it: warnings in Model, errors elsewhere (#455)', () => {
    expect(problemasDeModelo([nosop, inalcanzable], true).map((p) => p.severidad)).toEqual(['warning', 'warning']);
    expect(problemasDeModelo([nosop, inalcanzable], false).map((p) => p.severidad)).toEqual(['error', 'error']);
  });

  it('no step of the Simulate panel owns them, even on a task: they are fixed in the diagram', () => {
    const ir = { id: 'Process_1', nodes: { Task_B: { type: 'task', name: 'Review', incoming: [], outgoing: [] } }, flows: {} } as never;
    const { porPaso, sinPaso } = agruparPorPaso(problemasDeModelo([inalcanzable, sinFin], false), ir);
    expect(sinPaso.map((p) => p.codigo)).toEqual(['E-INALCANZABLE', 'E-SIN-END']);
    expect(Object.values(porPaso).flat()).toEqual([]);
  });
});
