import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBpmn, validate } from '../../src/bpmn/index.js';
import { simulate, type Locale } from '../../src/index.js';
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
 * Golden de nivel 3 (recursos, sin calendarios): el oráculo de R-DEG-2. A diferencia del de M1,
 * sus bytes son los de **Linux x64**, la plataforma del CI: `Math.log`/`Math.exp`/`Math.cos`
 * difieren en el último bit entre arquitecturas y aquí, con colas de por medio, esa diferencia ya
 * no se cancela (R-DET-6). Regenerarlo fuera de Linux x64 rompe el CI.
 */
export const PEDIDO_NIVEL3_GOLDEN_PATH = resolve(GOLDEN_DIR, 'pedido-nivel3.seed-42.json');

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

/**
 * Retira **solo** la capa de calendarios: `calendars`, `resources[*].calendar` y
 * `elements[*].calendar`. Los pools de M2 se quedan intactos, que es justo la entrada que
 * entendía el motor de M2 (R-DEG-2).
 */
export function withoutCalendars(scenario: ResolvedScenario): ResolvedScenario {
  const degraded: ResolvedScenario = {
    ...scenario,
    resources: Object.fromEntries(
      Object.entries(scenario.resources ?? {}).map(([poolId, pool]) => {
        const copy = { ...pool };
        delete copy.calendar;
        return [poolId, copy];
      }),
    ),
    elements: Object.fromEntries(
      Object.entries(scenario.elements ?? {}).map(([elementId, element]) => {
        const copy = { ...element };
        delete copy.calendar;
        return [elementId, copy];
      }),
    ),
  };
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

/** Idioma de la corrida; el golden versionado es el del idioma por defecto (LILA-211). */
export interface GoldenOptions {
  locale?: Locale | undefined;
}

/** Valida y ejecuta una variante del ejemplo sin materializar el event log. */
export async function renderPedidoScenario(
  scenario: ResolvedScenario,
  options: GoldenOptions = {},
): Promise<string> {
  const xml = readFileSync(resolve(EXAMPLE_DIR, scenario.model), 'utf8');
  const parsedBpmn = await parseBpmn(xml);
  const modelValidation = validate(parsedBpmn.ir, {
    unsupported: parsedBpmn.unsupported,
    locale: options.locale,
  });
  if (modelValidation.errors.length > 0) {
    throw new Error(`examples/pedido/model.bpmn inválido: ${canonicalJson(modelValidation.errors)}`);
  }

  const errors = scenarioErrors(validateScenario(scenario, parsedBpmn.ir, { locale: options.locale }));
  if (errors.length > 0) {
    throw new Error(`examples/pedido/as-is.scenario.json inválido: ${canonicalJson(errors)}`);
  }

  return canonicalJson(simulate(parsedBpmn.ir, scenario, { log: false, locale: options.locale }));
}

/**
 * Golden de M1: ejecuta el ejemplo real después de retirar explícitamente las capas que M1 todavía
 * no interpretaba. Así el mismo oráculo permanece válido al introducir ResourceManager en M2.
 */
export async function renderPedidoGolden(seed: number, options: GoldenOptions = {}): Promise<string> {
  return renderPedidoScenario(withoutResourcesAndCalendars(loadPedidoScenario(seed)), options);
}

/** Golden de nivel 3: el ejemplo real con recursos y sin la capa de calendarios. */
export async function renderPedidoNivel3Golden(
  seed: number,
  options: GoldenOptions = {},
): Promise<string> {
  return renderPedidoScenario(withoutCalendars(loadPedidoScenario(seed)), options);
}

/**
 * Compara dos `RunResult` ya parseados con tolerancia **relativa** en los números y estricta en
 * todo lo demás (claves, orden de claves, strings, longitudes). Es lo que se usa fuera del CI:
 * entre arquitecturas `Math.log`/`Math.exp`/`Math.cos` difieren en el último bit, y con colas de
 * por medio esa diferencia deja de cancelarse (R-DET-6). Devuelve las rutas que se salen de `tol`.
 *
 * Vive aquí, y no dentro del test, para poder atacarlo sin re-ejecutar las 30 réplicas.
 */
export function numericDiffs(actual: unknown, expected: unknown, tol: number, path = ''): string[] {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Object.is(actual, expected)) return [];
    // Un `scale` infinito (±Infinity contra un finito) haría que `<= tol * scale` fuese siempre
    // cierto y el par se daría por igual; el guardia de finitud lo convierte en diferencia.
    const scale = Math.max(Math.abs(expected), Math.abs(actual), 1);
    return Number.isFinite(scale) && Math.abs(actual - expected) <= tol * scale
      ? []
      : [`${path}: ${actual} != ${expected}`];
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || actual.length !== expected.length) {
      return [`${path}: arrays distintos`];
    }
    return expected.flatMap((item, index) => numericDiffs(actual[index], item, tol, `${path}[${index}]`));
  }
  if (expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object') {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    // El orden de claves es parte del contrato del golden, no solo el conjunto.
    if (expectedKeys.join('\u0000') !== actualKeys.join('\u0000')) return [`${path}: claves distintas`];
    return expectedKeys.flatMap((key) =>
      numericDiffs(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        tol,
        path === '' ? key : `${path}.${key}`,
      ),
    );
  }
  return Object.is(actual, expected) ? [] : [`${path}: ${String(actual)} != ${String(expected)}`];
}
