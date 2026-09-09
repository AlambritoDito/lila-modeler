// @vitest-environment jsdom
/**
 * Pruebas de LILA-209, en dos mitades (mismo reparto que `BottleneckOverlay.test.ts`).
 *
 * `problemasPorElemento` es pura y se prueba contra el lint **de verdad**: `examples/pedido` con
 * su AS-IS, donde `Task_Empacar` es una tarea sin `processingTime` y el lint la marca con
 * `W-ELEMENTO-SIN-PARAMETROS`. Darle un tiempo de proceso —lo que hace el panel de escenario—
 * quita el aviso y el marcador, que es la aceptación del ticket.
 *
 * `sincronizarMarcadores` se prueba contra un **modelador falso** que anota las llamadas a
 * `overlays.add`/`overlays.remove`: jsdom no llega a montar un lienzo de diagram-js (le faltan
 * `SVGGraphicsElement.getBBox` y `SVGElement.transform.baseVal`), y lo que importa de esta capa
 * es el cableado —sobre qué id se pinta, qué se quita al repintar, qué pasa con un id que el
 * lienzo no conoce—. El aspecto real está verificado en navegador
 * (`docs/design/app-01d-marcadores.png`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseBpmn } from '@lila/engine/bpmn';
import type { ProcessIR } from '@lila/engine';
import type ModelerType from 'bpmn-js/lib/Modeler';

import { problemasEscenario, type Problema } from './ScenarioPanel';
import { problemasPorElemento, sincronizarMarcadores, type Validacion } from './ValidationMarkers';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, '../../../examples/pedido');

function leerEscenario(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(EXAMPLE_DIR, 'as-is.scenario.json'), 'utf8')) as Record<string, unknown>;
}

describe('problemasPorElemento (LILA-209)', () => {
  let ir: ProcessIR;
  beforeAll(async () => {
    ir = (await parseBpmn(readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8'))).ir;
  });

  it('una tarea sin tiempo de proceso es un aviso sobre esa tarea', () => {
    const escenario = leerEscenario();
    const validacion = problemasPorElemento(problemasEscenario(escenario, ir));

    expect(validacion.marcadores.get('Task_Empacar')).toEqual({
      nivel: 'aviso',
      mensajes: ['elements.Task_Empacar: el elemento existe en el modelo y no tiene parámetros; toma sus defaults.'],
    });
    expect(validacion.errores).toBe(0);
    // Los mismos números que la cabecera del panel de escenario: los dos leen la misma lista.
    expect(validacion.avisos).toBe(problemasEscenario(escenario, ir).length);
  });

  it('darle tiempo de proceso en el escenario quita el aviso y el marcador', () => {
    const escenario = leerEscenario();
    const elements = escenario['elements'] as Record<string, unknown>;
    const corregido = {
      ...escenario,
      elements: { ...elements, Task_Empacar: { processingTime: { type: 'constant', value: 60 } } },
    };

    const antes = problemasPorElemento(problemasEscenario(escenario, ir));
    const despues = problemasPorElemento(problemasEscenario(corregido, ir));

    expect(antes.marcadores.has('Task_Empacar')).toBe(true);
    expect(despues.marcadores.has('Task_Empacar')).toBe(false);
    expect(despues.avisos).toBe(antes.avisos - 1);
  });

  it('un escenario que no pasa el esquema son errores, y sin IR solo se valida el esquema', () => {
    const validacion = problemasPorElemento(problemasEscenario({ version: 1 }, null));

    expect(validacion.errores).toBeGreaterThan(0);
    expect(validacion.avisos).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * La parte pura, sin depender del lint: agrupación, niveles y totales.
 * ------------------------------------------------------------------ */

function problema(ruta: string, severidad: 'error' | 'warning', mensaje = ruta): Problema {
  return { mensaje, ruta, severidad };
}

describe('problemasPorElemento · agrupación y totales', () => {
  it('agrupa por elemento, el error gana al aviso y guarda todos los mensajes', () => {
    const validacion = problemasPorElemento([
      problema('elements.Task_1', 'warning', 'sin parámetros'),
      problema('elements.Task_1.processingTime', 'error', 'distribución inválida'),
      problema('elements.Flow_2', 'warning', 'probabilidad normalizada'),
    ]);

    expect(validacion.marcadores.get('Task_1')).toEqual({
      nivel: 'error',
      mensajes: ['sin parámetros', 'distribución inválida'],
    });
    expect(validacion.marcadores.get('Flow_2')?.nivel).toBe('aviso');
    expect(validacion.errores).toBe(1);
    expect(validacion.avisos).toBe(2);
    expect(validacion.primero).toBe('Task_1');
  });

  it('los problemas sin figura solo cuentan en los chips', () => {
    const validacion = problemasPorElemento(
      [problema('run.duration', 'error'), problema('resources.cajero.calendar', 'error'), problema('extends', 'error')],
      // Diagnóstico del proyecto abierto y avisos de bpmn-js al importar.
      { avisos: 3, errores: 2 },
    );

    expect(validacion.marcadores.size).toBe(0);
    expect(validacion.primero).toBeNull();
    expect(validacion.errores).toBe(5);
    expect(validacion.avisos).toBe(3);
  });

  it('sin problemas los chips quedan a cero', () => {
    expect(problemasPorElemento([])).toEqual({ avisos: 0, errores: 0, marcadores: new Map(), primero: null });
  });
});

