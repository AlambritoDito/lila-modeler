import { validateBpmnXml } from '@lila/engine/bpmn';
import { parseScenario, resolveExtends, validateScenario, type ResolvedScenario } from '@lila/engine/schema';
import { es as S } from './strings.es';

/** La misma frontera de validación que CLI, antes de crear un Worker. */
export async function prepareSimulation(xml: string, file: string, scenarios: Readonly<Record<string, Record<string, unknown>>>, expectedModel = 'model.bpmn') {
  const model = await validateBpmnXml(xml);
  // `parseScenario` en vez de `ScenarioSchema.parse`: un `ZodError` sin capturar llega a la barra
  // de estado como su volcado JSON en inglés (LILA-202). Aquí sale la misma lista que en la CLI.
  const parsed = parseScenario(resolveExtends(file, (path) => {
    const raw = scenarios[path];
    if (raw === undefined) throw new Error(S.simulacion.errorEscenarioDesconocido(path));
    return raw;
  }));
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('\n'));
  const scenario = parsed.data;
  if (scenario.model === undefined || scenario.run === undefined) throw new Error(S.simulacion.errorFaltaModelORun);
  if (scenario.model !== expectedModel) throw new Error(S.simulacion.errorModeloDistinto(scenario.model, expectedModel));
  const problems = validateScenario(scenario, model.ir);
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
