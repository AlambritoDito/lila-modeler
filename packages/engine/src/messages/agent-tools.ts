/**
 * Texts of the agent tools of #99, #403, #514 and #628 (annotate an element, the RACI matrix, a
 * scenario sheet as a tool, creating a `.lila`, the read-only inventory), English and Spanish,
 * shared by the CLI and the MCP server.
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
  processRaciOnPool: (process: string, pool: string) => string;
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
  // `put_process_bpmn` / `lila process import|export-bpmn` (#632)
  unsimulatableNote: (problem: string) => string;
  putMode: (mode: string) => string;
  putNoProject: (path: string) => string;
  putReplaceName: () => string;
  putScenarioBroken: (detail: string) => string;
  putScenarioNote: (entry: string, problem: string) => string;
  putSummary: (mode: 'add' | 'replace', dryRun: boolean, name: string, slug: string, file: string, revision: number) => string;
  bpmnRequired: () => string;
  bpmnWritten: (file: string) => string;
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
  // `lila project show` / `lila scenario show` (#628)
  projectShowHeader: (name: string, file: string, version: number) => string;
  projectShowProcess: (slug: string, name: string, processId: string, revision: number, elements: number | null) => string;
  projectShowScenarios: (count: number) => string;
  projectShowRuns: (count: number) => string;
  projectShowRevision: (revision: number) => string;
  projectShowExtends: (parent: string) => string;
  projectShowRun: (replications: number, start: string | null, current: boolean) => string;
  scenarioShowHeader: (entry: string, slug: string, revision: number, resolved: boolean) => string;
  scenarioShowNotes: (count: number) => string;
  scenarioShowRunnable: (runnable: boolean) => string;
}

/** Extended-attribute element types (`appliesTo`), as the app's attribute dialog names them. */
const EN_CATEGORIES: Readonly<Record<string, string>> = {
  task: 'tasks', gateway: 'gateways', event: 'events', subProcess: 'sub-processes', lane: 'pools and lanes', process: 'the process',
};
const ES_CATEGORIES: Readonly<Record<string, string>> = {
  task: 'tareas', gateway: 'compuertas', event: 'eventos', subProcess: 'subprocesos', lane: 'pools y carriles', process: 'el proceso',
};

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
    `attribute "${name}" applies to ${EN_CATEGORIES[appliesTo] ?? appliesTo}, not to ${id} (${category === '' ? 'it cannot carry attributes' : (EN_CATEGORIES[category] ?? category)}).`,
  processRaciOnPool: (process, pool) =>
    `the responsibilities and references of process ${process} belong to its pool ${pool}, where the app shows them; annotate ${pool} instead. Nothing was written.`,
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
    `the model has ${count} validation ${count === 1 ? 'error' : 'errors'}; nothing was written: ${detail}. To keep it as a diagram that does not simulate, pass allowUnsimulatable (--allow-unsimulatable).`,
  createScenarioNotObject: (name) => `scenario "${name}" must be a JSON object.`,
  createScenarioDuplicate: (entry) => `two scenarios would be saved as ${entry}.`,
  createScenarioModel: (name, model) =>
    `scenario "${name}" points to the model "${model}"; inside a .lila it is "model.bpmn" (or leave it out).`,
  createEmptyName: () => 'the project needs a name.',
  unsimulatableNote: (problem) => `does not simulate: ${problem}`,
  putMode: (mode) => `mode must be "add" or "replace"; got "${mode}".`,
  putNoProject: (path) =>
    `${path} does not exist; nothing was written. put_process_bpmn adds to an existing .lila: create it first with create_project (or create_process).`,
  putReplaceName: () => 'with mode "replace" the process keeps its name; `name` only names a process that is added. Nothing was written.',
  putScenarioBroken: (detail) =>
    `the new model would leave a scenario with errors it did not have; nothing was written:\n${detail}\nPass allowUnsimulatable (--allow-unsimulatable) to save it anyway.`,
  putScenarioNote: (entry, problem) => `${entry} cannot run as it is: ${problem}`,
  putSummary: (mode, dryRun, name, slug, file, revision) =>
    mode === 'add'
      ? dryRun
        ? `Dry run: would add process "${name}" (${slug}) to ${file}. Nothing was written.`
        : `Added process "${name}" (${slug}) to ${file}.`
      : dryRun
        ? `Dry run: would replace the model of process "${name}" (${slug}) in ${file} (revision ${revision}). Nothing was written.`
        : `Replaced the model of process "${name}" (${slug}) in ${file}: revision ${revision}.`,
  bpmnRequired: () => 'needs --bpmn <file.bpmn>.',
  bpmnWritten: (file) => `BPMN: ${file}`,
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
  projectShowHeader: (name, file, version) => `Project "${name}" (${file}), format version ${version}`,
  projectShowProcess: (slug, name, processId, revision, elements) =>
    `Process ${slug} "${name}": ${processId}, model revision ${revision}, ${elements === null ? 'model unreadable' : `${elements} ${elements === 1 ? 'element' : 'elements'}`}`,
  projectShowScenarios: (count) => `  ${count} ${count === 1 ? 'scenario' : 'scenarios'}${count === 0 ? '' : ':'}`,
  projectShowRuns: (count) => `  ${count} saved ${count === 1 ? 'run' : 'runs'}${count === 0 ? '' : ':'}`,
  projectShowRevision: (revision) => `revision ${revision}`,
  projectShowExtends: (parent) => `extends ${parent}`,
  projectShowRun: (replications, start, current) =>
    `${replications} ${replications === 1 ? 'replication' : 'replications'}${start === null ? '' : `, start ${start}`}, ${current ? 'current' : 'stale'}`,
  scenarioShowHeader: (entry, slug, revision, resolved) =>
    `Scenario ${entry} of process ${slug}, revision ${revision}${resolved ? ', resolved' : ', as stored'}:`,
  scenarioShowNotes: (count) => `${count} ${count === 1 ? 'note' : 'notes'} from the validator:`,
  scenarioShowRunnable: (runnable) => (runnable ? 'It can run.' : 'It cannot run as it is: see the errors above.'),
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
    `el atributo "${name}" se aplica a ${ES_CATEGORIES[appliesTo] ?? appliesTo}, no a ${id} (${category === '' ? 'no lleva atributos' : (ES_CATEGORIES[category] ?? category)}).`,
  processRaciOnPool: (process, pool) =>
    `las responsabilidades y referencias del proceso ${process} van en su pool ${pool}, que es donde la app las muestra; anota ${pool}. No se escribió nada.`,
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
    `el modelo tiene ${count} ${count === 1 ? 'error' : 'errores'} de validación; no se escribió nada: ${detail}. Para guardarlo como diagrama que no se simula, pasa allowUnsimulatable (--allow-unsimulatable).`,
  createScenarioNotObject: (name) => `el escenario "${name}" debe ser un objeto JSON.`,
  createScenarioDuplicate: (entry) => `dos escenarios se guardarían como ${entry}.`,
  createScenarioModel: (name, model) =>
    `el escenario "${name}" apunta al modelo "${model}"; dentro de un .lila es "model.bpmn" (u omítelo).`,
  createEmptyName: () => 'el proyecto necesita un nombre.',
  unsimulatableNote: (problem) => `no se simula: ${problem}`,
  putMode: (mode) => `mode debe ser "add" o "replace"; llegó "${mode}".`,
  putNoProject: (path) =>
    `${path} no existe; no se escribió nada. put_process_bpmn añade a un .lila que ya existe: créalo antes con create_project (o create_process).`,
  putReplaceName: () => 'con mode "replace" el proceso conserva su nombre; `name` solo nombra un proceso que se añade. No se escribió nada.',
  putScenarioBroken: (detail) =>
    `el modelo nuevo dejaría un escenario con errores que no tenía; no se escribió nada:\n${detail}\nPasa allowUnsimulatable (--allow-unsimulatable) para guardarlo de todos modos.`,
  putScenarioNote: (entry, problem) => `${entry} no se puede correr así: ${problem}`,
  putSummary: (mode, dryRun, name, slug, file, revision) =>
    mode === 'add'
      ? dryRun
        ? `Simulacro: se añadiría el proceso "${name}" (${slug}) a ${file}. No se escribió nada.`
        : `Añadido el proceso "${name}" (${slug}) a ${file}.`
      : dryRun
        ? `Simulacro: se reemplazaría el modelo del proceso "${name}" (${slug}) en ${file} (revisión ${revision}). No se escribió nada.`
        : `Reemplazado el modelo del proceso "${name}" (${slug}) en ${file}: revisión ${revision}.`,
  bpmnRequired: () => 'necesita --bpmn <archivo.bpmn>.',
  bpmnWritten: (file) => `BPMN: ${file}`,
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
  projectShowHeader: (name, file, version) => `Proyecto "${name}" (${file}), formato versión ${version}`,
  projectShowProcess: (slug, name, processId, revision, elements) =>
    `Proceso ${slug} "${name}": ${processId}, revisión del modelo ${revision}, ${elements === null ? 'modelo ilegible' : `${elements} ${elements === 1 ? 'elemento' : 'elementos'}`}`,
  projectShowScenarios: (count) => `  ${count} ${count === 1 ? 'escenario' : 'escenarios'}${count === 0 ? '' : ':'}`,
  projectShowRuns: (count) => `  ${count} ${count === 1 ? 'corrida guardada' : 'corridas guardadas'}${count === 0 ? '' : ':'}`,
  projectShowRevision: (revision) => `revisión ${revision}`,
  projectShowExtends: (parent) => `hereda de ${parent}`,
  projectShowRun: (replications, start, current) =>
    `${replications} ${replications === 1 ? 'réplica' : 'réplicas'}${start === null ? '' : `, inicio ${start}`}, ${current ? 'vigente' : 'obsoleta'}`,
  scenarioShowHeader: (entry, slug, revision, resolved) =>
    `Escenario ${entry} del proceso ${slug}, revisión ${revision}${resolved ? ', resuelto' : ', como está guardado'}:`,
  scenarioShowNotes: (count) => `${count} ${count === 1 ? 'nota' : 'notas'} del validador:`,
  scenarioShowRunnable: (runnable) => (runnable ? 'Se puede correr.' : 'No se puede correr así: mira los errores de arriba.'),
};

export const AGENT_TOOL_MESSAGES: Readonly<Record<Locale, AgentToolMessages>> = { en, es };

export function agentToolMessages(locale: Locale = 'en'): AgentToolMessages {
  return locale === 'es' ? es : en;
}
