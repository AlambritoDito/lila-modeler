/**
 * What is left of the Simulate rail (design 2a): Lote M replaced it with «Scenario ▾»
 * (`SelectorEscenario.tsx`), and this module keeps only the one question both that dropdown and the
 * scenario panel's header ask.
 */

/** BASE = a scenario with no `extends` parent. */
export const esEscenarioBase = (escenario: Record<string, unknown> | undefined): boolean =>
  typeof escenario?.['extends'] !== 'string';
