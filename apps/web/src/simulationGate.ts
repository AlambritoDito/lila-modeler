import type { ProcessIR } from '@lila/engine';
import { validateBpmnXml } from '@lila/engine/bpmn';
import { parseScenario, resolveExtends, validateScenario, type ResolvedScenario } from '@lila/engine/schema';
import { getLocale, strings, type Locale } from './i18n';

/** Fifth argument of `prepareSimulation`; an object so the language is named at the call site. */
export interface PrepareSimulationOptions {
  /**
   * Language of the engine messages. Defaults to the app's active locale — this module has no
   * React in it, so it reads the language store directly instead of taking a hook.
   */
  locale?: Locale | undefined;
}

/**
 * #419: many engine messages (E-SIN-START, E-SIN-END, E-INALCANZABLE, E-ELEMENTO-DESCONOCIDO…)
 * already open with the id or path they are about; prefixing it again printed it twice.
 */
function sinRepetir(code: string, where: string, message: string): string {
  return message.startsWith(where) ? `${code}: ${message}` : `${code}: ${where}: ${message}`;
}

/**
 * La misma frontera de validación que CLI, antes de crear un Worker.
 *
 * Los mensajes que salen de aquí con `code:` delante son del motor (`validateBpmnXml`,
 * `validateScenario`, zod), no del catálogo: se enseñan tal cual, para no tener dos ortografías
 * del mismo error. Since #280 the engine is asked for them in the app's language, so «verbatim»
 * and «in the user's language» are finally the same thing. The warnings returned here are copied
 * into the run that is starting: a run already stored keeps the language it was produced in.
 */
export async function prepareSimulation(xml: string, file: string, scenarios: Readonly<Record<string, Record<string, unknown>>>, expectedModel = 'model.bpmn', options: PrepareSimulationOptions = {}) {
  const S = strings();
  const locale = options.locale ?? getLocale();
  const model = await validateBpmnXml(xml, { locale });
  // `parseScenario` en vez de `ScenarioSchema.parse`: un `ZodError` sin capturar llega a la barra
  // de estado como su volcado JSON en inglés (LILA-202). Aquí sale la misma lista que en la CLI.
  const parsed = parseScenario(resolveExtends(file, (path) => {
    const raw = scenarios[path];
    if (raw === undefined) throw new Error(S.simulacion.errorEscenarioDesconocido(path));
    return raw;
  }), { locale });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('\n'));
  const scenario = parsed.data;
  if (scenario.model === undefined || scenario.run === undefined) throw new Error(S.simulacion.errorFaltaModelORun);
  if (scenario.model !== expectedModel) throw new Error(S.simulacion.errorModeloDistinto(scenario.model, expectedModel));
  const problems = validateScenario(scenario, model.ir, { locale });
  const errors = [
    ...model.errors.map((p) => sinRepetir(p.code, p.id, p.message)),
    ...problems.filter((p) => p.severity === 'error').map((p) => sinRepetir(p.code, p.path, p.message)),
  ];
  if (errors.length) throw new Error(errors.join('\n'));
  const warnings = [
    ...model.warnings.map((p) => `${p.code}: ${p.message}`),
    ...problems.filter((p) => p.severity === 'warning').map((p) => `${p.code}: ${p.message}`),
  ];
  return { ir: model.ir, scenario: scenario as ResolvedScenario, warnings };
}

/**
 * #430: `elements` keys, in any scenario of the project, that name nothing in the diagram — what
 * `validateScenario` rejects with E-ELEMENTO-DESCONOCIDO (a flattened subprocess id is known: it
 * gets E-SUBPROC-PARAMETRO instead). Deleting a configured shape leaves one behind; Run refuses
 * it, and the app offers to drop them rather than dropping them by itself, so ⌘Z after deleting
 * a shape still finds its configuration.
 */
export function entradasHuerfanas(scenarios: Readonly<Record<string, Record<string, unknown>>>, ir: ProcessIR): string[] {
  const conocidos = new Set([...Object.keys(ir.nodes), ...Object.keys(ir.flows)]);
  for (const node of Object.values(ir.nodes)) if (node.subprocessId !== undefined) conocidos.add(node.subprocessId);
  const huerfanas = new Set<string>();
  for (const scenario of Object.values(scenarios)) {
    const elements = scenario['elements'];
    if (elements === null || typeof elements !== 'object') continue;
    for (const id of Object.keys(elements)) if (!conocidos.has(id)) huerfanas.add(id);
  }
  return [...huerfanas];
}

/** The scenarios that change once the orphan entries are removed from them, and only those. */
export function sinHuerfanas(scenarios: Readonly<Record<string, Record<string, unknown>>>, ir: ProcessIR): Record<string, Record<string, unknown>> {
  const cambiados: Record<string, Record<string, unknown>> = {};
  for (const [file, scenario] of Object.entries(scenarios)) {
    const huerfanas = entradasHuerfanas({ [file]: scenario }, ir);
    if (huerfanas.length === 0) continue;
    const elements = { ...(scenario['elements'] as Record<string, unknown>) };
    for (const id of huerfanas) delete elements[id];
    cambiados[file] = { ...scenario, elements };
  }
  return cambiados;
}
