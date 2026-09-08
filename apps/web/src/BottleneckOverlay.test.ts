// @vitest-environment jsdom
/**
 * Pruebas de LILA-064, en dos mitades.
 *
 * `overlayModel` es pura: se prueba contra dos fuentes de `RunResult` —el golden
 * `pedido.seed-42.json` (M1, sin `resources`) y `simulate()` real sobre `examples/pedido` con su
 * AS-IS y su TO-BE 3 cajeros— para verificar que el ranking pintado es literalmente
 * `result.bottlenecks` y que cambiar de escenario cambia el overlay.
 *
 * `applyOverlay`/`clearOverlay`/`sincronizarOverlay` se prueban contra un **modelador falso**
 * (`modeladorFalso`) y no contra bpmn-js de verdad: jsdom no llega a montar un lienzo de
 * diagram-js —le faltan `SVGGraphicsElement.getBBox` y `SVGElement.transform.baseVal`, y
 * shimearlos deja a `Canvas` calculando viewboxes sobre geometría inventada, que es peor que no
 * probarlo—. Lo que sí importa de esta capa es el cableado, y eso es exactamente lo que el falso
 * observa: sobre qué id se pinta, en qué orden, qué se quita al limpiar y que el interruptor
 * pase por el mismo camino. El aspecto real está verificado a mano en navegador
 * (`docs/design/bottleneck-overlay.png`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseBpmn } from '@lila/engine/bpmn';
import { ScenarioSchema, resolveExtends, type ResolvedScenario } from '@lila/engine/schema';
import { simulate, type ProcessIR, type RunResult } from '@lila/engine';
import type ModelerType from 'bpmn-js/lib/Modeler';

import {
  applyOverlay,
  clearOverlay,
  overlayModel,
  sincronizarOverlay,
  type Corrida,
} from './BottleneckOverlay.js';

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

  describe('con recursos, sobre examples/pedido', () => {
    let asIs: ResolvedScenario;
    let toBe: ResolvedScenario;
    let resultAsIs: RunResult;
    let resultToBe: RunResult;

    // Dos corridas de 30 replicaciones: caras, así que se hacen una sola vez para todo el bloque.
    beforeAll(async () => {
      const ir = await loadIr();
      asIs = loadPedidoScenario('as-is.scenario.json');
      toBe = loadPedidoScenario('to-be-3-cajeros.scenario.json');
      resultAsIs = simulate(ir, asIs, { log: false });
      resultToBe = simulate(ir, toBe, { log: false });
    }, 120_000);

    // El corte de #226 (solo nivel `high`) no reordena nada: el orden y el `rango` que quedan son
    // los que trajo `result.bottlenecks`, ordenado por `resourceWait.total` (§6).
    it('pinta solo los cuellos de nivel alto, en el orden del motor', () => {
      const model = overlayModel(resultAsIs, asIs);

      expect(resultAsIs.bottlenecks.map((b) => b.elementId)).toEqual([
        'Task_Preparar',
        'Task_TomarPedido',
      ]);
      expect(Object.keys(model)).toEqual(['Task_Preparar']);
      expect(model['Task_Preparar']?.rango).toBe(0);
    });

    it('Task_Preparar es bottlenecks[0] y es el único "principal"', () => {
      const model = overlayModel(resultAsIs, asIs);

      expect(resultAsIs.bottlenecks[0]?.elementId).toBe('Task_Preparar');
      expect(model['Task_Preparar']?.principal).toBe(true);
      expect(model['Task_Preparar']?.nivel).toBe('high');
      expect(Object.values(model).filter((e) => e.principal)).toHaveLength(1);
    });

    // #226: la etiqueta larga («espera media 3000.559774 min · utilización 34.354969%») medía
    // 311 px sobre una tarea de 100 px. La corta redondea a un decimal en la unidad más gruesa
    // que siga valiendo 1 o más (días, aquí) y el texto completo se conserva en el `title`.
    it('la etiqueta cabe sobre la tarea y el texto completo va en el title', () => {
      const entry = overlayModel(resultAsIs, asIs)['Task_Preparar'];

      expect(entry?.etiqueta).toBe('2.1 d · 34%');
      expect(entry?.titulo).toBe('espera media 3000.559774 min · utilización 34.354969%');
    });

    // TO-BE triplica la capacidad de cajero (2 -> 3) y la espera media de Task_TomarPedido baja
    // de ~15 s a ~2 s, pero en los dos escenarios espera muchísimo menos de lo que trabaja
    // (~160 s): nunca llega a nivel `high`, así que el corte de #226 la deja fuera del lienzo en
    // los dos. Sigue estando en la tabla de Resultados y en el ranking de `lila run`.
    it('Task_TomarPedido está en el ranking pero no se pinta en ninguno de los dos escenarios', () => {
      expect(resultToBe.bottlenecks.map((b) => b.elementId)).toContain('Task_TomarPedido');
      expect(overlayModel(resultAsIs, asIs)['Task_TomarPedido']).toBeUndefined();
      expect(overlayModel(resultToBe, toBe)['Task_TomarPedido']).toBeUndefined();
    });
  });
});

/* ------------------------------------------------------------------ *
 * Modelador falso: observa el cableado sin montar diagram-js.
 * ------------------------------------------------------------------ */

