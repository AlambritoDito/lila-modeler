/**
 * `lila catalog list|show|create|update|delete|usages|adopt` (#673): the CLI side of the MCP catalog
 * tools of #672 (`list_catalog`, `get_catalog_object`, `create_catalog_object`,
 * `update_catalog_object`, `delete_catalog_object`, `find_usages`, `adopt_reference`), over the same
 * `@lila-modeler/engine/project-fs` functions. `--json` prints the object those tools return, and a
 * refusal exits `1` with the same message and code (`CATALOG_CODES`: in use, stale revision).
 * `--locale` is the tools' `locale`: the global `--lang`, for this command group only.
 */
import { parseArgs, type ParseArgsConfig } from 'node:util';

import { pairOf } from './cli-agent-tools.js';
import { isLocale, LOCALE_LIST } from './locale.js';
import { agentToolMessages, messages, type Locale } from './messages/index.js';
import {
  adoptLilaReference,
  CATALOG_CODES,
  createLilaCatalogObject,
  deleteLilaCatalogObject,
  lilaCatalogList,
  lilaCatalogObject,
  lilaUsages,
  updateLilaCatalogObject,
  type LilaCatalogWrite,
} from './project-fs/index.js';
import type { CatalogObject, CatalogUse } from './project/index.js';

/** The subcommands of `lila catalog`, in the order the help lists them. */
export const CATALOG_SUBCOMMANDS = ['list', 'show', 'create', 'update', 'delete', 'usages', 'adopt'] as const;

type Options = NonNullable<ParseArgsConfig['options']>;

/** The options every subcommand takes. */
const COMMON: Options = { type: { type: 'string' }, json: { type: 'boolean' }, locale: { type: 'string' } };
/** The options of the subcommands that write. */
const WRITES: Options = { ...COMMON, 'dry-run': { type: 'boolean' } };
/** The fields `create` and `update` set, as options. */
const FIELDS: Options = {
  name: { type: 'string' },
  description: { type: 'string' },
  attribute: { type: 'string', multiple: true },
  'unit-ref': { type: 'string' },
  'parent-ref': { type: 'string' },
  'owner-ref': { type: 'string' },
  url: { type: 'string' },
};

/** An option's value as `parseArgs` returns it. */
type Value = string | boolean | (string | boolean)[] | undefined;

interface Parsed {
  readonly values: Record<string, Value>;
  readonly positionals: string[];
  readonly locale: Locale;
}

/** `argv` against `options`; `--locale` (normalized like `--lang`: `es_MX` is `es`) replaces `locale`. */
function parse(argv: readonly string[], options: Options, locale: Locale): Parsed {
  const { values, positionals } = parseArgs({ args: [...argv], options, allowPositionals: true });
  const raw = values.locale;
  if (typeof raw !== 'string') return { values, positionals, locale };
  const tag = raw.toLowerCase().split(/[_.@-]/)[0] ?? '';
  if (!isLocale(tag)) throw new Error(agentToolMessages(locale).catalogBadLocale(raw, LOCALE_LIST));
  return { values, positionals, locale: tag };
}

function text(value: Value): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function usageError(command: string, body: string, locale: Locale): number {
  console.error(messages(locale).cli.commandError(`catalog ${command}`, body));
  return 1;
}

/** `--base-revision n`: an integer, or `undefined` when not given. */
function revisionOf(raw: string | undefined, locale: Locale): number | undefined {
  if (raw === undefined) return undefined;
  const C = messages(locale).cli;
  if (!/^-?\d+$/.test(raw)) throw new Error(C.integerRequired('base-revision', raw));
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(C.safeIntegerRequired('base-revision', raw));
  return value;
}

/** `--attribute name=value` (repeatable) → the object's `attributes`, in order. */
function attributesOf(values: Parsed['values'], locale: Locale): { name: string; value: string }[] | undefined {
  const list = values.attribute;
  if (!Array.isArray(list)) return undefined;
  return list.map((value) => {
    const [name, attribute] = pairOf('--attribute', String(value), locale);
    return { name, value: attribute };
  });
}

/** One use, as the in-use refusal lists it: `check-in Task_1 responsibility:R`, or `role/x unitRef`. */
function useText(use: CatalogUse, locale: Locale): string {
  const T = agentToolMessages(locale);
  return 'object' in use ? T.catalogUseInObject(use.object, use.field) : T.catalogUseInProcess(use.slug, use.element, use.relation);
}

