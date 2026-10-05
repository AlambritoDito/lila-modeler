import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { entradasHuerfanas, prepareSimulation, sinHuerfanas, sinRepetir } from './simulationGate';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');
const xml = readFileSync('examples/pedido/model.bpmn', 'utf8');
const raw = JSON.parse(readFileSync('examples/pedido/as-is.scenario.json', 'utf8')) as Record<string, unknown>;
it('resuelve y valida el escenario real antes de simular', async () => {
  const prepared = await prepareSimulation(xml, 'as-is.scenario.json', { 'as-is.scenario.json': raw });
  expect(prepared.ir.id).toBeTruthy(); expect(prepared.scenario.run).toBeDefined();
});
it('bloquea parámetros inválidos', async () => {
  await expect(prepareSimulation(xml, 'bad', { bad: { ...raw, run: { duration: -1 } } })).rejects.toThrow();
});
// Los defectos del esquema son la tercera boca de `parseScenario` (LILA-202): la CLI y el MCP
// tienen la suya en `scenario.test.ts` y `packages/mcp/test/server.test.ts`. Sin esta, volver a
// `ScenarioSchema.parse` aquí no rompe nada y el `ZodError` crudo de zod reaparece en la barra.
it('un defecto del esquema llega con el texto del catálogo y citando la ruta, igual que en la CLI (LILA-202)', async () => {
  // Cebo: un campo que el esquema acota. (`probability` ya no lo es: desde LILA-198 su rango
  // lo comprueba el lint con `E-PROB-RANGO`.)
  const run = { ...(raw['run'] as Record<string, unknown>), warmup: -1 };
  // #280: el idioma del motor va explícito; este caso pide el catálogo base.
  await expect(prepareSimulation(xml, 'roto', { roto: { ...raw, run } }, 'model.bpmn', { locale: 'en' })).rejects.toThrow(
    'run.warmup: must be ≥ 0',
  );
});

/**
 * #280: los defectos que salen de aquí son del motor, y desde ahora se le piden en el idioma de
 * la app. Sin `locale` se usa el activo (esta suite lo fija en español), que es lo que hace que
 * la barra de estado hable el mismo idioma que el resto de la interfaz.
 */
it('los problemas del escenario llegan en el idioma pedido, y sin pedirlo en el activo (#280)', async () => {
  const run = { ...(raw['run'] as Record<string, unknown>), warmup: -1 };
  const scenarios = { roto: { ...raw, run } };
  await expect(prepareSimulation(xml, 'roto', scenarios, 'model.bpmn', { locale: 'es' })).rejects.toThrow(
    'run.warmup: debe ser ≥ 0',
  );
  await expect(prepareSimulation(xml, 'roto', scenarios)).rejects.toThrow('run.warmup: debe ser ≥ 0');
  setLocale('en');
  try {
    await expect(prepareSimulation(xml, 'roto', scenarios)).rejects.toThrow('run.warmup: must be ≥ 0');
  } finally {
    setLocale('es');
  }
});

it('bloquea elementos BPMN fuera del perfil antes de simular', async () => {
  const bad = xml.replace(/bpmn:task/g, 'bpmn:adHocSubProcess');
  await expect(prepareSimulation(bad, 'base', { base: raw })).rejects.toThrow();
});

it('un escenario que apunta a otro modelo no simula el modelo activo por accidente', async () => {
  await expect(prepareSimulation(xml, 'base', { base: { ...raw, model: 'otro.bpmn' } })).rejects.toThrow('modelo activo');
});

// #419: the engine message for E-SIN-START already opens with the process id; the gate must not
// prefix it a second time.
it('an empty process reports E-SIN-START with its id exactly once (#419)', async () => {
  const empty = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x"><bpmn:process id="Process_vacio" isExecutable="false"/></bpmn:definitions>`;
  const error = await prepareSimulation(empty, 'base', { base: raw }).catch((e: unknown) => e as Error);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  const line = message.split('\n').find((l) => l.startsWith('E-SIN-START:')) ?? '';
  expect(line).toMatch(/^E-SIN-START: Process_vacio: /);
  expect(line.split('Process_vacio')).toHaveLength(2);
});

