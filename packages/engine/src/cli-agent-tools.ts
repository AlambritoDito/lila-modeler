/**
 * `lila process annotate|raci` (#99) and `lila scenario import|template` (#514): the CLI side of
 * the MCP tools `annotate_element`, `get_raci_matrix`, `import_scenario_sheet` and
 * `export_scenario_template`, over the same `@lila-modeler/engine/project-fs` functions. Kept out
 * of `cli.ts` so that file only dispatches here.
 */
import { parseArgs } from 'node:util';

import type { Annotations, Responsibility } from './bpmn/index.js';
import { agentToolMessages, messages, type Locale } from './messages/index.js';
import {
  annotateLilaElement,
  importLilaScenarioSheet,
  lilaRaciMatrix,
  lilaScenarioTemplate,
  raciCsv,
  writeExportFile,
  type LilaRaciMatrix,
} from './project-fs/index.js';

/** The `process` subcommands this file answers. */
export const PROCESS_TOOL_SUBCOMMANDS = ['annotate', 'raci'] as const;

/** Whether `lila process <sub>` is one of this file's (the others are `create`/`show`, in `cli.ts`). */
export function isProcessToolSubcommand(sub: string | undefined): boolean {
  return (PROCESS_TOOL_SUBCOMMANDS as readonly (string | undefined)[]).includes(sub);
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

/** `lila process annotate|raci`. */
export async function dispatchProcessTools(argv: readonly string[], locale: Locale): Promise<number> {
  if (wantsHelp(argv)) return help(locale);
  const [sub, ...rest] = argv;
  if (sub === 'annotate') return annotateCommand(rest, locale);
  if (sub === 'raci') return raciCommand(rest, locale);
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

/** `lila scenario import|template`. */
export async function dispatchScenarioTools(argv: readonly string[], locale: Locale): Promise<number> {
  if (wantsHelp(argv)) return help(locale);
  const [sub, ...rest] = argv;
  if (sub === 'import') return importCommand(rest, locale);
  if (sub === 'template') return templateCommand(rest, locale);
  return usageError('scenario', agentToolMessages(locale).scenarioUnknown(sub ?? '', 'import, template'), locale);
}