interface Etiqueta {
  id: string;
  type: string;
}

interface Falso {
  modeler: ModelerType;
  /** Etiquetas vivas del servicio `overlays`, en orden de inserción. */
  etiquetas: Etiqueta[];
  /** `id -> clases` puestas con `canvas.addMarker`. */
  marcadores: Map<string, Set<string>>;
  /** Ids repintados con `graphicsFactory.update` desde la última lectura. */
  repintados: string[];
  /** Dispara `render.shape` como haría diagram-js y devuelve el `style` de la figura resultante. */
  pintar(id: string): Partial<CSSStyleDeclaration>;
}

type Render = (evt: { type: string }, ctx: { element: { id: string } }) => unknown;

/** `idsEnLienzo`: los ids que el `elementRegistry` conoce, o sea los del `.bpmn` importado. */
function modeladorFalso(idsEnLienzo: readonly string[]): Falso {
  const elementos = new Map(idsEnLienzo.map((id) => [id, { id }]));
  const marcadores = new Map<string, Set<string>>();
  const repintados: string[] = [];
  let etiquetas: Etiqueta[] = [];
  let render: Render | null = null;

  const servicios: Readonly<Record<string, unknown>> = {
    bpmnRenderer: {
      // Hace de figura ya dibujada por el renderer por defecto: al overlay solo le importa `style`.
      drawShape: () => ({ style: {} as Partial<CSSStyleDeclaration> }),
    },
    canvas: {
      addMarker: (id: string, clase: string) => {
        const clases = marcadores.get(id) ?? new Set<string>();
        clases.add(clase);
        marcadores.set(id, clases);
      },
      removeMarker: (id: string, clase: string) => {
        marcadores.get(id)?.delete(clase);
        if (marcadores.get(id)?.size === 0) marcadores.delete(id);
      },
    },
    elementRegistry: {
      get: (id: string) => elementos.get(id),
      getGraphics: () => ({}),
    },
    eventBus: {
      on: (tipos: readonly string[], _prioridad: number, fn: Render) => {
        if (tipos.includes('render.shape')) render = fn;
      },
    },
    graphicsFactory: {
      update: (_tipo: string, elemento: { id: string }) => repintados.push(elemento.id),
    },
    overlays: {
      add: (id: string, type: string) => etiquetas.push({ id, type }),
      remove: (filtro: { type: string }) => {
        etiquetas = etiquetas.filter((e) => e.type !== filtro.type);
      },
    },
  };

  const modeler = { get: (nombre: string) => servicios[nombre] } as unknown as ModelerType;
  return {
    get etiquetas() {
      return etiquetas;
    },
    marcadores,
    modeler,
    pintar: (id) => {
      if (render === null) throw new Error('el renderer no se registró en el eventBus');
      const figura = render({ type: 'render.shape' }, { element: { id } });
      // `undefined` = `canRender` dijo que no: esa figura la dibuja el renderer por defecto.
      return (figura as { style: Partial<CSSStyleDeclaration> } | undefined)?.style ?? {};
    },
    repintados,
  };
}

