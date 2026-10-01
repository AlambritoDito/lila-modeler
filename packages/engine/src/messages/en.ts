/**
 * English message catalog of the engine outside `core/` (LILA-211). This is the default locale.
 */
import { coreEn } from '../core/messages/en.js';
import type { Catalog } from './types.js';

/** zod type names in English, for `invalid_type`. */
const TYPES: Record<string, string> = {
  array: 'a list',
  bigint: 'an integer',
  boolean: 'a boolean',
  int: 'an integer',
  null: 'null',
  number: 'a number',
  object: 'an object',
  record: 'an object',
  string: 'a string',
  undefined: 'nothing',
};

/** Node types of the IR in prose, for the summary of `describe_process`. */
const NODE_TYPES: Record<string, string> = {
  start: 'start',
  end: 'end',
  terminate: 'terminate',
  task: 'task',
  xor: 'XOR gateway',
  or: 'OR gateway',
  and: 'AND gateway',
  timer: 'timer',
  eventGateway: 'event-based gateway',
};

const EN_USAGE = `Usage: lila validate <file.bpmn|project.lila> [--process slug] [--json]
       lila run <model.bpmn|project.lila> <scenario> [--process slug] [--seed n]
                [--replications n] [--json result.json] [--csv directory] [--xlsx book.xlsx]
                [--save]
       lila compare <model.bpmn|project.lila> <a> <b> [...] [--process slug] [--seed n]
                    [--replications n] [--json result.json] [--xlsx book.xlsx] [--all]
       lila export diagram <model.bpmn|project.lila> [--process slug] [--out file.svg] [--force]
       lila export doc <project.lila> --out file.docx|file.html [--format docx|html]
                       [--process slug] [--run id|latest] [--scenario name] [--force]
       lila export results <project.lila> --out book.xlsx|directory [--format xlsx|csv]
                           [--process slug] [--run id|latest] [--scenario name] [--force]
       lila process create --outline <outline.json> -p <project.lila> [--name name]
                           [--process slug] [--dry-run] [--json]
       lila process show -p <project.lila> [--process slug] [--json]
       lila process edit -p <project.lila> --ops <ops.json> [--process slug]
                         [--dry-run] [--no-layout] [--json]
       lila process annotate <project.lila> <elementId> [--process slug] [--documentation text]
                             [--responsibility R|A|C|I:role ...] [--clear-responsibilities]
                             [--ref kind=id ...] [--attribute id=value ...] [--dry-run] [--json]
       lila process raci <project.lila> [--process slug] [--json|--csv]
       lila scenario import <project.lila> <scenario> <sheet.xlsx|sheet.csv> [--process slug]
                            [--dry-run] [--json]
       lila scenario template <project.lila> <scenario> --out sheet.xlsx [--process slug] [--force]
       lila mcp

Commands:
  validate   Parses the BPMN, prints its IR and validates the model.
  run        Validates model and scenario, simulates and shows the result tables.
  compare    Simulates two or more scenarios on the same model and compares them side by side.
  export     Exports without the app: the diagram as SVG, the process document as Word or
             HTML, or the results of a run saved in the .lila as .xlsx or CSV.
  process    create: builds a laid-out process from an outline (a step list) into a .lila.
             show: prints one process of a .lila as an outline.
             edit: applies a list of operations to a process, all or none. See docs/CLI.md.
             annotate: writes an element's description, RACI, catalog references and extended
             attributes into the .lila. raci: prints the RACI matrix of the process document.
  scenario   import: applies a scenario sheet (.xlsx/.csv) to a scenario of the .lila, like the
             app's Import Excel/CSV. template: writes that sheet, filled in, for a person.
  mcp        Starts the MCP server over stdio (for Claude Code / Desktop). See docs/MCP.md.

A model can be a .bpmn or a .lila project. With a .lila, a scenario is a .json path or, when no
such file exists, the name of a scenario of that process (its file name, with or without
.scenario.json, or its "name"). A .lila with several processes needs --process.

Options of validate, run and compare:
  --process slug    The process of a .lila with several processes (implicit with one).

validate options:
  --json     Prints the IR and the problems on stdout.

run options:
  --seed n          Overrides run.seed with an integer.
  --replications n  Overrides run.replications with an integer >= 1.
  --json file       Writes the deterministic RunResult as JSON.
  --csv directory   Writes elements, flows, resources, process and log as RFC 4180 CSV.
                    log.csv is written streaming and carries ISO timestamps from run.start.
  --xlsx file       Writes one .xlsx workbook with the Summary, Elements, Flows, Resources
                    and Parameters sheets. The event log is only in --csv.
  --save            Stores the run in the .lila (a scenario of the archive), as the app does:
                    the app shows it as the current run, and lila export uses it.

compare options:
  --seed n          Overrides run.seed in every compared scenario.
  --replications n  Overrides run.replications in every compared scenario.
  --json file       Writes the deterministic CompareResult as JSON.
  --xlsx file       Writes one .xlsx workbook with a Summary sheet per scenario plus a
                    Comparison sheet (value, 95% CI, delta and CI overlap per KPI).
  --all             Prints every KPI of compare(), not just the curated subset.
                    The first scenario listed is the base: the rest are compared against it.

export options:
  --out path        Where to write. Without it, export diagram prints the SVG on stdout.
  --format f        docx|html (doc) or xlsx|csv (results); by default from the --out extension
                    (.docx, .html, .xlsx). csv writes elements, flows, resources and process
                    .csv into the --out directory.
  --run id|latest   The stored run: latest (default) is the run of the current model and scenario;
                    the document only takes a current run and goes without results when there is
                    none.
  --scenario name   With latest, the run of that scenario (needed when several have one).
  --force           Replaces existing files; without it nothing existing is overwritten.
  The Word document has no diagram and no document has the run's charts: the engine has no
  rasteriser. The HTML document has the diagram.
process options:
  --outline file    create: the outline JSON (lanes plus steps; docs/MCP.md).
  -p, --project f   The .lila; create makes it when it does not exist.
  --ops file        edit: the JSON list of operations (docs/CLI.md).
  --process slug    create: slug of the new process (default: from the name). show, edit: which one.
  --name name       create: name of the process (default: the outline's).
  --dry-run         create, edit: build and check everything, write nothing.
  --no-layout       edit: keep every position; place only the new shapes.
  --json            Prints the result (create, edit) or the outline (show) as JSON.

process annotate options:
  --documentation t Replaces the description ("" removes it).
  --responsibility  TYPE:role, repeatable; replaces the element's whole RACI list.
  --clear-responsibilities  Removes every responsibility.
  --ref kind=id     systemRef, documentRef, riskRef, controlRef, kpiRef, input or output;
                    repeatable; replaces the lists of the kinds given (kind= empties one).
  --attribute k=v   An extended attribute by id or name; repeatable; "k=" removes its value.
  --dry-run         Shows the result without writing.

scenario import options:
  --dry-run         Shows the planned changes and the rows not applied without writing.

mcp options:
  None. It speaks MCP over stdin/stdout; the paths of the tools resolve against the
  directory it was launched from. Not run by hand: the MCP client launches it.

General options:
  --lang en|es     Language of the output. Default: LILA_LANG, then LANG; English if neither.
  -h, --help       Shows this help.
  -v, --version    Prints the installed version.`;

