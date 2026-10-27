/**
 * `patch_scenario` on a scenario inside a `.lila` (#466), moved here from `packages/mcp` (#635) so
 * that `lila scenario patch` runs the same code: the engine CLI cannot import the MCP package
 * (`lila mcp` loads it with a dynamic `import()`, ADR-030). The MCP server keeps only the mode that
 * patches a loose `.json` on disk, built on the helpers exported here.
 *
 * Refusals are thrown as an `Error` whose message is the body: the MCP server prefixes the tool
 * name, the CLI prints it with `commandError` and exits 1. Nothing is written on a refusal.
 */
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { ValidationResult } from '../bpmn/validate.js';
import {
  comparablePath,
  loadResolvedScenario,
  loadValidatedModel,
  readJsonFile,
  validatedModelOf,
  type ParsedIr,
  type ValidatedModel,
} from '../cli-shared.js';
import { applyJsonPatch, buildPatchDelta, type JsonPatchOp } from '../json-patch.js';
import { agentToolMessages, messages, type Locale } from '../messages/index.js';
import type { ProjectDocument, ScenarioDocument } from '../project/index.js';
import { parseScenario, schemaIssueLines, scenarioErrors, validateScenario, type ResolvedScenario } from '../scenario.js';
import {
  findLilaScenario,
  lilaScenarioEntryName,
  lilaScenarioPath,
  lilaScenarioReader,
  lilaWritten,
  openLilaProcess,
  writeLilaScenario,
  type LilaProcess,
} from './input.js';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Esquema + modelo + `validateScenario`, en una sola pasada: la misma comprobación sirve
 * para el modo (a) sobre el escenario ya parcheado, y para el modo (b) sobre el candidato que
 * realmente se va a escribir (que puede no coincidir con el parcheado si `extendsFrom` no es el
 * mismo archivo que `scenario`). Solo si esto no devuelve error se escribe algo a disco.
 * El esquema se pasa por `parseScenario` (LILA-202), no por `ScenarioSchema.safeParse`: los
 * defectos del escenario parcheado salen en español, igual que en la CLI y en `run_simulation`.
 */
