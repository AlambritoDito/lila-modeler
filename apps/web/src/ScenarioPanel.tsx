/**
 * Panel de escenario (LILA-061): `run`, `calendars`, `resources` y `elements[id]` del elemento
 * seleccionado en el lienzo, con validación en vivo y los mismos textos que la CLI.
 *
 * Tres decisiones que explican todo lo demás:
 *
 * 1. **Los formularios se generan desde el JSON Schema en tiempo de ejecución**, no a mano. El
 *    esquema sale de `toJsonSchema()` de `@lila-modeler/engine/schema` —el mismo que publica
 *    `docs/scenario.schema.json`—, así que un campo nuevo en `scenario.ts` aparece en el panel
 *    sin tocar este archivo. Las uniones (`oneOf`/`anyOf`) se dibujan como un selector de
 *    variante más el cuerpo de la elegida: es lo que hace que las 14 distribuciones funcionen
 *    con un solo control, y lo que hará que `resources[pool].capacity` soporte la forma
 *    `number | Array<{calendar, capacity}>` de LILA-164 el día que entre, sin código nuevo.
 *
 * 2. **Se edita el delta, no el resuelto** (`docs/SCENARIO_FORMAT.md` § 6). El panel enseña
 *    siempre el escenario **resuelto** (`resolveExtends`, o sea con los valores heredados del
 *    padre) y escribe cada cambio en el archivo hijo. Borrar un campo que el padre define
 *    escribe `null` —que es como § 6 dice "borra"—; borrar uno que solo estaba en el hijo lo
 *    quita del hijo. Cualquier cambio **dentro de un array** (los `intervals` de un calendario,
 *    los `resources` de una tarea, los `points` de una `user`) escribe el array **entero** en el
 *    delta: § 6 dice que los arrays se reemplazan enteros, así que un `[2]` suelto en el hijo no
 *    significaría nada.
 *
 * 3. **La escritura nunca se bloquea.** Un valor inválido se marca junto al campo con el texto
 *    del validador (zod para el esquema, `validateScenario` para las reglas R3…R14 contra el IR)
 *    y se cuenta en la cabecera, pero se escribe igual y «Guardar» sigue habilitado: es la
 *    aceptación literal del ticket. Guardar es explícito y no automático porque en `BrowserStore`
 *    `putScenario` **descarga un archivo**: guardar en cada tecla sería una descarga por tecla.
 *    El escenario que simula la app es el editado en el panel, sin necesidad de guardar.
 *
 * 4. **Lo que se ofrece depende de lo seleccionado** (#332). El esquema dice qué campos existen;
 *    el **IR** dice cuáles significan algo en el elemento que hay marcado en el lienzo, y es la
 *    tabla de `scenarioFields.ts` (la columna "Applies to" de § 2.5) la que decide cuáles se
 *    dibujan. Una compuerta no tiene campos propios: lo que se parametriza son las
 *    probabilidades de sus salientes, y eso es una vista distinta del mismo
 *    `elements[flowId].probability`. Las duraciones se teclean en `run.baseTimeUnit` y se
 *    guardan en segundos (R1, R2), y `run.start` se compone de una fecha y un desfase (R8).
 *    El JSON crudo sigue estando, plegado al final: es la vista avanzada, no la principal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProcessIR } from '@lila-modeler/engine';
import { resolveExtends, resolveScenarioPath, type ScenarioReader, type ValidateScenarioOptions } from '@lila-modeler/engine/schema';

import { Problemas, Propiedades, unidadBase } from './Campo.js';
import {
  borrar,
  conBorrados,
  duplicarEscenario,
  esObjeto,
  escribir,
  esquemaDe,
  esquemaEntrada,
  leer,
  porRuta,
  problemasEscenario,
  type Contexto,
  type Problema,
  type Ruta,
} from './escenarioModelo.js';
import { atajoPorId, etiqueta, MAC } from './atajos.js';
import { PASO_IDS, type PasoId } from './ids.js';
import { ImportarExcel } from './ImportarExcel.js';
import { BotonElemento, type Rotulo } from './ListaElementos.js';
import { PasoCalendarios } from './PasoCalendarios.js';
import { FichaLlegada, ListaLlegadas } from './PasoLlegadas.js';
import { PasoEjecucion } from './PasoEjecucion.js';
import { ListaRutas, VistaCompuerta } from './PasoRutas.js';
import { ListaTiempos, ResumenTiempo } from './PasoTiempos.js';
import { agruparPorPaso, elementoDeProblema, tareasSinDuracion } from './pasoDeProblema.js';
import { PasoRecursos, ListaRecursos } from './PasoRecursos.js';
import { esEscenarioBase } from './RailEscenarios.js';
import { entradasHuerfanas, sinHuerfanas } from './simulationGate.js';
import { CAMPOS_DE_PASO, fieldsForStep, type ClaseElemento } from './scenarioFields.js';
import { useLocale, useStrings } from './i18n';

// The model, the controls and the element lists live in their own modules since the Lote M split;
// this module keeps exporting them so its importers (the shell, tests, `vistaRapida`) do not move.
export {
  borrar,
  conBorrados,
  duplicarEscenario,
  escribir,
  esquemaDe,
  esquemaEntrada,
  esquemaRaiz,
  etiquetaVariante,
  indiceVariante,
  leer,
  problemasEscenario,
  rutaTexto,
  valorVacio,
  variantes,
  type Contexto,
  type EsquemaJson,
  type Problema,
  type Ruta,
} from './escenarioModelo.js';
export { Campo } from './Campo.js';
export { resumenDistribucion, resumenRecursos } from './ListaElementos.js';

/* ------------------------------------------------------------------ *
 * #332: what is selected decides what is offered
 * ------------------------------------------------------------------ */

