/**
 * `lila process annotate|raci` (#99), `lila scenario import|template` (#514), the read-only
 * `lila project show` and `lila scenario show` (#628), `lila process export-bpmn|import` (#632) and
 * `lila process attribute define|list` (#633), `lila scenario patch` and `lila project create` (#635):
 * the CLI side of the MCP tools `annotate_element`, `get_raci_matrix`, `import_scenario_sheet`,
 * `export_scenario_template`, `get_project`, `get_scenario`, `get_process_bpmn`, `put_process_bpmn`,
 * `define_attribute`, `patch_scenario` (for a `.lila`) and `create_project`, over the same
 * `@lila-modeler/engine/project-fs` functions. Kept out of `cli.ts` so that file only dispatches here.
 */
import { existsSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Annotations, AttributeDefinition, Responsibility } from './bpmn/index.js';
import { readJsonFile } from './cli-shared.js';
import { agentToolMessages, messages, type Locale } from './messages/index.js';
import {
  annotateLilaElement,
  createLilaProject,
  defineLilaAttribute,
  importLilaScenarioSheet,
  isLilaPath,
  lilaAttributeList,
  lilaProjectInventory,
  lilaRaciMatrix,
  lilaScenarioTemplate,
  lilaScenarioView,
  patchLilaScenario,
  putLilaProcessBpmn,
  raciCsv,
  readLilaProcessBpmn,
  writeExportFile,
  type JsonPatchOp,
  type LilaProjectInventory,
  type LilaRaciMatrix,
} from './project-fs/index.js';

/** The `process` subcommands this file answers. */
export const PROCESS_TOOL_SUBCOMMANDS = ['annotate', 'raci', 'export-bpmn', 'import', 'attribute'] as const;

/** Options of `lila process` (any subcommand) that take a value, so their value is not a subcommand. */
const PROCESS_VALUE_OPTIONS = new Set([
  '--outline', '--project', '-p', '--process', '--name',
  '--documentation', '--responsibility', '--ref', '--attribute', '--bpmn', '--out',
  '--id', '--type', '--applies-to', '--option', '--default',
]);

/** Index of the subcommand in `lila process …` arguments: the first positional, past any option. */
function subcommandIndex(argv: readonly string[]): number {
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === '--') return index + 1 < argv.length ? index + 1 : -1;
    if (!token.startsWith('-')) return index;
    if (PROCESS_VALUE_OPTIONS.has(token)) index++;
  }
  return -1;
}

/**
 * Whether `lila process …` is one of this file's subcommands (the others are `create`/`show`, in
 * `cli.ts`), wherever it comes among the options: `lila process --process x annotate …` too.
 */
export function isProcessToolSubcommand(argv: readonly string[]): boolean {
  const index = subcommandIndex(argv);
  return index !== -1 && (PROCESS_TOOL_SUBCOMMANDS as readonly string[]).includes(argv[index]!);
}

/** `R:cajero` → `{ type: 'R', roleRef: 'cajero' }`. */
function responsibilityOf(value: string, locale: Locale): Responsibility {
  const colon = value.indexOf(':');
  if (colon < 1 || colon === value.length - 1) throw new Error(agentToolMessages(locale).badResponsibilityArgument(value));
  return { type: value.slice(0, colon).trim().toUpperCase(), roleRef: value.slice(colon + 1).trim() };
}

/** `key=value` → `[key, value]`; the value may be empty. */
function pairOf(option: string, value: string, locale: Locale): [string, string] {
  const equals = value.indexOf('=');
  if (equals < 1) throw new Error(agentToolMessages(locale).badPairArgument(option, value));
  return [value.slice(0, equals).trim(), value.slice(equals + 1)];
}

/** An element's annotations, one labelled line each, the way the process document reads. */
function printAnnotations(annotations: Annotations, locale: Locale): void {
  const C = messages(locale).cli;
  if (annotations.documentation !== undefined) console.log(`  ${C.docDocumentation()}: ${annotations.documentation}`);
  if (annotations.responsibilities !== undefined) {
    console.log(`  ${C.docResponsibilities()}: ${annotations.responsibilities.map((r) => `${r.type}: ${r.roleRef}`).join(', ')}`);
  }
  for (const [kind, refs] of Object.entries(annotations.refs ?? {})) console.log(`  lila:${kind}: ${refs.join(', ')}`);
  for (const { ref, value } of annotations.attributes ?? []) console.log(`  ${ref}: ${value}`);
}

function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function help(locale: Locale): number {
  console.log(messages(locale).cli.usage());
  return 0;
}

