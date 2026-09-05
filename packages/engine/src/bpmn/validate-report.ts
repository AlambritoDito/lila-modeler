/**
 * `validateBpmnXml`: arma el mismo objeto que imprime `lila validate --json` (LILA-045). Vive
 * aparte de `validate.ts` para que la CLI y el servidor MCP (LILA-053) compartan una sola
 * función en vez de duplicar el armado del reporte; no toca `core/`.
 */
import type { ProcessIR } from '../core/ir.js';
import { parseBpmn } from './parse.js';
import { validate, type ValidationResult } from './validate.js';

export interface ValidateBpmnReport {
  ir: ProcessIR;
  ignoredProcessIds: string[];
  errors: ValidationResult['errors'];
  warnings: ValidationResult['warnings'];
}

/** Parsea y valida un XML BPMN; nunca lanza por un modelo inválido (los errores van en el reporte). */
export async function validateBpmnXml(xml: string): Promise<ValidateBpmnReport> {
  const { ir, ignoredProcessIds, unsupported, messageFlowCount, conditionFlowIds } =
    await parseBpmn(xml);
  const validation = validate(ir, { unsupported, messageFlowCount, conditionFlowIds });
  return { ir, ignoredProcessIds, errors: validation.errors, warnings: validation.warnings };
}
