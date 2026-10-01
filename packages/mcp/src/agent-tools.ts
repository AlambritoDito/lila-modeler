/**
 * The modelling tools of #99, #403 and #514: `annotate_element`, `get_raci_matrix`,
 * `import_scenario_sheet`, `export_scenario_template` and `create_project`. Thin layers over
 * `@lila-modeler/engine/project-fs`, like `lila process annotate|raci` and
 * `lila scenario import|template`; registered by `createServer` (`server.ts`).
 *
 * As in the rest of the server, the schemas stay loose where a tighter one would make the SDK
 * answer in English only (a RACI type, a scenario that is not an object): the engine refuses those
 * in the caller's language, with nothing written.
 */
import type { Locale } from '@lila-modeler/engine/messages';
import {
  annotateLilaElement,
  createLilaProject,
  importLilaScenarioSheet,
  lilaRaciMatrix,
  lilaScenarioTemplate,
  writeExportFile,
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
    'get_raci_matrix',
    {
      title: 'Get RACI matrix',
      description:
        'The RACI matrix of a process of a .lila: `roles` (every roleRef, in order of appearance) ' +
        'and `rows`, one per element with responsibilities, in the order of the process document ' +
        '(id, name, lane, the raw `responsibilities` and `cells`: role -> "R", "A, C"…). Like ' +
        '`lila process raci --json`.',
      inputSchema: z.object({ project: projectSchema, process: processSchema, locale: localeSchema }),
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
        'file is refused unless `overwrite`.',
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
        locale: localeSchema,
      }),
    },
    async ({ path, name, bpmn, scenarios, overwrite, locale }): Promise<CallToolResult> => {
      try {
        return textResult(await createLilaProject({ path, name, bpmn, scenarios, overwrite, locale: localeOf(locale) }));
      } catch (error) {
        return failure('create_project', error);
      }
    },
  );
}