function usageError(command: string, body: string, locale: Locale): number {
  console.error(messages(locale).cli.commandError(command, body));
  return 1;
}

async function annotateCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      process: { type: 'string' },
      documentation: { type: 'string' },
      responsibility: { type: 'string', multiple: true },
      'clear-responsibilities': { type: 'boolean' },
      ref: { type: 'string', multiple: true },
      attribute: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (positionals.length !== 2) return usageError('process annotate', C.expectedPositionals('<project.lila> <elementId>'), locale);
  const [file, elementId] = positionals as [string, string];
  const responsibilities =
    values['clear-responsibilities'] === true
      ? []
      : values.responsibility?.map((value) => responsibilityOf(value, locale));
  let refs: Record<string, string[]> | undefined;
  for (const value of values.ref ?? []) {
    const [kind, ref] = pairOf('--ref', value, locale);
    refs ??= {};
    refs[kind] ??= [];
    // `--ref systemRef=` clears that kind.
    if (ref !== '') refs[kind].push(ref);
  }
  const attributes = values.attribute === undefined
    ? undefined
    : Object.fromEntries(values.attribute.map((value) => pairOf('--attribute', value, locale)));
  const result = await annotateLilaElement({
    file,
    process: values.process,
    elementId,
    documentation: values.documentation,
    responsibilities,
    refs,
    attributes,
    dryRun: values['dry-run'] === true,
    locale,
  });
  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(!result.changed ? T.noChange() : result.dryRun ? T.annotateDryRun(elementId) : T.annotated(elementId, result.file));
  printAnnotations(result.after, locale);
  return 0;
}

/** The matrix as a text table: element (and lane), then one column per role. */
function printRaci(matrix: LilaRaciMatrix, locale: Locale): void {
  const T = agentToolMessages(locale);
  if (matrix.rows.length === 0) {
    console.log(T.raciEmpty(matrix.process));
    return;
  }
  const withLanes = matrix.rows.some((row) => row.lane !== undefined);
  const header = [T.raciElement(), ...(withLanes ? [T.raciLane()] : []), ...matrix.roles];
  const rows = matrix.rows.map((row) => [
    row.name === row.id ? row.id : `${row.name} (${row.id})`,
    ...(withLanes ? [row.lane ?? ''] : []),
    ...matrix.roles.map((role) => row.cells[role] ?? ''),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  for (const line of [header, ...rows]) console.log(line.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd());
}

async function raciCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { process: { type: 'string' }, json: { type: 'boolean' }, csv: { type: 'boolean' } },
    allowPositionals: true,
  });
  const C = messages(locale).cli;
  if (positionals.length !== 1) return usageError('process raci', C.expectedPositionals('<project.lila>'), locale);
  const matrix = await lilaRaciMatrix({ file: positionals[0]!, process: values.process, locale });
  if (values.json === true) console.log(JSON.stringify(matrix, null, 2));
  else if (values.csv === true) process.stdout.write(raciCsv(matrix));
  else printRaci(matrix, locale);
  return 0;
}

/** `lila process export-bpmn` (#632): the model XML of one process, to `--out` or stdout. Writes nothing else. */
async function exportBpmnCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { project: { type: 'string', short: 'p' }, process: { type: 'string' }, out: { type: 'string' }, force: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (positionals.length > 0) return usageError('process export-bpmn', C.expectedPositionals('export-bpmn'), locale);
  if (values.project === undefined) return usageError('process export-bpmn', C.processMissingOption('-p/--project <file.lila>'), locale);
  const read = await readLilaProcessBpmn(values.project, { process: values.process, locale });
  if (values.out === undefined) process.stdout.write(read.xml);
  else console.log(T.bpmnWritten(writeExportFile(values.out, read.xml, { overwrite: values.force === true, source: read.file, locale })));
  return 0;
}

/** `lila process import` (#632): a BPMN as a new process of a `.lila`, or `--replace` the model of one. */
async function importBpmnCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      project: { type: 'string', short: 'p' },
      bpmn: { type: 'string' },
      replace: { type: 'boolean' },
      process: { type: 'string' },
      name: { type: 'string' },
      'no-layout': { type: 'boolean' },
      'allow-unsimulatable': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (positionals.length > 0) return usageError('process import', C.expectedPositionals('import'), locale);
  if (values.project === undefined) return usageError('process import', C.processMissingOption('-p/--project <file.lila>'), locale);
  if (values.bpmn === undefined) return usageError('process import', T.bpmnRequired(), locale);
  const result = await putLilaProcessBpmn({
    file: values.project,
    mode: values.replace === true ? 'replace' : 'add',
    bpmn: values.bpmn,
    process: values.process,
    name: values.name,
    layout: values['no-layout'] !== true,
    allowUnsimulatable: values['allow-unsimulatable'] === true,
    dryRun: values['dry-run'] === true,
    locale,
  });
  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(result.summary);
  for (const note of result.notes) console.log(`${C.warningLabel()} ${note}`);
  for (const warning of result.warnings) console.log(`${C.warningLabel()} ${warning}`);
  return 0;
}