// Same guard for scenario problems: E-ELEMENTO-DESCONOCIDO already carries its path (at the end since #519).
it('a scenario entry for an unknown id cites its path exactly once (#419)', async () => {
  const elements = { ...(raw['elements'] as Record<string, unknown>), Tarea_fantasma: { processingTime: { type: 'constant', value: 1 } } };
  const error = await prepareSimulation(xml, 'base', { base: { ...raw, elements } }).catch((e: unknown) => e as Error);
  const line = (error as Error).message.split('\n').find((l) => l.startsWith('E-ELEMENTO-DESCONOCIDO:')) ?? '';
  expect(line).toMatch(/^E-ELEMENTO-DESCONOCIDO: /);
  expect(line.split('elements.Tarea_fantasma')).toHaveLength(2);
});

it('a message intermediate catch event still stops Run with E-NOSOP, even though it only warns while modelling (#455)', async () => {
  const conMensaje = xml.replace(/<bpmn:task (id="[^"]+")/, '<bpmn:intermediateCatchEvent $1').replace(/<\/bpmn:task>/, '<bpmn:messageEventDefinition id="Def_msg"/></bpmn:intermediateCatchEvent>');
  expect(conMensaje).toContain('messageEventDefinition');
  await expect(prepareSimulation(conMensaje, 'as-is.scenario.json', { 'as-is.scenario.json': raw }, 'model.bpmn', { locale: 'en' })).rejects.toThrow(/E-NOSOP: .*message event not supported by the simulator/);
});

// #430: deleting a configured shape leaves its entry behind; removing the orphans from the base
// and from its children is what lets Run pass again, and nothing else is touched.
it('removing orphan entries from the base and its children lets Run pass (#430)', async () => {
  const fantasma = { processingTime: { type: 'constant', value: 1 } };
  const base = { ...raw, elements: { ...(raw['elements'] as Record<string, unknown>), Tarea_fantasma: fantasma } };
  const hijo = { extends: './base.scenario.json', elements: { Tarea_fantasma: fantasma, Otra_fantasma: fantasma } };
  const intacto = { extends: './base.scenario.json', name: 'sin huérfanas' };
  const scenarios = { 'base.scenario.json': base, 'hijo.scenario.json': hijo, 'intacto.scenario.json': intacto };
  await expect(prepareSimulation(xml, 'hijo.scenario.json', scenarios)).rejects.toThrow('E-ELEMENTO-DESCONOCIDO');
  const { ir } = await prepareSimulation(xml, 'as-is', { 'as-is': raw });

  expect(entradasHuerfanas(scenarios, ir).sort()).toEqual(['Otra_fantasma', 'Tarea_fantasma']);
  const cambiados = sinHuerfanas(scenarios, ir);
  expect(Object.keys(cambiados).sort()).toEqual(['base.scenario.json', 'hijo.scenario.json']);
  expect(cambiados['base.scenario.json']!['elements']).toEqual(raw['elements']);
  expect(cambiados['hijo.scenario.json']!['elements']).toEqual({});

  const limpios = { ...scenarios, ...cambiados };
  expect(entradasHuerfanas(limpios, ir)).toEqual([]);
  await expect(prepareSimulation(xml, 'hijo.scenario.json', limpios)).resolves.toBeDefined();
});

// #430, QA: same rule as the engine for a flattened subprocess id. An entry with its own time,
// resources or cost is E-SUBPROC-PARAMETRO (not an orphan); any other entry is E-ELEMENTO-DESCONOCIDO.
it('a subprocess id is an orphan unless its entry carries processingTime, resources or fixedCost (#430)', async () => {
  const { parseBpmn } = await import('@lila-modeler/engine/bpmn');
  const { ir } = await parseBpmn(readFileSync('packages/engine/test/fixtures/subproceso-and.bpmn', 'utf8'));
  const con = (entrada: Record<string, unknown>) => ({ s: { elements: { SubProcess_Preparacion: entrada } } });
  expect(entradasHuerfanas(con({ calendar: 'x' }), ir)).toEqual(['SubProcess_Preparacion']);
  expect(entradasHuerfanas(con({}), ir)).toEqual(['SubProcess_Preparacion']);
  expect(Object.keys(sinHuerfanas(con({ calendar: 'x' }), ir))).toEqual(['s']);
  expect(entradasHuerfanas(con({ processingTime: { type: 'constant', value: 1 } }), ir)).toEqual([]);
  expect(entradasHuerfanas(con({ fixedCost: 3 }), ir)).toEqual([]);
});

// #519: the path may open the message (ids, schema) or close it, in parentheses (lint); an id that
// is only a prefix of another one (Task_1 / Task_10) must not count as already cited.
it.each([
  ['E-X', 'Task_1', 'Task_1: has no start.', 'E-X: Task_1: has no start.'],
  ['E-X', 'elements.T.p', 'is outside [0, 1] (elements.T.p).', 'E-X: is outside [0, 1] (elements.T.p).'],
  ['E-X', 'Task_1', 'Task_10: something else.', 'E-X: Task_1: Task_10: something else.'],
  ['E-X', 'Task_1', 'the flow leaves Task_10 (elements.Task_10).', 'E-X: Task_1: the flow leaves Task_10 (elements.Task_10).'],
])('sinRepetir(%s, %s) does not confuse an id with a longer one (#519)', (code, where, message, expected) => {
  expect(sinRepetir(code, where, message)).toBe(expected);
});

// #519: the two lint errors whose subject used to be an id now carry the path at the end; the gate
// prints `code: message` with nothing in front and nothing repeated.
it('E-CAL-VACIO and E-CAPACIDAD-Y-CALENDARIO reach the alert as one clean line each (#519)', async () => {
  const scenario = {
    ...raw,
    calendars: {
      navidad: { intervals: [{ dates: ['12-25'], from: '09:00', to: '13:00' }], holidays: ['12-25'] },
      dia: { intervals: [{ days: ['MON'], from: '08:00', to: '20:00' }] },
    },
    resources: { cajero: { capacity: [{ calendar: 'dia', capacity: 2 }], calendar: 'dia' } },
  };
  const error = await prepareSimulation(xml, 'base', { base: scenario }).catch((e: unknown) => e as Error);
  const lines = (error as Error).message.split('\n');
  expect(lines).toContain('E-CAL-VACIO: todas las aperturas del calendario caen en uno de sus festivos (calendars.navidad).');
  expect(lines).toContain(
    'E-CAPACIDAD-Y-CALENDARIO: la capacidad por intervalos y el calendario son excluyentes; el calendario va en cada tramo (resources.cajero.capacity).',
  );
});

/**
 * #546 (QA of #560, must-fix 2): the gate picks the process with the union of the project's
 * scenarios, as the live reparse and its seeding do, not with the one that runs. A scenario that
 * configures only the Customer pool does not take the run (and so the panel's IR) to Customer.
 */
it('the process simulated is the one all the project scenarios target, whichever runs (#546)', async () => {
  const cliente = { ...raw, name: 'Customer', elements: { StartEvent_ClienteInicio: { triggerCount: 1 }, Task_ClienteRecibe: {} } };
  const escenarios = { 'as-is.scenario.json': raw, 'cliente.scenario.json': cliente };
  const { ir } = await prepareSimulation(xml, 'as-is.scenario.json', escenarios, 'model.bpmn', { locale: 'en' });
  expect(ir.id).toBe('Process_Restaurante');
  await expect(prepareSimulation(xml, 'cliente.scenario.json', escenarios, 'model.bpmn', { locale: 'en' })).rejects.toThrow(
    'E-ELEMENTO-DESCONOCIDO: the id StartEvent_ClienteInicio belongs to the process "Customer" (Process_Cliente), but the simulated process is "Restaurant" (Process_Restaurante).',
  );
});