/** An object whole: its line, then each field it has (field names are the stored ones, not translated). */
function printObject(object: CatalogObject, locale: Locale): void {
  console.log(agentToolMessages(locale).catalogObjectLine(`${object.type}/${object.id}`, object.name, object.revision));
  for (const [field, value] of Object.entries(object)) {
    if (field === 'type' || field === 'id' || field === 'name' || field === 'revision') continue;
    if (field === 'attributes' && Array.isArray(value)) {
      console.log('  attributes:');
      for (const { name, value: attribute } of value as { name: string; value: string }[]) console.log(`    ${name}: ${attribute}`);
    } else {
      console.log(`  ${field}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }
}

/** What a write prints without `--json`: what happened, the models rewritten, and the upgrade note. */
function printWrite(kind: 'create' | 'update' | 'delete' | 'adopt', result: LilaCatalogWrite, locale: Locale): void {
  const T = agentToolMessages(locale);
  const state = !result.changed ? 'no-change' : result.dryRun ? 'dry-run' : 'written';
  console.log(T.catalogWrite(kind, `${result.object.type}/${result.object.id}`, result.file, state));
  if (kind !== 'delete') printObject(result.object, locale);
  for (const { slug, references } of result.processes) console.log(T.catalogRewritten(slug, references));
  if (result.note !== undefined) console.log(`${messages(locale).cli.warningLabel()} ${result.note}`);
}

function output(json: boolean, result: unknown, print: () => void): number {
  if (json) console.log(JSON.stringify(result, null, 2));
  else print();
  return 0;
}

async function listCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals, locale: lang } = parse(argv, COMMON, locale);
  if (positionals.length !== 1) return usageError('list', messages(lang).cli.expectedPositionals('<project.lila>'), lang);
  const list = await lilaCatalogList({ file: positionals[0]!, type: text(values.type), locale: lang });
  return output(values.json === true, list, () => {
    const T = agentToolMessages(lang);
    console.log(T.catalogListHeader(list.file, list.objects.length, list.formatVersion));
    for (const object of list.objects) console.log(`  ${T.catalogObjectLine(`${object.type}/${object.id}`, object.name, object.revision)}`);
  });
}

async function showCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals, locale: lang } = parse(argv, COMMON, locale);
  if (positionals.length !== 2) return usageError('show', messages(lang).cli.expectedPositionals('<project.lila> <id>'), lang);
  const [file, id] = positionals as [string, string];
  const read = await lilaCatalogObject({ file, id, type: text(values.type), locale: lang });
  return output(values.json === true, read, () => printObject(read.object, lang));
}

async function createCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals, locale: lang } = parse(argv, { ...WRITES, ...FIELDS }, locale);
  const C = messages(lang).cli;
  if (positionals.length !== 1) return usageError('create', C.expectedPositionals('<project.lila>'), lang);
  const type = text(values.type);
  if (type === undefined) return usageError('create', C.processMissingOption('--type role|unit|system|document'), lang);
  const name = text(values.name);
  if (name === undefined) return usageError('create', C.processMissingOption('--name <name>'), lang);
  const result = await createLilaCatalogObject({
    file: positionals[0]!,
    type,
    name,
    description: text(values.description),
    attributes: attributesOf(values, lang),
    unitRef: text(values['unit-ref']),
    parentRef: text(values['parent-ref']),
    ownerRef: text(values['owner-ref']),
    url: text(values.url),
    dryRun: values['dry-run'] === true,
    locale: lang,
  });
  return output(values.json === true, result, () => printWrite('create', result, lang));
}

/** In an update, `""` removes an optional field (MCP's `null`); left out, the field stays. */
function optional(value: Value): string | null | undefined {
  const given = text(value);
  return given === '' ? null : given;
}

async function updateCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const options: Options = { ...WRITES, ...FIELDS, 'base-revision': { type: 'string' }, 'clear-attributes': { type: 'boolean' } };
  const { values, positionals, locale: lang } = parse(argv, options, locale);
  const C = messages(lang).cli;
  if (positionals.length !== 2) return usageError('update', C.expectedPositionals('<project.lila> <id>'), lang);
  const baseRevision = revisionOf(text(values['base-revision']), lang);
  if (baseRevision === undefined) return usageError('update', C.processMissingOption('--base-revision <n>'), lang);
  if (values['clear-attributes'] === true && values.attribute !== undefined) {
    return usageError('update', agentToolMessages(lang).catalogEitherOption('--attribute', '--clear-attributes'), lang);
  }
  const [file, id] = positionals as [string, string];
  const result = await updateLilaCatalogObject({
    file,
    id,
    type: text(values.type),
    baseRevision,
    name: text(values.name),
    description: optional(values.description),
    attributes: values['clear-attributes'] === true ? null : attributesOf(values, lang),
    unitRef: optional(values['unit-ref']),
    parentRef: optional(values['parent-ref']),
    ownerRef: optional(values['owner-ref']),
    url: optional(values.url),
    dryRun: values['dry-run'] === true,
    locale: lang,
  });
  return output(values.json === true, result, () => printWrite('update', result, lang));
}

async function deleteCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const options: Options = { ...WRITES, 'base-revision': { type: 'string' }, 'replace-with': { type: 'string' }, 'remove-references': { type: 'boolean' } };
  const { values, positionals, locale: lang } = parse(argv, options, locale);
  const T = agentToolMessages(lang);
  if (positionals.length !== 2) return usageError('delete', messages(lang).cli.expectedPositionals('<project.lila> <id>'), lang);
  const replaceWith = text(values['replace-with']);
  const removeReferences = values['remove-references'] === true;
  if (replaceWith !== undefined && removeReferences) return usageError('delete', T.catalogEitherOption('--replace-with', '--remove-references'), lang);
  const [file, id] = positionals as [string, string];
  let result: LilaCatalogWrite;
  try {
    result = await deleteLilaCatalogObject({
      file,
      id,
      type: text(values.type),
      baseRevision: revisionOf(text(values['base-revision']), lang),
      replaceWith,
      removeReferences,
      dryRun: values['dry-run'] === true,
      locale: lang,
    });
  } catch (error) {
    // The refusal names MCP's arguments; say what they are on the command line.
    if ((error as { code?: unknown }).code !== CATALOG_CODES['LILA-OBJECT-IN-USE']) throw error;
    usageError('delete', (error as Error).message, lang);
    console.error(T.catalogInUseHint());
    return 1;
  }
  return output(values.json === true, result, () => printWrite('delete', result, lang));
}

async function usagesCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals, locale: lang } = parse(argv, COMMON, locale);
  if (positionals.length < 1 || positionals.length > 2) {
    return usageError('usages', messages(lang).cli.expectedPositionals('<project.lila> [<id>]'), lang);
  }
  const [file, id] = positionals as [string, string | undefined];
  const usages = await lilaUsages({ file, id, type: text(values.type), locale: lang });
  return output(values.json === true, usages, () => {
    const T = agentToolMessages(lang);
    if ('resolved' in usages) {
      const key = usages.type === undefined ? usages.id : `${usages.type}/${usages.id}`;
      console.log(usages.resolved ? T.catalogUses(key, usages.uses.length) : T.catalogUnresolvedUses(usages.id, usages.uses.length));
      for (const use of usages.uses) console.log(`  ${useText(use, lang)}`);
      return;
    }
    for (const [key, uses] of Object.entries(usages.uses)) {
      console.log(T.catalogUses(key, uses.length));
      for (const use of uses) console.log(`  ${useText(use, lang)}`);
    }
    console.log(T.catalogIndexUnresolved(usages.unresolved.length));
    for (const reference of usages.unresolved) console.log(`  ${reference.type}/${reference.id}: ${useText(reference, lang)}`);
    for (const { id: processId, slugs } of usages.duplicateProcessIds) console.log(T.catalogDuplicateProcessId(processId, slugs.join(', ')));
  });
}

async function adoptCommand(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals, locale: lang } = parse(argv, { ...WRITES, name: { type: 'string' } }, locale);
  const C = messages(lang).cli;
  if (positionals.length !== 2) return usageError('adopt', C.expectedPositionals('<project.lila> <ref>'), lang);
  const type = text(values.type);
  if (type === undefined) return usageError('adopt', C.processMissingOption('--type role|unit|system|document'), lang);
  const [file, ref] = positionals as [string, string];
  const result = await adoptLilaReference({ file, type, ref, name: text(values.name), dryRun: values['dry-run'] === true, locale: lang });
  return output(values.json === true, result, () => printWrite('adopt', result, lang));
}

/** `lila catalog list|show|create|update|delete|usages|adopt`. */
export async function dispatchCatalogTools(argv: readonly string[], locale: Locale): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(messages(locale).cli.usage());
    return 0;
  }
  const [sub, ...rest] = argv;
  if (sub === 'list') return listCommand(rest, locale);
  if (sub === 'show') return showCommand(rest, locale);
  if (sub === 'create') return createCommand(rest, locale);
  if (sub === 'update') return updateCommand(rest, locale);
  if (sub === 'delete') return deleteCommand(rest, locale);
  if (sub === 'usages') return usagesCommand(rest, locale);
  if (sub === 'adopt') return adoptCommand(rest, locale);
  console.error(messages(locale).cli.commandError('catalog', agentToolMessages(locale).processToolUnknown(sub ?? '', CATALOG_SUBCOMMANDS.join(', '))));
  return 1;
}
