/**
 * Demostración mínima de LILA-063: corre `runInWorker` (LILA-059) dos veces sobre
 * `examples/pedido` —AS-IS y TO-BE 3 cajeros— y muestra `CompareView`. Mismo patrón que
 * `results-demo.tsx` (LILA-062): pantalla aparte de Vite, no toca `main.tsx` porque el shell real
 * (LILA-057) sigue en otra rama.
 *
 * `to-be-3-cajeros.scenario.json` declara `"extends": "as-is.scenario.json"` (solo sube
 * `cajero.capacity` a 3): se resuelve con `resolveExtends` (`@lila/engine/schema`) pasándole un
 * `ScenarioReader` que lee de los dos JSON ya importados por Vite, en vez de `node:fs` — la
 * cadena de herencia es la misma función que usa `lila compare` en la CLI, solo cambia de dónde
 * lee cada archivo.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseBpmn } from '@lila/engine/bpmn';
import { resolveExtends, ScenarioSchema, type ResolvedScenario } from '@lila/engine/schema';
import type { BaseTimeUnit } from '@lila/engine/format';
import { compare, type CompareResult, type ProcessIR, type RunResult, type SimulationProgress } from '@lila/engine';
import { runInWorker } from './simulationClient.js';
import { CompareView } from './CompareView.js';
import './theme/tokens.css';

// ponytail: mismos JSON directos del repo que results-demo.tsx (LILA-142 no dejó ejemplos
// servidos en public/ todavía); `server.fs.allow` en vite.config.ts ya cubre esta carpeta.
import modelXml from '../../../examples/pedido/model.bpmn?raw';
import asIsJson from '../../../examples/pedido/as-is.scenario.json';
import toBeJson from '../../../examples/pedido/to-be-3-cajeros.scenario.json';

const SCENARIO_NAMES = ['AS-IS', 'TO-BE 3 cajeros'] as const;
const SCENARIO_FILES: Readonly<Record<string, unknown>> = {
  'as-is.scenario.json': asIsJson,
  'to-be-3-cajeros.scenario.json': toBeJson,
};

function readScenarioFile(path: string): unknown {
  const found = SCENARIO_FILES[path];
  if (found === undefined) throw new Error(`compare-demo: escenario desconocido "${path}".`);
  return found;
}

function loadResolvedScenario(file: string): ResolvedScenario {
  const merged = resolveExtends(file, readScenarioFile);
  const parsed = ScenarioSchema.parse(merged);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error(`${file} no es un escenario resuelto.`);
  }
  return parsed as ResolvedScenario;
}

/** Igual que `resourceNames` de ResultsView.tsx, pero fusionando varios escenarios (cli.ts lo
 * hace igual en `printCompareResult`): un pool puede nacer en el TO-BE y no existir en el base. */
function mergedResourceNames(scenarios: readonly ResolvedScenario[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const scenario of scenarios) {
    for (const [id, resource] of Object.entries(scenario.resources ?? {})) {
      names[id] ??= resource.name ?? id;
    }
  }
  return names;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'running'; label: string; progress: SimulationProgress | null }
  | {
      kind: 'done';
      baseTimeUnit: BaseTimeUnit;
      comparison: CompareResult;
      ir: ProcessIR;
      resourceNames: Record<string, string>;
    }
  | { kind: 'error'; message: string };

function CompareDemo() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let vivo = true;
    const asIs = loadResolvedScenario('as-is.scenario.json');
    const toBe = loadResolvedScenario('to-be-3-cajeros.scenario.json');

    async function run(): Promise<{ ir: ProcessIR; results: RunResult[] } | undefined> {
      const { ir } = await parseBpmn(modelXml);
      if (!vivo) return undefined;

      setStatus({ kind: 'running', label: SCENARIO_NAMES[0], progress: null });
      const runAsIs = await runInWorker(ir, asIs, {
        onProgress: (progress) => {
          if (vivo) setStatus({ kind: 'running', label: SCENARIO_NAMES[0], progress });
        },
      });
      if (!vivo) return undefined;

      setStatus({ kind: 'running', label: SCENARIO_NAMES[1], progress: null });
      const runToBe = await runInWorker(ir, toBe, {
        onProgress: (progress) => {
          if (vivo) setStatus({ kind: 'running', label: SCENARIO_NAMES[1], progress });
        },
      });
      if (!vivo) return undefined;

      return { ir, results: [runAsIs.result, runToBe.result] };
    }

    void run()
      .then((done) => {
        if (!vivo || done === undefined) return;
        setStatus({
          baseTimeUnit: asIs.run.baseTimeUnit as BaseTimeUnit,
          comparison: compare(done.results),
          ir: done.ir,
          kind: 'done',
          resourceNames: mergedResourceNames([asIs, toBe]),
        });
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
      <h1 style={{ fontSize: 20, margin: '0 0 16px' }}>Lila Modeler · Comparar (demo LILA-063)</h1>

      {status.kind === 'loading' && <p>Cargando examples/pedido…</p>}
      {status.kind === 'running' && (
        <p>
          Simulando {status.label}…{' '}
          {status.progress === null ? '' : `${Math.round(status.progress.fraction * 100)}%`}
        </p>
      )}
      {status.kind === 'error' && (
        <p role="alert" style={{ color: 'var(--status-error)' }}>
          Error: {status.message}
        </p>
      )}
      {status.kind === 'done' && (
        <CompareView
          baseTimeUnit={status.baseTimeUnit}
          comparison={status.comparison}
          ir={status.ir}
          resourceNames={status.resourceNames}
          scenarioNames={SCENARIO_NAMES}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CompareDemo />
  </StrictMode>,
);
