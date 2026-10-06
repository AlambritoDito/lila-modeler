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
import { useEffect, useMemo, useState } from 'react';

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
import { PASO_IDS, type PasoId } from './ids.js';
import { ImportarExcel } from './ImportarExcel.js';
import { BotonElemento, type Rotulo } from './ListaElementos.js';
import { PasoCalendarios } from './PasoCalendarios.js';
import { PasoLlegadas, ListaLlegadas } from './PasoLlegadas.js';
import { PasoParametros, ListaParametros, VistaCompuerta } from './PasoParametros.js';
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
 * #333: the four steps of the Simulate panel
 * ------------------------------------------------------------------ */

/**
 * The step bar: Parameters, Resources, Calendars and Arrivals (#396), in order, as the only
 * navigation of the panel.
 *
 * They are buttons and not tabs on purpose — a step is a filter over one document, not a
 * different document — and each carries `aria-pressed` (this one is the one chosen) plus
 * `aria-current="step"` (this one is where you are in the sequence), which is what a screen
 * reader needs to announce "step 3 of 4, pressed".
 *
 * ponytail: there are exactly four, with no "All" that shows every section at once. The ceiling
 * is someone who knew the old single list and wants it back; the upgrade path is a fifth id in
 * `PASO_IDS` whose `fieldsForStep` is the union of the four, which is a dozen lines the day
 * anybody actually asks for it.
 */
function BarraPasos({
  paso,
  onPaso,
}: {
  paso: PasoId;
  onPaso: (paso: PasoId) => void;
}): React.JSX.Element {
  const S = useStrings();
  return (
    <>
      <nav className="pasos" aria-label={S.escenario.pasos}>
        {PASO_IDS.map((p) => (
          <button
            key={p}
            type="button"
            className={p === paso ? 'paso activo' : 'paso'}
            aria-pressed={p === paso}
            aria-current={p === paso ? 'step' : undefined}
            onClick={() => {
              onPaso(p);
            }}
          >
            {S.escenario.paso[p]}
          </button>
        ))}
      </nav>
      <p className="ayuda">{S.escenario.pasoAyuda[paso]}</p>
    </>
  );
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
}: ScenarioPanelProps): React.JSX.Element {
  const S = useStrings();
  /**
   * #333: the step being filled in. It lives here and not in the shell because it is a view of
   * this panel and of nothing else, and because keeping it here is what makes it survive picking
   * an element on the canvas and a whole run finishing: both of them only re-render the panel.
   */
  const [paso, setPaso] = useState<PasoId>('parameters');
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

  const elementos = esObjeto(resuelto['elements']) ? resuelto['elements'] : {};
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

  return (
    <div className="escenario">
      <div className="escenario-cabecera">
        <strong>{S.escenario.titulo(typeof resuelto['name'] === 'string' ? resuelto['name'] : archivo)}</strong>
        {esEscenarioBase(delta) && <span className="insignia-base">{S.rail.base}</span>}
        <span className={errores > 0 ? 'error' : 'aviso'}>
          {S.escenario.conteo(errores, avisos)}
        </span>
        {!enVentana && guardarBoton}
        {!enVentana && duplicarBoton}
      </div>

      <p className="escenario-archivo">{S.escenario.archivoHereda(archivo, heredaDe)}</p>
      <Problemas ruta={['extends']} ctx={ctx} />

      <ImportarExcel key={archivo} archivo={archivo} resuelto={resuelto} delta={delta} padre={padre} ir={ir} onCambio={onCambio} />

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

      <BarraPasos paso={paso} onPaso={setPaso} />

      {/* Each step is its own component (Lote M): the section it owns goes here, and what it adds
          to the element section goes in the lists below. */}
      {paso === 'parameters' && <PasoParametros ctx={ctx} />}
      {paso === 'calendars' && (
        <PasoCalendarios ctx={ctx} onIrARecursos={() => { setPaso('resources'); }} />
      )}
      {paso === 'resources' && <PasoRecursos ctx={ctx} ir={ir} avanzado={avanzado} />}
      {paso === 'arrivals' && <PasoLlegadas />}

      <details open>
        <summary>{S.escenario.seccionElemento}</summary>
        {idSeleccionado === null ? (
          <ul className="ids">
            {Object.keys(elementos).map((id) => (
              <li key={id}>
                <BotonElemento id={id} rotulo={rotulo(id)} onSeleccionar={onSeleccionar} />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="vacio">
              {rotulo(idSeleccionado).principal}
              {rotulo(idSeleccionado).id !== undefined && (
                <span className="id mono">{S.escenario.nombreEntreParentesis(idSeleccionado)}</span>
              )}
            </p>
            <Propiedades
              esquema={esquemaEntrada(esquemaDe('elements'))}
              ruta={['elements', idSeleccionado]}
              ctx={ctx}
              visibles={fieldsForStep(paso, clase)}
              siDefinido={CAMPOS_DE_PASO[paso]}
            />
            <Problemas ruta={['elements', idSeleccionado]} ctx={ctx} />
            {/* The gateway is where the branching is parameterised, and branching is a
                Parameters question: its outgoing flows have to add up. */}
            {paso === 'parameters' && ir !== null && (clase === 'xor' || clase === 'or') && (
              <VistaCompuerta ir={ir} id={idSeleccionado} clase={clase} ctx={ctx} avanzado={avanzado} />
            )}
          </>
        )}

        {/* Parameters, Resources and Arrivals list the elements they are about with what is
            already written on each, selected or not: «which task still has no time» is the
            question of the step, and the form of one element cannot answer it. */}
        {paso === 'parameters' && (
          <ListaParametros ids={idsPorTipo(['task', 'timer'])} {...lista} />
        )}
        {paso === 'arrivals' && <ListaLlegadas ids={idsPorTipo(['start'])} {...lista} />}
        {paso === 'resources' && <ListaRecursos ids={idsPorTipo(['task'])} {...lista} />}
      </details>

      <VistaJson
        delta={delta}
        onAplicar={(escenario) => {
          onCambio(archivo, escenario);
        }}
      />

      {/* The validation list is live in **every** step: a resource you break in Resources has to
          be told there, and `docs/COMING-FROM-BIZAGI.md` promises exactly this
          ("the validation list at the bottom of the panel is live in every step"). */}
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
  );
}
