/**
 * Texts of the agent tools of #99, #403 and #514 (annotate an element, the RACI matrix, a scenario
 * sheet as a tool, creating a `.lila`), English and Spanish, shared by the CLI and the MCP server.
 *
 * Their own file, like `sheets.ts`: none of them is an `E-*`/`W-*` code, and keeping them out of
 * `en.ts`/`es.ts` keeps the main catalog to the problems of a model or a scenario.
 * `test/project-fs/agent-tools.test.ts` checks that both languages declare the same entries.
 */
import type { Locale } from './types.js';

export interface AgentToolMessages {
  unknownElement: (id: string, slug: string, file: string) => string;
  contentLoss: (detail: string) => string;
  nothingToAnnotate: () => string;
  raciType: (type: string) => string;
  emptyRoleRef: () => string;
  unknownRefKind: (kind: string, accepted: string) => string;
  emptyRef: (kind: string) => string;
  unknownAttribute: (key: string, available: string) => string;
  ambiguousAttribute: (name: string, ids: string) => string;
  attributeNotApplicable: (name: string, appliesTo: string, id: string, category: string) => string;
  attributeNumber: (name: string, value: string) => string;
  attributeDate: (name: string, value: string) => string;
  attributeOption: (name: string, value: string, options: string) => string;
  none: () => string;
  sheetUnreadable: (file: string) => string;
  sheetTooLarge: (file: string) => string;
  sheetOutOfBounds: (file: string) => string;
  importLint: (count: number, detail: string) => string;
  createNotLila: (path: string) => string;
  createExists: (path: string) => string;
  createDirectory: (path: string) => string;
  createModelUnparsable: (detail: string) => string;
  createModelInvalid: (count: number, detail: string) => string;
  createScenarioNotObject: (name: string) => string;
  createScenarioDuplicate: (entry: string) => string;
  createScenarioModel: (name: string, model: string) => string;
  createEmptyName: () => string;
  // CLI chrome
  processToolUnknown: (sub: string, accepted: string) => string;
  scenarioUnknown: (sub: string, accepted: string) => string;
  badResponsibilityArgument: (value: string) => string;
  badPairArgument: (option: string, value: string) => string;
  annotated: (id: string, file: string) => string;
  annotateDryRun: (id: string) => string;
  noChange: () => string;
  raciElement: () => string;
  raciLane: () => string;
  raciEmpty: (slug: string) => string;
  importChanges: (count: number) => string;
  importNotApplied: (count: number) => string;
  importNotes: (count: number) => string;
  importDryRun: () => string;
  importWritten: (entry: string, file: string) => string;
  importNothing: () => string;
  templateWritten: (file: string) => string;
  outRequired: () => string;
  newEntry: () => string;
}

