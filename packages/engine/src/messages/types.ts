/**
 * Types of the full engine message catalog (LILA-211).
 *
 * It composes the `core/` subset (`src/core/messages/`) with the namespaces that live outside
 * `core/`: the model validator (`bpmn/validate.ts`), the scenario lint and the zod texts. The
 * rules for an entry are the ones documented in `src/core/messages/types.ts`.
 *
 * PR-2 (CLI `--lang`, MCP `locale`) adds the `cli` and `mcp` namespaces here.
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

export interface Catalog {
  codes: CodeMessages;
  chrome: CoreChrome;
  constructions: Constructions;
  zod: ZodMessages;
}

/** `'E-CAL-VACIO/sin-intervalos'` -> `'E-CAL-VACIO'`; a key without a variant is its own code. */
export type CodeOf<K> = K extends `${infer C}/${string}` ? C : K;

/** Every `E-*`/`W-*` code the engine can emit. */
export type ProblemCode = CodeOf<keyof CodeMessages>;