export async function validatePatchedScenario(
  raw: unknown,
  locale: Locale,
  lila?: LilaProcess | undefined,
): Promise<{ ok: true; scenario: ResolvedScenario; notes: string[] } | { ok: false; error: string }> {
  const M = messages(locale).mcp;
  const parsed = parseScenario(raw, { locale });
  if (!parsed.success) {
    // `schemaIssueLines` es la que pone los códigos de § 17 (`E-CLAVE-DESCONOCIDA`) que la CLI ya
    // emite (LILA-198); formatear los defectos aquí a mano los perdía.
    const detail = schemaIssueLines(parsed.error.issues, { locale }).join('; ');
    return { ok: false, error: `${M.invalidAfterPatchLabel()} ${detail}` };
  }
  // `ScenarioSchema` tiene `model` y `run` opcionales (un archivo con `extends` los hereda), así
  // que un patch puede borrarlos y aun así pasar el esquema. `loadResolvedScenario` los exige y es
  // lo que hace el modo (b); sin este par de guardas el modo (a) escribía un escenario que la
  // propia `run_simulation` rechaza después — y el `remove /model` filtraba el TypeError de
  // `node:path` en vez de un mensaje del dominio.
  if (parsed.data.model === undefined) return { ok: false, error: M.patchedMissingModel() };
  if (parsed.data.run === undefined) return { ok: false, error: M.patchedMissingRun() };
  const scenario = parsed.data as ResolvedScenario;

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  let elsewhere: ValidatedModel['elsewhere'];
  // In a `.lila` the model is the process's own `model.bpmn` (#466): a patch that points `model`
  // elsewhere is refused, like `run_simulation` refuses a scenario of another model.
  if (lila !== undefined && comparablePath(scenario.model) !== comparablePath(lila.modelPath)) {
    return { ok: false, error: M.modelMismatch(lila.modelPath, scenario.model) };
  }
  try {
    ({ ir, validation: modelValidation, elsewhere } =
      lila === undefined
        ? await loadValidatedModel(scenario.model, locale, { scenarios: [scenario] })
        : await validatedModelOf({ path: lila.modelPath, xml: lila.process.model.xml, lila }, locale, [scenario]));
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  if (modelValidation.errors.length > 0) {
    return { ok: false, error: M.modelInvalid(JSON.stringify(modelValidation.errors)) };
  }

  const problems = validateScenario(scenario, ir, { locale, elsewhere });
  const issues = scenarioErrors(problems);
  if (issues.length > 0) {
    return { ok: false, error: `${M.invalidAfterPatchLabel()} ${JSON.stringify(issues)}` };
  }

  const notes = problems.filter((p) => p.severity === 'warning').map((p) => `${p.code}: ${p.message}`);
  return { ok: true, scenario, notes };
}

/**
 * `loadResolvedScenario` prefija sus errores con la ruta del archivo. En el modo (b) esa ruta es
 * la de `saveTo`: un archivo que todavía no existe y que, si el escenario no valida, no se va a
 * escribir. Citarlo manda al agente a abrir una ruta fantasma — el mismo problema que el escenario
 * inline de LILA-054. Se le quita el prefijo y se alinea el texto con el del modo (a).
 */
export function withoutPhantomFile(error: unknown, phantom: string, locale: Locale): string {
  const catalog = messages(locale);
  const raw = message(error).replaceAll('\n', ' ');
  return raw.startsWith(`${phantom}: `)
    ? raw
        .slice(phantom.length + 2)
        .replace(catalog.cli.invalidScenarioLabel(), catalog.mcp.invalidAfterPatchLabel())
    : raw;
}

/**
 * El escenario resuelto trae `model` como ruta absoluta: `resolveExtends` la ancla al archivo que
 * la declara. Escribirla tal cual en el modo (a) vuelve el archivo dependiente de la máquina que
 * corrió la tool (`/Users/quien-sea/...`), y deja de resolver en cualquier otro checkout. Se
 * reescribe relativa al propio escenario, que es como la declaran los del repo y la misma regla
 * que el modo (b) aplica a `extends`.
 */
export function withRelativeModel(scenario: ResolvedScenario, file: string): ResolvedScenario {
  return { ...scenario, model: posix.relative(posix.dirname(file), scenario.model) };
}

/**
 * Whether two scenarios say the same, as JSON (#627): key order and `undefined` keys do not count.
 * A patch whose result is the scenario it read (`test` only, or a `replace` with the same value)
 * writes nothing, so the scenario keeps its revision and its runs stay current.
 */
export function sameScenario(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)));
}

export interface PatchLilaScenarioRequest {
  /** The `.lila`. */
  readonly file: string;
  /** Slug of the process when the `.lila` holds several; implicit when it holds one. */
  readonly process?: string | undefined;
  /** The scenario to patch: its entry name (with or without `.scenario.json`) or its `name`. */
  readonly scenario: string;
  readonly patch: readonly JsonPatchOp[];
  /** Absent: patch `scenario` in place. Present: the entry of a new scenario that `extends` the parent. */
  readonly saveTo?: string | undefined;
  /** Parent of the new scenario's `extends` (only with `saveTo`). Default: `scenario`. */
  readonly extendsFrom?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  /** Check everything and write nothing. */
  readonly dryRun?: boolean | undefined;
  readonly locale?: Locale | undefined;
}

export interface PatchLilaScenarioResult {
  /** The resulting scenario, resolved through `extends`. */
  readonly scenario: ResolvedScenario;
  readonly file: string;
  /** Slug of the process; after a write, where it is in the file now (#613). */
  readonly process: string;
  /** The scenario entry patched or created. */
  readonly entry: string;
  readonly written: boolean;
  readonly dryRun: boolean;
  /** Why nothing was written, if so, then the lint warnings. */
  readonly notes: readonly string[];
}

/**
 * The same two modes as on disk, with every name inside the archive: `scenario` and `extendsFrom`
 * name scenarios of the process (`findLilaScenario`), and `saveTo` is the name of the new entry.
 * Validation runs against the process's own model, and only a scenario that validates is written —
 * through `writeLilaScenario`, which saves the whole archive atomically and carries every other
 * process through unchanged.
 */