/** One definition per line, as `lila process attribute list` and `lila project show` print it. */
function printDefinitions(definitions: readonly AttributeDefinition[], indent: string, locale: Locale): void {
  const T = agentToolMessages(locale);
  for (const d of definitions) {
    console.log(`${indent}${T.attributeLine(d.id, d.name, d.type, d.appliesTo, d.options === undefined ? null : d.options.join(', '), d.default ?? null)}`);
  }
}

/** `lila process attribute define|list` (#633). */
async function attributeCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      process: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      'applies-to': { type: 'string' },
      option: { type: 'string', multiple: true },
      default: { type: 'string' },
      remove: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  const [sub, file, ...extra] = positionals;
  if (sub !== 'define' && sub !== 'list') {
    return usageError('process attribute', T.processToolUnknown(sub ?? '', 'define, list'), locale);
  }
  if (file === undefined || extra.length > 0) return usageError(`process attribute ${sub}`, C.expectedPositionals('<project.lila>'), locale);
  if (sub === 'list') {
    const list = await lilaAttributeList({ file, process: values.process, locale });
    if (values.json === true) console.log(JSON.stringify(list, null, 2));
    else if (list.definitions.length === 0) console.log(T.attributeListEmpty(list.process));
    else printDefinitions(list.definitions, '', locale);
    return 0;
  }
  const result = await defineLilaAttribute({
    file,
    process: values.process,
    id: values.id,
    name: values.name,
    type: values.type,
    appliesTo: values['applies-to'],
    options: values.option,
    default: values.default,
    remove: values.remove === true,
    dryRun: values['dry-run'] === true,
    locale,
  });
  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const done = result.after === null
    ? T.attributeRemoved(result.before?.id ?? values.id ?? values.name ?? '', result.file)
    : T.attributeSaved(result.after.name, result.after.id, result.file);
  console.log(!result.changed ? T.attributeNoChange() : result.dryRun ? T.attributeDryRun() : done);
  if (result.after !== null) printDefinitions([result.after], '  ', locale);
  if (result.removedValues.length > 0) {
    console.log(T.attributeRemovedValues(result.removedValues.length));
    for (const { elementId, value } of result.removedValues) console.log(`  ${elementId}: ${value}`);
  }
  return 0;
}

/** `lila process annotate|raci|export-bpmn|import|attribute`. */
export async function dispatchProcessTools(argv: readonly string[], locale: Locale): Promise<number> {
  if (wantsHelp(argv)) return help(locale);
  const index = subcommandIndex(argv);
  const sub = index === -1 ? undefined : argv[index];
  const rest = index === -1 ? [...argv] : [...argv.slice(0, index), ...argv.slice(index + 1)];
  if (sub === 'annotate') return annotateCommand(rest, locale);
  if (sub === 'raci') return raciCommand(rest, locale);
  if (sub === 'export-bpmn') return exportBpmnCommand(rest, locale);
  if (sub === 'import') return importBpmnCommand(rest, locale);
  if (sub === 'attribute') return attributeCommand(rest, locale);
  return usageError('process', agentToolMessages(locale).processToolUnknown(sub ?? '', PROCESS_TOOL_SUBCOMMANDS.join(', ')), locale);
}

async function importCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { process: { type: 'string' }, 'dry-run': { type: 'boolean' }, json: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (positionals.length !== 3) {
    return usageError('scenario import', C.expectedPositionals('<project.lila> <scenario> <sheet.xlsx|sheet.csv>'), locale);
  }
  const [file, scenario, sheet] = positionals as [string, string, string];
  const result = await importLilaScenarioSheet({ file, process: values.process, scenario, sheet, dryRun: values['dry-run'] === true, locale });
  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const notApplied = result.issues.filter((issue) => issue.kind === 'error' || issue.kind === 'unmatched' || issue.kind === 'ambiguous');
  const notes = result.issues.filter((issue) => issue.kind === 'warning');
  const lint = result.issues.filter((issue) => issue.kind === 'lint');
  console.log(T.importChanges(result.changes.length));
  for (const change of result.changes) console.log(`  ${change.text}`);
  for (const [title, list] of [[T.importNotApplied(notApplied.length), notApplied], [T.importNotes(notes.length), notes]] as const) {
    if (list.length === 0) continue;
    console.log(title);
    for (const issue of list) console.log(`  ${issue.text}`);
  }
  for (const issue of lint) console.log(`${C.errorLabel()}  ${issue.text}`);
  console.log(
    result.written ? T.importWritten(result.scenario, result.file) : result.dryRun ? T.importDryRun() : T.importNothing(),
  );
  return 0;
}

