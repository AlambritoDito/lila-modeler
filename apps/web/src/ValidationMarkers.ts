/**
 * Marcadores de validación sobre las figuras y recuento de errores/avisos (LILA-209).
 *
 * Dos mitades, como `BottleneckOverlay.ts`:
 *
 * - `problemasPorElemento` es pura: agrupa por elemento los problemas que la app **ya** calcula
 *   —el lint del escenario resuelto (`problemasEscenario`, o sea `validateScenario` con los
 *   textos de la CLI), el diagnóstico del proyecto abierto y los avisos de bpmn-js al importar—
 *   y devuelve el mapa a pintar más los totales de los chips. No valida nada por su cuenta: si
 *   el chip dice «6 avisos», la cabecera del panel de escenario dice exactamente lo mismo,
 *   porque los dos leen la misma lista.
 * - `sincronizarMarcadores` es el único punto que toca el modelador, por el servicio `overlays`
 *   (nada de SVG inyectado). Limpia por `type` antes de repintar, así que es idempotente: el
 *   shell puede llamarla en cada render sin comprobar si algo cambió, y el marcador desaparece
 *   solo en cuanto el problema se corrige en el panel.
 *
 * `Modeler.tsx` lo expone como `Modelador.validacion(...)`; el resto del shell sigue sin ver
 * bpmn-js (misma frontera que `Modelador.cuellos`).
 *
 * El aspecto del disco vive en `app.css` (`.lienzo .lila-validacion`): el overlay se pinta
 * dentro de `.lienzo`, así que no hace falta inyectar un `<style>` como sí hace el overlay de
 * cuellos de botella.
 */
import type Modeler from 'bpmn-js/lib/Modeler';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Overlays from 'diagram-js/lib/features/overlays/Overlays';
import type { Problema } from './ScenarioPanel';
import { S } from './strings.es';

const TIPO = 'lila-validacion';

/** Acciones que recuerda el tooltip, como en el artboard `docs/design/01-modelar-1440.png`. */
const ACCIONES = S.lienzo.marcadorAcciones;

/**
 * `elements.<id>`, `elements.<id>.processingTime`, `elements.<id>.resources[0].ref`: la ruta de
 * un `ScenarioProblem` empieza por el id del elemento cuando el problema es de un elemento
 * (R-RES-2). Los demás (`run.duration`, `resources.cajero.calendar`, `extends`) no tienen figura
 * sobre la que pintar y solo cuentan en los chips.
 */
const RUTA_ELEMENTO = /^elements\.([^.[]+)/;

export type NivelValidacion = 'error' | 'aviso';

export interface MarcadorValidacion {
  /** `error` gana a `aviso`: un elemento con las dos cosas se pinta en rojo. */
  nivel: NivelValidacion;
  /** Todos los mensajes del elemento, en el orden en que los emitió el lint. */
  mensajes: string[];
}

export interface Validacion {
  /**
   * `id del elemento -> marcador`, en orden de aparición. Están todos los ids con problema;
   * cuáles llegan a tener disco lo decide `sincronizarMarcadores` contra el `elementRegistry`.
   */
  marcadores: ReadonlyMap<string, MarcadorValidacion>;
  errores: number;
  avisos: number;
  /** Primer id con problema, al que lleva el clic en un chip. `null` si no hay ninguno. */
  primero: string | null;
}

/** Problemas que no cuelgan de ninguna figura y solo suman en los chips. */
export interface SinElemento {
  /** Diagnóstico del proyecto abierto (`ProjectDocument.problems`). */
  errores?: number;
  /** Avisos de bpmn-js al importar (`EstadoLienzo.avisos`). */
  avisos?: number;
}

/**
 * Agrupa los problemas por elemento y cuenta los totales. Función pura; se prueba sin navegador
 * (ver `ValidationMarkers.test.ts`).
 */
export function problemasPorElemento(
  problemas: readonly Problema[],
  sinElemento: SinElemento = {},
): Validacion {
  const marcadores = new Map<string, MarcadorValidacion>();
  let errores = sinElemento.errores ?? 0;
  let avisos = sinElemento.avisos ?? 0;
  let primero: string | null = null;

  for (const problema of problemas) {
    const nivel: NivelValidacion = problema.severidad === 'error' ? 'error' : 'aviso';
    if (nivel === 'error') errores += 1;
    else avisos += 1;

    const id = RUTA_ELEMENTO.exec(problema.ruta)?.[1];
    if (id === undefined) continue;
    primero ??= id;
    const previo = marcadores.get(id);
    if (previo === undefined) {
      marcadores.set(id, { mensajes: [problema.mensaje], nivel });
    } else {
      previo.mensajes.push(problema.mensaje);
      if (nivel === 'error') previo.nivel = 'error';
    }
  }

  return { avisos, errores, marcadores, primero };
}

/**
 * Disco de 16 px con el `title` nativo: mensajes del elemento y las acciones del artboard.
 *
 * ponytail: el tooltip es el `title` del navegador, no el del artboard (caja sobre `bg.elevated`
 * con sombra y los atajos en mono, `docs/design/COMPARACION-2026-09-07.md` § tooltips). Techo:
 * no se puede estilar ni abrir con el teclado, y tarda ~1 s en aparecer. Camino: cuando haya un
 * tooltip propio en la UI (ticket aparte), este `title` se cambia por él sin tocar nada más.
 */
function disco(marcador: MarcadorValidacion): HTMLElement {
  const div = document.createElement('div');
  div.className = `lila-validacion lila-validacion-${marcador.nivel}`;
  div.textContent = S.lienzo.marcadorSimbolo;
  div.title = S.lienzo.marcadorTitulo(marcador.mensajes, ACCIONES);
  return div;
}

/**
 * Repinta los marcadores de `validacion` sobre `modeler`. Quita siempre los anteriores primero,
 * así que llamarla dos veces no acumula nada y `validacion = null` (o un mapa vacío) los borra
 * todos: corregir el escenario en el panel es exactamente ese camino.
 *
 * Solo se pinta sobre ids que el lienzo conoce. Los ids del lint son los del IR, y tanto el IR
 * como bpmn-js importan pasando por el mismo `sanitizeXmlIds` (`modelerXml.ts`), así que
 * coinciden salvo que el modelo del resultado no sea el que está abierto — y entonces lo que
 * toca es no pintar nada, no reventar el lienzo.
 *
 * El disco se ancla a la esquina superior derecha de **su figura**: nunca cae sobre la marca de
 * agua «Powered by bpmn.io», que es un elemento fijo del contenedor y no un elemento del
 * diagrama.
 */
export function sincronizarMarcadores(modeler: Modeler, validacion: Validacion | null): void {
  const overlays = modeler.get<Overlays>('overlays');
  overlays.remove({ type: TIPO });
  if (validacion === null) return;

  const registro = modeler.get<ElementRegistry>('elementRegistry');
  for (const [id, marcador] of validacion.marcadores) {
    if (registro.get(id) === undefined) continue;
    overlays.add(id, TIPO, { html: disco(marcador), position: { right: -8, top: -8 } });
  }
}
