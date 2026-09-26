/**
 * Static example gallery (#458): the welcome screen (`Bienvenida.tsx`) lists every public example
 * under `examples/` and opens any of them as a project. `examples/pedido` already ships inside
 * the bundle (LILA-064) — this widens that same trick to the rest of the examples the policy
 * names (`docs/EXAMPLES_POLICY.md`), instead of adding a new loading path (`extraResources`, IPC,
 * `fetch`). `examples/bizagi-exports/` stays out: those are parser interoperability fixtures
 * without a scenario, not a modelling example.
 *
 * ponytail: the plan called for one `import.meta.glob(..., { query: '?raw', eager: true })` over
 * the three example directories, but Vitest's Vite instance does not resolve a raw `.json` import
 * through the glob the same way the app's production build does — the glob comes back empty
 * under jsdom, which would make every test in this file (and the ones that render `Bienvenida`)
 * silently see zero examples instead of failing loudly. Seven plain imports below are the ceiling
 * anyway (the policy names exactly these directories), so a glob would only save repetition, not
 * complexity; the loss of a working test guard is not worth that.
 */
import pedidoModel from '../../../examples/pedido/model.bpmn?raw';
import pedidoAsIs from '../../../examples/pedido/as-is.scenario.json';
import pedidoToBe from '../../../examples/pedido/to-be-3-cajeros.scenario.json';
import level1Model from '../../../examples/bizagi-levels/level-1/model.bpmn?raw';
import level1Scenario from '../../../examples/bizagi-levels/level-1/scenario.json';
import level2Model from '../../../examples/bizagi-levels/level-2/model.bpmn?raw';
import level2Scenario from '../../../examples/bizagi-levels/level-2/scenario.json';
import level3Model from '../../../examples/bizagi-levels/level-3/model.bpmn?raw';
import level3Scenario from '../../../examples/bizagi-levels/level-3/scenario.json';
import level4Model from '../../../examples/bizagi-levels/level-4/model.bpmn?raw';
import level4Scenario from '../../../examples/bizagi-levels/level-4/scenario.json';
import mm1Model from '../../../examples/mm1/mm1-rho08/model.bpmn?raw';
import mm1Scenario from '../../../examples/mm1/mm1-rho08/scenario.json';
import mm3Model from '../../../examples/mm1/mm3/model.bpmn?raw';
import mm3Scenario from '../../../examples/mm1/mm3/scenario.json';
import type { ProjectDocument } from './store/ProjectStore';
import { strings } from './i18n';

/** Keys `strings.*.ts#bienvenida.ejemplos` (LILA-210 parity) and `Bienvenida.tsx`'s gallery. */
export type EjemploId =
  | 'pedido'
  | 'bizagi-level-1'
  | 'bizagi-level-2'
  | 'bizagi-level-3'
  | 'bizagi-level-4'
  | 'mm1-rho08'
  | 'mm3';

/** One row of the gallery: a model plus the `*.scenario.json` file(s) that go with it. */
export interface Ejemplo {
  readonly id: EjemploId;
  readonly modelo: string;
  /** File name (as `resolveExtends`/`prepareSimulation` key it) -> parsed scenario document. */
  readonly escenarios: Readonly<Record<string, Record<string, unknown>>>;
}

/** Gallery order: `pedido` (today's default) → the four Bizagi levels → the two M/M/c cases. */
export const EJEMPLOS: readonly Ejemplo[] = [
  {
    id: 'pedido', modelo: pedidoModel,
    escenarios: {
      'as-is.scenario.json': pedidoAsIs as Record<string, unknown>,
      'to-be-3-cajeros.scenario.json': pedidoToBe as Record<string, unknown>,
    },
  },
  { id: 'bizagi-level-1', modelo: level1Model, escenarios: { 'scenario.json': level1Scenario as Record<string, unknown> } },
  { id: 'bizagi-level-2', modelo: level2Model, escenarios: { 'scenario.json': level2Scenario as Record<string, unknown> } },
  { id: 'bizagi-level-3', modelo: level3Model, escenarios: { 'scenario.json': level3Scenario as Record<string, unknown> } },
  { id: 'bizagi-level-4', modelo: level4Model, escenarios: { 'scenario.json': level4Scenario as Record<string, unknown> } },
  { id: 'mm1-rho08', modelo: mm1Model, escenarios: { 'scenario.json': mm1Scenario as Record<string, unknown> } },
  { id: 'mm3', modelo: mm3Model, escenarios: { 'scenario.json': mm3Scenario as Record<string, unknown> } },
];

const POR_ID = new Map(EJEMPLOS.map((ejemplo) => [ejemplo.id, ejemplo]));

/** The BPMN `id` of the one `<process>` in `xml`: read directly, no engine parse needed here. */
function idDeProceso(xml: string): string {
  const encontrado = /<(?:\w+:)?process\b[^>]*\bid="([^"]+)"/.exec(xml);
  if (encontrado === null) throw new Error(`ejemplos.ts: no process id in ${xml.slice(0, 80)}…`);
  return encontrado[1]!;
}

/**
 * A fresh `ProjectDocument` for `id`: no path, no saved runs. It goes through `App.tsx#activate`
 * exactly like a restored session or a recent project (`saved=true`) — clean and pathless, so
 * «Save» asks for a project folder like it already does for the built-in `pedido` demo, and never
 * overwrites the example under `examples/`.
 */
export function proyectoDeEjemplo(id: EjemploId): ProjectDocument {
  const ejemplo = POR_ID.get(id);
  if (ejemplo === undefined) throw new Error(`unknown example: ${id}`);
  return {
    version: 1,
    id: `ejemplo-${id}`,
    name: strings().bienvenida.ejemplos[id].titulo,
    model: { id: idDeProceso(ejemplo.modelo), name: 'model.bpmn', xml: ejemplo.modelo, revision: 0 },
    scenarios: ejemplo.escenarios,
    scenarioRevisions: {},
    runs: [],
  };
}
