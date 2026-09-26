/**
 * Acceptance of #458: every entry the welcome screen's gallery lists is a real, runnable example
 * — not just a file that happens to sit under `examples/`. Each one has to parse, its scenario(s)
 * have to resolve `extends`/validate against the model (`prepareSimulation`, the same gate the
 * shell uses before «Run»), and simulating it has to produce cases without ever going through the
 * `E-*`/`W-*` catalog as a thrown error.
 */
import { simulate } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { expect, it } from 'vitest';
import { EJEMPLOS, proyectoDeEjemplo } from './ejemplos';
import { prepareSimulation } from './simulationGate';

it('el catálogo trae los siete ejemplos públicos, en el orden del plan', () => {
  expect(EJEMPLOS.map((e) => e.id)).toEqual([
    'pedido', 'bizagi-level-1', 'bizagi-level-2', 'bizagi-level-3', 'bizagi-level-4', 'mm1-rho08', 'mm3',
  ]);
});

for (const ejemplo of EJEMPLOS) {
  for (const archivo of Object.keys(ejemplo.escenarios)) {
    it(`${ejemplo.id} · ${archivo} parsea, resuelve y simula sin E-*`, async () => {
      const parsed = await parseBpmn(ejemplo.modelo);
      expect(parsed.ir.id).toBeTruthy();
      // Nothing in `prepareSimulation` throws without an `E-*`/other stable code prefix (same
      // gate `App.tsx` runs before «Run»): a rejection here is exactly what «simulates without
      // E-*» rules out.
      const { ir, scenario } = await prepareSimulation(ejemplo.modelo, archivo, ejemplo.escenarios);
      const result = simulate(ir, scenario);
      // Not just "did not throw": a scenario whose arrivals all land inside the warm-up would
      // resolve and simulate cleanly while never producing a single started case (#431's
      // warm-up bug) — silently teaching nothing. `started > 0` is the same signal `App.tsx`
      // checks for that warning.
      expect(result.process.started).toBeGreaterThan(0);
    });
  }
}

it('proyectoDeEjemplo(id) arma un ProjectDocument limpio, listo para `activate`', () => {
  for (const ejemplo of EJEMPLOS) {
    const doc = proyectoDeEjemplo(ejemplo.id);
    expect(doc.version).toBe(1);
    expect(doc.id).toBe(`ejemplo-${ejemplo.id}`);
    expect(doc.name).toBeTruthy();
    expect(doc.model.xml).toBe(ejemplo.modelo);
    expect(doc.model.revision).toBe(0);
    expect(doc.model.id).toMatch(/^Process_/);
    expect(doc.scenarios).toBe(ejemplo.escenarios);
    expect(doc.scenarioRevisions).toEqual({});
    expect(doc.runs).toEqual([]);
  }
});

it('proyectoDeEjemplo rechaza un id fuera del catálogo', () => {
  // @ts-expect-error — `EjemploId` already rules this out at compile time; the runtime guard is
  // the one that actually fires if the catalog and the gallery (`Bienvenida.tsx`) ever drift.
  expect(() => proyectoDeEjemplo('no-existe')).toThrow('no-existe');
});