const en: AgentToolMessages = {
  unknownElement: (id, slug, file) => `no element of process ${slug} in ${file} has the id "${id}"; nothing was written.`,
  contentLoss: (detail) =>
    `the model has content that cannot be written back without losing it, so it cannot be annotated: ${detail}`,
  nothingToAnnotate: () => 'pass at least one of documentation, responsibilities, refs or attributes.',
  raciType: (type) => `"${type}" is not a RACI type; use R, A, C or I.`,
  emptyRoleRef: () => 'every responsibility needs a roleRef.',
  unknownRefKind: (kind, accepted) => `"${kind}" is not a kind of reference; use one of ${accepted}.`,
  emptyRef: (kind) => `a ${kind} reference cannot be empty.`,
  unknownAttribute: (key, available) => `no extended attribute has the id or name "${key}"; defined: ${available}.`,
  ambiguousAttribute: (name, ids) => `the name "${name}" is shared by the attributes ${ids}; use the id.`,
  attributeNotApplicable: (name, appliesTo, id, category) =>
    `attribute "${name}" applies to ${appliesTo}, and ${id} is ${category === '' ? 'an element that cannot carry attributes' : `a ${category}`}.`,
  attributeNumber: (name, value) => `"${value}" is not a number for attribute "${name}"; write it like 12 or -3.5.`,
  attributeDate: (name, value) => `"${value}" is not a date for attribute "${name}"; write it as YYYY-MM-DD.`,
  attributeOption: (name, value, options) => `"${value}" is not an option of attribute "${name}"; use one of ${options}.`,
  none: () => 'none',
  sheetUnreadable: (file) => `${file} cannot be read as a spreadsheet (.xlsx, or a .csv/.txt table).`,
  sheetTooLarge: (file) => `${file} is too large to import.`,
  sheetOutOfBounds: (file) => `${file} has cells beyond the limits of a spreadsheet; it was not read.`,
  importLint: (count, detail) =>
    `the import would leave the scenario with ${count} ${count === 1 ? 'error' : 'errors'}; nothing was written: ${detail}`,
  createNotLila: (path) => `${path} is not a .lila path.`,
  createExists: (path) => `${path} already exists; nothing was written. Pass \`overwrite\` to replace it.`,
  createDirectory: (path) => `${path} is a directory; nothing was written.`,
  createModelUnparsable: (detail) => `the BPMN cannot be read; nothing was written: ${detail}`,
  createModelInvalid: (count, detail) =>
    `the model has ${count} validation ${count === 1 ? 'error' : 'errors'}; nothing was written: ${detail}`,
  createScenarioNotObject: (name) => `scenario "${name}" must be a JSON object.`,
  createScenarioDuplicate: (entry) => `two scenarios would be saved as ${entry}.`,
  createScenarioModel: (name, model) =>
    `scenario "${name}" points to the model "${model}"; inside a .lila it is "model.bpmn" (or leave it out).`,
  createEmptyName: () => 'the project needs a name.',
  processToolUnknown: (sub, accepted) => `unknown subcommand "${sub}"; use ${accepted}.`,
  scenarioUnknown: (sub, accepted) => `unknown subcommand "${sub}"; use ${accepted}.`,
  badResponsibilityArgument: (value) => `--responsibility takes TYPE:role, such as R:cashier; got "${value}".`,
  badPairArgument: (option, value) => `${option} takes key=value; got "${value}".`,
  annotated: (id, file) => `Annotated ${id} in ${file}.`,
  annotateDryRun: (id) => `Dry run: ${id} would be annotated as shown; nothing was written.`,
  noChange: () => 'Nothing changes: the element already says this. Nothing was written.',
  raciElement: () => 'Element',
  raciLane: () => 'Lane',
  raciEmpty: (slug) => `No element of process ${slug} has responsibilities (RACI).`,
  importChanges: (count) => `${count} ${count === 1 ? 'change' : 'changes'}:`,
  importNotApplied: (count) => `${count} ${count === 1 ? 'row' : 'rows'} not applied:`,
  importNotes: (count) => `${count} ${count === 1 ? 'note' : 'notes'}:`,
  importDryRun: () => 'Dry run: nothing was written.',
  importWritten: (entry, file) => `Saved ${entry} in ${file}.`,
  importNothing: () => 'The sheet changes nothing; nothing was written.',
  templateWritten: (file) => `Template: ${file}`,
  outRequired: () => 'needs --out <file.xlsx>.',
  newEntry: () => 'new',
};