/* ------------------------------------------------------------------ *
 * Modelador falso: anota las llamadas a `overlays.add` / `overlays.remove`.
 * ------------------------------------------------------------------ */

interface Disco {
  id: string;
  type: string;
  html: HTMLElement;
}

interface Falso {
  modeler: ModelerType;
  discos: Disco[];
  limpiezas: number;
}

function modeladorFalso(idsEnLienzo: readonly string[]): Falso {
  const elementos = new Map(idsEnLienzo.map((id) => [id, { id }]));
  let discos: Disco[] = [];
  let limpiezas = 0;

  const servicios: Readonly<Record<string, unknown>> = {
    elementRegistry: { get: (id: string) => elementos.get(id) },
    overlays: {
      add: (id: string, type: string, opciones: { html: HTMLElement }) => discos.push({ html: opciones.html, id, type }),
      remove: (filtro: { type: string }) => {
        limpiezas += 1;
        discos = discos.filter((d) => d.type !== filtro.type);
      },
    },
  };

  const modeler = { get: (nombre: string) => servicios[nombre] } as unknown as ModelerType;
  return {
    get discos() {
      return discos;
    },
    get limpiezas() {
      return limpiezas;
    },
    modeler,
  };
}

function validacionDe(entradas: readonly [string, 'error' | 'aviso'][]): Validacion {
  return {
    avisos: entradas.filter(([, n]) => n === 'aviso').length,
    errores: entradas.filter(([, n]) => n === 'error').length,
    marcadores: new Map(entradas.map(([id, nivel]) => [id, { mensajes: [`${id}: algo`], nivel }])),
    primero: entradas[0]?.[0] ?? null,
  };
}

describe('sincronizarMarcadores sobre el lienzo (LILA-209)', () => {
  it('pinta un disco por elemento, con su nivel y su tooltip', () => {
    const falso = modeladorFalso(['Task_1', 'Task_2']);

    sincronizarMarcadores(falso.modeler, validacionDe([['Task_1', 'error'], ['Task_2', 'aviso']]));

    expect(falso.discos.map((d) => d.id)).toEqual(['Task_1', 'Task_2']);
    expect(falso.discos.every((d) => d.type === 'lila-validacion')).toBe(true);
    expect(falso.discos[0]?.html.className).toBe('lila-validacion lila-validacion-error');
    expect(falso.discos[1]?.html.className).toBe('lila-validacion lila-validacion-aviso');
    expect(falso.discos[0]?.html.textContent).toBe('!');
    expect(falso.discos[0]?.html.title).toBe('Task_1: algo\nF2 renombrar · ⇥ propiedades');
  });

  it('ignora los ids que el lienzo no conoce, sin fallar', () => {
    const falso = modeladorFalso(['Task_1']);

    sincronizarMarcadores(falso.modeler, validacionDe([['Task_1', 'aviso'], ['Task_Borrada', 'error']]));

    expect(falso.discos.map((d) => d.id)).toEqual(['Task_1']);
  });

  // Corregir el escenario en el panel es exactamente este camino: el mapa se queda sin la
  // entrada y el disco se va en el siguiente repintado, sin recargar nada.
  it('repintar no acumula y quedarse sin problemas quita todos los discos', () => {
    const falso = modeladorFalso(['Task_1', 'Task_2']);

    sincronizarMarcadores(falso.modeler, validacionDe([['Task_1', 'aviso'], ['Task_2', 'aviso']]));
    sincronizarMarcadores(falso.modeler, validacionDe([['Task_1', 'aviso']]));
    expect(falso.discos.map((d) => d.id)).toEqual(['Task_1']);

    sincronizarMarcadores(falso.modeler, validacionDe([]));
    expect(falso.discos).toEqual([]);

    // `null` (modelo recién abierto, sin lint todavía) hace lo mismo y tampoco pinta nada.
    sincronizarMarcadores(falso.modeler, null);
    expect(falso.discos).toEqual([]);
    expect(falso.limpiezas).toBe(4);
  });
});