/** La clase del elemento seleccionado: el tipo de nodo del IR, o `'flow'` si es un flujo. */
export function claseDeElemento(ir: ProcessIR | null, id: string | null): ClaseElemento | null {
  if (ir === null || id === null) return null;
  if (ir.flows[id] !== undefined) return 'flow';
  return ir.nodes[id]?.type ?? null;
}

/* ------------------------------------------------------------------ *
 * #333 / Lote M: the six steps of the Simulate panel
 * ------------------------------------------------------------------ */

/**
 * Lote M: the problems that hold a step back — what its «! n» counts and its banner lists (only the
 * errors among them stop «▶ Simulate», see `bloqueantes`). Every error counts; of the warnings, only the XOR split that does not add up to
 * 100 % (the engine normalises it, the design asks for it to be fixed) and the panel's own «no
 * duration» check. The other warnings (`W-SIN-SEED`, an entry without parameters) stay in the
 * validation list and do not mark a step: the design never marks Arrivals or Run.
 */
export function bloquea(problema: Problema): boolean {
  return problema.severidad === 'error' || problema.codigo === 'W-XOR-NORMALIZADA' || problema.codigo === 'LILA-SIN-DURACION';
}

/**
 * The step bar (Lote M): six numbered tabs — Arrivals, Times, Routes, Resources, Calendars and
 * Run — each with «✓» or «! n», the problems that hold the step back.
 *
 * A `tablist` with a roving tabindex: Tab reaches the current step only, ←/→ (and Home/End) move
 * between steps and open them, Alt+1…6 open one from anywhere (handled by the panel). In the
 * detached window (`compacta`) only the current step shows its name and the others a bare «!»
 * when they have problems, the design's compact header.
 */
