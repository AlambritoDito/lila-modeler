import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBpmn } from '../../src/bpmn/parse.js';
import { validate } from '../../src/bpmn/validate.js';
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

/** Serialización canónica y auditable usada tanto por el test como por el regenerador. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Ejecuta el ejemplo real `examples/pedido` sin conservar sus filas de log en el callback.
 * El escenario se parsea de nuevo en cada llamada para que cambiar la semilla no mute el fixture.
 */
export async function renderPedidoGolden(seed = 42): Promise<string> {
  const scenarioInput: unknown = JSON.parse(
    readFileSync(resolve(EXAMPLE_DIR, 'as-is.scenario.json'), 'utf8'),
  );
  const parsed = ScenarioSchema.parse(scenarioInput);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error('examples/pedido/as-is.scenario.json no es un escenario resuelto.');
  }

  const scenario: ResolvedScenario = {
    ...parsed,
    model: parsed.model,
    run: { ...parsed.run, seed },
  };
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
