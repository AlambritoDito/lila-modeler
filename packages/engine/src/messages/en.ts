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
       lila compare <model.bpmn|project.lila> <a> <b> [...] [--process slug] [--seed n]
                    [--replications n] [--json result.json] [--xlsx book.xlsx] [--all]
       lila mcp

Commands:
  validate   Parses the BPMN, prints its IR and validates the model.
  run        Validates model and scenario, simulates and shows the result tables.
  compare    Simulates two or more scenarios on the same model and compares them side by side.
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

compare options:
  --seed n          Overrides run.seed in every compared scenario.
  --replications n  Overrides run.replications in every compared scenario.
  --json file       Writes the deterministic CompareResult as JSON.
  --xlsx file       Writes one .xlsx workbook with a Summary sheet per scenario plus a
                    Comparison sheet (value, 95% CI, delta and CI overlap per KPI).
  --all             Prints every KPI of compare(), not just the curated subset.
                    The first scenario listed is the base: the rest are compared against it.

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
    lilaChangedOnDisk: (file) =>
      `${file} changed on disk while this call was working on it; nothing was written. Try again.`,
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
