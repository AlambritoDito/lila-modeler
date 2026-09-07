import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { parseBpmn, validate } from '../src/bpmn/index.js';
import { simulate } from '../src/index.js';
import { ScenarioSchema, toJsonSchema, validateScenario, type ResolvedScenario } from '../src/scenario.js';
import { validateJsonSchema } from './mini-json-schema.js';

/**
 * QA adversarial de LILA-187 (`examples/bizagi-levels` reescritos con la topología, las
 * probabilidades y las llegadas oficiales), por un agente distinto al implementador.
 *
 * `bizagi-levels.test.ts` es de LILA-010 y comprueba la **forma** de los archivos con regex, sin
 * pasar por el parser. Este ataca lo que aquel no puede ver: que los cuatro `model.bpmn` entren de
 * verdad por `parseBpmn` sin nada fuera del perfil, que los `scenario.json` validen contra el JSON
 * Schema publicado y no solo contra zod, que el lint no tenga nada que decir salvo los elementos
 * sin parámetros, que los XOR sumen 1 sin normalizar, y que en `expected.json` no haya un solo
 * número sin procedencia (`quote`/`quotes` o `source`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const levelsDir = resolve(here, '../../../examples/bizagi-levels');
const levels = [1, 2, 3, 4] as const;

/** NCName de XML 1.0 acotado a lo que usa el repo: sin `:` (los ids no llevan prefijo). */
const NCNAME = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

function leer(level: number, archivo: string): string {
  return readFileSync(resolve(levelsDir, `level-${level}`, archivo), 'utf8');
}

function escenarioDe(level: number): ResolvedScenario {
  const parsed = ScenarioSchema.parse(JSON.parse(leer(level, 'scenario.json')));
  if (parsed.model === undefined || parsed.run === undefined) throw new Error(`level-${level}: escenario sin resolver`);
  return { ...parsed, model: parsed.model, run: parsed.run };
}

describe.each(levels)('QA LILA-187 · examples/bizagi-levels/level-%i', (level) => {
  test('ataque 10: `parseBpmn` lo abre entero, sin elementos fuera del perfil', async () => {
    const parsed = await parseBpmn(leer(level, 'model.bpmn'));
    // `unsupported` vacío = no hay ni un `bpmn:*` fuera de la sección 2 de SEMANTICS; sin él,
    // `validate` no tendría de dónde sacar el error y el ejemplo pasaría con elementos mudos.
    expect(parsed.unsupported).toEqual([]);
    const problemas = validate(parsed.ir, { unsupported: parsed.unsupported });
    expect(problemas.errors).toEqual([]);
    expect(problemas.warnings).toEqual([]);
    expect(Object.keys(parsed.ir.nodes).length).toBeGreaterThan(0);
  });

  test('ataque 10: todo id del IR es un NCName (R-DURA-4: el id es la única clave)', async () => {
    const { ir } = await parseBpmn(leer(level, 'model.bpmn'));
    for (const id of [ir.id, ...Object.keys(ir.nodes), ...Object.keys(ir.flows)]) {
      expect(NCNAME.test(id), `id no NCName: ${id}`).toBe(true);
    }
  });

  test('ataque 10: `scenario.json` valida contra el JSON Schema publicado, no solo contra zod', () => {
    const crudo: unknown = JSON.parse(leer(level, 'scenario.json'));
    expect(validateJsonSchema(toJsonSchema(), crudo)).toEqual([]);
  });

  test('ataque 11: el lint no tiene nada que decir salvo elementos sin parámetros (R3)', async () => {
    const { ir } = await parseBpmn(leer(level, 'model.bpmn'));
    const problemas = validateScenario(escenarioDe(level), ir);
    expect(problemas.filter((p) => p.severity === 'error')).toEqual([]);
    // El único aviso admisible es el del elemento del modelo que el escenario no parametriza
    // (gateways y ends, que no llevan parámetros; en el nivel 1, además, las tareas sin tiempo).
    expect([...new Set(problemas.map((p) => p.code))].sort()).toEqual(['W-ELEMENTO-SIN-PARAMETROS']);
  });

  test('ataque 11: toda clave de `elements` existe en el IR (R3) y las de flujo son sequence flows', async () => {
    const { ir } = await parseBpmn(leer(level, 'model.bpmn'));
    const scenario = escenarioDe(level);
    for (const id of Object.keys(scenario.elements ?? {})) {
      expect(ir.nodes[id] !== undefined || ir.flows[id] !== undefined, `${id} no está en el IR`).toBe(true);
    }
    for (const [id, element] of Object.entries(scenario.elements ?? {})) {
      if (element.probability === undefined) continue;
      expect(ir.flows[id], `${id} lleva probability y no es un sequence flow`).toBeDefined();
    }
  });

  test('ataque 11: las probabilidades del XOR de triage suman 1 y la corrida no normaliza', async () => {
    const { ir } = await parseBpmn(leer(level, 'model.bpmn'));
    const scenario = escenarioDe(level);
    const salidas = ir.nodes.Gateway_Triage!.outgoing;
    expect(salidas).toHaveLength(3);
    const suma = salidas.reduce((acc, flowId) => acc + (scenario.elements?.[flowId]?.probability ?? 0), 0);
    expect(suma).toBeCloseTo(1, 10);
    // R-XOR: si no sumaran 1, el motor repartiría el residuo y avisaría. Ningún nivel puede
    // apoyarse en ese rescate: los porcentajes están publicados en prosa (50/30/20).
    const warnings = simulate(ir, scenario, { log: false }).warnings;
    expect(warnings.filter((w) => w.startsWith('W-XOR-'))).toEqual([]);
  });

  test('ataque 10: ningún número de `expected.json` sin `quote`/`quotes` o `source`', () => {
    const expected = JSON.parse(leer(level, 'expected.json')) as Record<string, unknown>;
    // Se recorre `values`, que es donde vive lo publicado (`level` y `title` son metadatos). El
    // `source` de la raíz es la URL de la página, no la procedencia de un número concreto: no
    // licencia a sus descendientes. Cada dato tiene que citar su frase (`quote`/`quotes`) o la
    // captura de la que se transcribió (`source`), en su objeto o en uno intermedio.
    const valores = expected.values as Record<string, unknown>;
    const rutas = Object.entries(valores).flatMap(([k, v]) => sinProcedencia(v, `$.values.${k}`, false));
    expect(rutas).toEqual([]);
  });
});

/**
 * Rutas de `expected.json` que llevan un número sin que ni su objeto ni ningún ancestro declare de
 * dónde sale. `quote`/`quotes` = frase textual de la página; `source` = URL de la captura (que va
 * siempre acompañada de la `nota` que dice qué se transcribió).
 */
function sinProcedencia(value: unknown, path: string, heredada: boolean): string[] {
  if (typeof value === 'number') return heredada ? [] : [path];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => sinProcedencia(v, `${path}[${i}]`, heredada));
  const obj = value as Record<string, unknown>;
  const citado = heredada || obj.quote !== undefined || obj.quotes !== undefined || obj.source !== undefined;
  return Object.entries(obj).flatMap(([k, v]) => sinProcedencia(v, `${path}.${k}`, citado));
}
