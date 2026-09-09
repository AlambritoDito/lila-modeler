/**
 * Demostración mínima de LILA-062: corre `runInWorker` (LILA-059) sobre `examples/pedido` y
 * muestra `ResultsView`. No es el shell real — `Modeler.tsx` (LILA-057) sigue en QA en otra
 * rama — así que este archivo vive aparte de `main.tsx` y no lo toca. El orquestador, al mezclar
 * #57, reemplaza la carga fija de aquí por el `ProjectStore`/`store.ts` de LILA-058/066: el
 * `ir` y el `scenario` que ya tiene el shell en memoria se pasan tal cual a `<ResultsView>`.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseBpmn } from '@lila/engine/bpmn';
import { ScenarioSchema, type ResolvedScenario } from '@lila/engine/schema';
import type { ProcessIR, RunResult, SimulationProgress } from '@lila/engine';
import { runInWorker } from './simulationClient.js';
import { ResultsView } from './ResultsView.js';
import { strings } from './i18n';
import './theme/tokens.css';

// ponytail: `?raw`/JSON directo del repo en vez de copiarlos a `public/` (LILA-142/#59 no dejó
// ejemplos servidos ahí todavía) — `server.fs.allow` en vite.config.ts habilita leerlos fuera de
// `apps/web` en dev; `vite build` los empaqueta igual sin ese permiso adicional.
import modelXml from '../../../examples/pedido/model.bpmn?raw';
import scenarioJson from '../../../examples/pedido/as-is.scenario.json';

type Status =
  | { kind: 'loading' }
  | { kind: 'running'; progress: SimulationProgress | null }
  | { kind: 'done'; ir: ProcessIR; scenario: ResolvedScenario; result: RunResult }
  | { kind: 'error'; message: string };

function loadScenario(): ResolvedScenario {
  const parsed = ScenarioSchema.parse(scenarioJson);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error('examples/pedido/as-is.scenario.json no es un escenario resuelto.');
  }
  return parsed as ResolvedScenario;
}

function ResultsDemo() {
  const S = strings();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let vivo = true;
    const scenario = loadScenario();

    void parseBpmn(modelXml)
      .then(({ ir }) => {
        if (!vivo) return undefined;
        setStatus({ kind: 'running', progress: null });
        return runInWorker(ir, scenario, {
          onProgress: (progress) => {
            if (vivo) setStatus({ kind: 'running', progress });
          },
        }).then((run) => ({ ir, result: run.result }));
      })
      .then((done) => {
        if (vivo && done !== undefined) setStatus({ ir: done.ir, kind: 'done', result: done.result, scenario });
      })
      .catch((error: unknown) => {
        if (vivo) setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      vivo = false;
    };
  }, []);

  return (
    <main
      style={{
        background: 'var(--bg-base)',
        color: 'var(--fg-primary)',
        font: 'var(--font-size-base) var(--font-ui)',
        minHeight: '100vh',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 20, margin: '0 0 16px' }}>{S.demos.tituloResultados}</h1>

      {status.kind === 'loading' && <p>{S.demos.cargando}</p>}
      {status.kind === 'running' && (
        <p>
          Simulando…{' '}
          {status.progress === null ? '' : `${Math.round(status.progress.fraction * 100)}%`}
        </p>
      )}
      {status.kind === 'error' && (
        <p role="alert" style={{ color: 'var(--status-error)' }}>
          Error: {status.message}
        </p>
      )}
      {status.kind === 'done' && (
        <ResultsView ir={status.ir} scenario={status.scenario} result={status.result} />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ResultsDemo />
  </StrictMode>,
);
