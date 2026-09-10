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
    ...model.errors.map((p) => `${p.code}: ${p.id}: ${p.message}`),
    ...problems.filter((p) => p.severity === 'error').map((p) => `${p.code}: ${p.path}: ${p.message}`),
  ];
  if (errors.length) throw new Error(errors.join('\n'));
  const warnings = [
    ...model.warnings.map((p) => `${p.code}: ${p.message}`),
    ...problems.filter((p) => p.severity === 'warning').map((p) => `${p.code}: ${p.message}`),
  ];
  return { ir: model.ir, scenario: scenario as ResolvedScenario, warnings };
}