async function templateCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const C = messages(locale).cli;
  const T = agentToolMessages(locale);
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { process: { type: 'string' }, out: { type: 'string' }, force: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (positionals.length !== 2) return usageError('scenario template', C.expectedPositionals('<project.lila> <scenario>'), locale);
  if (values.out === undefined) return usageError('scenario template', T.outRequired(), locale);
  const [file, scenario] = positionals as [string, string];
  const template = await lilaScenarioTemplate({ file, process: values.process, scenario, locale });
  console.log(T.templateWritten(writeExportFile(values.out, template.data, { overwrite: values.force === true, source: template.file, locale })));
  return 0;
}

/** `lila scenario show` (#628): one scenario, as stored or `--resolved`, with the validator's notes. Writes nothing. */
async function scenarioShowCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { process: { type: 'string' }, resolved: { type: 'boolean' }, json: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (positionals.length !== 2) return usageError('scenario show', C.expectedPositionals('<project.lila> <scenario>'), locale);
  const [file, scenario] = positionals as [string, string];
  const view = await lilaScenarioView({ file, process: values.process, scenario, resolved: values.resolved === true, locale });
  if (values.json === true) {
    console.log(JSON.stringify(view, null, 2));
    return 0;
  }
  console.log(T.scenarioShowHeader(view.entry, view.process, view.revision, view.resolved));
  console.log(JSON.stringify(view.scenario, null, 2));
  if (view.notes.length > 0) {
    console.log(T.scenarioShowNotes(view.notes.length));
    for (const note of view.notes) console.log(`  ${note}`);
  }
  console.log(T.scenarioShowRunnable(view.runnable));
  return 0;
}

/** A JSON file named on the command line; one that is not there is refused in the CLI's language. */
function readJsonArgument(file: string, locale: Locale): unknown {
  if (!existsSync(file) || lstatSync(file).isDirectory()) throw new Error(messages(locale).mcp.fileMissing(resolve(file).replaceAll('\\', '/')));
  return readJsonFile(file, locale);
}

/** The `--patch` file: a non-empty JSON list of RFC 6902 operations, as `patch_scenario` takes them. */
function readPatch(file: string, locale: Locale): JsonPatchOp[] {
  const patch = readJsonArgument(file, locale);
  const isOp = (op: unknown): op is JsonPatchOp =>
    typeof op === 'object' && op !== null && typeof (op as JsonPatchOp).op === 'string' && typeof (op as JsonPatchOp).path === 'string';
  if (!Array.isArray(patch) || patch.length === 0 || !patch.every(isOp)) throw new Error(agentToolMessages(locale).patchNotList(file));
  return patch;
}

/** `lila scenario patch` (#635): `patch_scenario` on a scenario of a `.lila`, by the same engine function. */
async function scenarioPatchCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      patch: { type: 'string' },
      process: { type: 'string' },
      'save-to': { type: 'string' },
      'extends-from': { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (positionals.length !== 2) return usageError('scenario patch', C.expectedPositionals('<project.lila> <scenario>'), locale);
  if (values.patch === undefined) return usageError('scenario patch', T.patchRequired(), locale);
  const [file, scenario] = positionals as [string, string];
  const result = await patchLilaScenario({
    file,
    process: values.process,
    scenario,
    patch: readPatch(values.patch, locale),
    saveTo: values['save-to'],
    extendsFrom: values['extends-from'],
    name: values.name,
    description: values.description,
    dryRun: values['dry-run'] === true,
    locale,
  });
  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  // A no-op or a dry run says why nothing was written in its first note.
  if (result.written) console.log(T.scenarioPatched(result.entry, result.process, result.file));
  result.notes.forEach((note, index) => console.log(index === 0 && !result.written ? note : `${C.warningLabel()} ${note}`));
  return 0;
}

/** `lila scenario import|template|show|patch`. */
export async function dispatchScenarioTools(argv: readonly string[], locale: Locale): Promise<number> {
  if (wantsHelp(argv)) return help(locale);
  const [sub, ...rest] = argv;
  if (sub === 'import') return importCommand(rest, locale);
  if (sub === 'template') return templateCommand(rest, locale);
  if (sub === 'show') return scenarioShowCommand(rest, locale);
  if (sub === 'patch') return scenarioPatchCommand(rest, locale);
  return usageError('scenario', agentToolMessages(locale).scenarioUnknown(sub ?? '', 'import, template, show, patch'), locale);
}

