import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prepareSimulation } from './simulationGate';
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

// Same guard for scenario problems: E-ELEMENTO-DESCONOCIDO already opens with its path.
it('a scenario entry for an unknown id cites its path exactly once (#419)', async () => {
  const elements = { ...(raw['elements'] as Record<string, unknown>), Tarea_fantasma: { processingTime: { type: 'constant', value: 1 } } };
  const error = await prepareSimulation(xml, 'base', { base: { ...raw, elements } }).catch((e: unknown) => e as Error);
  const line = (error as Error).message.split('\n').find((l) => l.startsWith('E-ELEMENTO-DESCONOCIDO:')) ?? '';
  expect(line).toMatch(/^E-ELEMENTO-DESCONOCIDO: elements\.Tarea_fantasma: /);
  expect(line.split('elements.Tarea_fantasma')).toHaveLength(2);
});

it('a message intermediate catch event still stops Run with E-NOSOP, even though it only warns while modelling (#455)', async () => {
  const conMensaje = xml.replace(/<bpmn:task (id="[^"]+")/, '<bpmn:intermediateCatchEvent $1').replace(/<\/bpmn:task>/, '<bpmn:messageEventDefinition id="Def_msg"/></bpmn:intermediateCatchEvent>');
  expect(conMensaje).toContain('messageEventDefinition');
  await expect(prepareSimulation(conMensaje, 'as-is.scenario.json', { 'as-is.scenario.json': raw }, 'model.bpmn', { locale: 'en' })).rejects.toThrow(/E-NOSOP: .*message event not supported by the simulator/);
});
