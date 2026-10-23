/**
 * The modelling tools of #99, #403, #514 and #633: `annotate_element`, `define_attribute`,
 * `get_raci_matrix`, `import_scenario_sheet`, `export_scenario_template` and `create_project`, the
 * read-only inventory of #628: `get_project` and `get_scenario`, the raw BPMN of a process
 * (#632): `get_process_bpmn` and `put_process_bpmn`, and renaming and deleting processes and
 * scenarios (#634): `rename_process`, `delete_process`, `rename_scenario` and `delete_scenario`, and
 * the catalog (#672): `list_catalog`, `get_catalog_object`, `create_catalog_object`,
 * `update_catalog_object`, `delete_catalog_object`, `find_usages` and `adopt_reference`.
 * Thin layers over
 * `@lila-modeler/engine/project-fs`, like `lila process annotate|raci` and
 * `lila scenario import|template`; registered by `createServer` (`server.ts`).
 *
 * As in the rest of the server, the schemas stay loose where a tighter one would make the SDK
 * answer in English only (a RACI type, a scenario that is not an object): the engine refuses those
 * in the caller's language, with nothing written.
 */
import { messages, type Locale } from '@lila-modeler/engine/messages';
import {
  annotateLilaElement,
  createLilaProject,
  defineLilaAttribute,
  deleteLilaProcess,
  deleteLilaScenario,
  importLilaScenarioSheet,
  isLilaPath,
  lilaProjectInventory,
  lilaRaciMatrix,
  lilaScenarioTemplate,
  lilaScenarioView,
  putLilaProcessBpmn,
  readLilaProcessBpmn,
  renameLilaProcess,
  renameLilaScenario,
  writeExportFile,
  adoptLilaReference,
  createLilaCatalogObject,
  deleteLilaCatalogObject,
  lilaCatalogList,
  lilaCatalogObject,
  lilaUsages,
  updateLilaCatalogObject,
} from '@lila-modeler/engine/project-fs';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
}