export async function patchLilaScenario(request: PatchLilaScenarioRequest): Promise<PatchLilaScenarioResult> {
  const { scenario, process, patch, saveTo, extendsFrom, name, description } = request;
  const locale = request.locale ?? 'en';
  const dryRun = request.dryRun === true;
  const M = messages(locale).mcp;

  const lila = await openLilaProcess(request.file, { process, locale });
  const entry = findLilaScenario(lila, scenario, locale);
  const read = lilaScenarioReader(lila, (file) => readJsonFile(file, locale), locale);
  const base = loadResolvedScenario(lilaScenarioPath(lila, entry), read, locale);

  const written = (target: string, resolvedScenario: ResolvedScenario, notes: string[], document: ProjectDocument): PatchLilaScenarioResult => {
    // Where the process is in the file now (#613): a one-process version 2 archive is version 1 after
    // the write, so its slug and the folder its `model` resolves under change with it.
    const { slug, root } = lilaWritten(lila, document);
    const model = resolvedScenario.model.startsWith(lila.root) ? `${root}${resolvedScenario.model.slice(lila.root.length)}` : resolvedScenario.model;
    return { scenario: { ...resolvedScenario, model }, file: lila.file, process: slug, entry: target, written: true, dryRun, notes };
  };
  // #627: nothing changes, nothing is written; the process is where it was. A dry run reports the
  // same, with what it would have written.
  const unchanged = (target: string, resolvedScenario: ResolvedScenario, notes: string[]): PatchLilaScenarioResult =>
    ({ scenario: resolvedScenario, file: lila.file, process: lila.process.slug, entry: target, written: false, dryRun, notes });
  const write = async (target: string, resolvedScenario: ResolvedScenario, stored: ScenarioDocument, notes: string[]): Promise<PatchLilaScenarioResult> => {
    if (dryRun) return unchanged(target, resolvedScenario, [agentToolMessages(locale).patchDryRun(target), ...notes]);
    const document = await writeLilaScenario(lila, target, stored, locale);
    return written(target, resolvedScenario, notes, document);
  };

  const patchedRaw = applyJsonPatch(base, patch, locale);

  if (saveTo === undefined) {
    if (isPlainObject(patchedRaw)) {
      if (name !== undefined) patchedRaw.name = name;
      if (description !== undefined) patchedRaw.description = description;
    }
    const outcome = await validatePatchedScenario(patchedRaw, locale, lila);
    if (!outcome.ok) throw new Error(outcome.error);
    if (sameScenario(outcome.scenario, base)) return unchanged(entry, outcome.scenario, [M.patchNoChange(), ...outcome.notes]);
    const path = lilaScenarioPath(lila, entry);
    return write(entry, outcome.scenario, withRelativeModel(outcome.scenario, path), outcome.notes);
  }

  if (!isPlainObject(patchedRaw)) throw new Error(M.patchNotAnObject());
  const target = lilaScenarioEntryName(saveTo, locale);
  const parent = extendsFrom === undefined ? entry : findLilaScenario(lila, extendsFrom, locale);
  const delta = buildPatchDelta(patch, patchedRaw, locale);
  // Both entries live in the same folder of the archive, so `extends` is the parent's entry name.
  const candidate: Record<string, unknown> = { version: base.version, extends: parent, ...delta };
  candidate['name'] = name ?? (typeof delta['name'] === 'string' ? delta['name'] : M.patchedName(base.name));
  if (description !== undefined) candidate['description'] = description;

  const targetPath = lilaScenarioPath(lila, target);
  let resolvedCandidate: ResolvedScenario;
  try {
    resolvedCandidate = loadResolvedScenario(
      targetPath,
      (file) => (file === targetPath ? candidate : read(file)),
      locale,
    );
  } catch (error) {
    throw new Error(withoutPhantomFile(error, targetPath, locale));
  }

  const outcome = await validatePatchedScenario(resolvedCandidate, locale, lila);
  if (!outcome.ok) throw new Error(outcome.error);
  if (Object.hasOwn(lila.process.scenarios, target) && sameScenario(lila.process.scenarios[target], candidate)) {
    return unchanged(target, outcome.scenario, [M.patchSameTarget(target), ...outcome.notes]);
  }
  return write(target, outcome.scenario, candidate, outcome.notes);
}
