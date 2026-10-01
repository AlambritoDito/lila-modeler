/**
 * `validateBpmnXml`: arma el mismo objeto que imprime `lila validate --json` (LILA-045). Vive
 * aparte de `validate.ts` para que la CLI y el servidor MCP (LILA-053) compartan una sola
 * función en vez de duplicar el armado del reporte; no toca `core/`.
 */
import type { ProcessIR } from '../core/ir.js';
import type { Locale } from '../messages/index.js';
import { parseBpmn, type ParseResult } from './parse.js';
import { validate, type ValidationResult } from './validate.js';

/** Opciones de `validateBpmnXml`. */
export interface ValidateBpmnXmlOptions {
  /** Idioma de los `message` del reporte (LILA-211). */
  locale?: Locale | undefined;
  /** #546: the ids the scenario to run configures; see `ParseBpmnOptions.scenarioIds`. */
  scenarioIds?: Iterable<string> | undefined;
}

export interface ValidateBpmnReport {
  ir: ProcessIR;
  ignoredProcessIds: string[];
  errors: ValidationResult['errors'];
  warnings: ValidationResult['warnings'];
}

/** `validateBpmnXml` plus where the other processes' elements are (#546), for `validateScenario`. */
export interface ValidatedBpmnModel extends ValidateBpmnReport {
  elsewhere: NonNullable<ParseResult['elsewhere']>;
}

/**
 * The one parse-and-validate step of every run (CLI, MCP, web and desktop): `scenarioIds` picks
 * the process the scenario targets, and `elsewhere` lets `validateScenario` say where an entry of
 * another process is. Never throws for an invalid model.
 */
export async function validateBpmnModel(
  xml: string,
  options: ValidateBpmnXmlOptions = {},
): Promise<ValidatedBpmnModel> {
  const { ir, ignoredProcessIds, unsupported, messageFlowCount, conditionFlowIds, elsewhere } =
    await parseBpmn(xml, { scenarioIds: options.scenarioIds });
  const validation = validate(ir, {
    unsupported,
    messageFlowCount,
    conditionFlowIds,
    locale: options.locale,
  });
  return { ir, ignoredProcessIds, errors: validation.errors, warnings: validation.warnings, elsewhere: elsewhere ?? {} };
}

/**
 * Parsea y valida un XML BPMN; nunca lanza por un modelo inválido (los errores van en el reporte).
 * The report is the documented `lila validate --json` object, so it leaves `elsewhere` out.
 */
export async function validateBpmnXml(
  xml: string,
  options: ValidateBpmnXmlOptions = {},
): Promise<ValidateBpmnReport> {
  const { ir, ignoredProcessIds, errors, warnings } = await validateBpmnModel(xml, options);
  return { ir, ignoredProcessIds, errors, warnings };
}