function failure(tool: string, error: unknown): CallToolResult {
  return { content: [{ type: 'text', text: `${tool}: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
}

/** Registers the tools on `server`; `localeOf` turns a call's `locale` into the one to answer in. */
export function registerAgentTools(
  server: McpServer,
  localeOf: (locale: Locale | undefined) => Locale,
): void {
  const localeSchema = z
    .enum(['en', 'es'])
    .optional()
    .describe('Language of the texts this call returns. Defaults to the server locale (LILA_LANG).');
  const projectSchema = z.string().describe('Path to the .lila, relative to the cwd of the server process.');
  const processSchema = z
    .string()
    .optional()
    .describe('Slug of the process when the .lila holds several; implicit when it holds one.');
  const dryRunSchema = z.boolean().optional().describe('Report what would change and write nothing.');
  const allowUnsimulatableSchema = z
    .boolean()
    .optional()
    .describe('Save a model with validation errors as a diagram that does not simulate; the errors come back in `notes`. Default false: refused.');

  server.registerTool(
    'annotate_element',
    {
      title: 'Annotate element',
      description:
        'Writes the description, RACI responsibilities, catalog references and extended attribute ' +
        'values of one element (task, event, gateway, flow, lane, pool, the process…) of a process ' +
        'of a .lila, by its BPMN id, and saves the project atomically. `documentation` replaces ' +
        'the description ("" removes it); `responsibilities` replaces the whole RACI list ([] ' +
        'clears it); each kind in `refs` replaces that kind; `attributes` are merged by attribute ' +
        'id or name ("" removes a value) and checked against the project\'s attribute definitions. ' +
        'Writes where the app reads: a pool\'s description goes to the process it references ' +
        '(`documentationOn`), and the RACI and references of a process inside a pool belong to ' +
        'the pool (annotating them on the process is refused). Returns `before` and `after` as the ' +
        'app shows the element; `dryRun` writes nothing. Like `lila process annotate`.',
      inputSchema: z.object({
        project: projectSchema,
        process: processSchema,
        elementId: z.string().describe('The BPMN id of the element.'),
        documentation: z.string().optional().describe('The element\'s description; "" removes it.'),
        responsibilities: z
          .array(
            z.object({
              type: z.string().describe('R, A, C or I.'),
              roleRef: z.string().describe('The role, e.g. "cashier".'),
            }),
          )
          .optional()
          .describe('The whole RACI list of the element; [] clears it.'),
        refs: z
          .record(z.string(), z.array(z.string()))
          .optional()
          .describe('By kind (systemRef, documentRef, riskRef, controlRef, kpiRef, input, output): the ids it references.'),
        attributes: z
          .record(z.string(), z.string())
          .optional()
          .describe('Extended attribute values by attribute id or name; "" removes one.'),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, process, elementId, documentation, responsibilities, refs, attributes, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(
          await annotateLilaElement({
            file: project, process, elementId, documentation, responsibilities, refs, attributes, dryRun, locale: localeOf(locale),
          }),
        );
      } catch (error) {
        return failure('annotate_element', error);
      }
    },
  );

  server.registerTool(
    'define_attribute',
    {
      title: 'Define attribute',
      description:
        'Defines, changes or removes one extended attribute of a process of a .lila (#633), what ' +
        '`annotate_element` then fills in on elements, with the rules of the app\'s attribute ' +
        'dialog: a name unique per element type, a `list` with at least one option, a `default` ' +
        'that fits. Pass the whole definition every time (`name`, `type`, `appliesTo`, and ' +
        '`options`/`default` when it has them): it updates the one with that `id`, else the one ' +
        'with that name (any case) and `appliesTo`, else creates one with a deterministic id ' +
        '(`Attr_<name>`), so calling it again changes nothing. A rename keeps the values; ' +
        '`remove: true` removes the definition and its values, and retyping, changing ' +
        '`appliesTo` or taking options away removes the values that no longer fit: ' +
        '`removedValues` lists them, a dry run too. Returns `before`, `after` and every ' +
        '`definition` of the process; `get_project` lists them too. Like ' +
        '`lila process attribute define`.',
      inputSchema: z.object({
        project: projectSchema,
        process: processSchema,
        id: z.string().optional().describe('The definition to change or remove. Leave it out to find it by name and appliesTo, or to create one.'),
        name: z.string().optional().describe('Its name, as people read it ("SLA (h)"). Required unless removing by id.'),
        type: z.string().optional().describe('text, number, list or date. Required unless removing.'),
        appliesTo: z
          .string()
          .optional()
          .describe('The element type it applies to: task, gateway, event, subProcess, lane (pools and lanes) or process. Required unless removing by id.'),
        options: z.array(z.string()).optional().describe('The options of a list (only a list takes them).'),
        default: z.string().optional().describe('What an element without its own value shows; it has to fit the type.'),
        remove: z.boolean().optional().describe('Remove the definition and every value it has.'),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, process, id, name, type, appliesTo, options, default: fallback, remove, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(
          await defineLilaAttribute({
            file: project, process, id, name, type, appliesTo, options, default: fallback, remove, dryRun, locale: localeOf(locale),
          }),
        );
      } catch (error) {
        return failure('define_attribute', error);
      }
    },
  );

  server.registerTool(
    'get_raci_matrix',
    {
      title: 'Get RACI matrix',
      description:
        'The RACI matrix of a process of a .lila: `roles` (every roleRef, in order of appearance) ' +
        'and `rows`, one per element with responsibilities, in the order of the process document ' +
        '(id, name, lane, the raw `responsibilities` and `cells`: role -> "R", "A, C"…), and ' +
        '`roleNames`: role id -> the name of the catalog role it resolves to (ids that match no ' +
        'role are left out; the ids stay the keys). Like `lila process raci --json`.',
      inputSchema: z.object({ project: projectSchema, process: processSchema, locale: localeSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, process, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await lilaRaciMatrix({ file: project, process, locale: localeOf(locale) }));
      } catch (error) {
        return failure('get_raci_matrix', error);
      }
    },
  );

  server.registerTool(
    'import_scenario_sheet',
    {
      title: 'Import scenario sheet',
      description:
        'Applies a scenario sheet (.xlsx, or a .csv/.txt table; the template of ' +
        '`export_scenario_template`, docs/SCENARIO_SHEETS.md) to a scenario of a .lila, exactly ' +
        'like the app\'s Import Excel/CSV: `changes` (each with before, after and a readable ' +
        '`text`) and `issues` (rows not applied, notes, and `lint` errors the result would have). ' +
        'The scenario is saved atomically unless `dryRun`, nothing changes, or there is a `lint` ' +
        'issue (then it is an error and nothing is written). As in the app, the valid rows are ' +
        'written even when other rows are not applied: read `issues` before calling the import ' +
        'done. Like `lila scenario import`.',
      inputSchema: z.object({
        project: projectSchema,
        process: processSchema,
        scenario: z.string().describe('A scenario of the process: its file name (with or without .scenario.json) or its "name".'),
        sheet: z.string().describe('Path to the .xlsx, .csv or .txt, relative to the cwd of the server process.'),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, process, scenario, sheet, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await importLilaScenarioSheet({ file: project, process, scenario, sheet, dryRun, locale: localeOf(locale) }));
      } catch (error) {
        return failure('import_scenario_sheet', error);
      }
    },
  );

  server.registerTool(
    'export_scenario_template',
    {
      title: 'Export scenario template',
      description:
        'Writes the scenario sheet of a scenario of a .lila as .xlsx (Elements, Arrivals, ' +
        'Resources, Assignments, Calendars), filled in with its current values, like the app\'s ' +
        'Download template: hand it to a person to fill in, then `import_scenario_sheet`. Never ' +
        'overwrites an existing file unless `overwrite`. Like `lila scenario template`.',
      inputSchema: z.object({
        project: projectSchema,
        process: processSchema,
        scenario: z.string().describe('A scenario of the process: its file name or its "name".'),
        saveTo: z.string().describe('Path of the .xlsx to write.'),
        overwrite: z.boolean().optional().describe('Replace an existing file. Default false.'),
        locale: localeSchema,
      }),
    },
    async ({ project, process, scenario, saveTo, overwrite, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      try {
        const template = await lilaScenarioTemplate({ file: project, process, scenario, locale: language });
        const file = writeExportFile(saveTo, template.data, { overwrite, source: template.file, locale: language });
        return textResult({ file, project: template.file, process: template.process, scenario: template.scenario });
      } catch (error) {
        return failure('export_scenario_template', error);
      }
    },
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Creates a new .lila project from a BPMN model (inline XML, or a path to a .bpmn) and ' +
        'optional scenarios, without the app; the web and desktop apps open it. A model with ' +
        'validation errors is refused. Scenarios are saved as given (a scenario without `model` ' +
        'or `extends` gets "model.bpmn"): each comes back with `runnable` and its `errors`, so a ' +
        'draft is kept but flagged. Written atomically (no partial file on error); an existing ' +
        'file is refused unless `overwrite`. A model without a diagram (BPMN DI) gets one, drawn ' +
        'as `edit_process` with `layout: true` draws it (`laidOut: true`); one that cannot be is ' +
        'kept as given and `notes` says why. `allowUnsimulatable: ' +
        'true` keeps a model with validation errors as a diagram that does not simulate, the ' +
        'errors in `notes`.',
      inputSchema: z.object({
        path: z.string().describe('Path of the new .lila, relative to the cwd of the server process.'),
        name: z.string().describe('Name of the project.'),
        bpmn: z.string().describe('BPMN 2.0 XML, or a path to a .bpmn.'),
        scenarios: z
          .array(
            z.object({
              name: z.string().describe('Saved as <name>.scenario.json.'),
              scenario: z.unknown().describe('The scenario JSON object (docs/SCENARIO_FORMAT.md).'),
            }),
          )
          .optional(),
        overwrite: z.boolean().optional().describe('Replace an existing file. Default false.'),
        allowUnsimulatable: allowUnsimulatableSchema,
        locale: localeSchema,
      }),
    },
    async ({ path, name, bpmn, scenarios, overwrite, allowUnsimulatable, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await createLilaProject({ path, name, bpmn, scenarios, overwrite, allowUnsimulatable, locale: localeOf(locale) }));
      } catch (error) {
        return failure('create_project', error);
      }
    },
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'What a .lila holds, read without writing anything: its name, `formatVersion` (3 for a ' +
        'repository with a catalog, 2 for a repository of several processes, 1 otherwise) and its `processes`, each with `slug`, ' +
        '`name`, `processId`, `modelRevision`, `elements` (flow nodes), its `scenarios` (entry, ' +
        'name, revision, extends), its stored `runs` (id, scenario, start, replications and ' +
        '`current`: false when the model or the scenario it ran changed after the run; a change in ' +
        'only an `extends` parent does not count) and its extended ' +
        '`attributes` (the definitions `annotate_element` can fill in, with `appliesTo` and ' +
        '`options`; null when the model cannot be read back whole). Call it first on an existing ' +
        'file. Like `lila project show --json`.',
      inputSchema: z.object({ project: projectSchema, locale: localeSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, locale }): Promise<CallToolResult> => {
      // #645: a folder or an empty path is not a `.lila`; refused as `patch_scenario` refuses it.
      if (!isLilaPath(project)) return failure('get_project', new Error(messages(localeOf(locale)).mcp.projectNotLila(project)));
      try {
        return textResult(await lilaProjectInventory({ file: project, locale: localeOf(locale) }));
      } catch (error) {
        return failure('get_project', error);
      }
    },
  );

  server.registerTool(
    'get_scenario',
    {
      title: 'Get scenario',
      description:
        'One scenario of a process of a .lila, read without writing anything: as stored (with its ' +
        '`extends`), or with `resolved: true` merged through `extends` with the engine\'s defaults ' +
        '(the object `patch_scenario` patches). Also `revision`, `runnable` and `notes`: the ' +
        'validator against the process model, errors (E-…) first, then warnings (W-…), the checks ' +
        '`run_simulation` makes; so it works as a scenario lint. Like `lila scenario show --json`.',
      inputSchema: z.object({
        project: projectSchema,
        process: processSchema,
        scenario: z.string().describe('A scenario of the process: its file name (with or without .scenario.json) or its "name".'),
        resolved: z.boolean().optional().describe('true: resolved through `extends`, with defaults. Default false: as stored.'),
        locale: localeSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, process, scenario, resolved, locale }): Promise<CallToolResult> => {
      if (!isLilaPath(project)) return failure('get_scenario', new Error(messages(localeOf(locale)).mcp.projectNotLila(project)));
      try {
        return textResult(await lilaScenarioView({ file: project, process, scenario, resolved, locale: localeOf(locale) }));
      } catch (error) {
        return failure('get_scenario', error);
      }
    },
  );

  server.registerTool(
    'get_process_bpmn',
    {
      title: 'Get process BPMN',
      description:
        'The BPMN 2.0 XML of one process of a .lila, as stored, read without writing anything: ' +
        '`{ file, process, processId, revision, xml }`. Hand it to another tool, or edit it and ' +
        'write it back with `put_process_bpmn` `mode: "replace"`. Like `lila process export-bpmn`.',
      inputSchema: z.object({ project: projectSchema, process: processSchema, locale: localeSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, process, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await readLilaProcessBpmn(project, { process, locale: localeOf(locale) }));
      } catch (error) {
        return failure('get_process_bpmn', error);
      }
    },
  );

  server.registerTool(
    'put_process_bpmn',
    {
      title: 'Put process BPMN',
      description:
        'Adds a BPMN model (inline XML, or a path to a .bpmn: a Bizagi export, say) as a new ' +
        'process of an existing .lila (`mode: "add"`, with a default `as-is` scenario), or replaces ' +
        'the model of one of its processes (`mode: "replace"`: its revision goes up, so saved runs ' +
        'go stale; its annotations go with the old model). The model is validated as ' +
        '`create_project` validates it: one with errors is refused unless `allowUnsimulatable`. ' +
        'On replace, scenario entries that no longer apply are removed and listed in ' +
        '`scenarioRemovals`, as `edit_process` does, and a scenario error the old model did not ' +
        'cause refuses the call (unless `allowUnsimulatable`). A model whose simulated process has ' +
        'no diagram is laid out (`layout`, default true, `laidOut: true`); one that cannot be is ' +
        'kept as given and `notes` says why. Atomic and locked like every write; `dryRun` writes ' +
        'nothing. Like `lila process import`.',
      inputSchema: z.object({
        project: projectSchema,
        process: z
          .string()
          .optional()
          .describe('add: the slug of the new process (default: from its name). replace: the process replaced; implicit when the .lila holds one.'),
        bpmn: z.string().describe('BPMN 2.0 XML, or a path to a .bpmn.'),
        mode: z.enum(['add', 'replace']).describe('"add" (a new process) or "replace" (the model of an existing one).'),
        name: z.string().optional().describe('add only: the name of the new process. Default: its pool\'s, its process\'s, or the file\'s.'),
        layout: z.boolean().optional().describe('Lay out a model that has no diagram (BPMN DI). Default true.'),
        allowUnsimulatable: allowUnsimulatableSchema,
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, process, bpmn, mode, name, layout, allowUnsimulatable, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(
          await putLilaProcessBpmn({ file: project, process, bpmn, mode, name, layout, allowUnsimulatable, dryRun, locale: localeOf(locale) }),
        );
      } catch (error) {
        return failure('put_process_bpmn', error);
      }
    },
  );

  // #634: one tool per operation, so the deletes carry `destructiveHint` and each schema is exact.
  const slugSchema = z.string().describe('Slug of the process, as `get_project` lists it.');
  const scenarioSchema = z.string().describe('A scenario of the process: its file name (with or without .scenario.json) or its "name".');

  server.registerTool(
    'rename_process',
    {
      title: 'Rename process',
      description:
        'Renames one process of a .lila: sets its `name`, the one its canvas tab shows; its slug never ' +
        'changes. Refused in a project with a single process, whose name is the project\'s. The same ' +
        'name writes nothing (`written: false`). Atomic and locked like every write; `dryRun` writes ' +
        'nothing. Returns `{ file, dryRun, written, process, before, after, summary, notes }`. Like ' +
        '`lila process rename`.',
      inputSchema: z.object({
        project: projectSchema,
        process: slugSchema,
        name: z.string().describe('The new name.'),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ project, process, name, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await renameLilaProcess({ file: project, process, name, dryRun, locale: localeOf(locale) }));
      } catch (error) {
        return failure('rename_process', error);
      }
    },
  );

  server.registerTool(
    'delete_process',
    {
      title: 'Delete process',
      description:
        'Deletes one process of a .lila with its scenarios and saved runs, listed in ' +
        '`removedScenarios` and `removedRuns`. Refused for the last process, and for a process that a ' +
        'call activity of another process names in its `calledElement` (the refusal lists them as ' +
        '`slug/elementId (name)`). Down to one process, the project is written as a version 1 archive ' +
        'and its process takes the project\'s name (`notes` says so; `slugs` lists what is left). ' +
        'Atomic and locked like every write; `dryRun` writes nothing. Like `lila process delete`.',
      inputSchema: z.object({ project: projectSchema, process: slugSchema, dryRun: dryRunSchema, locale: localeSchema }),
      annotations: { destructiveHint: true },
    },
    async ({ project, process, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await deleteLilaProcess({ file: project, process, dryRun, locale: localeOf(locale) }));
      } catch (error) {
        return failure('delete_process', error);
      }
    },
  );

  server.registerTool(
    'rename_scenario',
    {
      title: 'Rename scenario',
      description:
        'Renames one scenario of a process of a .lila: sets its "name"; its entry (file name) stays. ' +
        'Its revision goes up, and so do those of the scenarios that extend it, as in the app, so their ' +
        'saved runs go stale. Refused when another scenario of the process already answers to that ' +
        'name (by its "name" or its file name). The same name writes nothing (`written: false`). ' +
        'Atomic and locked like every write; `dryRun` writes nothing. Returns `{ file, dryRun, ' +
        'written, process, entry, before, after, revision, summary, notes }`. Like `lila scenario rename`.',
      inputSchema: z.object({
        project: projectSchema,
        process: processSchema,
        scenario: scenarioSchema,
        name: z.string().describe('The new name.'),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ project, process, scenario, name, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await renameLilaScenario({ file: project, process, scenario, name, dryRun, locale: localeOf(locale) }));
      } catch (error) {
        return failure('rename_scenario', error);
      }
    },
  );

  server.registerTool(
    'delete_scenario',
    {
      title: 'Delete scenario',
      description:
        'Deletes one scenario of a process of a .lila with its saved runs, listed in `removedRuns`. ' +
        'Refused for the last scenario of the process, and for one that other scenarios extend (the ' +
        'refusal lists them). Deleting `as-is.scenario.json` leaves `edit_process` nowhere to store ' +
        'durations; `notes` says so. Atomic and locked like every write; `dryRun` writes nothing. ' +
        'Returns `{ file, dryRun, written, process, entry, removedRuns, summary, notes }`. Like ' +
        '`lila scenario delete`.',
      inputSchema: z.object({
        project: projectSchema,
        process: processSchema,
        scenario: scenarioSchema,
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ project, process, scenario, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await deleteLilaScenario({ file: project, process, scenario, dryRun, locale: localeOf(locale) }));
      } catch (error) {
        return failure('delete_scenario', error);
      }
    },
  );

  // Catalog (#672, RM-01). Folder projects wait for the version 3 folder adapter (#671).
  const upgradeText =
    'The first object created or adopted in a version 1 or 2 file saves it as repository version 3: ' +
    'the result (a dry run too) says `wouldUpgrade: true` with a `note`, because Lila 1.0.0-beta.15 ' +
    'to beta.28 and older cannot open the upgraded file.';
  const catalogProjectSchema = z.string().describe('Path to the .lila, relative to the cwd of the server process.');
  const typeSchema = z.string().describe('role, unit, system or document.');
  const optionalTypeSchema = z
    .string()
    .optional()
    .describe('The object\'s type; needed only when objects of several types share the id.');
  const idSchema = z.string().describe('The object\'s id, e.g. "role-4k9w2m7q1z8c".');
  const attributesSchema = z
    .array(z.object({ name: z.string(), value: z.string() }))
    .describe('Free extended attributes, { name, value } text pairs, in order.');
  const fieldsShape = {
    description: z.string().describe('Plain text.'),
    unitRef: z.string().describe('role: the id of its unit.'),
    parentRef: z.string().describe('unit: the id of its parent unit.'),
    ownerRef: z.string().describe('system, document: the id of the owning role.'),
    url: z.string().describe('system, document: an http or https URL, shown as a link, never fetched.'),
  };

  server.registerTool(
    'list_catalog',
    {
      title: 'List catalog',
      description:
        'The catalog objects of a .lila (roles, units, systems, documents, and objects of types this ' +
        'build only reads), by type then id, each whole: `type`, `id`, `name`, `revision`, and its ' +
        'fields. `formatVersion` says whether the file is already a version 3 repository. Read-only.',
      inputSchema: z.object({
        project: catalogProjectSchema,
        type: z.string().optional().describe('Only objects of this type.'),
        locale: localeSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, type, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await lilaCatalogList({ file: project, type, locale: localeOf(locale) }));
      } catch (error) {
        return failure('list_catalog', error);
      }
    },
  );

  server.registerTool(
    'get_catalog_object',
    {
      title: 'Get catalog object',
      description:
        'One catalog object of a .lila by id, whole, with its `revision`: pass that revision as ' +
        '`baseRevision` to `update_catalog_object`. An unknown id is an error. Read-only.',
      inputSchema: z.object({ project: catalogProjectSchema, id: idSchema, type: optionalTypeSchema, locale: localeSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, id, type, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await lilaCatalogObject({ file: project, id, type, locale: localeOf(locale) }));
      } catch (error) {
        return failure('get_catalog_object', error);
      }
    },
  );

  server.registerTool(
    'create_catalog_object',
    {
      title: 'Create catalog object',
      description:
        'Creates a catalog object (role, unit, system or document) in a .lila with a generated id ' +
        '(`<type>-` and 12 characters) and revision 1, and saves the project atomically. Names are ' +
        'not unique and never a key: refer to the object by the returned id (`annotate_element` ' +
        'writes it in `responsibilities[].roleRef` or `refs`). ' + upgradeText +
        ' Returns `{ file, dryRun, changed, written, object, created, updated, deleted, processes, wouldUpgrade, note? }`.',
      inputSchema: z.object({
        project: catalogProjectSchema,
        type: typeSchema,
        name: z.string().describe('What people read. Not empty.'),
        description: fieldsShape.description.optional(),
        attributes: attributesSchema.optional(),
        unitRef: fieldsShape.unitRef.optional(),
        parentRef: fieldsShape.parentRef.optional(),
        ownerRef: fieldsShape.ownerRef.optional(),
        url: fieldsShape.url.optional(),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, dryRun, locale, ...fields }): Promise<CallToolResult> => {
      try {
        return textResult(await createLilaCatalogObject({ file: project, dryRun, locale: localeOf(locale), ...fields }));
      } catch (error) {
        return failure('create_catalog_object', error);
      }
    },
  );

  server.registerTool(
    'update_catalog_object',
    {
      title: 'Update catalog object',
      description:
        'Renames a catalog object of a .lila or changes its fields, and saves the project atomically. ' +
        'A rename writes only the object: no model changes, because models hold the id. ' +
        '`baseRevision` is the revision you read (`get_catalog_object`); if the object changed since, ' +
        'the call fails with E-REVISION and writes nothing. A field left out stays; null removes an ' +
        'optional one. Its revision goes up by one; an update that changes nothing writes nothing. ' +
        'Objects of types this build does not know are read-only. Returns what `create_catalog_object` returns.',
      inputSchema: z.object({
        project: catalogProjectSchema,
        id: idSchema,
        type: optionalTypeSchema,
        baseRevision: z.number().int().describe('The revision you read.'),
        name: z.string().optional().describe('The new name. Not empty.'),
        description: fieldsShape.description.nullable().optional(),
        attributes: attributesSchema.nullable().optional(),
        unitRef: fieldsShape.unitRef.nullable().optional(),
        parentRef: fieldsShape.parentRef.nullable().optional(),
        ownerRef: fieldsShape.ownerRef.nullable().optional(),
        url: fieldsShape.url.nullable().optional(),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, dryRun, locale, ...fields }): Promise<CallToolResult> => {
      try {
        return textResult(await updateLilaCatalogObject({ file: project, dryRun, locale: localeOf(locale), ...fields }));
      } catch (error) {
        return failure('update_catalog_object', error);
      }
    },
  );

  server.registerTool(
    'delete_catalog_object',
    {
      title: 'Delete catalog object',
      description:
        'Deletes a catalog object of a .lila and saves the project atomically. An object in use (in ' +
        'a model, or in another object\'s unitRef/parentRef/ownerRef) is refused with E-OBJETO-EN-USO, ' +
        'listing its uses, unless you say what happens to the references: `replaceWith` another ' +
        'object of the same type (every reference is rewritten to it) or `removeReferences: true`. ' +
        'Rewritten models get a new revision, so their saved runs become stale; `processes` lists ' +
        'them. There is no forced delete that leaves broken references (references held by objects ' +
        'of types this build does not know are not seen). Returns what ' +
        '`create_catalog_object` returns; `object` is the deleted one.',
      inputSchema: z.object({
        project: catalogProjectSchema,
        id: idSchema,
        type: optionalTypeSchema,
        baseRevision: z.number().int().optional().describe('The revision you read; when given, a changed object fails with E-REVISION.'),
        replaceWith: z.string().optional().describe('The id of an object of the same type that takes over every reference.'),
        removeReferences: z.boolean().optional().describe('Remove every reference to the object, then delete it.'),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ project, id, type, baseRevision, replaceWith, removeReferences, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(
          await deleteLilaCatalogObject({ file: project, id, type, baseRevision, replaceWith, removeReferences, dryRun, locale: localeOf(locale) }),
        );
      } catch (error) {
        return failure('delete_catalog_object', error);
      }
    },
  );

  server.registerTool(
    'find_usages',
    {
      title: 'Find usages',
      description:
        'Where catalog objects are used in a .lila. With `id`: the uses of that object, each ' +
        '`{ process, slug, element, relation }` (relation `responsibility:R`, `systemRef`, `input`…; ' +
        '`process` is the process id, absent in a version 1 or 2 file) ' +
        'or `{ object, field }`; when no object has that id, `resolved: false` and the unresolved ' +
        'references to it (what `adopt_reference` would adopt). Without `id`: `uses` of every object ' +
        '(by `<type>/<id>`), every `unresolved` reference, and `duplicateProcessIds` (BPMN process ' +
        'ids declared by more than one process). Derived from the models; read-only.',
      inputSchema: z.object({
        project: catalogProjectSchema,
        id: z.string().optional().describe('An object id, or a reference value that matches no object.'),
        type: z.string().optional().describe('The type, when several types share the id or to narrow unresolved references.'),
        locale: localeSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, id, type, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await lilaUsages({ file: project, id, type, locale: localeOf(locale) }));
      } catch (error) {
        return failure('find_usages', error);
      }
    },
  );

  server.registerTool(
    'adopt_reference',
    {
      title: 'Adopt reference',
      description:
        'Turns a reference typed by hand before the catalog existed (a roleRef "cashier", a ' +
        'systemRef "POS") into a catalog object of `type`, and saves the project atomically. A value ' +
        'that is a valid id (lowercase letters, digits, hyphens, at most 64), not a reserved Windows ' +
        'name (con, nul…) and not the id of another object becomes the object\'s id, and no model is ' +
        'rewritten; any other value gets a generated id, and every reference of that type ' +
        'with that value, in every process, is rewritten to it (`processes` lists them). `name` ' +
        'defaults to the value. ' + upgradeText +
        ' Returns what `create_catalog_object` returns.',
      inputSchema: z.object({
        project: catalogProjectSchema,
        type: typeSchema,
        ref: z.string().describe('The reference as it is written in the models.'),
        name: z.string().optional().describe('The object\'s name; defaults to `ref`.'),
        dryRun: dryRunSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, type, ref, name, dryRun, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await adoptLilaReference({ file: project, type, ref, name, dryRun, locale: localeOf(locale) }));
      } catch (error) {
        return failure('adopt_reference', error);
      }
    },
  );
}
