import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBpmn, validate } from '../../src/bpmn/index.js';
import { simulate } from '../../src/index.js';
import {
  ScenarioSchema,
  scenarioErrors,
  validateScenario,
  type ResolvedScenario,
} from '../../src/scenario.js';

const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(GOLDEN_DIR, '../../../..');
const EXAMPLE_DIR = resolve(REPOSITORY_ROOT, 'examples/pedido');

export const PEDIDO_GOLDEN_PATH = resolve(GOLDEN_DIR, 'pedido.seed-42.json');

/**
 * Elimina por copia toda la capa de recursos y calendarios del escenario de pedido. El resultado
 * representa exactamente la entrada que entendía M1: tiempos, llegadas y probabilidades, sin que
 * los campos añadidos en M2 puedan activar colas, costos de pool o calendarios.
 */
export function withoutResourcesAndCalendars(scenario: ResolvedScenario): ResolvedScenario {
  const degraded: ResolvedScenario = {
    ...scenario,
    elements: Object.fromEntries(
      Object.entries(scenario.elements ?? {}).map(([elementId, configuration]) => {
        const element = { ...configuration };
        delete element.resources;
        delete element.selection;
        delete element.calendar;
        return [elementId, element];
      }),
    ),
  };
  delete degraded.resources;
  delete degraded.calendars;
  return degraded;
}

/** Serialización canónica y auditable usada tanto por el test como por el regenerador. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Carga de nuevo el escenario real en cada llamada; el caller recibe una copia independiente. */
export function loadPedidoScenario(seed: number): ResolvedScenario {
  const scenarioInput: unknown = JSON.parse(
    readFileSync(resolve(EXAMPLE_DIR, 'as-is.scenario.json'), 'utf8'),
  );
  const parsed = ScenarioSchema.parse(scenarioInput);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error('examples/pedido/as-is.scenario.json no es un escenario resuelto.');
  }
  if (parsed.run.seed !== 42) {
    throw new Error('examples/pedido/as-is.scenario.json debe declarar explícitamente seed 42.');
  }

  return {
    ...parsed,
    model: parsed.model,
    run: { ...parsed.run, seed },
  };
}

/** Valida y ejecuta una variante del ejemplo sin materializar el event log. */
export async function renderPedidoScenario(scenario: ResolvedScenario): Promise<string> {
  const xml = readFileSync(resolve(EXAMPLE_DIR, scenario.model), 'utf8');
  const parsedBpmn = await parseBpmn(xml);
  const modelValidation = validate(parsedBpmn.ir, { unsupported: parsedBpmn.unsupported });
  if (modelValidation.errors.length > 0) {
    throw new Error(`examples/pedido/model.bpmn inválido: ${canonicalJson(modelValidation.errors)}`);
  }

  const errors = scenarioErrors(validateScenario(scenario, parsedBpmn.ir));
  if (errors.length > 0) {
    throw new Error(`examples/pedido/as-is.scenario.json inválido: ${canonicalJson(errors)}`);
  }

  return canonicalJson(simulate(parsedBpmn.ir, scenario, { log: false }));
}

/**
 * Golden de M1: ejecuta el ejemplo real después de retirar explícitamente las capas que M1 todavía
 * no interpretaba. Así el mismo oráculo permanece válido al introducir ResourceManager en M2.
 */
export async function renderPedidoGolden(seed: number): Promise<string> {
  return renderPedidoScenario(withoutResourcesAndCalendars(loadPedidoScenario(seed)));
}
