/**
 * Types of the full engine message catalog (LILA-211).
 *
 * It composes the `core/` subset (`src/core/messages/`) with the namespaces that live outside
 * `core/`: the model validator (`bpmn/validate.ts`), the scenario lint and the zod texts. The
 * rules for an entry are the ones documented in `src/core/messages/types.ts`.
 *
 * PR-2 (CLI `--lang`, MCP `locale`) adds the `cli` and `mcp` namespaces here: the chrome of
 * `cli.ts`/`cli-shared.ts` and of `@lila/mcp`. They live here and **not** in `core/messages/` on
 * purpose: the web worker bundles `core/` only, and it has no console and no tools to describe.
 */
import type { CoreChrome, CoreCodeMessages } from '../core/messages/types.js';
import type { ConstructionId } from './constructions.js';

export type { Locale } from '../core/messages/types.js';

/** Message bodies of the codes emitted outside `core/`. */
export interface OuterCodeMessages {
  /* --- bpmn/validate.ts --------------------------------------------- */
  /** R-NOSOP-1: `{id} ({qname})` or `{id} ({qname}, "{name}")` plus the construction. */
  'E-NOSOP': (id: string, qname: string, name: string, construction: string) => string;
  'E-PARSE-INCOMPLETO': (id: string, notice: string) => string;
  'W-PARSE/otro-proceso': (id: string, processId: string, notice: string) => string;
  'W-PARSE/flujo-ausente': (id: string, notice: string) => string;
  'W-PARSE/inofensivo': (id: string, notice: string) => string;
  'W-XOR-DEFAULT-ROTO': (id: string, notice: string) => string;
  'W-MSGFLOW': (processId: string, count: number) => string;
  'W-COND': (flowId: string) => string;
  'E-GATEWAY-SIN-ARISTAS/sin-entradas': (id: string) => string;
  'E-GATEWAY-SIN-ARISTAS/sin-salidas': (id: string) => string;
  'E-SIN-START': (processId: string) => string;
  'E-SIN-END': (processId: string) => string;
  'E-INALCANZABLE': (id: string) => string;

  /* --- scenario.ts (lint) ------------------------------------------- */
  'E-RESERVADO': (path: string) => string;
  'E-REF-DESCONOCIDA': (path: string, calendar: string) => string;
  'E-SUBPROC-PARAMETRO': (path: string, id: string) => string;
  'E-ELEMENTO-DESCONOCIDO': (path: string, id: string) => string;
  'E-PROB-EN-NODO': (path: string) => string;
  'E-PROB-RANGO': (path: string, value: number) => string;
  'E-CAMPO-NO-APLICA/solo-inicio': (path: string) => string;
  'E-CAMPO-NO-APLICA/solo-tarea': (path: string) => string;
  'E-CAMPO-NO-APLICA/selection': (path: string) => string;
  'E-TIMER-RECURSO': (path: string) => string;
  'E-REC-DESCONOCIDO/recurso': (path: string, ref: string) => string;
  'E-REC-DUPLICADO/ref': (path: string, ref: string) => string;
  'E-REC-CANTIDAD/excede-ruta': (
    path: string,
    quantity: number,
    capacity: number,
    ref: string,
  ) => string;
  'E-XOR-SUMA-CERO': (path: string) => string;
  'E-SIN-PARADA': (path: string) => string;
  'W-SIN-SEED': (path: string) => string;
  'W-ELEMENTO-SIN-PARAMETROS': (path: string) => string;

  /* --- scenario.ts (schema) ----------------------------------------- */
  'E-CLAVE-DESCONOCIDA': (keys: string) => string;
}

export type CodeMessages = CoreCodeMessages & OuterCodeMessages;

/** Display text of every row of the R-NOSOP-2 catalogue (`docs/SEMANTICS.md` § 3). */
export type Constructions = Record<ConstructionId, string>;

/**
 * Texts of the zod layer: the error map of `parseScenario` and the `message:` strings that live
 * inside `ScenarioSchema` and therefore never reach the map.
 *
 * The operators (`<`, `≤`, `>`, `≥`) and the joined lists arrive already rendered, so a number or
 * a key set reads the same in both locales.
 */