/** `RunResult` mínimo: solo los campos que lee `overlayModel` (§2 y §6). */
function resultadoFalso(
  filas: readonly { id: string; espera: number; proceso: number; utilizacion: number }[],
): RunResult {
  return {
    bottlenecks: filas.map((f) => ({
      elementId: f.id,
      resourceWaitTotal: f.espera * 10,
      utilization: f.utilizacion,
    })),
    elements: Object.fromEntries(
      filas.map((f) => [
        f.id,
        { processing: { mean: f.proceso }, resourceWait: { mean: f.espera } },
      ]),
    ),
    // El resto de `RunResult` (flows, process, warnings…) no lo toca el overlay; construirlo
    // entero aquí solo añadiría ruido que ninguna aserción lee.
  } as unknown as RunResult;
}

const ESCENARIO = scenarioSinRecursos();

function corridaDe(
  filas: readonly { id: string; espera: number; proceso: number; utilizacion: number }[],
  originalIds: Readonly<Record<string, string>> = {},
): Corrida {
  return { originalIds, result: resultadoFalso(filas), scenario: ESCENARIO };
}

/** Las tres esperan más de lo que trabajan: nivel `high` las tres, así que se pintan las tres. */
const RANKING = [
  { espera: 600, id: 'Task_Preparar', proceso: 300, utilizacion: 0.97 },
  { espera: 500, id: 'Task_TomarPedido', proceso: 160, utilizacion: 0.55 },
  { espera: 400, id: 'Task_Revisar', proceso: 200, utilizacion: 0.1 },
];