/** The inventory as text: one block per process, its scenarios and its saved runs. */
function printInventory(inventory: LilaProjectInventory, locale: Locale): void {
  const T = agentToolMessages(locale);
  console.log(T.projectShowHeader(inventory.name, inventory.file, inventory.formatVersion));
  for (const process of inventory.processes) {
    console.log(T.projectShowProcess(process.slug, process.name, process.processId, process.modelRevision, process.elements));
    console.log(T.projectShowScenarios(process.scenarios.length));
    for (const scenario of process.scenarios) {
      const parts = [scenario.entry, ...(scenario.name === null ? [] : [`"${scenario.name}"`]), T.projectShowRevision(scenario.revision)];
      if (scenario.extends !== null) parts.push(T.projectShowExtends(scenario.extends));
      console.log(`    ${parts.join('  ')}`);
    }
    console.log(T.projectShowRuns(process.runs.length));
    for (const run of process.runs) console.log(`    ${run.id}  ${run.scenario}  ${T.projectShowRun(run.replications, run.start, run.current)}`);
    console.log(T.projectShowAttributes(process.attributes === null ? null : process.attributes.length));
    printDefinitions(process.attributes ?? [], '    ', locale);
  }
}

/** `lila project create` (#635): `create_project`, by the same engine function. `--force` is its `overwrite`. */
async function projectCreateCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const T = agentToolMessages(locale);
  const C = messages(locale).cli;
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      name: { type: 'string' },
      bpmn: { type: 'string' },
      scenario: { type: 'string', multiple: true },
      force: { type: 'boolean' },
      'allow-unsimulatable': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (positionals.length !== 1) return usageError('project create', C.expectedPositionals('<path.lila>'), locale);
  if (values.name === undefined) return usageError('project create', T.createNameRequired(), locale);
  if (values.bpmn === undefined) return usageError('project create', T.bpmnRequired(), locale);
  // The engine's refusal names MCP's `overwrite`; here the switch is --force. The engine checks again under the lock.
  const target = resolve(positionals[0]!).replaceAll('\\', '/');
  if (values.force !== true && isLilaPath(target) && existsSync(target) && !lstatSync(target).isDirectory()) {
    return usageError('project create', C.exportTargetExists(target), locale);
  }
  const scenarios = (values.scenario ?? []).map((value) => {
    const [name, file] = pairOf('--scenario', value, locale);
    return { name, scenario: readJsonArgument(file, locale) };
  });
  const result = await createLilaProject({
    path: positionals[0]!,
    name: values.name,
    bpmn: values.bpmn,
    scenarios,
    overwrite: values.force === true,
    allowUnsimulatable: values['allow-unsimulatable'] === true,
    locale,
  });
  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(T.projectCreated(result.name, result.file, result.processId));
  if (result.laidOut) console.log(T.projectLaidOut());
  for (const scenario of result.scenarios) {
    console.log(T.projectScenario(scenario.entry, scenario.runnable));
    for (const error of scenario.errors) console.log(`    ${C.errorLabel()} ${error}`);
    for (const warning of scenario.warnings) console.log(`    ${C.warningLabel()} ${warning}`);
  }
  for (const note of result.notes) console.log(`${C.warningLabel()} ${note}`);
  for (const warning of result.warnings) console.log(`${C.warningLabel()} ${warning}`);
  return 0;
}

/** `lila project show` (#628): what a `.lila` holds, writing nothing; `lila project create` (#635). */
export async function dispatchProjectTools(argv: readonly string[], locale: Locale): Promise<number> {
  if (wantsHelp(argv)) return help(locale);
  const C = messages(locale).cli;
  const [sub, ...rest] = argv;
  if (sub === 'create') return projectCreateCommand(rest, locale);
  if (sub !== 'show') return usageError('project', agentToolMessages(locale).processToolUnknown(sub ?? '', 'show, create'), locale);
  const { values, positionals } = parseArgs({ args: rest, options: { json: { type: 'boolean' } }, allowPositionals: true });
  if (positionals.length !== 1) return usageError('project show', C.expectedPositionals('<project.lila>'), locale);
  const inventory = await lilaProjectInventory({ file: positionals[0]!, locale });
  if (values.json === true) console.log(JSON.stringify(inventory, null, 2));
  else printInventory(inventory, locale);
  return 0;
}
