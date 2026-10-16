/**
 * Texts of the agent tools of #99, #403, #514, #628, #633 and #634 (annotate an element, the RACI
 * matrix, a scenario sheet as a tool, creating a `.lila`, the read-only inventory, defining an
 * extended attribute, renaming and deleting processes and scenarios), English and Spanish, shared
 * by the CLI and the MCP server.
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
  // define_attribute (#633)
  attributeIncomplete: () => string;
  attributeRemoveTarget: () => string;
  attributeUnknownId: (id: string, defined: string) => string;
  attributeNameEmpty: () => string;
  attributeTypeUnknown: (type: string, accepted: string) => string;
  attributeAppliesToUnknown: (appliesTo: string, accepted: string) => string;
  attributeNoOptions: (name: string) => string;
  attributeOptionsNotList: (name: string, type: string) => string;
  attributeDuplicate: (name: string, appliesTo: string, id: string) => string;
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
  // `rename_process`, `delete_process`, `rename_scenario`, `delete_scenario` (#634)
  manageEmptyName: () => string;
  manageSingleProcess: (file: string) => string;
  manageLastProcess: (slug: string, file: string) => string;
  manageProcessCalled: (slug: string, callers: string) => string;
  manageOneProcessLeft: (name: string, slug: string) => string;
  manageLastScenario: (entry: string, slug: string) => string;
  manageScenarioExtended: (entry: string, children: string) => string;
  manageScenarioNameTaken: (name: string, other: string) => string;
  manageBaseScenarioNote: (entry: string) => string;
  manageNoChange: () => string;
  processRenamed: (dryRun: boolean, slug: string, before: string, after: string, file: string) => string;
  processDeleted: (dryRun: boolean, slug: string, name: string, file: string, scenarios: number, runs: number) => string;
  scenarioRenamed: (dryRun: boolean, entry: string, slug: string, name: string, file: string) => string;
  scenarioDeleted: (dryRun: boolean, entry: string, slug: string, file: string, runs: number) => string;
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
  attributeSaved: (name: string, id: string, file: string) => string;
  attributeRemoved: (id: string, file: string) => string;
  attributeDryRun: () => string;
  attributeNoChange: () => string;
  attributeRemovedValues: (count: number) => string;
  attributeLine: (id: string, name: string, type: string, appliesTo: string, options: string | null, fallback: string | null) => string;
  attributeListEmpty: (slug: string) => string;
  // `lila project show` / `lila scenario show` (#628)
  projectShowHeader: (name: string, file: string, version: number) => string;
  projectShowProcess: (slug: string, name: string, processId: string, revision: number, elements: number | null) => string;
  projectShowScenarios: (count: number) => string;
  projectShowRuns: (count: number) => string;
  projectShowAttributes: (count: number | null) => string;
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
  attributeIncomplete: () =>
    'pass the whole definition of the attribute: name, type and appliesTo, and its options and default when it has them.',
  attributeRemoveTarget: () => 'to remove an attribute, pass its id, or its name and appliesTo.',
  attributeUnknownId: (id, defined) =>
    `no extended attribute has the id "${id}"; defined: ${defined}. Leave id out to create one. Nothing was written.`,
  attributeNameEmpty: () => 'an extended attribute needs a name.',
  attributeTypeUnknown: (type, accepted) => `"${type}" is not an attribute type; use one of ${accepted}.`,
  attributeAppliesToUnknown: (appliesTo, accepted) => `"${appliesTo}" is not an element type for attributes; use one of ${accepted}.`,
  attributeNoOptions: (name) => `attribute "${name}" is a list and needs at least one option.`,
  attributeOptionsNotList: (name, type) => `attribute "${name}" is of type ${type}; only a list takes options.`,
  attributeDuplicate: (name, appliesTo, id) =>
    `an attribute for ${EN_CATEGORIES[appliesTo] ?? appliesTo} is already named "${name}" (${id}); pass its id to change it.`,
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
  manageEmptyName: () => 'the new name cannot be empty. Nothing was written.',
  manageSingleProcess: (file) =>
    `${file} has a single process, and a project with one process is saved under the project's name; a process is renamed only in a project with two or more. Nothing was written.`,
  manageLastProcess: (slug, file) => `${slug} is the only process of ${file}, and a project keeps at least one. Nothing was written.`,
  manageProcessCalled: (slug, callers) =>
    `process ${slug} is the target of call activities in other processes: ${callers}. Point them at another process first. Nothing was written.`,
  manageOneProcessLeft: (name, slug) =>
    `"${name}" is now the only process: the project is written as a version 1 archive, where its process takes the project's name and the slug ${slug}.`,
  manageLastScenario: (entry, slug) => `${entry} is the only scenario of process ${slug}, and a process keeps at least one. Nothing was written.`,
  manageScenarioExtended: (entry, children) =>
    `other scenarios extend ${entry}: ${children}. Delete them first or change their extends. Nothing was written.`,
  manageScenarioNameTaken: (name, other) =>
    `the scenario ${other} of this process already goes by "${name}", so the name would no longer find one scenario. Nothing was written.`,
  manageBaseScenarioNote: (entry) =>
    `${entry} is gone: edit_process (lila process edit) stores the durations, resources and branch probabilities it is given in that scenario, so it can no longer take them.`,
  manageNoChange: () => 'Nothing changes: it already has that name. Nothing was written.',
  processRenamed: (dryRun, slug, before, after, file) =>
    dryRun
      ? `Dry run: would rename process ${slug} from "${before}" to "${after}" in ${file}. Nothing was written.`
      : `Renamed process ${slug} from "${before}" to "${after}" in ${file}.`,
  processDeleted: (dryRun, slug, name, file, scenarios, runs) => {
    const what = `${scenarios} ${scenarios === 1 ? 'scenario' : 'scenarios'} and ${runs} saved ${runs === 1 ? 'run' : 'runs'}`;
    return dryRun
      ? `Dry run: would delete process "${name}" (${slug}) from ${file}, with ${what}. Nothing was written.`
      : `Deleted process "${name}" (${slug}) from ${file}, with ${what}.`;
  },
  scenarioRenamed: (dryRun, entry, slug, name, file) =>
    dryRun
      ? `Dry run: would rename scenario ${entry} of process ${slug} to "${name}" in ${file}. Nothing was written.`
      : `Renamed scenario ${entry} of process ${slug} to "${name}" in ${file}.`,
  scenarioDeleted: (dryRun, entry, slug, file, runs) => {
    const what = `${runs} saved ${runs === 1 ? 'run' : 'runs'}`;
    return dryRun
      ? `Dry run: would delete scenario ${entry} of process ${slug} from ${file}, with ${what}. Nothing was written.`
      : `Deleted scenario ${entry} of process ${slug} from ${file}, with ${what}.`;
  },
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
  attributeSaved: (name, id, file) => `Saved attribute "${name}" (${id}) in ${file}.`,
  attributeRemoved: (id, file) => `Removed attribute ${id} from ${file}.`,
  attributeDryRun: () => 'Dry run: the attribute would be saved as shown; nothing was written.',
  attributeNoChange: () => 'Nothing changes: the project already says this. Nothing was written.',
  attributeRemovedValues: (count) => `${count} ${count === 1 ? 'value' : 'values'} removed:`,
  attributeLine: (id, name, type, appliesTo, options, fallback) =>
    `${id}  "${name}"  ${type}, for ${EN_CATEGORIES[appliesTo] ?? appliesTo}${options === null ? '' : `, options ${options}`}${fallback === null ? '' : `, default ${fallback}`}`,
  attributeListEmpty: (slug) => `Process ${slug} defines no extended attributes.`,
  projectShowHeader: (name, file, version) => `Project "${name}" (${file}), format version ${version}`,
  projectShowProcess: (slug, name, processId, revision, elements) =>
    `Process ${slug} "${name}": ${processId}, model revision ${revision}, ${elements === null ? 'model unreadable' : `${elements} ${elements === 1 ? 'element' : 'elements'}`}`,
  projectShowScenarios: (count) => `  ${count} ${count === 1 ? 'scenario' : 'scenarios'}${count === 0 ? '' : ':'}`,
  projectShowRuns: (count) => `  ${count} saved ${count === 1 ? 'run' : 'runs'}${count === 0 ? '' : ':'}`,
  projectShowAttributes: (count) =>
    count === null
      ? '  extended attributes: unreadable model'
      : `  ${count} extended ${count === 1 ? 'attribute' : 'attributes'}${count === 0 ? '' : ':'}`,
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
  attributeIncomplete: () =>
    'pasa la definición entera del atributo: name, type y appliesTo, y sus opciones y su valor por defecto si los tiene.',
  attributeRemoveTarget: () => 'para quitar un atributo pasa su id, o su nombre y appliesTo.',
  attributeUnknownId: (id, defined) =>
    `ningún atributo extendido tiene el id "${id}"; definidos: ${defined}. Omite el id para crear uno. No se escribió nada.`,
  attributeNameEmpty: () => 'un atributo extendido necesita un nombre.',
  attributeTypeUnknown: (type, accepted) => `"${type}" no es un tipo de atributo; usa uno de ${accepted}.`,
  attributeAppliesToUnknown: (appliesTo, accepted) => `"${appliesTo}" no es un tipo de elemento para atributos; usa uno de ${accepted}.`,
  attributeNoOptions: (name) => `el atributo "${name}" es una lista y necesita al menos una opción.`,
  attributeOptionsNotList: (name, type) => `el atributo "${name}" es de tipo ${type}; solo una lista lleva opciones.`,
  attributeDuplicate: (name, appliesTo, id) =>
    `ya hay un atributo para ${ES_CATEGORIES[appliesTo] ?? appliesTo} llamado "${name}" (${id}); pasa su id para cambiarlo.`,
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
  manageEmptyName: () => 'el nombre nuevo no puede estar vacío. No se escribió nada.',
  manageSingleProcess: (file) =>
    `${file} tiene un solo proceso, y un proyecto con un proceso se guarda con el nombre del proyecto; un proceso solo se renombra en un proyecto con dos o más. No se escribió nada.`,
  manageLastProcess: (slug, file) => `${slug} es el único proceso de ${file}, y un proyecto conserva al menos uno. No se escribió nada.`,
  manageProcessCalled: (slug, callers) =>
    `el proceso ${slug} es el destino de actividades de llamada de otros procesos: ${callers}. Apúntalas a otro proceso antes. No se escribió nada.`,
  manageOneProcessLeft: (name, slug) =>
    `"${name}" queda como único proceso: el proyecto se escribe como un archivo de versión 1, donde su proceso toma el nombre del proyecto y el slug ${slug}.`,
  manageLastScenario: (entry, slug) => `${entry} es el único escenario del proceso ${slug}, y un proceso conserva al menos uno. No se escribió nada.`,
  manageScenarioExtended: (entry, children) =>
    `otros escenarios heredan de ${entry}: ${children}. Bórralos antes o cambia su extends. No se escribió nada.`,
  manageScenarioNameTaken: (name, other) =>
    `el escenario ${other} de este proceso ya se llama "${name}", así que el nombre dejaría de encontrar un solo escenario. No se escribió nada.`,
  manageBaseScenarioNote: (entry) =>
    `${entry} ya no está: edit_process (lila process edit) guarda en ese escenario las duraciones, los recursos y las probabilidades de rama que recibe, así que ya no podrá recibirlos.`,
  manageNoChange: () => 'No cambia nada: ya tiene ese nombre. No se escribió nada.',
  processRenamed: (dryRun, slug, before, after, file) =>
    dryRun
      ? `Simulacro: se renombraría el proceso ${slug} de "${before}" a "${after}" en ${file}. No se escribió nada.`
      : `Renombrado el proceso ${slug} de "${before}" a "${after}" en ${file}.`,
  processDeleted: (dryRun, slug, name, file, scenarios, runs) => {
    const what = `${scenarios} ${scenarios === 1 ? 'escenario' : 'escenarios'} y ${runs} ${runs === 1 ? 'corrida guardada' : 'corridas guardadas'}`;
    return dryRun
      ? `Simulacro: se borraría el proceso "${name}" (${slug}) de ${file}, con ${what}. No se escribió nada.`
      : `Borrado el proceso "${name}" (${slug}) de ${file}, con ${what}.`;
  },
  scenarioRenamed: (dryRun, entry, slug, name, file) =>
    dryRun
      ? `Simulacro: se renombraría el escenario ${entry} del proceso ${slug} a "${name}" en ${file}. No se escribió nada.`
      : `Renombrado el escenario ${entry} del proceso ${slug} a "${name}" en ${file}.`,
  scenarioDeleted: (dryRun, entry, slug, file, runs) => {
    const what = `${runs} ${runs === 1 ? 'corrida guardada' : 'corridas guardadas'}`;
    return dryRun
      ? `Simulacro: se borraría el escenario ${entry} del proceso ${slug} de ${file}, con ${what}. No se escribió nada.`
      : `Borrado el escenario ${entry} del proceso ${slug} de ${file}, con ${what}.`;
  },
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
  attributeSaved: (name, id, file) => `Guardado el atributo "${name}" (${id}) en ${file}.`,
  attributeRemoved: (id, file) => `Quitado el atributo ${id} de ${file}.`,
  attributeDryRun: () => 'Simulacro: el atributo quedaría así; no se escribió nada.',
  attributeNoChange: () => 'No cambia nada: el proyecto ya dice esto. No se escribió nada.',
  attributeRemovedValues: (count) => `${count} ${count === 1 ? 'valor quitado' : 'valores quitados'}:`,
  attributeLine: (id, name, type, appliesTo, options, fallback) =>
    `${id}  "${name}"  ${type}, para ${ES_CATEGORIES[appliesTo] ?? appliesTo}${options === null ? '' : `, opciones ${options}`}${fallback === null ? '' : `, por defecto ${fallback}`}`,
  attributeListEmpty: (slug) => `El proceso ${slug} no define atributos extendidos.`,
  projectShowHeader: (name, file, version) => `Proyecto "${name}" (${file}), formato versión ${version}`,
  projectShowProcess: (slug, name, processId, revision, elements) =>
    `Proceso ${slug} "${name}": ${processId}, revisión del modelo ${revision}, ${elements === null ? 'modelo ilegible' : `${elements} ${elements === 1 ? 'elemento' : 'elementos'}`}`,
  projectShowScenarios: (count) => `  ${count} ${count === 1 ? 'escenario' : 'escenarios'}${count === 0 ? '' : ':'}`,
  projectShowRuns: (count) => `  ${count} ${count === 1 ? 'corrida guardada' : 'corridas guardadas'}${count === 0 ? '' : ':'}`,
  projectShowAttributes: (count) =>
    count === null
      ? '  atributos extendidos: modelo ilegible'
      : `  ${count} ${count === 1 ? 'atributo extendido' : 'atributos extendidos'}${count === 0 ? '' : ':'}`,
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
