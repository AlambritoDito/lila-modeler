/**
 * Prueba de la parte pura de LILA-064: `overlayModel(result, scenario)` sin bpmn-js ni navegador
 * (jsdom no dibuja bpmn-js — ver Modeler.tsx —, así que `applyOverlay`/`clearOverlay` se verifican
 * a mano en el navegador, ver el comentario de cierre del ticket).
 *
 * Dos fuentes de `RunResult`, como pide el ticket:
 * - El golden `pedido.seed-42.json` (M1, sin `resources`): cubre "sin resources en el resultado
 *   el overlay queda vacío sin errores".
 * - `simulate()` real sobre `examples/pedido` con su AS-IS (que sí declara recursos) y su TO-BE
 *   3 cajeros (`extends`): cubre la clasificación, `bottlenecks[0]` como `principal` y que cambiar
 *   de escenario cambia el nivel de una tarea.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseBpmn } from '@lila/engine/bpmn';
import { ScenarioSchema, resolveExtends, type ResolvedScenario } from '@lila/engine/schema';
import { simulate, type ProcessIR, type RunResult } from '@lila/engine';

import { overlayModel } from './BottleneckOverlay.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const EXAMPLE_DIR = resolve(REPOSITORY_ROOT, 'examples/pedido');
const GOLDEN_PATH = resolve(REPOSITORY_ROOT, 'packages/engine/test/golden/pedido.seed-42.json');

function loadGolden(): RunResult {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as RunResult;
}

/** Escenario mínimo que acompaña al golden: mismo `run`, sin `resources` (así lo generó M1). */
function scenarioSinRecursos(): ResolvedScenario {
  return ScenarioSchema.parse({
    model: 'model.bpmn',
    name: 'AS-IS (sin recursos, M1)',
    run: { baseTimeUnit: 'min', currency: 'MXN', replications: 30, seed: 42, start: '2026-09-07T08:00:00-06:00' },
    version: 1,
  }) as ResolvedScenario;
}

/** Lee y resuelve un escenario de `examples/pedido/*.scenario.json` con su cadena `extends`. */
function loadPedidoScenario(filename: string): ResolvedScenario {
  const read = (path: string): unknown => JSON.parse(readFileSync(resolve(EXAMPLE_DIR, path), 'utf8'));
  const merged = resolveExtends(filename, read);
  const parsed = ScenarioSchema.parse(merged);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error(`${filename} no resuelve a un escenario completo (falta model o run).`);
  }
  return parsed as ResolvedScenario;
}

async function loadIr(): Promise<ProcessIR> {
  const xml = readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8');
  const { ir } = await parseBpmn(xml);
  return ir;
}

describe('overlayModel (LILA-064)', () => {
  it('sin resources en el resultado, el overlay queda vacío sin errores', () => {
    const model = overlayModel(loadGolden(), scenarioSinRecursos());
    expect(model).toEqual({});
  });

  it(
    'con recursos: Task_Preparar es bottlenecks[0] y queda "principal"; cambiar a TO-BE cambia el nivel de Task_TomarPedido',
    async () => {
      const ir = await loadIr();
      const asIs = loadPedidoScenario('as-is.scenario.json');
      const toBe = loadPedidoScenario('to-be-3-cajeros.scenario.json');

      const resultAsIs = simulate(ir, asIs, { log: false });
      const resultToBe = simulate(ir, toBe, { log: false });

      expect(resultAsIs.bottlenecks[0]?.elementId).toBe('Task_Preparar');

      const modelAsIs = overlayModel(resultAsIs, asIs);
      const modelToBe = overlayModel(resultToBe, toBe);

      // El horno (capacidad 1, sin calendario) hace que Task_Preparar quede en cola casi todo el
      // tiempo: es la única tarea cuya espera domina por completo. Task_Revisar, encolada detrás
      // de ese cuello de botella, casi nunca llega a esperar por su cuenta (censurada, §2) y no
      // entra en el mapa; Timer_Reposo no declara recursos y tampoco.
      expect(Object.keys(modelAsIs).sort()).toEqual(['Task_Preparar', 'Task_TomarPedido']);
      expect(modelAsIs['Task_Preparar']?.principal).toBe(true);
      expect(modelAsIs['Task_Preparar']?.nivel).toBe('high');
      expect(modelAsIs['Task_TomarPedido']?.principal).toBe(false);
      expect(modelAsIs['Task_Preparar']?.etiqueta).toMatch(/espera media/);

      // TO-BE triplica la capacidad de cajero (2 -> 3): la espera media de Task_TomarPedido baja
      // de ~15 s a ~2 s (de compararse contra su propio tiempo de proceso, ~160 s: pasa de "casi
      // el 10 % del proceso" a "menos del 5 %"), y su nivel baja de "mid" a "low" — el ratio es
      // propio de la tarea, no depende de las demás (ver el comentario de `nivelDeRatio`).
      expect(modelAsIs['Task_TomarPedido']?.nivel).toBe('mid');
      expect(modelToBe['Task_TomarPedido']?.nivel).toBe('low');
    },
    60_000,
  );
});
