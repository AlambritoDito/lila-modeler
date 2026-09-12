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
};

const EN_USAGE = `Usage: lila validate <file.bpmn> [--json]
       lila run <model.bpmn> <scenario.json> [--seed n] [--replications n]
                [--json result.json] [--csv directory] [--xlsx book.xlsx]
       lila compare <model.bpmn> <a.json> <b.json> [...] [--seed n] [--replications n]
                    [--json result.json] [--xlsx book.xlsx] [--all]
       lila mcp

Commands:
  validate   Parses the BPMN, prints its IR and validates the model.
  run        Validates model and scenario, simulates and shows the result tables.
  compare    Simulates two or more scenarios on the same model and compares them side by side.
  mcp        Starts the MCP server over stdio (for Claude Code / Desktop). See docs/MCP.md.

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
  --lang en|es  Language of the output. Default: LILA_LANG, then LANG; English if neither.
  -h, --help    Shows this help.`;

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
      `${id}: the declared default flow does not exist; the isDefault mark is ignored and the split follows the rules of a XOR without a default: ${notice}.`,
    'W-MSGFLOW': (processId, count) =>
      `${processId}: ${count} message flows (bpmn:messageFlow) were ignored.`,
    'W-COND': (flowId) => `${flowId}: conditionExpression is ignored; branching is probabilistic.`,
    'E-GATEWAY-SIN-ARISTAS/sin-entradas': (id) => `${id}: the gateway has no incoming flows.`,
    'E-GATEWAY-SIN-ARISTAS/sin-salidas': (id) => `${id}: the gateway has no outgoing flows.`,
    'E-SIN-START': (processId) => `${processId}: the process has no start event.`,
    'E-SIN-END': (processId) => `${processId}: the process has no end event and no terminate.`,
    'E-INALCANZABLE': (id) => `${id}: the node is not reachable from any start event.`,

    'E-RESERVADO': (path) => `${path}: reserved field, not supported by the simulator in v1.`,
    'E-REF-DESCONOCIDA': (path, calendar) =>
      `${path}: the calendar ${calendar} does not exist in calendars.`,
    'E-REF-DESCONOCIDA/flujo': (path, flowId) =>
      `${path}: the sequence flow ${flowId} does not exist in the model.`,
    'E-SUBPROC-PARAMETRO': (path, id) =>
      `${path}: ${id} is an embedded subprocess and has no processing time, resources or cost of its own; its time is the sum of what happens inside.`,
    'E-ELEMENTO-DESCONOCIDO': (path, id) => `${path}: the id ${id} does not exist in the model.`,
    'E-PROB-EN-NODO': (path) => `${path}: only accepted on a sequence flow.`,
    'E-PROB-RANGO': (path, value) => `${path}: ${value} is outside [0, 1].`,
    'E-CAMPO-NO-APLICA/solo-inicio': (path) => `${path}: only accepted on a start event.`,
    'E-CAMPO-NO-APLICA/solo-tarea': (path) => `${path}: only a task can consume resources.`,
    'E-CAMPO-NO-APLICA/selection': (path) => `${path}: it only makes sense together with resources.`,
    'E-CAMPO-NO-APLICA/solo-flujo-xor': (path) =>
      `${path}: only accepted on a sequence flow leaving a diverging exclusive gateway.`,
    'E-TIMER-RECURSO': (path) => `${path}: a timer is a delay and consumes no resources.`,
    'E-REC-DESCONOCIDO/recurso': (path, ref) =>
      `${path}: the resource ${ref} does not exist in resources.`,
    'E-REC-DUPLICADO/ref': (path, ref) => `${path}: ${ref} appears more than once; use quantity.`,
    'E-REC-CANTIDAD/excede-ruta': (path, quantity, capacity, ref) =>
      `${path}: ${quantity} exceeds capacity ${capacity} of ${ref}.`,
    'E-XOR-SUMA-CERO': (path) =>
      `${path}: the probabilities of the XOR add up to 0; there is no possible route.`,
    'E-SIN-PARADA': (path) =>
      `${path}: a stopping condition is missing; declare run.duration or a triggerCount.`,
    'W-SIN-SEED': (path) => `${path}: the scenario declares no seed; the run uses seed = 1.`,
    'W-ELEMENTO-SIN-PARAMETROS': (path) =>
      `${path}: the element exists in the model and has no parameters; it takes its defaults.`,
    'W-COND-INALCANZABLE': (path, flowId, gatewayId) =>
      `${path}: ${flowId} cannot be reached before ${gatewayId} on any sequential path; the condition only applies if a parallel branch traverses it.`,

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

    distributionMinMax: (type) => `${type}: min ≤ max is required`,
    distributionMinModeMax: (type) => `${type}: min ≤ mode ≤ max is required`,
    startIso: () => 'run.start must be ISO 8601 with an explicit offset',
    startInvalidDate: (start, monthDay) =>
      `run.start: ${start} is not a valid date; ${monthDay} does not exist in the civil calendar.`,
    startInvalidTime: (start, clock) =>
      `run.start: ${start} is not a valid time; ${clock} does not exist on the civil clock.`,
    startInvalidOffset: (start, offset) =>
      `run.start: ${start} does not have a valid offset; ${offset} is not a time offset.`,
    currencyIso: () => 'run.currency must be an ISO 4217 code',
    intervalFrom: () => 'from must be "HH:MM"',
    intervalTo: () => 'to must be "HH:MM" ("24:00" is accepted)',
    intervalOrder: () =>
      'R13: to > from is required; a night window is declared as two intervals',
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
    xlsxDelta: (scenario) => `Delta ${scenario}`,
    xlsxDeltaRelative: (scenario) => `Delta % ${scenario}`,
    xlsxCi95Low: (scenario) => `CI95 low ${scenario}`,
    xlsxCi95High: (scenario) => `CI95 high ${scenario}`,
    xlsxOverlap: (scenario) => `CI95 overlap ${scenario}`,

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
    bpmnPath: () => 'one .bpmn path',
    runPaths: () => 'the paths <model.bpmn> <scenario.json>',
    comparePaths: () => 'a <model.bpmn> and at least two scenarios <a.json> <b.json>',
    missingBpmnPath: () => 'the path of the .bpmn file is missing.',
    modelMismatch: (modelPath, scenarioModel) =>
      `the positional model (${modelPath}) does not match scenario.model (${scenarioModel}).`,
    modelMismatchIn: (modelPath, scenarioModel, file) =>
      `the positional model (${modelPath}) does not match scenario.model (${scenarioModel}) in ${file}.`,
    mcpNoArguments: () => 'it takes no arguments.',
    mcpMissingPackage: (packageName) =>
      `the package ${packageName} is missing. In the repo, \`npm ci && npm run build\` from the root.`,
    invalidLang: (value, accepted) => `lila: --lang only accepts: ${accepted}; got "${value}".`,
    missingLangValue: (accepted) => `lila: --lang requires a value: ${accepted}.`,
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
  },
};
