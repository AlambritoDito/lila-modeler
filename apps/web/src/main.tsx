/**
 * Shell de la app web (LILA-057): barra superior con los modos, paleta de bpmn-js a la
 * izquierda, lienzo al centro, panel derecho con pestañas y barra de estado abajo. La
 * disposición es la del brief `prompts/claude-design-ui.md`; los colores salen todos de los
 * tokens de LILA-112, sin un solo hex aquí.
 *
 * Los literales van escritos donde se usan: `strings.es.ts` es LILA-066 y sacarlos ahora solo
 * movería el problema de sitio.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lienzo, type EstadoLienzo, type Modelador } from './Modeler';
import { applyTheme, type Theme } from './theme/applyTheme';
// Único punto de la SPA que conoce la implementación concreta (LILA-058, ADR-023): el resto
// del shell habla con `store` solo por el tipo `ProjectStore`. Cambiar de modalidad —
// `DesktopStore` (LILA-071), `RemoteStore` (LILA-086)— es cambiar esta línea.
import { BrowserStore } from './store/BrowserStore';
import type { ProjectStore } from './store/ProjectStore';
// El benchmark se compila dentro del bundle: es el único archivo que la app trae de serie, y
// así no hay que copiarlo a `public/` ni abrir `examples/` con `server.fs.allow`.
import pedido from '../../../examples/pedido/model.bpmn?raw';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import './theme/tokens.css';
import './app.css';

const MODOS = ['Modelar', 'Simular', 'Resultados', 'Comparar'] as const;
const PESTANAS = ['Propiedades', 'Documentación', 'Simulación'] as const;

/** Tema por defecto. Se pide por fetch para que editar el JSON y recargar cambie la UI. */
const TEMA_URL = '/eva-01.json';

/** Id del benchmark que trae la app de serie; cualquier otro se elige al vuelo (ver `abrir`). */
const PROCESO_INICIAL = 'pedido';

const PLACEHOLDER: Record<(typeof PESTANAS)[number], string> = {
  Propiedades: 'El panel de propiedades llega en LILA-060.',
  Documentación: 'Los campos lila: llegan en LILA-060.',
  Simulación: 'Los parámetros del escenario llegan en LILA-061.',
};

function App(): React.JSX.Element {
  // El store se crea una sola vez, con el benchmark ya cargado: así `listProcesses()` lo
  // incluye desde el primer render, sin un viaje redundante por `getProcess()`.
  const [store] = useState<ProjectStore>(
    () => new BrowserStore(new Map([[PROCESO_INICIAL, { xml: pedido, name: 'model.bpmn' }]])),
  );
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
    // El proceso activo y el nombre solo cambian si el archivo se pudo abrir. Si no, el lienzo
    // se queda con el diagrama anterior, y renombrarlo haría que la barra dijera un archivo y
    // el lienzo mostrara otro —y que «Exportar .bpmn» descargara el anterior con el nombre
    // nuevo—.
    if (await modelador.abrir(datos.xml)) {
      setProcesoId(id);
      setArchivo(datos.name);
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
        <Lienzo xmlInicial={pedido} onListo={setModelador} onEstado={setEstado} />
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
        <p className="vacio">{PLACEHOLDER[pestana]}</p>
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