/** Cuántas entradas del ranking llegan al lienzo (#226); la decisión está en `docs/design/README.md`. */
describe('corte del ranking (#226)', () => {
  const modelo = (filas: readonly { id: string; espera: number; proceso: number; utilizacion: number }[]) =>
    overlayModel(resultadoFalso(filas), ESCENARIO);

  it('con cuellos de nivel alto se pintan solo esos, conservando su rango', () => {
    const model = modelo([
      { espera: 600, id: 'A', proceso: 300, utilizacion: 0.9 },
      { espera: 60, id: 'B', proceso: 160, utilizacion: 0.5 },
      { espera: 400, id: 'C', proceso: 200, utilizacion: 0.4 },
      { espera: 1, id: 'D', proceso: 200, utilizacion: 0.1 },
    ]);

    expect(Object.keys(model)).toEqual(['A', 'C']);
    expect(model['C']?.rango).toBe(2);
  });

  it('sin ninguno de nivel alto se pintan las tres primeras del ranking', () => {
    const model = modelo(
      [60, 50, 40, 30, 1].map((espera, i) => ({ espera, id: `T${i}`, proceso: 160, utilizacion: 0.5 })),
    );

    expect(Object.keys(model)).toEqual(['T0', 'T1', 'T2']);
  });

  it('nunca más de cinco etiquetas sobre el diagrama', () => {
    const model = modelo(
      [700, 600, 500, 400, 300, 200, 100].map((espera, i) => ({ espera, id: `T${i}`, proceso: 10, utilizacion: 0.5 })),
    );

    expect(Object.keys(model)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
  });
});

describe('applyOverlay / clearOverlay sobre el lienzo (LILA-064)', () => {
  it('pinta el ranking en su orden y marca solo bottlenecks[0]', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));

    applyOverlay(falso.modeler, corridaDe(RANKING));

    expect(falso.etiquetas.map((e) => e.id)).toEqual([
      'Task_Preparar',
      'Task_TomarPedido',
      'Task_Revisar',
    ]);
    expect([...falso.marcadores.keys()]).toEqual(['Task_Preparar']);
    expect(falso.pintar('Task_Preparar').fill).toBe('var(--sim-bottleneck-high)');
    expect(falso.pintar('Task_Revisar').fill).toBe('var(--sim-bottleneck-high)');
    // Un elemento fuera del ranking lo sigue dibujando el renderer por defecto.
    expect(falso.pintar('Gateway_1')).toEqual({});
  });

  // El motor sanitiza los ids que no son NCName válido y `RunResult` queda keyed por el
  // sanitizado; bpmn-js importó el XML original, así que el lienzo solo conoce el de antes.
  it('pinta sobre el id que conoce bpmn-js cuando el del resultado venía sanitizado', () => {
    const falso = modeladorFalso(['9 Tomar Pedido']);
    const corrida = corridaDe([{ espera: 600, id: '_9_Tomar_Pedido', proceso: 300, utilizacion: 0.9 }], {
      _9_Tomar_Pedido: '9 Tomar Pedido',
    });

    applyOverlay(falso.modeler, corrida);

    expect(falso.etiquetas.map((e) => e.id)).toEqual(['9 Tomar Pedido']);
    expect([...falso.marcadores.keys()]).toEqual(['9 Tomar Pedido']);
    expect(falso.pintar('9 Tomar Pedido').fill).toBe('var(--sim-bottleneck-high)');
  });

  it('ignora los ids que el lienzo no conoce, sin fallar', () => {
    const falso = modeladorFalso(['Task_Preparar']);

    applyOverlay(falso.modeler, corridaDe(RANKING));

    expect(falso.etiquetas.map((e) => e.id)).toEqual(['Task_Preparar']);
  });

  it('limpiar quita etiquetas, marcador y tinte, y repetirlo no acumula nada', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));
    applyOverlay(falso.modeler, corridaDe(RANKING));

    clearOverlay(falso.modeler);
    clearOverlay(falso.modeler);

    expect(falso.etiquetas).toEqual([]);
    expect([...falso.marcadores.keys()]).toEqual([]);
    expect(falso.pintar('Task_Preparar')).toEqual({});
  });

  it('cambiar de escenario deja el lienzo solo con el overlay de la corrida nueva', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));
    applyOverlay(falso.modeler, corridaDe(RANKING));

    // TO-BE: el cuello de botella principal es otro y Task_Revisar ya no espera a nadie. Aquí
    // ninguna llega a nivel `high`, así que se pintan las dos por el camino de las tres primeras
    // (#226) y Task_Preparar cambia de tinte alto a bajo.
    applyOverlay(
      falso.modeler,
      corridaDe([
        { espera: 40, id: 'Task_TomarPedido', proceso: 160, utilizacion: 0.8 },
        { espera: 5, id: 'Task_Preparar', proceso: 300, utilizacion: 0.3 },
      ]),
    );

    expect(falso.etiquetas.map((e) => e.id)).toEqual(['Task_TomarPedido', 'Task_Preparar']);
    expect([...falso.marcadores.keys()]).toEqual(['Task_TomarPedido']);
    expect(falso.pintar('Task_Preparar').fill).toBe('var(--sim-bottleneck-low)');
    expect(falso.pintar('Task_Revisar')).toEqual({});
  });

  // El interruptor «Cuellos de botella» del panel derecho y el «no hay corrida» de main.tsx son
  // la misma llamada: `Modelador.cuellos(corrida, visible)`.
  it('el interruptor apaga y vuelve a encender el overlay por el mismo camino', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));
    const corrida = corridaDe(RANKING);

    sincronizarOverlay(falso.modeler, corrida, true);
    expect(falso.etiquetas).toHaveLength(3);

    sincronizarOverlay(falso.modeler, corrida, false);
    expect(falso.etiquetas).toEqual([]);
    expect([...falso.marcadores.keys()]).toEqual([]);

    sincronizarOverlay(falso.modeler, corrida, true);
    expect(falso.etiquetas).toHaveLength(3);
    expect([...falso.marcadores.keys()]).toEqual(['Task_Preparar']);

    // Sin corrida (escenario recién cambiado, o modelo recién abierto) el overlay se va igual.
    sincronizarOverlay(falso.modeler, null, true);
    expect(falso.etiquetas).toEqual([]);
  });
});