export interface ZodMessages {
  /** zod type name, e.g. `string` -> `a string`. Unknown names come back unchanged. */
  typeName: (name: string) => string;
  /** Unit of a size bound, by container: `string` counts characters, everything else elements. */
  units: (origin: string, amount: number | bigint) => string;
  required: (expected: string) => string;
  wrongType: (expected: string, received: string) => string;
  tooBigNumber: (operator: string, maximum: string) => string;
  tooBigSize: (maximum: string, units: string) => string;
  tooSmallNumber: (operator: string, minimum: string) => string;
  tooSmallSize: (minimum: string, units: string) => string;
  invalidValue: (value: string) => string;
  invalidValues: (values: string) => string;
  unrecognizedKey: (key: string) => string;
  unrecognizedKeys: (keys: string) => string;
  invalidUnion: () => string;

  /** `min ≤ max` / `min ≤ mode ≤ max` of a distribution, named by its `type`. */
  distributionMinMax: (type: string) => string;
  distributionMinModeMax: (type: string) => string;
  startIso: () => string;
  startInvalidDate: (start: string, monthDay: string) => string;
  startInvalidTime: (start: string, clock: string) => string;
  startInvalidOffset: (start: string, offset: string) => string;
  currencyIso: () => string;
  intervalFrom: () => string;
  intervalTo: () => string;
  intervalOrder: () => string;
}

/**
 * Chrome of the `lila` CLI (`cli.ts`) and of the code it shares with the MCP server
 * (`cli-shared.ts`): usage, table and section titles, the labels of a problem line, and the errors
 * of the argument parsing. The Bizagi table titles (`Process elements`, `Sequence flows`,
 * `Resources`, `Process summary (extras)`) and every column name are **not** here: they are the
 * parity contract with Bizagi (`docs/BIZAGI_PARITY.md`) and read the same in both locales.
 *
 * Entries are message **bodies**: `lila <command>: ` is `commandError()`, exactly like `coded()`
 * puts the `CODE: ` prefix on a problem.
 */
export interface CliMessages {
  /** `lila --help`, and what an empty or wrong command line prints. */
  usage: () => string;

  /* --- `lila validate` ---------------------------------------------- */
  /** `subject` is `id` or `id (name)`, already assembled by the caller. */
  process: (subject: string) => string;
  exportedBy: (exporter: string, version: string) => string;
  nodes: (count: number, byType: string) => string;
  flows: (count: number) => string;
  /** Mark of the default flow of a XOR, appended to its line. */
  defaultFlow: () => string;
  otherProcesses: (ids: string) => string;
  /** Closing line of `validate`; not pluralised, same as the CLI has always printed it. */
  problemCounts: (errors: number, warnings: number) => string;
  errorLabel: () => string;
  warningLabel: () => string;

  /* --- `lila run` --------------------------------------------------- */
  scenario: (name: string) => string;
  runHeader: (seed: number, replications: number, unit: string) => string;
  /** Appended to `runHeader` after a `·` when the scenario declares one. */
  currency: (currency: string) => string;
  bottlenecks: () => string;
  /** Title of the per-outcome table of `lila run` (#316). */
  outcomes: () => string;
  noResourceWait: () => string;
  warnings: () => string;

  /* --- `lila compare` ----------------------------------------------- */
  comparedScenarios: () => string;
  timeUnitHeader: (unit: string) => string;
  columnName: () => string;
  columnFile: () => string;
  columnSeed: () => string;
  columnReplications: () => string;
  baseColumn: (name: string) => string;
  significantMark: () => string;

  /* --- `--xlsx` workbook (issue #80) -------------------------------- */
  /**
   * Sheet names and the labels of the sheets the spreadsheet adds on top of the CSV tables
   * (`Summary`, `Parameters`, `Comparison`). The **column** names of the Elements / Flows /
   * Resources tables are not here: they are the Bizagi contract of `docs/BIZAGI_PARITY.md` and
   * come from `format.ts` untranslated, exactly as in the CSV.
   */
  xlsxSheetSummary: () => string;
  xlsxSheetElements: () => string;
  xlsxSheetFlows: () => string;
  xlsxSheetResources: () => string;
  xlsxSheetParameters: () => string;
  xlsxSheetComparison: () => string;
  xlsxColumnSection: () => string;
  xlsxColumnParameter: () => string;
  xlsxColumnValue: () => string;
  xlsxSectionProcess: () => string;
  xlsxSectionOutcomes: () => string;
  xlsxSectionPayroll: () => string;
  xlsxSectionRun: () => string;
  xlsxSectionArrivals: () => string;
  xlsxSectionTasks: () => string;
  xlsxSectionGateways: () => string;
  xlsxSectionCalendars: () => string;
  xlsxCapacity: () => string;
  xlsxWorkingHours: () => string;
  xlsxPayrollCost: () => string;
  xlsxTotal: () => string;
  /** Column headers of the `Comparison` sheet, one group per compared scenario. */
  xlsxDelta: (scenario: string) => string;
  xlsxDeltaRelative: (scenario: string) => string;
  xlsxCi95Low: (scenario: string) => string;
  xlsxCi95High: (scenario: string) => string;
  xlsxOverlap: (scenario: string) => string;

