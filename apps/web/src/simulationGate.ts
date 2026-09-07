import { validateBpmnXml } from '@lila/engine/bpmn';
import { ScenarioSchema, resolveExtends, validateScenario, type ResolvedScenario } from '@lila/engine/schema';

/** La misma frontera de validación que CLI, antes de crear un Worker. */
export async function prepareSimulation(xml: string, file: string, scenarios: Readonly<Record<string, Record<string, unknown>>>) {
  const model = await validateBpmnXml(xml);
  const scenario = ScenarioSchema.parse(resolveExtends(file, (path) => {
    const raw = scenarios[path];
    if (raw === undefined) throw new Error(`Escenario desconocido: ${path}`);
    return raw;
  }));
  if (scenario.model === undefined || scenario.run === undefined) throw new Error('Falta model o run en el escenario resuelto.');
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