export const en: Catalog = {
  codes: {
    ...coreEn.codes,

    'E-NOSOP': (id, qname, name, construction) =>
      `${name === '' ? `${id} (${qname})` : `${id} (${qname}, "${name}")`}: ${construction} not supported by the simulator.`,
    'E-PARSE-INCOMPLETO': (id, notice) =>
      `${id}: the XML reader discarded model content, which was left incomplete: ${notice}.`,
    'W-PARSE/otro-proceso': (id, processId, notice) =>
      `${id}: XML reader notice in ${processId}, another process of the file that Lila does not simulate: ${notice}.`,
    'W-PARSE/flujo-ausente': (id, notice) =>
      `${id}: the XML reader did not find a flow this element declares; the graph is built without it: ${notice}.`,
    'W-PARSE/inofensivo': (id, notice) =>
      `${id}: XML reader notice, with no loss of nodes or flows: ${notice}.`,
    'W-XOR-DEFAULT-ROTO': (id, notice) =>
      `${id}: the declared default flow does not exist; the default-flow mark (\`isDefault\`) is ignored and the split follows the rules of a XOR without a default flow: ${notice}.`,
    'W-MSGFLOW': (processId, count) =>
      `${processId}: ${count} message flows (bpmn:messageFlow) were ignored.`,
    'W-COND': (flowId) => `${flowId}: the flow's condition (\`conditionExpression\`) is ignored; branching is probabilistic.`,
    'E-GATEWAY-SIN-ARISTAS/sin-entradas': (id) => `${id}: the gateway has no incoming flows.`,
    'E-GATEWAY-SIN-ARISTAS/sin-salidas': (id) => `${id}: the gateway has no outgoing flows.`,
    'E-SIN-START': (processId) => `${processId}: the process has no start event.`,
    'E-SIN-END': (processId) => `${processId}: the process has no end event and no terminate.`,
    'E-INALCANZABLE': (id) => `${id}: the node is not reachable from any start event.`,

    'E-RESERVADO': (path) => `reserved field, not supported by the simulator in v1 (${path}).`,
    'E-REF-DESCONOCIDA': (path, calendar) =>
      `the calendar ${calendar} does not exist in the list of calendars (${path}).`,
    'E-REF-DESCONOCIDA/flujo': (path, flowId) =>
      `the sequence flow ${flowId} does not exist in the model (${path}).`,
    'E-SUBPROC-PARAMETRO': (path, id) =>
      `${id} is an embedded subprocess and has no processing time, resources or cost of its own; its time is the sum of what happens inside (${path}).`,
    'E-ELEMENTO-DESCONOCIDO': (path, id) => `the id ${id} does not exist in the model (${path}).`,
    'E-PROB-EN-NODO': (path) => `a probability is only accepted on a sequence flow (${path}).`,
    'E-PROB-RANGO': (path, value) => `${value} is outside [0, 1] (${path}).`,
    'E-CAMPO-NO-APLICA/solo-inicio': (path) => `only accepted on a start event (${path}).`,
    'E-CAMPO-NO-APLICA/solo-tarea': (path) => `only a task can consume resources (${path}).`,
    'E-CAMPO-NO-APLICA/selection': (path) =>
      `the resource selection only makes sense together with the task's resources (${path}).`,
    'E-CAMPO-NO-APLICA/solo-flujo-xor': (path) =>
      `only accepted on a sequence flow leaving a diverging exclusive gateway (${path}).`,
    'E-TIMER-RECURSO': (path) => `a timer is a delay and consumes no resources (${path}).`,
    'E-REC-DESCONOCIDO/recurso': (path, ref) =>
      `the resource ${ref} does not exist in the list of resources (${path}).`,
    'E-REC-DUPLICADO/ref': (path, ref) =>
      `${ref} appears more than once; use the quantity instead of repeating it (${path}).`,
    'E-REC-CANTIDAD/excede-ruta': (path, quantity, capacity, ref) =>
      `the quantity ${quantity} exceeds the capacity ${capacity} of ${ref} (${path}).`,
    'E-XOR-SUMA-CERO': (path) =>
      `the probabilities of the XOR add up to 0; there is no possible route (${path}).`,
    'E-SIN-PARADA': (path) =>
      `a stopping condition is missing; declare the run duration or a maximum number of arrivals (${path}).`,
    'W-SIN-SEED': (path) =>
      `the scenario declares no seed; the run uses seed 1 (${path}).`,
    'W-ELEMENTO-SIN-PARAMETROS': (path) =>
      `the element exists in the model and has no parameters; it takes its default values (${path}).`,
    'W-COND-INALCANZABLE': (path, flowId, gatewayId) =>
      `${flowId} cannot be reached before ${gatewayId} on any sequential path; the condition only applies if a parallel branch traverses it (${path}).`,
    'W-OR-PROB-PARCIAL': (path, flowId, gatewayId) =>
      `${flowId} declares no probability, but ${gatewayId} has other outgoing flows that do; the undeclared flow is always taken, because a missing probability counts as 1 (${path}).`,

    'E-CLAVE-DESCONOCIDA': (keys) => `key not recognised by the schema: ${keys}.`,
  },
  chrome: coreEn.chrome,
  constructions: {
    boundaryEvent: 'event attached to an activity (boundary event)',
    messageEvent: 'message event',
    signalEvent: 'signal event',
    linkEvent: 'link event',
    errorEvent: 'error event',
    escalationEvent: 'escalation event',
    compensationEvent: 'compensation event',
    conditionalEvent: 'conditional event',
    cancelEvent: 'cancel event',
    multipleTriggerEvent: 'event with multiple triggers',
    intermediateThrowEvent: 'intermediate throw event',
    eventBasedGateway: 'event-based gateway',
    complexGateway: 'complex gateway',
    multiInstanceMarker: 'multi-instance marker',
    loopMarker: 'loop marker on the activity',
    transactionSubProcess: 'transaction subprocess',
    adHocSubProcess: 'ad-hoc subprocess',
    eventSubProcess: 'event subprocess',
    choreographyDiagram: 'choreography diagram',
    conversationDiagram: 'conversation diagram',
    startQuantity: 'startQuantity attribute other than 1',
    completionQuantity: 'completionQuantity attribute other than 1',
    endEventTrigger: 'end event with that trigger',
    startEventTrigger: 'start event with that trigger',
    outOfProfile: 'element outside the v1 profile',
  },
  zod: {
    typeName: (name) => TYPES[name] ?? name,
    units: (origin, amount) => {
      const one = amount === 1 || amount === 1n;
      if (origin === 'string') return one ? 'character' : 'characters';
      return one ? 'element' : 'elements';
    },
    required: (expected) => `is required and must be ${expected}`,
    wrongType: (expected, received) => `must be ${expected}, not ${received}`,
    tooBigNumber: (operator, maximum) => `must be ${operator} ${maximum}`,
    tooBigSize: (maximum, units) => `must have at most ${maximum} ${units}`,
    tooSmallNumber: (operator, minimum) => `must be ${operator} ${minimum}`,
    tooSmallSize: (minimum, units) => `must have at least ${minimum} ${units}`,
    invalidValue: (value) => `must be ${value}`,
    invalidValues: (values) => `must be one of: ${values}`,
    unrecognizedKey: (key) => `unknown key: ${key}`,
    unrecognizedKeys: (keys) => `unknown keys: ${keys}`,
    invalidUnion: () => 'does not match any of the accepted shapes',

    distributionMinMax: (type) => `${type}: minimum ≤ maximum is required`,
    distributionMinModeMax: (type) => `${type}: minimum ≤ mode ≤ maximum is required`,
    startIso: () => 'the start date must be ISO 8601 with an explicit offset',
    startInvalidDate: (start, monthDay) =>
      `the start date ${start} is not a valid date; ${monthDay} does not exist in the civil calendar.`,
    startInvalidTime: (start, clock) =>
      `the start date ${start} does not have a valid time; ${clock} does not exist on the civil clock.`,
    startInvalidOffset: (start, offset) =>
      `the start date ${start} does not have a valid offset; ${offset} is not a time offset.`,
    currencyIso: () => 'the currency must be an ISO 4217 code',
    intervalFrom: () => 'the start time of the interval must be "HH:MM"',
    intervalTo: () => 'the end time of the interval must be "HH:MM" ("24:00" is accepted)',
    intervalOrder: () =>
      'R13: the end time must be later than the start time; a night window is declared as two intervals',
    monthDay: () =>
      'days of the month: 0 is not a day; use 1…31, or -1…-31 counted from the end of the month',
    monthWeekdayNth: () =>
      'week of the month: 0 is not a week; use 1…5, or -1…-5 counted from the end of the month',
    annualDate: () =>
      'annual dates: an annual date is "MM-DD" and must exist in some year ("02-29" is accepted)',
    holidayDate: () =>
      'holidays: a holiday is "YYYY-MM-DD" (once) or "MM-DD" (every year) and must be a real date',
    intervalSelector: () =>
      'each interval declares exactly one of: days of the week, days of the month, weekdays of the month or annual dates',
  },
  cli: {
    usage: () => EN_USAGE,

    process: (subject) => `Process ${subject}`,
    exportedBy: (exporter, version) => `Exported by ${exporter} ${version}`,
    nodes: (count, byType) => `Nodes (${count}): ${byType}`,
    flows: (count) => `Flows (${count}):`,
    defaultFlow: () => '(default)',
    otherProcesses: (ids) => `Other processes in the file, not simulated: ${ids}`,
    problemCounts: (errors, warnings) => `${errors} errors, ${warnings} warnings.`,
    errorLabel: () => 'error',
    warningLabel: () => 'warning',

    scenario: (name) => `Scenario ${name}`,
    runHeader: (seed, replications, unit) =>
      `Seed ${seed} · Replications ${replications} · Time unit ${unit}`,
    currency: (currency) => `Currency ${currency}`,
    bottlenecks: () => 'Bottlenecks',
    outcomes: () => 'Outcomes',
    noResourceWait: () => 'No wait for a resource detected.',
    warnings: () => 'Warnings:',

    comparedScenarios: () => 'Compared scenarios',
    timeUnitHeader: (unit) => `Time unit ${unit} (base scenario) · Utilization in %`,
    columnName: () => 'Name',
    columnFile: () => 'File',
    columnSeed: () => 'Seed',
    columnReplications: () => 'Replications',
    baseColumn: (name) => `${name} (base)`,
    significantMark: () => '* significant difference (95% CI without overlap)',

    xlsxSheetSummary: () => 'Summary',
    xlsxSheetElements: () => 'Elements',
    xlsxSheetFlows: () => 'Flows',
    xlsxSheetResources: () => 'Resources',
    xlsxSheetParameters: () => 'Parameters',
    xlsxSheetComparison: () => 'Comparison',
    xlsxColumnSection: () => 'Section',
    xlsxColumnParameter: () => 'Parameter',
    xlsxColumnValue: () => 'Value',
    xlsxSectionProcess: () => 'Process',
    xlsxSectionOutcomes: () => 'Outcomes',
    xlsxSectionPayroll: () => 'Payroll',
    xlsxSectionRun: () => 'Run',
    xlsxSectionArrivals: () => 'Arrivals',
    xlsxSectionTasks: () => 'Tasks',
    xlsxSectionGateways: () => 'Gateways',
    xlsxSectionCalendars: () => 'Calendars',
    xlsxCapacity: () => 'Capacity',
    xlsxWorkingHours: () => 'Working hours',
    xlsxPayrollCost: () => 'Payroll cost',
    xlsxTotal: () => 'Total',
    xlsxSectionNotes: () => 'Notes',
    xlsxNoteDurations: () => 'Durations',
    xlsxNoteSeconds: () =>
      'Every duration in the Elements and Resources sheets is in seconds, the Busy time column ' +
      'of Resources included, whatever base time unit the scenario declares; the app converts ' +
      'them for display, this workbook does not.',
    xlsxCostPerCase: () => 'Cost per case',
    xlsxNoteCostPerCase: () =>
      'Cost per case is the mean cost of the cases that completed, not Total cost divided by ' +
      'Instances completed: the cost of the cases still in flight is part of Total cost and not ' +
      'of this mean.',
    xlsxNotePayroll: () =>
      'Payroll cost charges availability (capacity x cost per hour x the open hours of the run, ' +
      'busy or idle); the Unit cost of the Resources sheet charges only the hours actually ' +
      'occupied. They are two different questions, not two estimates of one.',
    xlsxDelta: (scenario) => `Delta ${scenario}`,
    xlsxDeltaRelative: (scenario) => `Delta % ${scenario}`,
    xlsxCi95Low: (scenario) => `CI95 low ${scenario}`,
    xlsxCi95High: (scenario) => `CI95 high ${scenario}`,
    xlsxOverlap: (scenario) => `CI95 overlap ${scenario}`,

    docVersion: (version) => `Version ${version}`,
    docDate: (date) => `Date: ${date}`,
    docGeneratedBy: (version) => `Generated by Lila Modeler ${version}`,
    docDescription: () => 'Process description',
    docNoDescription: () => 'The process has no description.',
    docAttributeNoRef: () => 'Attribute without a reference',
    docElements: () => 'Elements',
    docNoLane: () => 'No lane',
    docType: () => 'Type',
    docId: () => 'Id',
    docLane: () => 'Lane',
    docSubprocess: () => 'Sub-process',
    docAttachedTo: () => 'Attached to',
    docDocumentation: () => 'Description',
    docResponsibilities: () => 'Responsibilities (RACI)',
    docScenario: (name) => `Scenario: ${name}`,
    docResults: () => 'Results',
    docDiagramAlt: () => 'Process diagram',

    mixedTimeUnit: (unit, others) =>
      `the scenarios do not share baseTimeUnit; the whole table uses ${unit}, the one of the base ` +
      `scenario. Declaring another one: ${others}.`,
    differentSeeds: (seeds) =>
      `the scenarios run with different seeds (${seeds}): the common random numbers (R-DET-3) are ` +
      'lost and the deltas mix the effect of the change with the one of the sampling. ' +
      'Use --seed to force the same seed on all of them.',
    fewReplications: (label) =>
      `${label} ran without at least two complete replications; without a 95% CI there is no ` +
      'significance mark possible for that scenario.',
    moreWarnings: (count) =>
      count === 1
        ? '(+1 more warning with the same code)'
        : `(+${count} more warnings with the same code)`,

    invalidJson: (file, detail) => `${file}: invalid JSON: ${detail}`,
    invalidScenarioLabel: () => 'invalid scenario:',
    missingModel: (file) => `${file}: the resolved scenario does not declare model.`,
    missingRun: (file) => `${file}: the resolved scenario does not declare run.`,
    temporaryFileClosed: (file) => `temporary file already closed: ${file}`,
    cannotWrite: (target) => `cannot write ${target}: a directory with that name exists.`,

    commandError: (command, body) => `lila ${command}: ${body}`,
    unknownCommand: (command) => `lila: unknown command "${command}".`,
    integerRequired: (option, raw) => `--${option} requires an integer; got "${raw}".`,
    safeIntegerRequired: (option, raw) => `--${option} requires a safe integer; got "${raw}".`,
    minimumIntegerRequired: (option, minimum, raw) =>
      `--${option} requires an integer >= ${minimum}; got "${raw}".`,
    expectedPositionals: (expected) => `expected ${expected}.`,
    bpmnPath: () => 'one .bpmn or .lila path',
    runPaths: () => 'a <model.bpmn|project.lila> and a <scenario>',
    comparePaths: () => 'a <model.bpmn|project.lila> and at least two scenarios <a> <b>',
    missingBpmnPath: () => 'the path of the .bpmn or .lila file is missing.',
    modelMismatch: (modelPath, scenarioModel) =>
      `the positional model (${modelPath}) does not match scenario.model (${scenarioModel}).`,
    modelMismatchIn: (modelPath, scenarioModel, file) =>
      `the positional model (${modelPath}) does not match scenario.model (${scenarioModel}) in ${file}.`,
    mcpNoArguments: () => 'it takes no arguments.',
    mcpMissingPackage: (packageName) =>
      `the package ${packageName} is missing. In the repo, \`npm ci && npm run build\` from the root.`,
    invalidLang: (value, accepted) => `lila: --lang only accepts: ${accepted}; got "${value}".`,
    missingLangValue: (accepted) => `lila: --lang requires a value: ${accepted}.`,

    lilaProcessRequired: (file, slugs) =>
      `${file} holds several processes (${slugs}): choose one with --process <slug> (\`process\` in MCP).`,
    lilaUnknownProcess: (file, slug, slugs) => `${file} has no process "${slug}"; its processes are: ${slugs}.`,
    processOnlyForLila: () => 'a process slug only applies when the model is a .lila file.',
    lilaUnreadable: (file, detail) => `${file} cannot be opened as a .lila project: ${detail}`,
    lilaScenarioNotFound: (name, slug, file, available) =>
      `there is no file "${name}" and no scenario of that name in process "${slug}" of ${file}; ` +
      (available === '' ? 'that process has no scenarios.' : `its scenarios are: ${available}.`),
    lilaScenarioUnknown: (name, slug, file, available) =>
      `there is no scenario "${name}" in process "${slug}" of ${file}; ` +
      (available === '' ? 'that process has no scenarios.' : `its scenarios are: ${available}.`),
    lilaScenarioAmbiguous: (name, matches) =>
      `several scenarios are named "${name}": ${matches}. Use the file name instead.`,
    lilaScenarioEntryName: (name) =>
      `"${name}" is not a scenario name inside a .lila: use a flat <name>.scenario.json, without folders.`,
    lilaBusy: (file) =>
      `another program is saving ${file} right now; nothing was written. Try again in a moment.`,
    lilaChangedOnDisk: (file) =>
      `${file} changed on disk while this call was working on it; nothing was written. Try again.`,

    exportNeedsLila: (file) => `${file} is not a .lila project: the document and the results are exported from one.`,
    exportRunUnknown: (id, slug, file, runs) =>
      `process "${slug}" of ${file} has no run "${id}"; ` + (runs === '' ? 'it has no stored runs.' : `its runs are: ${runs}.`),
    exportNoRun: (file, slug, scenario) =>
      `process "${slug}" of ${file} has no stored run${scenario === '' ? '' : ` of ${scenario}`}. ` +
      'Simulate it with `lila run <file> <scenario> --save` (`saveRun` in MCP), or in Lila Modeler and save the project.',
    exportNoCurrentRun: (file, slug, runs) =>
      `process "${slug}" of ${file} has no run of its current model and scenario; older runs: ${runs}. ` +
      'Pass one by id (--run, `run` in MCP) or simulate again (`lila run … --save`).',
    exportRunAmbiguous: (file, slug, scenarios) =>
      `process "${slug}" of ${file} has current runs of several scenarios (${scenarios}): ` +
      'choose one with --scenario (`scenario` in MCP) or pass a run id.',
    exportRunStale: (id, slug, file) =>
      `run "${id}" of process "${slug}" of ${file} is of an older model or scenario: the document would ` +
      'mix today\'s model with old results. Export its results instead, or simulate again.',
    exportNoDiagram: () => 'The model has no diagram (BPMN DI): the document goes without one.',
    exportDocxNoDiagram: () =>
      'The Word document has no diagram: Word needs a PNG and the engine has no rasteriser. The HTML document has it.',
    exportDocumentNoRun: () => 'No current run: the document has the model and no results.',
    exportNoCharts: () => 'The charts of the run are left out: the engine has no rasteriser.',
    exportTargetExists: (target) => `${target} already exists; nothing was written. Pass --force (\`overwrite\` in MCP) to replace it.`,
    exportNotDirectory: (path) => `cannot write into ${path}: it is a file, not a directory.`,
    exportUnknownKind: (kind) => `unknown export "${kind}": expected diagram, doc or results.`,
    exportPaths: () => 'diagram|doc|results and a <model.bpmn|project.lila>',
    exportInvalidFormat: (value, accepted) =>
      value === '' ? `choose a format with --format: ${accepted}.` : `--format only accepts: ${accepted}; got "${value}".`,
    exportOutRequired: (kind) => `lila export ${kind} needs --out <path>.`,
    exportTargetIsSource: (target) =>
      `${target} is the file being exported; nothing was written. Choose another destination.`,
    exportFileNeeded: (path) => `"${path}" ends with a slash; name the file to write.`,
    exportRunAndScenario: () =>
      'a run id already says which scenario: pass --run <id> or --scenario (`run` or `scenario` in MCP), not both.',
    saveRunNeedsLila: () => 'saving the run (--save, `saveRun` in MCP) needs a .lila model.',
    saveRunNeedsArchiveScenario: (scenario) =>
      `saving the run needs a scenario of the .lila, and "${scenario}" is not one: name a scenario of the process.`,
    lilaRunStale: (file, scenario) =>
      `the model or the scenario ${scenario} of ${file} changed while the simulation ran; the run was not saved. Run it again.`,
    runSaved: (id, file, slug) => `Run ${id} saved in ${file} (process ${slug}).`,
    outlineInvalid: (detail) => `the outline is invalid:\n${detail}`,
    outlineDuplicateId: (id) => `step id "${id}" is used more than once.`,
    outlineBadId: (id) => `step id "${id}" is not a valid BPMN id (letters, digits, "_", "-" and ".", not starting with a digit).`,
    outlineReservedId: (id) => `step id "${id}" clashes with an id Lila generates (start, end, flows, lanes, diagram); rename the step.`,
    outlineDuplicateLane: (lane) => `lane "${lane}" is listed more than once.`,
    outlineUnknownLane: (step, lane) => `step "${step}": lane "${lane}" is not in "lanes".`,
    outlineUnknownTarget: (step, target) => `step "${step}": "${target}" is not the id of a step.`,
    outlineBranchesNeedGateway: (step, type) => `step "${step}": "branches" needs a gateway (xor, or, and), not ${type}.`,
    outlineBranchTarget: (step) => `step "${step}": each branch needs either "to" (a step id) or "end": true.`,
    outlineManyNextNeedGateway: (step) => `step "${step}": several "next" steps need a gateway (xor, or, and); add one.`,
    outlineEndWithNext: (step) => `step "${step}": "end" cannot be combined with "next" or "branches".`,
    outlineFieldNotApplicable: (step, field, type) => `step "${step}": "${field}" does not apply to a ${type}.`,
    outlineProbabilityOnAnd: (step) => `step "${step}": a parallel gateway (and) takes every branch; "probability" does not apply.`,
    outlineProbabilitySum: (step, sum) => `step "${step}": the branch probabilities add up to ${sum}, more than 1.`,
    outlineBadDuration: (step, text) =>
      `step "${step}": duration "${text}" is not a distribution. Write a number of seconds, "20m", "normal(20m, 5m)", "triangular(1m, 2m, 5m)", "exponential(mean=4m)" or a scenario distribution object.`,
    outlineBpmnInvalid: (detail) => `the process built from the outline does not validate:\n${detail}`,
    outlineNoProcess: () => 'the BPMN has no process.',
    outlineUnsupported: (id, type) => `${id} (${type}) has no outline equivalent and was left out.`,
    outlineLostFlow: (id) => `${id}: a flow to or from an element the outline left out was dropped.`,
    outlineUnknownKey: (key) => `unknown field "${key}".`,
    outlineNotObject: () => 'must be an object.',
    outlineNotText: () => 'must be a non-empty text.',
    outlineNotTextList: () => 'must be a list of non-empty texts.',
    outlineNotBoolean: () => 'must be true or false.',
    outlineNotProbability: () => 'must be a number between 0 and 1.',
    outlineNotQuantity: () => 'must be a whole number of at least 1.',
    outlineNoSteps: () => 'must be a non-empty list of steps.',
    outlineBadType: (value, accepted) => `"${value}" is not a step type; use one of ${accepted}.`,
    outlineBadNext: () => 'must be a step id or a list of step ids.',
    outlineBadResource: () => 'must be a resource name or {"name", "quantity"}.',
    outlineBadSelection: () => 'must be "and" (every resource) or "or" (any one of them).',
    outlineNoWayOut: (step) => `from step "${step}" no path reaches an end: a case that gets here would loop forever. Give the loop an exit.`,
    outlineLayoutFailed: (detail) => `the automatic layout failed on this outline (${detail}). Try listing the branches in the order their steps appear.`,
    outlineXorAndJoin: (join, split) =>
      `parallel join "${join}" waits for branches of the exclusive gateway "${split}", which only ever takes one: cases would wait there forever. Use an xor (or or) join.`,
    outlineDroppedPools: (names) => `other pools are not part of the outline and were left out: ${names}.`,
    outlineDroppedMessageFlows: (count) => `${count} message flows are not part of the outline and were left out.`,
    outlineDroppedEventNames: (events) => `start and end events are implicit in an outline; their names were left out: ${events}.`,
    outlineDroppedArtifacts: (count) => `${count} annotations, groups or associations are not part of the outline and were left out.`,
    outlineDroppedDefaults: (ids) => `default-flow marks are not part of the outline and were left out: ${ids}.`,
    outlineScenarioOutside: (kinds) =>
      `the scenario's ${kinds.split(',').map((k) => ({ arrivals: 'arrivals', calendars: 'calendars', costs: 'costs', capacities: 'resource capacities and types', conditions: 'conditional routing' } as Record<string, string>)[k] ?? k).join(', ')} are not part of the outline; they stay in the scenario, which this reading does not change.`,
    processSlugNewFile: (slug, derived) =>
      `a new .lila holds one process, whose slug comes from its name ("${derived}"), so it cannot be "${slug}". Leave the slug out, or set a name that gives it.`,
    outlineFileUnreadable: (file, detail) => `cannot read the outline ${file}: ${detail}`,
    processNotLila: (file) => `${file} is not a .lila file.`,
    processBadSlug: (slug) => `"${slug}" is not a valid process slug (lowercase letters, digits and hyphens).`,
    processExists: (slug, file) => `${file} already has a process "${slug}"; nothing was written. Choose another name or slug.`,
    processCreated: (name, slug, file, steps, lanes, newFile) =>
      `Created process "${name}" (${slug}) in ${newFile ? 'the new file ' : ''}${file}: ${steps} steps, ${lanes} lanes, base scenario as-is.scenario.json.`,
    processDryRun: (name, slug, file, steps, lanes, newFile) =>
      `Dry run: would create process "${name}" (${slug}) in ${newFile ? 'the new file ' : ''}${file}: ${steps} steps, ${lanes} lanes. Nothing was written.`,
    processUnknownSubcommand: (sub) => `unknown subcommand "${sub}"; use create, show, edit, annotate or raci.`,
    processMissingOption: (option) => `missing ${option}.`,
    processShowHeader: (name, slug) => `Process "${name}" (${slug})`,
    processShowLanes: (lanes) => `Lanes: ${lanes}`,
    editInvalid: (detail) => `the edit was refused; nothing was changed:\n${detail}`,
    editBpmnInvalid: (detail) => `the edited process would not validate; nothing was changed:\n${detail}`,
    editContentLoss: (detail) => `the model has content the BPMN reader cannot write back, so editing it would lose it: ${detail}`,
    editUnknownId: (id) => `"${id}" is not the id of an element of the model.`,
    editNotAStep: (id, type) => `"${id}" is a ${type}, not a step (task, gateway, event or sub-process).`,
    editOtherProcess: (id, process) => `"${id}" is not in the process being edited (${process}).`,
    editBadId: (id) => `"${id}" is not a valid BPMN id (letters, digits, "_", "-" and ".", not starting with a digit).`,
    editIdTaken: (id) => `id "${id}" is already used in the model.`,
    editAfterAndBetween: () => 'use either "after" or "between", not both.',
    editAfterAndBefore: () => 'use either "after" or "before", not both.',
    editAfterEnd: (id) => `"${id}" is an end event: nothing can follow it. Use "between" with the step before it.`,
    editAfterAmbiguous: (id, count) =>
      `"${id}" has ${count} outgoing flows, so "after" is ambiguous; use "between": ["${id}", "<next step id>"].`,
    editNoFlowBetween: (from, to) => `there is no flow from "${from}" to "${to}".`,
    editOtherContainer: (from, to) => `"${from}" and "${to}" are not in the same process or sub-process.`,
    editFromEnd: (id) => `"${id}" is an end event: no flow can leave it.`,
    editToStart: (id) => `"${id}" is a start or boundary event: no flow can arrive at it.`,
    editProbabilityNeedsChoice: (id) =>
      `"probability" only applies to a flow out of an exclusive (xor) or inclusive (or) gateway; "${id}" is not one.`,
    editNeedsScenario: (field, scenario) =>
      `"${field}" goes into the base scenario ${scenario}, and this process has none; set it with patch_scenario instead.`,
    editRemoveAmbiguous: (id, incoming, outgoing) =>
      `cannot remove "${id}": with ${incoming} incoming and ${outgoing} outgoing flows it is not clear how to reconnect them. Remove or reconnect its flows first.`,
    editRemoveBoundary: (id, boundaries) => `cannot remove "${id}": boundary events are attached to it (${boundaries}); remove them first.`,
    editCannotRemove: (id, type) => `"${id}" is a ${type}; only steps and sequence flows can be removed.`,
    editBoundaryNeedsActivity: (id, boundaries) =>
      `"${id}" has boundary events attached (${boundaries}); only a task, call activity or sub-process can hold them.`,
    editLaneUnknown: (lane, lanes) =>
      lanes === '' ? `there is no lane "${lane}": the process has no lanes; add one with addLane.` : `there is no lane "${lane}"; the lanes are: ${lanes}.`,
    editLaneAmbiguous: (lane, ids) => `several lanes are named "${lane}" (${ids}); use the lane id.`,
    editLaneOutsideProcess: (id) => `"${id}" is inside a sub-process, which has no lanes.`,
    editProbabilityNote: (gateway, scenario, sum) =>
      `gateway "${gateway}": the probabilities of its outgoing flows in ${scenario} now add up to ${sum}; adjust them with patch_scenario.`,
    editScenarioEntries: (scenario, ids) => `${scenario} still has entries for removed elements (${ids}); they were kept.`,
    editPositionAfter: (id) => `after "${id}"`,
    editPositionBetween: (from, to) => `between "${from}" and "${to}"`,
    editPositionAlone: () => 'unconnected',
    editPositionLane: (lane) => `in lane "${lane}"`,
    editAdded: (id, type, position) => `added ${type} "${id}" ${position}`,
    editConnected: (from, to, flow) => `connected "${from}" → "${to}" (${flow})`,
    editRemovedFlow: (id) => `removed flow "${id}"`,
    editRemovedStep: (id, reconnected, also) =>
      `removed "${id}"${reconnected === '' ? '' : `; reconnected ${reconnected}`}${also === '' ? '' : `; also removed ${also}`}`,
    editAlsoRemoved: (ids) => `; also removed ${ids}`,
    editRenamed: (id, before, after) => `renamed "${id}": "${before}" → "${after}"`,
    editRetyped: (id, from, to) => `"${id}": ${from} → ${to}`,
    editMoved: (id, lane) => `moved "${id}" to lane "${lane}"`,
    editLaneAdded: (name, id) => `added lane "${name}" (${id})`,
    processEdited: (name, slug, file, operations, removed) =>
      `Edited process "${name}" (${slug}) in ${file}: ${operations} operations, ${removed} elements removed.`,
    processEditDryRun: (name, slug, file, operations, removed) =>
      `Dry run: would edit process "${name}" (${slug}) in ${file}: ${operations} operations, ${removed} elements removed. Nothing was written.`,
    editOpsUnreadable: (file, detail) => `cannot read the operations ${file}: ${detail}`,
    editLayoutFailed: (detail) => `the automatic layout failed on the edited process (${detail}); nothing was changed. Try again with layout: false (--no-layout).`,
  },
  mcp: {
    nodeType: (type) => NODE_TYPES[type] ?? type,
    nodes: (count) => `Nodes (${count}):`,
    gateways: () => 'Gateways and their outgoing flows:',
    lanes: () => 'Lanes:',
    embeddedSubprocesses: () => 'Embedded subprocesses (flattened):',
    validation: (counts) => `Validation: ${counts}.`,
    validationWithErrors: (counts) =>
      `Validation: ${counts}. The model CANNOT be simulated; use validate_bpmn for the detail.`,
    errorCount: (count) => `${count} ${count === 1 ? 'error' : 'errors'}`,
    warningCount: (count) => `${count} ${count === 1 ? 'warning' : 'warnings'}`,
    referencedResources: () => 'Referenced resources:',
    referencedResourcesNone: () =>
      'Referenced resources: (no scenario, or the scenario references no resources)',
    referencedResourcesUnreadable: (detail) =>
      `Referenced resources: the scenario could not be read: ${detail}`,

    fileMissing: (file) => `the file ${file} does not exist.`,
    bothPathAndXml: () => 'pass `path` or `xml`, not both.',
    pathOrXml: () => 'pass `path` or `xml`.',
    projectOrPath: () => 'pass `project` or `path`.',
    bothProjectAndPath: () => 'pass `project` or `path`, not both.',
    modelMismatch: (modelPath, scenarioModel) =>
      `the model (${modelPath}) does not match scenario.model (${scenarioModel}).`,
    modelInvalid: (detail) => `the model does not pass validation: ${detail}`,
    scenarioInvalid: (detail) => `invalid scenario: ${detail}`,
    atLeastTwoScenarios: () => 'at least two scenarios are needed.',
    patchNotAnObject: () => 'the patch did not produce a scenario object.',
    invalidAfterPatchLabel: () => 'invalid scenario after the patch:',
    patchedMissingModel: () => 'the resulting scenario does not declare model.',
    patchedMissingRun: () => 'the resulting scenario does not declare run.',
    patchedName: (name) => `${name} (patched)`,
    inlineScenario: () => 'inline scenario',
    projectNotLila: (file) => `\`project\` must be a .lila file; got ${file}.`,
  },
};