  /* --- `compareWarnings()` (cli-shared.ts) -------------------------- */
  mixedTimeUnit: (unit: string, others: string) => string;
  differentSeeds: (seeds: string) => string;
  fewReplications: (label: string) => string;
  /** `count` is how many warnings of that code were dropped, never the total. */
  moreWarnings: (count: number) => string;

  /* --- loading a model or a scenario (cli-shared.ts) ---------------- */
  invalidJson: (file: string, detail: string) => string;
  /** Its own entry: `patch_scenario` rewrites this label into its own (`docs/MCP.md`). */
  invalidScenarioLabel: () => string;
  missingModel: (file: string) => string;
  missingRun: (file: string) => string;
  temporaryFileClosed: (file: string) => string;
  cannotWrite: (target: string) => string;

  /* --- arguments ---------------------------------------------------- */
  commandError: (command: string, body: string) => string;
  unknownCommand: (command: string) => string;
  integerRequired: (option: string, raw: string) => string;
  safeIntegerRequired: (option: string, raw: string) => string;
  minimumIntegerRequired: (option: string, minimum: number, raw: string) => string;
  expectedPositionals: (expected: string) => string;
  bpmnPath: () => string;
  runPaths: () => string;
  comparePaths: () => string;
  missingBpmnPath: () => string;
  modelMismatch: (modelPath: string, scenarioModel: string) => string;
  modelMismatchIn: (modelPath: string, scenarioModel: string, file: string) => string;
  mcpNoArguments: () => string;
  mcpMissingPackage: (packageName: string) => string;
  /** `accepted` arrives already joined (`en, es`), like every list in the catalog. */
  invalidLang: (value: string, accepted: string) => string;
  missingLangValue: (accepted: string) => string;
}

/**
 * Chrome of the MCP server (`packages/mcp/src/server.ts`): the readable summary of
 * `describe_process` and the bodies of the `isError` messages. The tools' own `title`,
 * `description` and `.describe()` are **not** here: they are the protocol surface an MCP client
 * reads, they are fixed in English, and a per-call `locale` cannot change what was already
 * advertised in `tools/list`.
 *
 * As in `CliMessages`, entries are bodies: `<tool>: ` is added by the caller.
 */
export interface McpMessages {
  /* --- `describe_process` summary ----------------------------------- */
  /** Node type of the IR (`task`, `xor`, …) in prose. An unknown type comes back unchanged. */
  nodeType: (type: string) => string;
  nodes: (count: number) => string;
  gateways: () => string;
  lanes: () => string;
  embeddedSubprocesses: () => string;
  /** `counts` is `errorCount` + `warningCount`, already joined by the caller. */
  validation: (counts: string) => string;
  validationWithErrors: (counts: string) => string;
  errorCount: (count: number) => string;
  warningCount: (count: number) => string;
  referencedResources: () => string;
  referencedResourcesNone: () => string;
  referencedResourcesUnreadable: (detail: string) => string;

  /* --- `isError` bodies --------------------------------------------- */
  fileMissing: (file: string) => string;
  bothPathAndXml: () => string;
  pathOrXml: () => string;
  modelMismatch: (modelPath: string, scenarioModel: string) => string;
  modelInvalid: (detail: string) => string;
  scenarioInvalid: (detail: string) => string;
  atLeastTwoScenarios: () => string;
  patchNotAnObject: () => string;
  /** Replaces `CliMessages.invalidScenarioLabel` when the defect came from a patch. */
  invalidAfterPatchLabel: () => string;
  patchedMissingModel: () => string;
  patchedMissingRun: () => string;
  patchedName: (name: string) => string;
  /** Etiqueta del escenario que llegó inline, en vez del archivo virtual que nunca existió. */
  inlineScenario: () => string;
}

export interface Catalog {
  codes: CodeMessages;
  chrome: CoreChrome;
  constructions: Constructions;
  zod: ZodMessages;
  cli: CliMessages;
  mcp: McpMessages;
}

/** `'E-CAL-VACIO/sin-intervalos'` -> `'E-CAL-VACIO'`; a key without a variant is its own code. */
export type CodeOf<K> = K extends `${infer C}/${string}` ? C : K;

/** Every `E-*`/`W-*` code the engine can emit. */
export type ProblemCode = CodeOf<keyof CodeMessages>;
