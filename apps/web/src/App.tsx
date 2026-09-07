/**
 * Shell de la app web (LILA-057): barra superior con los modos, paleta de bpmn-js a la
 * izquierda, lienzo al centro, panel derecho con pestañas y barra de estado abajo. La
 * disposición es la del brief `prompts/claude-design-ui.md`; los colores salen todos de los
 * tokens de LILA-112, sin un solo hex aquí.
 *
 * Los literales van escritos donde se usan: `strings.es.ts` es LILA-066 y sacarlos ahora solo
 * movería el problema de sitio.
 */
import { useEffect, useRef, useState } from 'react';
import { parseBpmn } from '@lila/engine/bpmn';
import {
  ScenarioSchema,
  resolveExtends,
  type ResolvedScenario,
  type Scenario,
} from '@lila/engine/schema';
import type { ProcessIR, SimulationProgress } from '@lila/engine';
import { Lienzo, type EstadoLienzo, type Modelador } from './Modeler';
import { PanelPropiedades } from './PropertiesPanel';
import { ScenarioPanel } from './ScenarioPanel';
import type { Corrida } from './BottleneckOverlay';
import { runInWorker } from './simulationClient';
import { applyTheme, type Theme } from './theme/applyTheme';
// Único punto de la SPA que conoce la implementación concreta (LILA-058, ADR-023): el resto
// del shell habla con `store` solo por el tipo `ProjectStore`. Cambiar de modalidad —
// `DesktopStore` (LILA-071), `RemoteStore` (LILA-086)— es cambiar esta línea.
import type { ProjectStore } from './store/ProjectStore';
// El benchmark se compila dentro del bundle: es el único archivo que la app trae de serie, y
// así no hay que copiarlo a `public/` ni abrir `examples/` con `server.fs.allow`.
import pedido from '../../../examples/pedido/model.bpmn?raw';
// Los dos escenarios del benchmark viajan en el bundle por la misma razón que el modelo: son lo
// único que la app trae de serie, y con ellos «cambiar de escenario» ya es una acción real de la
// UI (aceptación de LILA-064). Abrir escenarios propios es LILA-061.
import asIsJson from '../../../examples/pedido/as-is.scenario.json';
import toBeJson from '../../../examples/pedido/to-be-3-cajeros.scenario.json';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import './theme/tokens.css';
import './app.css';

const MODOS = ['Modelar', 'Simular', 'Resultados', 'Comparar'] as const;
const PESTANAS = ['Propiedades', 'Documentación', 'Simulación'] as const;

/** Tema por defecto. Se pide por fetch para que editar el JSON y recargar cambie la UI. */
const TEMA_URL = './eva-01.json';

/** Id del benchmark que trae la app de serie; cualquier otro se elige al vuelo (ver `abrir`). */
const PROCESO_INICIAL = 'pedido';

/** Escenarios de la sesión, por nombre de archivo (el que resuelve `extends`). */
type Escenarios = Readonly<Record<string, Record<string, unknown>>>;

/** Los dos del benchmark; el panel de escenario (LILA-061) añade copias a este mismo mapa. */
const ESCENARIOS_INICIALES: Escenarios = {
  'as-is.scenario.json': asIsJson as Record<string, unknown>,
  'to-be-3-cajeros.scenario.json': toBeJson as Record<string, unknown>,
};

/** Etiqueta del selector: el `name` del escenario, que es lo que también imprime la CLI. */
function etiquetaEscenario(archivo: string, escenarios: Escenarios): string {
  const nombre = escenarios[archivo]?.['name'];
  return typeof nombre === 'string' ? nombre : archivo;
}

/** Resuelve la cadena `extends` (el TO-BE hereda del AS-IS) contra el mapa de arriba, sin disco. */
function cargarEscenario(archivo: string, escenarios: Escenarios): ResolvedScenario {
  const combinado = resolveExtends(archivo, (ruta) => {
    const crudo = escenarios[ruta];
    if (crudo === undefined) throw new Error(`escenario desconocido: ${ruta}`);
    return crudo;
  });
  const parsed = ScenarioSchema.parse(combinado);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error(`${archivo} no resuelve a un escenario completo (falta model o run).`);
  }
  return parsed as ResolvedScenario;
}

/** Fase de la simulación, para lo que enseña el panel derecho. */
type EstadoSim =
  | { tipo: 'inactivo' }
  | { tipo: 'simulando'; progreso: SimulationProgress | null }
  | { tipo: 'error'; mensaje: string };