const es: AgentToolMessages = {
  unknownElement: (id, slug, file) => `ningún elemento del proceso ${slug} de ${file} tiene el id "${id}"; no se escribió nada.`,
  contentLoss: (detail) =>
    `el modelo tiene contenido que no se puede volver a escribir sin perderlo, así que no se puede anotar: ${detail}`,
  nothingToAnnotate: () => 'pasa al menos uno de documentation, responsibilities, refs o attributes.',
  raciType: (type) => `"${type}" no es un tipo RACI; usa R, A, C o I.`,
  emptyRoleRef: () => 'cada responsabilidad necesita un roleRef.',
  unknownRefKind: (kind, accepted) => `"${kind}" no es un tipo de referencia; usa uno de ${accepted}.`,
  emptyRef: (kind) => `una referencia ${kind} no puede estar vacía.`,
  unknownAttribute: (key, available) => `ningún atributo extendido tiene el id o el nombre "${key}"; definidos: ${available}.`,
  ambiguousAttribute: (name, ids) => `el nombre "${name}" lo comparten los atributos ${ids}; usa el id.`,
  attributeNotApplicable: (name, appliesTo, id, category) =>
    `el atributo "${name}" se aplica a ${appliesTo}, y ${id} es ${category === '' ? 'un elemento que no lleva atributos' : `de tipo ${category}`}.`,
  attributeNumber: (name, value) => `"${value}" no es un número para el atributo "${name}"; escríbelo como 12 o -3.5.`,
  attributeDate: (name, value) => `"${value}" no es una fecha para el atributo "${name}"; escríbela como AAAA-MM-DD.`,
  attributeOption: (name, value, options) => `"${value}" no es una opción del atributo "${name}"; usa una de ${options}.`,
  none: () => 'ninguno',
  sheetUnreadable: (file) => `${file} no se puede leer como hoja de cálculo (.xlsx, o una tabla .csv/.txt).`,
  sheetTooLarge: (file) => `${file} es demasiado grande para importarlo.`,
  sheetOutOfBounds: (file) => `${file} tiene celdas fuera de los límites de una hoja de cálculo; no se leyó.`,
  importLint: (count, detail) =>
    `la importación dejaría el escenario con ${count} ${count === 1 ? 'error' : 'errores'}; no se escribió nada: ${detail}`,
  createNotLila: (path) => `${path} no es una ruta .lila.`,
  createExists: (path) => `${path} ya existe; no se escribió nada. Pasa \`overwrite\` para reemplazarlo.`,
  createDirectory: (path) => `${path} es una carpeta; no se escribió nada.`,
  createModelUnparsable: (detail) => `el BPMN no se puede leer; no se escribió nada: ${detail}`,
  createModelInvalid: (count, detail) =>
    `el modelo tiene ${count} ${count === 1 ? 'error' : 'errores'} de validación; no se escribió nada: ${detail}`,
  createScenarioNotObject: (name) => `el escenario "${name}" debe ser un objeto JSON.`,
  createScenarioDuplicate: (entry) => `dos escenarios se guardarían como ${entry}.`,
  createScenarioModel: (name, model) =>
    `el escenario "${name}" apunta al modelo "${model}"; dentro de un .lila es "model.bpmn" (u omítelo).`,
  createEmptyName: () => 'el proyecto necesita un nombre.',
  processToolUnknown: (sub, accepted) => `subcomando desconocido "${sub}"; usa ${accepted}.`,
  scenarioUnknown: (sub, accepted) => `subcomando desconocido "${sub}"; usa ${accepted}.`,
  badResponsibilityArgument: (value) => `--responsibility recibe TIPO:rol, como R:cajero; llegó "${value}".`,
  badPairArgument: (option, value) => `${option} recibe clave=valor; llegó "${value}".`,
  annotated: (id, file) => `Anotado ${id} en ${file}.`,
  annotateDryRun: (id) => `Simulacro: ${id} quedaría anotado así; no se escribió nada.`,
  noChange: () => 'No cambia nada: el elemento ya dice esto. No se escribió nada.',
  raciElement: () => 'Elemento',
  raciLane: () => 'Carril',
  raciEmpty: (slug) => `Ningún elemento del proceso ${slug} tiene responsabilidades (RACI).`,
  importChanges: (count) => `${count} ${count === 1 ? 'cambio' : 'cambios'}:`,
  importNotApplied: (count) => `${count} ${count === 1 ? 'fila no aplicada' : 'filas no aplicadas'}:`,
  importNotes: (count) => `${count} ${count === 1 ? 'nota' : 'notas'}:`,
  importDryRun: () => 'Simulacro: no se escribió nada.',
  importWritten: (entry, file) => `Guardado ${entry} en ${file}.`,
  importNothing: () => 'La hoja no cambia nada; no se escribió nada.',
  templateWritten: (file) => `Plantilla: ${file}`,
  outRequired: () => 'necesita --out <archivo.xlsx>.',
  newEntry: () => 'nuevo',
};

export const AGENT_TOOL_MESSAGES: Readonly<Record<Locale, AgentToolMessages>> = { en, es };

export function agentToolMessages(locale: Locale = 'en'): AgentToolMessages {
  return locale === 'es' ? es : en;
}
