/**
 * Demostración en navegador de LILA-064: monta un modelador de bpmn-js sobre `examples/pedido`,
 * corre `runInWorker` (LILA-059) con el escenario elegido y aplica `applyOverlay`/`clearOverlay`
 * (`BottleneckOverlay.ts`). No es el shell real — `Modeler.tsx` (LILA-057) vive en otra rama de la
 * pila, todavía no mezclada aquí — así que este archivo monta su propio `Modeler` de bpmn-js
 * mínimo, igual que hicieron `results-demo.tsx` (LILA-062) para `ResultsView` y `compare-demo.tsx`
 * (LILA-063) para `CompareView`. Al mezclar #57, el orquestador reemplaza este montaje propio por
 * `<Lienzo>` y llama a `applyOverlay`/`clearOverlay` con el modelador que ya expone esa API; nada
 * de `BottleneckOverlay.ts` cambia.
 *
 * Sin `moddleExtensions: { lila }`: `examples/pedido/model.bpmn` no usa la extensión `lila:`
 * (verificado, 0 coincidencias), así que esta demo no necesita el descriptor — y ese subpath del
 * paquete del motor todavía no existe en esta rama (lo trae LILA-057, no mezclado aquí).
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Modeler from 'bpmn-js/lib/Modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import { parseBpmn } from '@lila/engine/bpmn';
import { ScenarioSchema, resolveExtends, type ResolvedScenario } from '@lila/engine/schema';
import type { ProcessIR, RunResult, SimulationProgress } from '@lila/engine';
import { runInWorker } from './simulationClient.js';
import { applyOverlay, clearOverlay } from './BottleneckOverlay.js';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import './theme/tokens.css';

// ponytail: igual que `results-demo.tsx` — `?raw`/JSON directo del repo, `server.fs.allow` en
// vite.config.ts habilita leerlos fuera de `apps/web` en dev y `vite build` los empaqueta igual.
import modelXml from '../../../examples/pedido/model.bpmn?raw';
import asIsJson from '../../../examples/pedido/as-is.scenario.json';
import toBeJson from '../../../examples/pedido/to-be-3-cajeros.scenario.json';

const ESCENARIOS: Readonly<Record<string, unknown>> = {
  'as-is.scenario.json': asIsJson,
  'to-be-3-cajeros.scenario.json': toBeJson,
};

const NOMBRES: Readonly<Record<string, string>> = {
  'as-is.scenario.json': 'AS-IS',
  'to-be-3-cajeros.scenario.json': 'TO-BE 3 cajeros',
};

/** Resuelve `extends` (TO-BE hereda de AS-IS) contra el mapa de arriba, sin tocar disco. */
function loadScenario(filename: string): ResolvedScenario {
  const merged = resolveExtends(filename, (path) => {
    const raw = ESCENARIOS[path];
    if (raw === undefined) throw new Error(`escenario desconocido: ${path}`);
    return raw;
  });
  const parsed = ScenarioSchema.parse(merged);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error(`${filename} no resuelve a un escenario completo (falta model o run).`);
  }
  return parsed as ResolvedScenario;
}

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'listo' }
  | { tipo: 'simulando'; progreso: SimulationProgress | null }
  | { tipo: 'hecho'; result: RunResult }
  | { tipo: 'error'; mensaje: string };

const botonEstilo: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: 4,
  color: 'var(--fg-primary)',
  cursor: 'pointer',
  font: 'inherit',
  padding: '6px 14px',
};

function OverlayDemo(): React.JSX.Element {
  const contenedor = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<Modeler | null>(null);
  const irRef = useRef<ProcessIR | null>(null);
  const [escenarioId, setEscenarioId] = useState('as-is.scenario.json');
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  useEffect(() => {
    const container = contenedor.current;
    if (container === null) return;

    const modeler = new Modeler({ container });
    modelerRef.current = modeler;
    let vivo = true;

    void parseBpmn(modelXml)
      .then(async ({ ir }) => {
        if (!vivo) return;
        irRef.current = ir;
        await modeler.importXML(modelXml);
        if (!vivo) return;
        modeler.get<Canvas>('canvas').zoom('fit-viewport');
        setEstado({ tipo: 'listo' });
      })
      .catch((error: unknown) => {
        if (vivo) setEstado({ mensaje: error instanceof Error ? error.message : String(error), tipo: 'error' });
      });

    return () => {
      vivo = false;
      modeler.destroy();
    };
  }, []);

  async function simular(): Promise<void> {
    const modeler = modelerRef.current;
    const ir = irRef.current;
    if (modeler === null || ir === null) return;
    setEstado({ progreso: null, tipo: 'simulando' });
    try {
      const scenario = loadScenario(escenarioId);
      const { result } = await runInWorker(ir, scenario, {
        onProgress: (progreso) => setEstado({ progreso, tipo: 'simulando' }),
      });
      applyOverlay(modeler, result, scenario);
      setEstado({ result, tipo: 'hecho' });
    } catch (error: unknown) {
      setEstado({ mensaje: error instanceof Error ? error.message : String(error), tipo: 'error' });
    }
  }

  function limpiar(): void {
    if (modelerRef.current !== null) clearOverlay(modelerRef.current);
    setEstado({ tipo: 'listo' });
  }

  return (
    <div
      style={{
        background: 'var(--bg-base)',
        color: 'var(--fg-primary)',
        display: 'flex',
        flexDirection: 'column',
        font: 'var(--font-size-base) var(--font-ui)',
        height: '100vh',
      }}
    >
      <header style={{ alignItems: 'center', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, padding: 12 }}>
        <strong>Lila Modeler · overlay de cuellos de botella (demo LILA-064)</strong>
        <select
          value={escenarioId}
          onChange={(e) => setEscenarioId(e.target.value)}
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 4, color: 'var(--fg-primary)', font: 'inherit', padding: '4px 8px' }}
        >
          {Object.keys(ESCENARIOS).map((id) => (
            <option key={id} value={id}>
              {NOMBRES[id]}
            </option>
          ))}
        </select>
        <button type="button" style={{ ...botonEstilo, background: 'var(--accent-primary)', border: 'none', color: 'var(--fg-onAccent)', fontWeight: 600 }} onClick={() => void simular()}>
          Simular
        </button>
        <button type="button" style={botonEstilo} onClick={limpiar}>
          Limpiar overlay
        </button>
        {estado.tipo === 'simulando' && (
          <span>Simulando… {estado.progreso === null ? '' : `${Math.round(estado.progreso.fraction * 100)}%`}</span>
        )}
        {estado.tipo === 'error' && (
          <span role="alert" style={{ color: 'var(--status-error)' }}>
            Error: {estado.mensaje}
          </span>
        )}
        {estado.tipo === 'hecho' && (
          <span>Cuello de botella principal: {estado.result.bottlenecks[0]?.elementId ?? '(sin espera por recurso)'}</span>
        )}
      </header>
      <div ref={contenedor} style={{ background: 'var(--canvas-bg)', flex: 1, position: 'relative' }} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayDemo />
  </StrictMode>,
);