function BarraPasos({
  paso,
  onPaso,
  conteos,
  compacta,
}: {
  paso: PasoId;
  onPaso: (paso: PasoId, foco?: boolean) => void;
  conteos: Readonly<Record<PasoId, number>>;
  compacta: boolean;
}): React.JSX.Element {
  const S = useStrings();
  const indice = PASO_IDS.indexOf(paso);
  return (
    <div
      role="tablist"
      className="pasos"
      aria-label={S.escenario.pasos}
      onKeyDown={(e) => {
        let destino: number | null = null;
        if (e.key === 'ArrowRight') destino = (indice + 1) % PASO_IDS.length;
        else if (e.key === 'ArrowLeft') destino = (indice + PASO_IDS.length - 1) % PASO_IDS.length;
        else if (e.key === 'Home') destino = 0;
        else if (e.key === 'End') destino = PASO_IDS.length - 1;
        if (destino === null) return;
        e.preventDefault();
        onPaso(PASO_IDS[destino]!, true);
      }}
    >
      {PASO_IDS.map((p, i) => {
        const activo = p === paso;
        const n = conteos[p];
        const tecla = etiqueta(atajoPorId(`paso:${p}`), MAC);
        return (
          <button
            key={p}
            id={`sim-paso-${p}`}
            type="button"
            role="tab"
            className={['paso', activo ? 'activo' : '', n > 0 ? 'con-problemas' : ''].filter(Boolean).join(' ')}
            aria-selected={activo}
            aria-controls="sim-cuerpo"
            tabIndex={activo ? 0 : -1}
            data-paso={p}
            title={S.pasosSim.tabTitulo(S.pasosSim.titulos[p] ?? '', tecla)}
            onClick={() => {
              onPaso(p);
            }}
          >
            <span className="paso-num" aria-hidden="true">{i + 1}</span>
            {(!compacta || activo) && <span className="paso-nombre">{S.escenario.paso[p]}</span>}
            {compacta && !activo && <span className="sr-only">{S.escenario.paso[p]}</span>}
            {n > 0 ? (
              <span className="paso-problemas" aria-label={S.escenario.pasoProblemas(n)}>
                {compacta && !activo ? '!' : `! ${n}`}
              </span>
            ) : (
              !compacta && <span className="paso-ok" aria-label={S.pasosSim.sinProblemas}>✓</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Lote M: what a selected element reads in the selection header — the kind of BPMN element in the
 * properties catalog (`S.propiedades.tipos`), from the class of the IR.
 */
const TIPO_BPMN: Partial<Record<ClaseElemento, string>> = {
  task: 'bpmn:Task',
  start: 'bpmn:StartEvent',
  end: 'bpmn:EndEvent',
  terminate: 'bpmn:EndEvent',
  xor: 'bpmn:ExclusiveGateway',
  or: 'bpmn:InclusiveGateway',
  and: 'bpmn:ParallelGateway',
  eventGateway: 'bpmn:EventBasedGateway',
  timer: 'bpmn:IntermediateCatchEvent',
  flow: 'bpmn:SequenceFlow',
};

/** Which tip the «nothing here» note gives for a class (`S.pasosSim.consejos`). */
function consejoDe(clase: ClaseElemento | null): { clave: string; paso: PasoId | null } {
  switch (clase) {
    case 'task':
      return { clave: 'task', paso: 'times' };
    case 'start':
      return { clave: 'start', paso: 'arrivals' };
    case 'xor':
    case 'or':
      return { clave: 'gateway', paso: 'routes' };
    case 'flow':
      return { clave: 'flow', paso: 'routes' };
    case 'end':
    case 'terminate':
      return { clave: 'end', paso: null };
    default:
      return { clave: 'otro', paso: null };
  }
}

/** The nearest ancestor that scrolls: the docked panel (`.panel`) or the window's body. */
function desplazable(nodo: HTMLElement | null): HTMLElement | null {
  for (let n = nodo?.parentElement ?? null; n !== null; n = n.parentElement) {
    const estilo = n.ownerDocument.defaultView?.getComputedStyle(n);
    if (estilo !== undefined && /(auto|scroll)/.test(estilo.overflowY) && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * #332: la vista avanzada, que es el JSON crudo del archivo en edición
 * ------------------------------------------------------------------ */

/**
 * El delta del archivo (§ 6) en un `<textarea>`, plegado y al final del panel.
 *
 * El formulario es la vista principal desde este ticket, pero el JSON no desaparece: es lo que
 * permite pegar un escenario entero, moverlo entre máquinas o tocar algo que el formulario
 * todavía no dibuja. Se aplica de golpe con el botón, no al teclear: un JSON a medio escribir no
 * parsea y aplicarlo en cada tecla borraría el escenario entre dos llaves.
 */
function VistaJson({
  delta,
  onAplicar,
}: {
  delta: Record<string, unknown>;
  onAplicar: (escenario: Record<string, unknown>) => void;
}): React.JSX.Element {
  const S = useStrings();
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mostrado = texto ?? JSON.stringify(delta, null, 2);
  return (
    <details>
      <summary>{S.escenario.seccionJson}</summary>
      <textarea
        className="json-escenario"
        aria-label={S.escenario.seccionJson}
        rows={16}
        value={mostrado}
        onChange={(e) => {
          setTexto(e.target.value);
          setError(null);
        }}
      />
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="boton"
        onClick={() => {
          let leido: unknown;
          try {
            leido = JSON.parse(mostrado);
          } catch (e) {
            setError(S.escenario.jsonInvalido(e instanceof Error ? e.message : String(e)));
            return;
          }
          if (!esObjeto(leido)) {
            setError(S.escenario.jsonNoEsObjeto);
            return;
          }
          setError(null);
          setTexto(null);
          onAplicar(leido);
        }}
      >
        {S.escenario.aplicarJson}
      </button>
    </details>
  );
}

/* ------------------------------------------------------------------ *
 * El panel
 * ------------------------------------------------------------------ */

export interface ScenarioPanelProps {
  /** Nombre de archivo del escenario en edición; es la clave que resuelve `extends`. */
  archivo: string;
  /** Escenarios disponibles por nombre de archivo, **sin resolver**. Incluye el que se edita. */
  escenarios: Readonly<Record<string, Record<string, unknown>>>;
  /** Cada cambio del panel, ya aplicado al delta del archivo en edición. */
  onCambio: (archivo: string, escenario: Record<string, unknown>) => void;
  /** «Guardar»: lo escribe el shell con `ProjectStore.putScenario`. Nunca se deshabilita. */
  onGuardar: () => void;
  /** «Duplicar»: el shell registra el nuevo archivo y lo selecciona. */
  onDuplicar: (archivo: string, escenario: Record<string, unknown>) => void;
  /** IR del diagrama del lienzo. `null` mientras no se haya parseado: solo se valida el esquema. */
  ir: ProcessIR | null;
  /** #546: the ids of the file's other processes, from the same reparse as `ir`. */
  otrosProcesos?: ValidateScenarioOptions['elsewhere'];
  /**
   * Problems of the model rather than of the scenario (#455: the live `E-NOSOP`), appended to the
   * lint so the header and the list count what the canvas chips count.
   */
  problemasExtra?: readonly Problema[];
  /** Names the IR does not have (unsupported elements, #455), read from the canvas. */
  nombresExtra?: Readonly<Record<string, string>>;
  /** Id del elemento seleccionado en el lienzo, o `null`. */
  seleccion: string | null;
  onSeleccionar: (id: string | null) => void;
  /** Settings → «Advanced» (#447): show BPMN ids next to names. */
  avanzado?: boolean;
  /** Drawn inside the detached window (design 2c): Duplicate and Save move to a footer. */
  enVentana?: boolean;
  /**
   * #396: a step asked for from outside the panel — the «Edit in …» link of the properties
   * panel's quick view. The panel opens it and calls `onPasoAtendido`, and the shell clears the
   * request: it is consumed once, so a later remount (detaching, switching tabs) opens on the
   * first step as before instead of on a stale ask. The step stays the panel's own state.
   */
  pasoPedido?: PasoId | null;
  onPasoAtendido?: () => void;
  /**
   * Lote M: «▶ Simulate» of the panel (and of the shell's top bar, through `irAlProblema`). The
   * panel calls it only when no step is held back by a problem; otherwise it takes the person to
   * the first problem — its step, its element selected, the step's banner — and says why.
   */
  onSimular?: () => void;
  /** Lote M: the number of problems that hold the run back, for the shell's «▶ Simulate» badge. */
  onConteoProblemas?: (n: number) => void;
  /**
   * Lote M: a request from the shell to go to the first problem (its «▶ Simulate» or ⌘↩ with
   * problems pending). A new number is a new request; `null` asks for nothing. Like `pasoPedido`,
   * the panel acts once per value.
   */
  irAlProblema?: number | null;
  /** Called once the panel has acted on `irAlProblema`, so the shell clears it (like `onPasoAtendido`). */
  onProblemaAtendido?: () => void;
}

/** Default of `problemasExtra`, one array for every render so the memo below keeps its cache. */
const SIN_PROBLEMAS: readonly Problema[] = [];
const SIN_NOMBRES: Readonly<Record<string, string>> = {};

export function ScenarioPanel({
  archivo,
  escenarios,
  onCambio,
  onGuardar,
  onDuplicar,
  ir,
  otrosProcesos,
  problemasExtra = SIN_PROBLEMAS,
  nombresExtra = SIN_NOMBRES,
  seleccion,
  onSeleccionar,
  avanzado = false,
  enVentana = false,
  pasoPedido = null,
  onPasoAtendido,
  onSimular,
  onConteoProblemas,
  irAlProblema = null,
  onProblemaAtendido,
}: ScenarioPanelProps): React.JSX.Element {
  const S = useStrings();
  /**
   * #333: the step being filled in. It lives here and not in the shell because it is a view of
   * this panel and of nothing else, and because keeping it here is what makes it survive picking
   * an element on the canvas and a whole run finishing: both of them only re-render the panel.
   */
  const [paso, setPaso] = useState<PasoId>('times');
  useEffect(() => {
    if (pasoPedido === null) return;
    setPaso(pasoPedido);
    onPasoAtendido?.();
  }, [pasoPedido, onPasoAtendido]);
  // The engine takes the language as a value, not as a catalog: `useLocale()` is what makes the
  // memoised lint below recompute when the app switches language.
  const locale = useLocale();
  const delta = escenarios[archivo] ?? {};

  const lector = useMemo<ScenarioReader>(
    () => (ruta) => {
      const encontrado = escenarios[ruta];
      if (encontrado === undefined) throw new Error(S.escenario.errorEscenarioDesconocido(ruta));
      return encontrado;
    },
    // `S` va en las dependencias porque el lector lo captura (LILA-210): `herencia` guarda el
    // mensaje que este lector lanzó, así que sin esto un `extends` roto se quedaría con el error
    // escrito en el idioma que hubiera al montar el panel. `useStrings()` devuelve un catálogo
    // distinto por idioma, así que la identidad solo cambia cuando el idioma cambia.
    [escenarios, S],
  );

  /**
   * Lo que se enseña: el escenario con `extends` ya aplicado (§ 6), y el fallo de la cadena si
   * la hay. Con la cadena rota (un padre que no existe, un ciclo) se sigue editando el archivo
   * tal cual —dejar el panel en blanco sería la única forma de no poder arreglarlo— pero el
   * fallo **se dice**: todo lo que la cabecera marca sobre un delta sin resolver (falta `run`,
   * falta `model`, elementos sin parámetros) es consecuencia de él y no de lo que se tecleó.
   */
  const herencia = useMemo<{ resuelto: Record<string, unknown>; error: string | null }>(() => {
    try {
      return { resuelto: resolveExtends(archivo, lector), error: null };
    } catch (e) {
      return { resuelto: delta, error: e instanceof Error ? e.message : String(e) };
    }
  }, [archivo, lector, delta]);
  const resuelto = herencia.resuelto;

  /** El padre resuelto, para saber si borrar un campo es `null` (§ 6) o quitarlo del hijo. */
  const padre = useMemo<Record<string, unknown> | null>(() => {
    const referencia = delta['extends'];
    if (typeof referencia !== 'string') return null;
    try {
      return resolveExtends(resolveScenarioPath(archivo, referencia), lector);
    } catch {
      return null;
    }
  }, [archivo, delta, lector]);

  const problemas = useMemo(() => {
    const propios = [...problemasEscenario(resuelto, ir, locale, otrosProcesos), ...problemasExtra];
    if (herencia.error === null) return propios;
    return [
      { ruta: 'extends', mensaje: herencia.error, severidad: 'error' as const },
      ...propios,
    ];
    // `locale` is a dependency because the messages cached here are the engine's: without it the
    // list would keep the language it was linted in until the scenario or the IR changed.
  }, [resuelto, ir, otrosProcesos, herencia.error, locale, problemasExtra]);
  const indice = useMemo(() => porRuta(problemas), [problemas]);
  /**
   * Lote M: the panel's own «no duration» check (`tareasSinDuracion`), on the task's
   * `processingTime` so it lands in Times next to the field that fixes it. It is kept out of
   * `problemas` (the header count and the validation list stay the engine's) and only feeds the
   * step markers and the banner.
   */
  const sinDuracion = useMemo<Problema[]>(
    () =>
      tareasSinDuracion(resuelto, ir).map((id) => {
        const nombre = ir?.nodes[id]?.name;
        return {
          ruta: `elements.${id}.processingTime`,
          mensaje: S.escenario.sinDuracion(nombre !== undefined && nombre.trim() !== '' ? nombre : id),
          severidad: 'warning' as const,
          codigo: 'LILA-SIN-DURACION',
        };
      }),
    [resuelto, ir, S],
  );
  /** Lote M: the problems that hold each step back (see `bloquea`), for the «! n» of the bar. */
  const porPaso = useMemo(
    () => agruparPorPaso([...problemas, ...sinDuracion].filter(bloquea), ir),
    [problemas, sinDuracion, ir],
  );
  const conteos = useMemo(
    () => Object.fromEntries(PASO_IDS.map((p) => [p, porPaso.porPaso[p].length])) as Record<PasoId, number>,
    [porPaso],
  );
  const errores = problemas.filter((p) => p.severidad === 'error').length;
  const avisos = problemas.length - errores;

  /** Primer segmento numérico: a partir de ahí el delta guarda el array entero (§ 6). */
  function baseDeArray(ruta: Ruta): number {
    return ruta.findIndex((seg) => typeof seg === 'number');
  }

  const ctx: Contexto = {
    resuelto,
    problemas: indice,
    delta,
    padre,
    ir,
    restaurar(ruta) {
      // Deshace el `null` propio del reservado eliminado: se quita del hijo, no se reescribe.
      onCambio(archivo, borrar(delta, ruta));
    },
    editar(ruta, valor) {
      const corte = baseDeArray(ruta);
      if (corte === -1) {
        // § 6: lo que el padre define y el valor nuevo no trae hay que borrarlo con `null`, o el
        // merge profundo lo deja pegado (cambiar de variante de distribución, sobre todo).
        onCambio(archivo, escribir(delta, ruta, conBorrados(valor, leer(padre, ruta))));
        return;
      }
      const base = ruta.slice(0, corte);
      const arreglo = escribir(leer(resuelto, base), ruta.slice(corte), valor);
      onCambio(archivo, escribir(delta, base, arreglo));
    },
    editarVarios(cambios) {
      let siguiente = delta;
      for (const { ruta, valor } of cambios) siguiente = escribir(siguiente, ruta, valor);
      onCambio(archivo, siguiente);
    },
    // Lote M (C3): renaming a calendar follows it into the scenarios that extend this one.
    archivo,
    escenarios,
    editarArchivo(otro, escenario) {
      onCambio(otro, escenario);
    },
    quitar(ruta) {
      const corte = baseDeArray(ruta);
      if (corte !== -1) {
        const base = ruta.slice(0, corte);
        const arreglo = borrar(leer(resuelto, base), ruta.slice(corte));
        onCambio(archivo, escribir(delta, base, arreglo));
        return;
      }
      // § 6: `null` borra una clave que el padre define; lo que solo estaba en el hijo se quita.
      if (padre !== null && leer(padre, ruta) !== undefined) {
        onCambio(archivo, escribir(delta, ruta, null));
        return;
      }
      onCambio(archivo, borrar(delta, ruta));
    },
  };

  /**
   * El id con el que se edita: el del **IR**, que es la clave del escenario (R3). bpmn-js
   * selecciona con el id que traía el archivo, y para un id no-NCName —los que emite Bizagi— el
   * IR lo saneó (`source.originalIds`, el mismo mapa que usa el overlay de LILA-064). Sin
   * traducirlo, el panel escribía `elements["1Task"]` y el lint lo rechazaba con "no existe en
   * el modelo", sin ninguna forma de llegar al id bueno desde el lienzo.
   */
  const idSeleccionado = useMemo<string | null>(() => {
    if (seleccion === null || ir === null) return seleccion;
    if (ir.nodes[seleccion] !== undefined || ir.flows[seleccion] !== undefined) return seleccion;
    const enIr = Object.entries(ir.source.originalIds).find(([, original]) => original === seleccion);
    return enIr?.[0] ?? seleccion;
  }, [seleccion, ir]);

  /** Qué es lo seleccionado (#332): decide qué campos se ofrecen y si sale la vista de compuerta. */
  const clase = claseDeElemento(ir, idSeleccionado);

  const heredaDe = typeof delta['extends'] === 'string' ? delta['extends'] : null;

  /**
   * El nombre BPMN del id, si el IR lo trae y no está vacío: `ir.nodes`/`ir.flows` ya lo dan sin
   * pedir nada nuevo a A (OP-13 conecta el `ir` vigente, este panel solo lo lee). `null` sin IR o
   * con un id que no aparece en él (el diagrama no se ha parseado, o el elemento ya no existe).
   *
   * The id is still the only key the rest of the panel understands; since #447 the name is what
   * the person reads and the id goes to the button's `data-id` (see `rotulo`).
   */
  function nombreElemento(id: string): string | null {
    const nombre = ir?.nodes[id]?.name ?? ir?.flows[id]?.name ?? nombresExtra[id];
    return nombre !== undefined && nombre.trim() !== '' ? nombre : null;
  }

  /** #447: the name, or the id without one; with «Advanced», the id as well. */
  function rotulo(id: string): Rotulo {
    const nombre = nombreElemento(id);
    if (nombre === null) return { principal: id };
    return avanzado ? { principal: nombre, id } : { principal: nombre };
  }

  /** The ids of the IR whose node type is one of `tipos`, in the order the diagram declares. */
  function idsPorTipo(tipos: readonly ClaseElemento[]): readonly string[] {
    if (ir === null) return [];
    return Object.entries(ir.nodes)
      .filter(([, nodo]) => tipos.includes(nodo.type as ClaseElemento))
      .map(([id]) => id);
  }

  const unidad = unidadBase(ctx);
  /** What every step's element list reads besides its ids (see `PropsListaPaso`). */
  const lista = { rotulo, resuelto, unidad, seleccion: idSeleccionado, onSeleccionar };
  /** #430: orphan entries of the whole project, since Run resolves any of its scenarios. */
  const huerfanas = useMemo(() => (ir === null ? [] : entradasHuerfanas(escenarios, ir)), [escenarios, ir]);

  /** Lote M: the problems that mark a step («! n»), in step order, then the ones no step owns. */
  const marcados = useMemo(
    () => [...PASO_IDS.flatMap((p) => porPaso.porPaso[p]), ...porPaso.sinPaso],
    [porPaso],
  );
  /**
   * What actually stops «▶ Simulate»: the errors only (E-*), which the engine refuses to run
   * anyway. Warnings (no duration, an XOR split that is normalised) still mark their step and
   * show in the banner, but the run goes ahead as it always did: the same scenario must give the
   * same results before and after Lote M, and the gallery examples run on the first click.
   */
  const bloqueantes = useMemo(() => marcados.filter((p) => p.severidad === 'error'), [marcados]);
  /** «Cannot simulate…»: said once after «▶ Simulate» with problems, cleared by the next click. */
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (bloqueantes.length === 0) setAviso(null);
  }, [bloqueantes.length]);

  const raizRef = useRef<HTMLDivElement>(null);
  const cabeceraRef = useRef<HTMLDivElement>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);

  /**
   * Opens `p`. `foco` moves the keyboard focus to its tab (arrow keys and Alt+n): the roving
   * tabindex has to follow the step or Tab would land on the old one.
   */
  function irAPaso(p: PasoId, foco = false): void {
    setPaso(p);
    if (foco) {
      // After the render that gives the new tab its `tabIndex=0`.
      queueMicrotask(() => raizRef.current?.querySelector<HTMLElement>(`[data-paso="${p}"]`)?.focus());
    }
  }

  /** Jumps to a problem: its step, its element selected (or nothing selected), the banner shown. */
  function irAProblema(problema: Problema): void {
    const destino = pasoDeProblemaPanel(problema.ruta);
    if (destino !== null) setPaso(destino);
    onSeleccionar(elementoDeProblema(problema.ruta, ir));
  }
  function pasoDeProblemaPanel(ruta: string): PasoId | null {
    for (const p of PASO_IDS) if (porPaso.porPaso[p].some((x) => x.ruta === ruta)) return p;
    return null;
  }

  /** «▶ Simulate»: runs when nothing holds it back, else goes to the first problem and says why. */
  function simular(): void {
    const primero = bloqueantes[0];
    if (primero === undefined) {
      setAviso(null);
      onSimular?.();
      return;
    }
    setAviso(S.pasosSim.noSePuede(bloqueantes.length));
    irAProblema(primero);
  }

  const conteoRef = useRef(onConteoProblemas);
  conteoRef.current = onConteoProblemas;
  useEffect(() => {
    conteoRef.current?.(bloqueantes.length);
  }, [bloqueantes.length]);

  // The shell's request to go to the first problem (its own «▶ Simulate», ⌘↩): once per value, and
  // acknowledged with `onProblemaAtendido` so the shell clears it. Without the acknowledgement a
  // remount (docking or detaching the panel) would see the same value again and simulate twice.
  const simularRef = useRef(simular);
  simularRef.current = simular;
  const atendidoRef = useRef(onProblemaAtendido);
  atendidoRef.current = onProblemaAtendido;
  useEffect(() => {
    if (irAlProblema === null) return;
    simularRef.current();
    atendidoRef.current?.();
  }, [irAlProblema]);

  /**
   * Alt+1…6 open a step and Esc clears the selection, on the panel's own document: the docked
   * panel listens on the app's, the detached one on its window's, so both work wherever the panel
   * is. `App.tsx` never dispatches Alt+1…6 (they are `panel` entries of `atajos.ts`) and handles Esc
   * first while a run is in flight (it cancels the run and marks the event handled), so the two
   * never fight over a key. Neither key acts inside a field, a label being edited or an open dialog.
   */
  const teclasRef = useRef({ irAPaso, seleccion: idSeleccionado, onSeleccionar });
  teclasRef.current = { irAPaso, seleccion: idSeleccionado, onSeleccionar };
  useEffect(() => {
    const doc = raizRef.current?.ownerDocument;
    if (doc === undefined) return;
    const alPulsar = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;
      // A field, a label being edited or a dialog keeps its keys: on macOS ⌥2/⌥3 type «@»/«#»
      // on a Spanish layout, and Esc there belongs to the field (QA of #600).
      const objetivo = e.target as Element | null;
      if (objetivo?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], dialog, .djs-direct-editing-parent') != null) return;
      if (doc.querySelector('dialog[open]') !== null) return;
      const digito = /^Digit([1-6])$/.exec(e.code);
      if (digito !== null && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (e.repeat) return;
        teclasRef.current.irAPaso(PASO_IDS[Number(digito[1]) - 1]!, true);
        return;
      }
      if (e.key !== 'Escape' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (teclasRef.current.seleccion === null) return;
      teclasRef.current.onSeleccionar(null);
    };
    doc.addEventListener('keydown', alPulsar);
    return () => {
      doc.removeEventListener('keydown', alPulsar);
    };
  }, []);

  /**
   * After a step change or a new selection, the top of the step goes back under the fixed header:
   * staying where the previous step left the scroll is what sent people hunting (baseline, step 2).
   */
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    const cuerpo = cuerpoRef.current;
    const cabecera = cabeceraRef.current;
    if (cuerpo === null || cabecera === null) return;
    const contenedor = desplazable(cuerpo);
    if (contenedor === null) return;
    const hueco = cuerpo.getBoundingClientRect().top - cabecera.getBoundingClientRect().bottom;
    if (hueco < 0) contenedor.scrollTop += hueco;
  }, [paso, idSeleccionado]);

  const guardarBoton = (
    <button type="button" className={enVentana ? 'boton primario' : 'boton'} onClick={onGuardar}>
      {S.escenario.guardar}
    </button>
  );
  const duplicarBoton = (
    <button
      type="button"
      className="boton"
      onClick={() => {
        const copia = duplicarEscenario(archivo, delta, Object.keys(escenarios));
        onDuplicar(copia.archivo, copia.escenario);
      }}
    >
      {S.escenario.duplicar}
    </button>
  );

  const elementos = esObjeto(resuelto['elements']) ? resuelto['elements'] : {};
  const nombreEscenario = typeof resuelto['name'] === 'string' ? resuelto['name'] : archivo;
  const indicePaso = PASO_IDS.indexOf(paso);
  const anterior = PASO_IDS[indicePaso - 1];
  const siguiente = PASO_IDS[indicePaso + 1];
  const delPaso = porPaso.porPaso[paso];
  const tareas = new Set(idsPorTipo(['task']));
  const atajoSimular = etiqueta(atajoPorId('ejecutar'), MAC);
  const pista = `${etiqueta(atajoPorId('paso:arrivals'), MAC).replace(/1$/, '1…6')} · ${atajoSimular}`;

  /* --- What the step shows for the selected element (Lote M: only this step's parameters). --- */
  const visibles = idSeleccionado === null ? [] : fieldsForStep(paso, clase);
  const definidos = idSeleccionado === null ? [] : CAMPOS_DE_PASO[paso].filter((campo) => leer(resuelto, ['elements', idSeleccionado, campo]) !== undefined);
  const esCompuerta = clase === 'xor' || clase === 'or';
  /** Whether the selected element has anything to set in this step; if not, the panel says where. */
  const tieneAlgo =
    idSeleccionado !== null &&
    (paso === 'run' ||
      (paso === 'routes' && esCompuerta && ir !== null) ||
      visibles.some((campo) => !['priority', 'preempt', 'batch', 'conditions'].includes(campo)) ||
      definidos.length > 0);
  const nombreSeleccion = idSeleccionado === null ? '' : rotulo(idSeleccionado).principal;
  const tipoSeleccion =
    clase === null ? '' : (S.propiedades.tipos[TIPO_BPMN[clase] ?? ''] ?? TIPO_BPMN[clase]?.replace('bpmn:', '') ?? clase);
  const consejo = consejoDe(clase);

  const inicios = idsPorTipo(['start']);

  /** The step's content without a selection: its overview (lists, pools, calendars, the run). */
  function vistaGeneral(): React.JSX.Element | null {
    switch (paso) {
      case 'arrivals':
        if (inicios.length === 1 && ir !== null) {
          return <FichaLlegada id={inicios[0]!} nombre={rotulo(inicios[0]!).principal} ctx={ctx} />;
        }
        return <ListaLlegadas ids={inicios} {...lista} />;
      case 'times':
        return <ListaTiempos ids={idsPorTipo(['task', 'timer'])} tareas={tareas} {...lista} />;
      case 'routes':
        return <ListaRutas ids={idsPorTipo(['xor', 'or'])} ir={ir} {...lista} />;
      case 'resources':
        return (
          <>
            <PasoRecursos ctx={ctx} ir={ir} avanzado={avanzado} />
            <ListaRecursos ids={idsPorTipo(['task'])} {...lista} />
          </>
        );
      case 'calendars':
        return <PasoCalendarios ctx={ctx} onIrARecursos={() => { irAPaso('resources'); }} />;
      case 'run':
        return <PasoEjecucion ctx={ctx} />;
    }
  }

  /** The selected element in this step: its fields of the step, or where it is set instead. */
  function vistaSeleccion(id: string): React.JSX.Element {
    if (paso === 'run') return <PasoEjecucion ctx={ctx} />;
    if (!tieneAlgo) {
      return (
        <div className="sim-nota">
          <p>
            {S.pasosSim.nada(tipoSeleccion, S.escenario.paso[paso] ?? paso)}{' '}
            {S.pasosSim.consejos[consejo.clave]}
          </p>
          {consejo.paso !== null && consejo.paso !== paso && (
            <button type="button" className="boton" onClick={() => { irAPaso(consejo.paso!); }}>
              {S.pasosSim.irA(S.escenario.paso[consejo.paso] ?? consejo.paso)}
            </button>
          )}
        </div>
      );
    }
    if (paso === 'arrivals' && clase === 'start') {
      return <FichaLlegada id={id} nombre={nombreSeleccion} ctx={ctx} />;
    }
    return (
      <>
        <Propiedades
          esquema={esquemaEntrada(esquemaDe('elements'))}
          ruta={['elements', id]}
          ctx={ctx}
          visibles={visibles}
          siDefinido={CAMPOS_DE_PASO[paso]}
        />
        <Problemas ruta={['elements', id]} ctx={ctx} />
        {paso === 'times' && (clase === 'task' || clase === 'timer') && (
          <ResumenTiempo id={id} esTarea={clase === 'task'} ctx={ctx} unidad={unidad} />
        )}
        {/* The gateway is where the branching is parameterised, and branching is what the
            Routes step is about: its outgoing flows have to add up. */}
        {paso === 'routes' && ir !== null && esCompuerta && (
          <VistaCompuerta ir={ir} id={id} clase={clase} ctx={ctx} avanzado={avanzado} />
        )}
      </>
    );
  }

  return (
    <div ref={raizRef} className={enVentana ? 'escenario sim-panel compacto' : 'escenario sim-panel'}>
      {/* Lote M: the header stays put while the step scrolls under it (`position: sticky`), at
          any panel width: the scenario, «▶ Simulate» and the six steps are always one click away. */}
      <div ref={cabeceraRef} className="sim-cabecera">
        <div className="escenario-cabecera">
          <strong className="sim-escenario" title={nombreEscenario}>
            {enVentana ? nombreEscenario : S.escenario.titulo(nombreEscenario)}
          </strong>
          {esEscenarioBase(delta) && <span className="insignia-base">{S.rail.base}</span>}
          <span className={errores > 0 ? 'error sim-conteo' : 'aviso sim-conteo'}>
            {S.escenario.conteo(errores, avisos)}
          </span>
          {!enVentana && guardarBoton}
          {!enVentana && duplicarBoton}
          <button
            type="button"
            className="boton primario sim-simular"
            title={`${S.pasosSim.simular} (${atajoSimular})`}
            onClick={simular}
          >
            <span aria-hidden="true">▶ </span>
            {S.pasosSim.simular}
            {bloqueantes.length > 0 && (
              <span className="sim-insignia" aria-label={S.pasosSim.insignia(bloqueantes.length)}>
                {bloqueantes.length}
              </span>
            )}
          </button>
        </div>
        <BarraPasos paso={paso} onPaso={irAPaso} conteos={conteos} compacta={enVentana} />
        {!enVentana && <p className="sim-pista mono">{pista}</p>}
      </div>

      <div ref={cuerpoRef} id="sim-cuerpo" role="tabpanel" aria-labelledby={`sim-paso-${paso}`} className="sim-cuerpo">
        <p className="escenario-archivo">{S.escenario.archivoHereda(archivo, heredaDe)}</p>
        <Problemas ruta={['extends']} ctx={ctx} />

        {huerfanas.length > 0 && ir !== null && (
          <div className="lista-paso huerfanas">
            <p className="etiqueta">{S.escenario.huerfanas}</p>
            <ul className="ids">
              {huerfanas.map((id) => <li key={id} className="mono">{id}</li>)}
            </ul>
            <button
              type="button"
              className="boton"
              onClick={() => {
                for (const [otro, escenario] of Object.entries(sinHuerfanas(escenarios, ir))) onCambio(otro, escenario);
              }}
            >
              {S.escenario.quitarHuerfanas}
            </button>
          </div>
        )}

        <div className="sim-paso-cabeza">
          <p className="sim-paso-n">{S.pasosSim.pasoDe(indicePaso + 1, PASO_IDS.length, nombreEscenario)}</p>
          <h3 className="sim-paso-titulo">{S.pasosSim.titulos[paso]}</h3>
          <p className="ayuda">{S.escenario.pasoAyuda[paso]}</p>
        </div>

        {aviso !== null && (
          <p role="status" className="sim-aviso">{aviso}</p>
        )}

        {delPaso.length > 0 && (
          <section className="sim-banner" aria-label={delPaso.length === 1 ? S.pasosSim.bannerUno : S.pasosSim.bannerVarios(delPaso.length)}>
            <p className="sim-banner-titulo">
              {delPaso.length === 1 ? S.pasosSim.bannerUno : S.pasosSim.bannerVarios(delPaso.length)}
            </p>
            <ul>
              {delPaso.map((problema, i) => (
                <li key={`${problema.ruta}-${i}`}>
                  <span>{problema.mensaje}</span>
                  <button type="button" className="boton" onClick={() => { irAProblema(problema); }}>
                    {S.pasosSim.ir}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {idSeleccionado !== null && paso !== 'run' ? (
          <details open className="sim-elemento">
            <summary>{S.escenario.seccionElemento}</summary>
            <p className="vacio">
              {nombreSeleccion}
              {rotulo(idSeleccionado).id !== undefined && (
                <span className="id mono">{S.escenario.nombreEntreParentesis(idSeleccionado)}</span>
              )}
            </p>
            <div className="sim-seleccion">
              <span className="sim-seleccion-tipo">{S.pasosSim.soloEstePaso(tipoSeleccion)}</span>
              <button
                type="button"
                className="boton"
                title={S.pasosSim.verTodoTitulo}
                onClick={() => { onSeleccionar(null); }}
              >
                {S.pasosSim.verTodo}
              </button>
            </div>
            {vistaSeleccion(idSeleccionado)}
          </details>
        ) : (
          // Nothing selected (or Run, which has no element fields): the step's overview, without
          // the «Selected element» heading around it.
          <div className="sim-elemento sim-general">
            {idSeleccionado === null ? vistaGeneral() : vistaSeleccion(idSeleccionado)}
            {/* Every entry the scenario already has, whatever the step: a flow or an element that
                is hard to click on the canvas is still one click away (#447 rows). */}
            {idSeleccionado === null && Object.keys(elementos).length > 0 && (
              <details className="sim-entradas">
                <summary>{S.pasosSim.entradas(Object.keys(elementos).length)}</summary>
                <ul className="ids">
                  {Object.keys(elementos).map((id) => (
                    <li key={id}>
                      <BotonElemento id={id} rotulo={rotulo(id)} onSeleccionar={onSeleccionar} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <nav className="sim-navegacion" aria-label={S.escenario.pasos}>
          {anterior !== undefined && (
            <button type="button" className="boton" onClick={() => { irAPaso(anterior); }}>
              {S.pasosSim.anterior(S.escenario.paso[anterior] ?? anterior)}
            </button>
          )}
          <span className="sim-hueco" />
          {siguiente !== undefined ? (
            <button type="button" className="boton sim-siguiente" onClick={() => { irAPaso(siguiente); }}>
              {S.pasosSim.siguiente(S.escenario.paso[siguiente] ?? siguiente)}
            </button>
          ) : (
            <button type="button" className="boton primario" onClick={simular}>
              <span aria-hidden="true">▶ </span>
              {S.pasosSim.simular}
            </button>
          )}
        </nav>

        {/* Problems no step owns (a broken `extends`, `model`, an entry for an element the diagram
            does not have): they hold the run back too, so they are listed here, always open. */}
        {porPaso.sinPaso.length > 0 && (
          <section className="sim-banner sim-sinpaso" aria-label={S.pasosSim.sinPaso}>
            <p className="sim-banner-titulo">{S.pasosSim.sinPaso}</p>
            <ul>
              {porPaso.sinPaso.map((problema, i) => (
                <li key={`${problema.ruta}-${i}`}>
                  <span>{problema.mensaje}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ImportarExcel key={archivo} archivo={archivo} resuelto={resuelto} delta={delta} padre={padre} ir={ir} onCambio={onCambio} />

        <VistaJson
          delta={delta}
          onAplicar={(escenario) => {
            onCambio(archivo, escenario);
          }}
        />

        {/* The validation list is live in **every** step: a resource you break in Resources has to
            be told there, and `docs/COMING-FROM-BIZAGI.md` promises exactly this. */}
        {problemas.length > 0 && (
          <details>
            <summary>{S.escenario.seccionValidacion(errores)}</summary>
            <ul className="ids">
              {problemas.map((problema, i) => (
                <li key={i} className={problema.severidad === 'error' ? 'error' : 'aviso'}>
                  {problema.mensaje}
                </li>
              ))}
            </ul>
          </details>
        )}

        {enVentana && (
          <footer className="escenario-pie">
            <span>{S.escenario.pieVentana}</span>
            {/* Duplicate, then Save: the order they are painted in is the order Tab visits. */}
            {duplicarBoton}
            {guardarBoton}
          </footer>
        )}
      </div>
    </div>
  );
}
