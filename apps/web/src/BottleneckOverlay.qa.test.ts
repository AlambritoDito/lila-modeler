// @vitest-environment jsdom
/**
 * QA adversarial de LILA-064 (overlay de cuellos de botella).
 *
 * Complementa `BottleneckOverlay.test.ts` —que prueba el camino feliz contra `examples/pedido`—
 * atacando los bordes: empates en el ranking, corridas sin cuellos, unidades de la etiqueta y,
 * sobre todo, **el lienzo que cambia debajo del overlay**: borrar en el diagrama la tarea que
 * el overlay tenía marcada y después limpiar.
 *
 * El modelador falso de aquí es más estricto que el de `BottleneckOverlay.test.ts`: reproduce lo
 * que hace diagram-js de verdad en `Canvas._updateMarker`, que resuelve el id contra el
 * `elementRegistry` y escribe sobre lo que salga (`element.markers = …`). Con un id que ya no
 * existe eso es `undefined` y revienta con `TypeError`, así que el falso revienta igual: un doble
 * tolerante escondería justo el fallo que se busca.
 */
import { describe, expect, it } from 'vitest';

import { ScenarioSchema, type ResolvedScenario } from '@lila/engine/schema';
import type { RunResult } from '@lila/engine';
import type ModelerType from 'bpmn-js/lib/Modeler';

import {
  applyOverlay,
  clearOverlay,
  overlayModel,
  sincronizarOverlay,
  type Corrida,
} from './BottleneckOverlay.js';

interface Fila {
  id: string;
  /** `resourceWait.mean`, en segundos. */
  espera: number;
  /** `processing.mean`, en segundos. */
  proceso: number;
  utilizacion: number;
  /** `resourceWait.total`; por defecto `espera * 10`. El ranking del motor ordena por este. */
  total?: number;
}

/** `RunResult` mínimo: solo los campos que lee `overlayModel` (RESULTS_FORMAT.md §2 y §6). */
function resultadoFalso(filas: readonly Fila[]): RunResult {
  return {
    bottlenecks: filas.map((f) => ({
      elementId: f.id,
      resourceWaitTotal: f.total ?? f.espera * 10,
      utilization: f.utilizacion,
    })),
    elements: Object.fromEntries(
      filas.map((f) => [f.id, { processing: { mean: f.proceso }, resourceWait: { mean: f.espera } }]),
    ),
  } as unknown as RunResult;
}

function escenario(baseTimeUnit: 's' | 'min' | 'h'): ResolvedScenario {
  return ScenarioSchema.parse({
    model: 'model.bpmn',
    name: `QA ${baseTimeUnit}`,
    run: {
      baseTimeUnit,
      currency: 'MXN',
      replications: 1,
      seed: 7,
      start: '2026-09-07T08:00:00-06:00',
    },
    version: 1,
  }) as ResolvedScenario;
}

function corridaDe(
  filas: readonly Fila[],
  opciones: { originalIds?: Readonly<Record<string, string>>; unidad?: 's' | 'min' | 'h' } = {},
): Corrida {
  return {
    originalIds: opciones.originalIds ?? {},
    result: resultadoFalso(filas),
    scenario: escenario(opciones.unidad ?? 'min'),
  };
}

/* ------------------------------------------------------------------ *
 * Modelador falso, con el lienzo mutable (`borrar`).
 * ------------------------------------------------------------------ */

type Render = (evt: { type: string }, ctx: { element: { id: string } }) => unknown;

interface Falso {
  modeler: ModelerType;
  etiquetas: { id: string; type: string }[];
  marcadores: Map<string, Set<string>>;
  /** Saca el elemento del `elementRegistry`, como haría borrarlo en el diagrama. */
  borrar(id: string): void;
  pintar(id: string): Partial<CSSStyleDeclaration>;
}

