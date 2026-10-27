// @vitest-environment jsdom
/**
 * #699 through the web app's own read path: the frozen archives of
 * `packages/engine/test/fixtures/released-lila/` opened with `readLila` (what `BrowserStore` and
 * the viewer call), every scenario through `prepareSimulation` (the gate «Run» goes through) and
 * simulated, then saved with `encodeLila` (what «Save» writes) and opened again.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '@lila-modeler/engine';
import { encodeLila, processesOf, type ProcessDocument } from '@lila-modeler/engine/project';
import { readLila } from './project';
import { prepareSimulation } from './simulationGate';
import { getLocale, setLocale, strings } from './i18n';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/engine/test/fixtures/released-lila');
const ARCHIVES = ['legacy-loose-model-v1.lila', 'v1.lila', 'v2-two-processes.lila'] as const;

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

let previous: ReturnType<typeof getLocale>;
beforeAll(() => { previous = getLocale(); setLocale('en'); });
afterAll(() => setLocale(previous));

/**
 * «Run» on one scenario of `process`, as `App.tsx` does for a project: a `.lila` is never a loose
 * diagram, so the only model its scenarios may name is `model.bpmn` (`modelosDeEscenarios`).
 */
async function run(process: ProcessDocument, file: string) {
  const { ir, scenario } = await prepareSimulation(process.model.xml, file, process.scenarios, 'model.bpmn');
  return simulate(ir, { ...scenario, run: { ...scenario.run, seed: 42, replications: 2 } }, { log: false });
}

describe('archives written by released versions open and run in the web app (#699)', () => {
  for (const name of ARCHIVES) {
    it(`${name}: every scenario runs, before and after save → reopen`, async () => {
      const opened = readLila(fixture(name));
      const reopened = readLila(encodeLila(opened));
      expect(reopened).toEqual(opened);
      for (const document of [opened, reopened]) {
        for (const process of processesOf(document)) {
          expect(process.model.name).toBe('model.bpmn');
          for (const file of Object.keys(process.scenarios)) {
            expect((await run(process, file)).process.completed, `${name} ${process.slug}/${file}`).toBeGreaterThan(0);
          }
        }
      }
    }, 60_000);
  }

  it('the legacy archive runs AS IS and the TO BE that extends it', async () => {
    const opened = readLila(fixture('legacy-loose-model-v1.lila'));
    expect(Object.keys(opened.scenarios).sort()).toEqual(['as-is.scenario.json', 'to-be.scenario.json']);
    expect(opened.scenarios['to-be.scenario.json']?.['extends']).toBe('as-is.scenario.json');
    const asIs = await run(opened as unknown as ProcessDocument, 'as-is.scenario.json');
    const toBe = await run(opened as unknown as ProcessDocument, 'to-be.scenario.json');
    expect(toBe.resources['specialist']).toBeDefined();
    expect(asIs.process.completed).toBeGreaterThan(0);
    expect(toBe.process.completed).toBeGreaterThan(0);
  }, 60_000);

  it('a scenario that points at a genuinely different model is still refused with the same message', async () => {
    const legacy = readLila(fixture('legacy-loose-model-v1.lila'));
    const toBe = { ...legacy.scenarios['to-be.scenario.json'], model: 'another-process.bpmn' };
    const opened = readLila(encodeLila({ ...legacy, scenarios: { ...legacy.scenarios, 'to-be.scenario.json': toBe } }));
    expect(opened.scenarios['to-be.scenario.json']?.['model']).toBe('another-process.bpmn');
    await expect(run(opened as unknown as ProcessDocument, 'to-be.scenario.json')).rejects.toThrow(
      strings().simulacion.errorModeloDistinto('another-process.bpmn', 'model.bpmn'),
    );
    // The AS IS beside it, which named the archive's own model, runs.
    expect((await run(opened as unknown as ProcessDocument, 'as-is.scenario.json')).process.completed).toBeGreaterThan(0);
  }, 60_000);
});