export function App({ store }: { store: ProjectStore }): React.JSX.Element {
  const [modelador, setModelador] = useState<Modelador | null>(null);
  const [estado, setEstado] = useState<EstadoLienzo>({
    zoom: 1,
    elementos: 0,
    avisos: 0,
    error: null,
  });
  const [procesoId, setProcesoId] = useState(PROCESO_INICIAL);
  const [archivo, setArchivo] = useState('model.bpmn');
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>('Propiedades');
  // El lienzo no se monta hasta que el tema está resuelto: bpmn-js lee los colores de las
  // figuras de los tokens al montar (ver Modeler.tsx). `tema === undefined` es "todavía no se
  // sabe"; `null`, "no se pudo cargar, seguimos con los valores por defecto de tokens.css".
  const [tema, setTema] = useState<Theme | null | undefined>(undefined);
  const [avisoTema, setAvisoTema] = useState<string | null>(null);
  const [escenarioId, setEscenarioId] = useState('as-is.scenario.json');
  // Los escenarios se editan en el panel (LILA-061), así que dejan de ser una constante de
  // módulo: el mapa entero es estado, y `simular()` corre siempre lo que el panel tiene ahora.
  const [escenarios, setEscenarios] = useState<Escenarios>(ESCENARIOS_INICIALES);
  // IR del diagrama del lienzo, para que el panel valide con `validateScenario` (reglas R3…R14)
  // y no solo con el esquema. `null` mientras no se haya podido parsear.
  const [ir, setIr] = useState<ProcessIR | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  // La última corrida y el interruptor son todo el estado del overlay (LILA-064). Poner
  // `corrida` a `null` es lo que "apaga" el overlay al cambiar de escenario o de modelo: no hay
  // una segunda ruta de limpieza que se pueda olvidar de correr.
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [verCuellos, setVerCuellos] = useState(true);
  const [sim, setSim] = useState<EstadoSim>({ tipo: 'inactivo' });
  // Corrida en vuelo. `runInWorker` traduce `abort()` a `worker.terminate()` (LILA-059), que es
  // la única forma real de pararla: `simulate` es síncrono y el worker no lee su cola mientras
  // corre. Sin esto, cambiar de escenario a mitad de una corrida deja el worker vivo y su
  // resultado llega tarde y pinta el overlay del escenario **anterior** sobre el selector nuevo
  // — justo lo contrario de la aceptación de LILA-064, y verificado en navegador.
  const enVuelo = useRef<AbortController | null>(null);

  /** Mata la corrida en vuelo, si la hay. Idempotente. */
  function cancelarCorrida(): void {
    enVuelo.current?.abort();
    enVuelo.current = null;
  }

  // Único punto donde se pinta o se limpia el overlay. Todo lo que puede cambiarlo —terminar una
  // corrida, elegir otro escenario, abrir otro `.bpmn`, mover el interruptor, remontar el lienzo—
  // pasa por aquí, y `cuellos` es idempotente, así que repetirlo no acumula nada.
  useEffect(() => {
    modelador?.cuellos(corrida, verCuellos);
  }, [modelador, corrida, verCuellos]);

  // El IR se reparsea cuando cambia el diagrama activo. No se engancha a cada `elements.changed`
  // del lienzo: parsear el XML entero por cada tecla del editor de nombres no lo pide nadie, y
  // `simular()` vuelve a parsear de todas formas antes de correr.
  useEffect(() => {
    if (modelador === null) return;
    let vivo = true;
    void modelador
      .exportar()
      .then((xml) => parseBpmn(xml))
      .then(({ ir: parseado }) => {
        if (vivo) setIr(parseado);
      })
      .catch(() => {
        if (vivo) setIr(null);
      });
    return () => {
      vivo = false;
    };
  }, [modelador, procesoId]);

  useEffect(() => {
    void fetch(TEMA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
        return r.json() as Promise<Theme>;
      })
      .then((t) => {
        applyTheme(t);
        setTema(t);
      })
      .catch((e: unknown) => {
        // Un tema roto no puede dejar la app en blanco: se avisa y se sigue con Eva-01, que
        // es lo que `tokens.css` trae por defecto.
        setAvisoTema(e instanceof Error ? e.message : String(e));
        setTema(null);
      });
  }, []);

  async function abrir(): Promise<void> {
    if (modelador === null) return;
    // Un id nuevo garantiza que `BrowserStore.getProcess` no tenga nada en memoria bajo esa
    // clave y abra el selector de archivo; el id real es irrelevante en esta modalidad.
    const id = crypto.randomUUID();
    const datos = await store.getProcess(id);
    // Cerrar el selector sin elegir nada no cambia nada y no se avisa de nada.
    if (datos === null) return;
    // El proceso activo y el nombre solo cambian si el archivo se pudo abrir. Si no, el lienzo
    // se queda con el diagrama anterior, y renombrarlo haría que la barra dijera un archivo y
    // el lienzo mostrara otro —y que «Exportar .bpmn» descargara el anterior con el nombre
    // nuevo—.
    if (await modelador.abrir(datos.xml)) {
      // La corrida en vuelo es del proceso anterior: su resultado no puede pintarse sobre el
      // diagrama nuevo (ni aunque los ids coincidan por casualidad).
      cancelarCorrida();
      setProcesoId(id);
      setArchivo(datos.name);
      // El resultado anterior es de otro proceso: dejarlo puesto pintaría cuellos de botella que
      // el diagrama nuevo no tiene (o, peor, sobre ids que coinciden por casualidad).
      setCorrida(null);
      setSim({ tipo: 'inactivo' });
      // La selección era del diagrama anterior: su id no tiene por qué existir en el nuevo.
      setSeleccion(null);
    }
  }

  /**
   * Corre el escenario elegido sobre lo que hay en el lienzo **ahora**: se exporta el XML y se
   * vuelve a parsear, así una tarea recién añadida entra en la simulación sin recargar nada. El
   * `ir.source.originalIds` que sale de ahí es el que deja al overlay pintar sobre los ids que
   * bpmn-js conoce cuando el archivo traía ids no-NCName (ver `BottleneckOverlay.ts`).
   */
  async function simular(): Promise<void> {
    if (modelador === null) return;
    cancelarCorrida();
    const control = new AbortController();
    enVuelo.current = control;
    setSim({ progreso: null, tipo: 'simulando' });
    try {
      const scenario = cargarEscenario(escenarioId, escenarios);
      const { ir } = await parseBpmn(await modelador.exportar());
      const { result } = await runInWorker(ir, scenario, {
        signal: control.signal,
        onProgress: (progreso) => {
          setSim({ progreso, tipo: 'simulando' });
        },
      });
      setCorrida({ originalIds: ir.source.originalIds, result, scenario });
      setSim({ tipo: 'inactivo' });
    } catch (e: unknown) {
      // Cancelar no es un error que enseñar: quien canceló ya dejó la UI como quería. Se
      // comprueba la señal y no el nombre de la excepción, porque `parseBpmn` puede fallar por
      // su cuenta después de que se haya cancelado.
      if (control.signal.aborted) return;
      setSim({ mensaje: e instanceof Error ? e.message : String(e), tipo: 'error' });
    } finally {
      if (enVuelo.current === control) enVuelo.current = null;
    }
  }

  async function exportar(): Promise<void> {
    if (modelador === null) return;
    await store.putProcess(procesoId, await modelador.exportar());
  }

  return (
    <div className="app">
      <header className="barra">
        <span className="proyecto">Lila Modeler</span>
        <span className="archivo">{archivo}</span>
        <nav className="modos">
          {MODOS.map((m) => (
            <button
              key={m}
              type="button"
              className={m === 'Modelar' ? 'modo activo' : 'modo'}
              disabled={m !== 'Modelar'}
              title={m === 'Modelar' ? undefined : 'Todavía no implementado'}
            >
              {m}
            </button>
          ))}
        </nav>
        <button type="button" className="boton" onClick={() => void abrir()}>
          Abrir .bpmn
        </button>
        <button type="button" className="boton primario" onClick={() => void exportar()}>
          Exportar .bpmn
        </button>
      </header>

      {/* La paleta de figuras la pinta bpmn-js dentro de este contenedor, arriba a la
          izquierda; la esquina inferior derecha queda libre para la marca de agua
          «Powered by bpmn.io», que es obligatoria por la licencia de bpmn.io. */}
      {tema === undefined ? (
        <div className="lienzo" />
      ) : (
        <Lienzo
          xmlInicial={pedido}
          onListo={setModelador}
          onEstado={setEstado}
          onSeleccion={setSeleccion}
        />
      )}

      <aside className="panel">
        <nav className="pestanas">
          {PESTANAS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === pestana ? 'pestana activa' : 'pestana'}
              onClick={() => {
                setPestana(p);
              }}
            >
              {p}
            </button>
          ))}
        </nav>
        {pestana === 'Simulación' ? (
          <div className="simulacion">
            <label className="campo">
              Escenario
              <select
                value={escenarioId}
                onChange={(e) => {
                  setEscenarioId(e.target.value);
                  // Cambiar de escenario invalida el resultado anterior: el overlay se limpia
                  // aquí y se vuelve a pintar cuando termine la corrida nueva. La corrida en
                  // vuelo es del escenario viejo, así que se mata: si no, terminaría después y
                  // pintaría sus cuellos de botella bajo el nombre del escenario nuevo.
                  cancelarCorrida();
                  setCorrida(null);
                  setSim({ tipo: 'inactivo' });
                }}
              >
                {Object.keys(escenarios).map((id) => (
                  <option key={id} value={id}>
                    {etiquetaEscenario(id, escenarios)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="boton primario"
              disabled={modelador === null || sim.tipo === 'simulando'}
              onClick={() => void simular()}
            >
              {sim.tipo === 'simulando' ? 'Simulando…' : 'Simular'}
            </button>
            {sim.tipo === 'simulando' && (
              <p className="vacio">
                {sim.progreso === null
                  ? 'Preparando…'
                  : `${Math.round(sim.progreso.fraction * 100)} % · replicación ${sim.progreso.replication}`}
              </p>
            )}
            {sim.tipo === 'error' && (
              <p role="alert" className="error">
                No se pudo simular: {sim.mensaje}
              </p>
            )}
            <label className="campo interruptor">
              <input
                type="checkbox"
                checked={verCuellos}
                onChange={(e) => {
                  setVerCuellos(e.target.checked);
                }}
              />
              Cuellos de botella
            </label>
            <p className="vacio">
              {corrida === null
                ? 'Simula para ver los cuellos de botella sobre el diagrama.'
                : (corrida.result.bottlenecks[0]?.elementId ??
                  'Ningún elemento esperó por un recurso en esta corrida.')}
            </p>
            <ScenarioPanel
              archivo={escenarioId}
              escenarios={escenarios}
              onCambio={(archivo, escenario) => {
                setEscenarios((previos) => ({ ...previos, [archivo]: escenario }));
                // El escenario cambió: el resultado en pantalla es del anterior. Mismo trato
                // que al cambiar de escenario en el selector (LILA-064).
                cancelarCorrida();
                setCorrida(null);
              }}
              onGuardar={() => {
                void store.putScenario(
                  procesoId,
                  escenarioId.replace(/\.scenario\.json$/, ''),
                  // El escenario puede ser inválido: se guarda igual y el panel lo marca. Es la
                  // aceptación de LILA-061, y por eso el cast en vez de un `parse` que lo tire.
                  (escenarios[escenarioId] ?? {}) as unknown as Scenario,
                );
              }}
              onDuplicar={(archivo, escenario) => {
                setEscenarios((previos) => ({ ...previos, [archivo]: escenario }));
                setEscenarioId(archivo);
                cancelarCorrida();
                setCorrida(null);
              }}
              ir={ir}
              seleccion={seleccion}
              onSeleccionar={setSeleccion}
            />
          </div>
        ) : (
          <PanelPropiedades modelador={modelador} pestana={pestana} />
        )}
      </aside>

      <nav className="diagramas">
        <button type="button" className="pestana activa">
          {archivo}
        </button>
      </nav>

      <footer className="estado">
        <span>{estado.elementos} elementos</span>
        <button
          type="button"
          className="enlace"
          onClick={() => {
            modelador?.ajustar();
          }}
        >
          Zoom {Math.round(estado.zoom * 100)} % · ajustar
        </button>
        <span>Tema: {tema?.name ?? 'Eva-01'}</span>
        {estado.avisos > 0 && (
          <span role="alert" className="aviso">
            {estado.avisos} avisos al importar: hay elementos que no se dibujaron
          </span>
        )}
        {estado.error !== null && (
          <span role="alert" className="error">
            No se pudo abrir el diagrama: {estado.error}
          </span>
        )}
        {avisoTema !== null && (
          <span role="alert" className="error">
            No se pudo cargar el tema: {avisoTema}
          </span>
        )}
      </footer>
    </div>
  );
}