function modeladorFalso(idsEnLienzo: readonly string[]): Falso {
  const elementos = new Map(idsEnLienzo.map((id) => [id, { id }]));
  const marcadores = new Map<string, Set<string>>();
  let etiquetas: { id: string; type: string }[] = [];
  let render: Render | null = null;

  /** `Canvas._resolveElement` + la primera línea de `_updateMarker`, tal cual las hace diagram-js. */
  const resolverParaMarcar = (id: string): { id: string } => {
    const elemento = elementos.get(id);
    if (elemento === undefined) {
      throw new TypeError("Cannot set properties of undefined (setting 'markers')");
    }
    return elemento;
  };

  const servicios: Readonly<Record<string, unknown>> = {
    bpmnRenderer: { drawShape: () => ({ style: {} as Partial<CSSStyleDeclaration> }) },
    canvas: {
      addMarker: (id: string, clase: string) => {
        const clases = marcadores.get(resolverParaMarcar(id).id) ?? new Set<string>();
        clases.add(clase);
        marcadores.set(id, clases);
      },
      removeMarker: (id: string, clase: string) => {
        marcadores.get(resolverParaMarcar(id).id)?.delete(clase);
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
    graphicsFactory: { update: () => undefined },
    overlays: {
      add: (id: string, type: string) => etiquetas.push({ id, type }),
      remove: (filtro: { type: string }) => {
        etiquetas = etiquetas.filter((e) => e.type !== filtro.type);
      },
    },
  };

  const modeler = { get: (nombre: string) => servicios[nombre] } as unknown as ModelerType;
  return {
    borrar: (id) => {
      elementos.delete(id);
      // Borrar en el diagrama se lleva el `gfx` del elemento y con él sus clases: el marcador
      // desaparece del lienzo por sí solo, sin pasar por `canvas.removeMarker`.
      marcadores.delete(id);
    },
    get etiquetas() {
      return etiquetas;
    },
    marcadores,
    modeler,
    pintar: (id) => {
      if (render === null) throw new Error('el renderer no se registró en el eventBus');
      const figura = render({ type: 'render.shape' }, { element: { id } });
      return (figura as { style: Partial<CSSStyleDeclaration> } | undefined)?.style ?? {};
    },
  };
}

/* ------------------------------------------------------------------ *
 * Ataques a `overlayModel` (parte pura).
 * ------------------------------------------------------------------ */

describe('overlayModel: ranking, niveles y etiqueta (QA LILA-064)', () => {
  // §6 fija el orden en el motor; el overlay no puede reordenar ni "mejorar" el desempate. Las
  // seis esperan más de lo que trabajan (nivel `high`), así que el único corte que les aplica
  // #226 es el techo de cinco: entran las cinco primeras, en su orden y con su `rango`.
  it('con empates en resourceWait.total respeta el orden de bottlenecks tal cual', () => {
    const empatadas: Fila[] = [
      { espera: 30, id: 'Task_F', proceso: 10, total: 900, utilizacion: 0.9 },
      { espera: 30, id: 'Task_A', proceso: 10, total: 900, utilizacion: 0.9 },
      { espera: 20, id: 'Task_E', proceso: 10, total: 600, utilizacion: 0.5 },
      { espera: 20, id: 'Task_B', proceso: 10, total: 600, utilizacion: 0.4 },
      { espera: 10, id: 'Task_D', proceso: 10, total: 300, utilizacion: 0.3 },
      { espera: 10, id: 'Task_C', proceso: 10, total: 300, utilizacion: 0.3 },
    ];
    const model = overlayModel(resultadoFalso(empatadas), escenario('min'));

    expect(Object.keys(model)).toEqual(['Task_F', 'Task_A', 'Task_E', 'Task_B', 'Task_D']);
    expect(Object.values(model).map((e) => e.rango)).toEqual([0, 1, 2, 3, 4]);
    expect(Object.values(model).filter((e) => e.principal).map((_, i) => i)).toHaveLength(1);
    expect(model['Task_F']?.principal).toBe(true);
  });

  it('sin cuellos (nivel 1/2, sin recursos) no hay nada que pintar', () => {
    expect(overlayModel(resultadoFalso([]), escenario('min'))).toEqual({});
  });

  // Un único cuello es siempre `bottlenecks[0]`, pero eso no lo convierte en "rojo": el nivel
  // sale del ratio espera/proceso, así que una espera despreciable no se pinta como crítica.
  it('un único cuello con espera despreciable es principal pero de nivel bajo', () => {
    const model = overlayModel(
      resultadoFalso([{ espera: 0.5, id: 'Task_Unica', proceso: 300, utilizacion: 0.2 }]),
      escenario('min'),
    );

    expect(model['Task_Unica']?.principal).toBe(true);
    expect(model['Task_Unica']?.rango).toBe(0);
    expect(model['Task_Unica']?.nivel).toBe('low');
  });

  // QA de #226: el corte por nivel `high` se llevó por delante la única aserción sobre `mid` (la
  // que seguía a `Task_TomarPedido` entre AS-IS y TO-BE en `BottleneckOverlay.test.ts`), y
  // sustituir la rama del medio de `nivelDeRatio` por `'low'` pasaba toda la suite de `apps/web`.
  // Aquí ninguna llega a `high`, así que las tres se pintan por el camino de las tres primeras y
  // los dos umbrales (0,05 y 1) quedan fijados por sus dos lados.
  it('los umbrales low/mid salen del ratio espera/proceso de cada tarea', () => {
    const model = overlayModel(
      resultadoFalso([
        { espera: 99, id: 'Task_CasiAlta', proceso: 100, utilizacion: 0.5 },
        { espera: 5, id: 'Task_JustoMid', proceso: 100, utilizacion: 0.5 },
        { espera: 4.9, id: 'Task_Baja', proceso: 100, utilizacion: 0.5 },
      ]),
      escenario('min'),
    );

    expect(model['Task_CasiAlta']?.nivel).toBe('mid');
    expect(model['Task_JustoMid']?.nivel).toBe('mid');
    expect(model['Task_Baja']?.nivel).toBe('low');
  });

  // Y el otro lado de `RATIO_HIGH`: un ratio de exactamente 1 ya es `high`, mientras que 0,99 se
  // queda en `mid`. Task_CasiAlta se pinta igual, pero por ser el rango 0 (el corte de #226
  // incluye siempre al principal), no por su nivel — de ahí que se afirmen los dos niveles.
  it('un ratio de exactamente 1 es alto y el de 0,99 se queda en mid', () => {
    const model = overlayModel(
      resultadoFalso([
        { espera: 99, id: 'Task_CasiAlta', proceso: 100, total: 990, utilizacion: 0.5 },
        { espera: 100, id: 'Task_Alta', proceso: 100, total: 500, utilizacion: 0.5 },
      ]),
      escenario('min'),
    );

    expect(Object.keys(model)).toEqual(['Task_CasiAlta', 'Task_Alta']);
    expect(model['Task_CasiAlta']?.nivel).toBe('mid');
    expect(model['Task_CasiAlta']?.principal).toBe(true);
    expect(model['Task_Alta']?.nivel).toBe('high');
    expect(model['Task_Alta']?.rango).toBe(1);
  });

  // R-DURA-2: los valores viven en segundos y `baseTimeUnit` es solo presentación. La etiqueta
  // tiene que decir «2 min», no «120 min» ni «120». Desde #226 la etiqueta corta elige por su
  // cuenta la unidad más gruesa que siga siendo legible (con `min` y con `s` sale la misma) y es
  // el `title` el que conserva la unidad del escenario.
  it('la etiqueta no imprime segundos crudos y el title respeta baseTimeUnit', () => {
    const filas = [{ espera: 120, id: 'Task_Espera', proceso: 120, utilizacion: 0.5 }];
    const enMinutos = overlayModel(resultadoFalso(filas), escenario('min'))['Task_Espera'];
    const enSegundos = overlayModel(resultadoFalso(filas), escenario('s'))['Task_Espera'];

    expect(enMinutos?.etiqueta).toBe('2 min · 50%');
    expect(enSegundos?.etiqueta).toBe('2 min · 50%');
    expect(enMinutos?.titulo).toBe('espera media 2 min · utilización 50%');
    expect(enSegundos?.titulo).toBe('espera media 120 s · utilización 50%');
  });

  // `processing.mean = 0` con espera > 0 no lo produce el motor, pero un 0/0 daría `NaN` y
  // `nivelDeRatio(NaN)` caería en `high` por descarte: se fija que el nivel salga por la rama
  // explícita y la etiqueta siga siendo legible.
  it('processing.mean = 0 da el nivel más alto sin NaN en la etiqueta', () => {
    const model = overlayModel(
      resultadoFalso([{ espera: 60, id: 'Task_Cero', proceso: 0, utilizacion: 1 }]),
      escenario('min'),
    );

    expect(model['Task_Cero']?.nivel).toBe('high');
    expect(model['Task_Cero']?.etiqueta).not.toMatch(/NaN|Infinity/);
  });
});

/* ------------------------------------------------------------------ *
 * Ataques al lienzo: el diagrama cambia debajo del overlay.
 * ------------------------------------------------------------------ */

describe('el lienzo cambia debajo del overlay (QA LILA-064)', () => {
  const RANKING: Fila[] = [
    { espera: 600, id: 'Task_Preparar', proceso: 300, utilizacion: 0.97 },
    { espera: 60, id: 'Task_TomarPedido', proceso: 160, utilizacion: 0.55 },
  ];

  // Camino real: simular, borrar en el lienzo la tarea marcada como cuello principal y apagar el
  // interruptor. `clearOverlay` llama `canvas.removeMarker` sobre un id que el registro ya no
  // conoce, y diagram-js escribe `element.markers` sobre `undefined`.
  it('borrar en el diagrama la tarea principal y apagar el interruptor no revienta', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));
    const corrida = corridaDe(RANKING);
    sincronizarOverlay(falso.modeler, corrida, true);

    falso.borrar('Task_Preparar');

    expect(() => {
      sincronizarOverlay(falso.modeler, corrida, false);
    }).not.toThrow();
    expect(falso.etiquetas).toEqual([]);
    expect(falso.pintar('Task_TomarPedido')).toEqual({});
  });

  // Misma raíz por el otro camino: cambiar de escenario repinta con `applyOverlay`, que empieza
  // por `clearOverlay`. Si el elemento marcado se borró, la corrida nueva no llega a pintarse.
  it('borrar la tarea principal y correr otro escenario pinta el overlay nuevo', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));
    applyOverlay(falso.modeler, corridaDe(RANKING));

    falso.borrar('Task_Preparar');
    applyOverlay(
      falso.modeler,
      corridaDe([{ espera: 400, id: 'Task_TomarPedido', proceso: 160, utilizacion: 0.8 }]),
    );

    expect(falso.etiquetas.map((e) => e.id)).toEqual(['Task_TomarPedido']);
    expect([...falso.marcadores.keys()]).toEqual(['Task_TomarPedido']);
  });

  // Una corrida sin cuellos (p. ej. el TO-BE que quitó la contención) tiene que **borrar** el
  // overlay anterior, no dejarlo puesto por no tener nada nuevo que pintar.
  it('una corrida sin cuellos limpia el overlay anterior', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));
    applyOverlay(falso.modeler, corridaDe(RANKING));

    applyOverlay(falso.modeler, corridaDe([]));

    expect(falso.etiquetas).toEqual([]);
    expect([...falso.marcadores.keys()]).toEqual([]);
    expect(falso.pintar('Task_Preparar')).toEqual({});
  });

  // Con el interruptor apagado, una corrida nueva no puede colarse en el lienzo.
  it('con el interruptor apagado, una corrida nueva no pinta nada', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));
    sincronizarOverlay(falso.modeler, corridaDe(RANKING), true);

    sincronizarOverlay(falso.modeler, corridaDe(RANKING), false);
    sincronizarOverlay(
      falso.modeler,
      corridaDe([{ espera: 400, id: 'Task_TomarPedido', proceso: 160, utilizacion: 0.8 }]),
      false,
    );

    expect(falso.etiquetas).toEqual([]);
    expect([...falso.marcadores.keys()]).toEqual([]);
  });

  // `clearOverlay` sobre un modelador que nunca tuvo overlay (abrir un `.bpmn` antes de simular).
  it('limpiar un modelador sin overlay previo no hace nada ni revienta', () => {
    const falso = modeladorFalso(RANKING.map((f) => f.id));

    expect(() => {
      clearOverlay(falso.modeler);
    }).not.toThrow();
    expect(falso.etiquetas).toEqual([]);
  });
});
