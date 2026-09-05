/**
 * Esquema del escenario v1.
 *
 * Especificación normativa: `docs/SCENARIO_FORMAT.md`. Este archivo la implementa con zod y es
 * la fuente de `docs/scenario.schema.json` (ver `scripts/generate-json-schema.ts`).
 *
 * Vive fuera de `core/` a propósito: `packages/engine/src/core/` no importa nada externo, ni zod.
 *
 * Reglas fijas: todos los tiempos van en segundos salvo `run.start`; el `id` BPMN es la única
 * clave, nunca el nombre.
 */

import { z } from 'zod';

import { checkDistribution } from './core/distributions.js';
import type { ProcessIR } from './core/ir.js';

/* ------------------------------------------------------------------ *
 * § 3 — Distribuciones (14, parámetros nombrados, segundos)
 * ------------------------------------------------------------------ */

const nonNegative = z.number().nonnegative();
const positive = z.number().positive();

/**
 * Las restricciones entre parámetros (`min ≤ mode ≤ max`) van como `refine`: zod las aplica, pero
 * no viajan al JSON Schema generado, que solo sirve al autocompletado del editor.
 */
export const DistributionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('constant'), value: nonNegative }),
  z
    .strictObject({ type: z.literal('uniform'), min: nonNegative, max: nonNegative })
    .refine((d) => d.min <= d.max, { message: 'uniform: se requiere min ≤ max' }),
  z
    .strictObject({
      type: z.literal('triangular'),
      min: nonNegative,
      mode: nonNegative,
      max: nonNegative,
    })
    .refine((d) => d.min <= d.mode && d.mode <= d.max, {
      message: 'triangular: se requiere min ≤ mode ≤ max',
    }),
  z.strictObject({ type: z.literal('exponential'), mean: positive }),
  z.strictObject({ type: z.literal('normal'), mean: z.number(), sd: nonNegative }),
  z
    .strictObject({
      type: z.literal('truncatedNormal'),
      mean: z.number(),
      sd: nonNegative,
      min: z.number(),
      max: z.number(),
    })
    .refine((d) => d.min <= d.max, { message: 'truncatedNormal: se requiere min ≤ max' }),
  z.strictObject({ type: z.literal('lognormal'), mean: positive, sd: nonNegative }),
  z.strictObject({ type: z.literal('gamma'), shape: positive, scale: positive }),
  z.strictObject({ type: z.literal('erlang'), k: z.int().min(1), mean: positive }),
  z.strictObject({ type: z.literal('weibull'), shape: positive, scale: positive }),
  z
    .strictObject({
      type: z.literal('beta'),
      alpha: positive,
      beta: positive,
      min: z.number(),
      max: z.number(),
    })
    .refine((d) => d.min <= d.max, { message: 'beta: se requiere min ≤ max' }),
  z.strictObject({ type: z.literal('poisson'), mean: positive }),
  z.strictObject({ type: z.literal('binomial'), n: z.int().min(1), p: z.number().min(0).max(1) }),
  z.strictObject({
    type: z.literal('user'),
    points: z
      .array(z.strictObject({ value: z.number(), probability: nonNegative }))
      .min(1),
  }),
]);

export type Distribution = z.output<typeof DistributionSchema>;

/* ------------------------------------------------------------------ *
 * § 2.2 — run
 * ------------------------------------------------------------------ */

/** ISO 8601 con offset explícito (R8). `Z` cuenta como offset. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** Solo para extraer año/mes/día de un `start` que ya pasó `ISO_WITH_OFFSET`. */
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})T/;

/**
 * `run.start` con fecha civil inexistente (`2026-02-31`, `2026-13-01`) pasaba el regex de arriba
 * y `new Date()` la normalizaba en silencio (hallazgo de QA de LILA-037/LILA-040). Aritmética
 * civil pura, sin `Date` (R-DET-5): meses de 1 a 12 y bisiesto = múltiplo de 4, salvo de 100
 * que no sea también de 400.
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day >= 1 && day <= maxDay;
}

export const RunSchema = z.strictObject({
  start: z
    .string()
    .regex(ISO_WITH_OFFSET, 'run.start debe ser ISO 8601 con offset')
    .superRefine((value, ctx) => {
      const match = ISO_DATE_PREFIX.exec(value);
      if (match === null) return; // ya lo rechazó el regex de arriba
      const [, year, month, day] = match;
      if (!isValidCivilDate(Number(year), Number(month), Number(day))) {
        ctx.addIssue({
          code: 'custom',
          message: `run.start: ${value} no es una fecha válida; ${month}-${day} no existe en el calendario civil.`,
        });
      }
    }),
  duration: positive.optional(),
  warmup: nonNegative.default(0),
  replications: z.int().min(1).default(1),
  seed: z.int().default(1),
  baseTimeUnit: z.enum(['s', 'min', 'h', 'day']).default('s'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'run.currency debe ser un código ISO 4217').optional(),
  // § 4 — reservado: aceptado por el esquema, rechazado por el motor.
  timezone: z.unknown().optional(),
});

/* ------------------------------------------------------------------ *
 * § 2.3 — calendars
 * ------------------------------------------------------------------ */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/**
 * `to` admite además `"24:00"`, la medianoche del día siguiente (LILA-041). Sin ella el formato
 * no sabe decir "hasta el final del día": `to` es exclusivo y el tope de `HHMM` es `23:59`, así
 * que un 24×7 escrito a mano o una ventana nocturna perdían 60 s cada noche en silencio. El
 * orden lexicográfico sigue valiendo para `to > from` y `compileCalendar` lo mapea a 86400.
 */
const HHMM_TO = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const CalendarSchema = z.strictObject({
  intervals: z
    .array(
      z
        .strictObject({
          days: z.array(z.enum(WEEKDAYS)).min(1),
          from: z.string().regex(HHMM, 'from debe ser "HH:MM"'),
          to: z.string().regex(HHMM_TO, 'to debe ser "HH:MM" (se admite "24:00")'),
        })
        .refine((i) => i.to > i.from, {
          message: 'R13: se requiere to > from; una ventana nocturna se declara como dos intervalos',
        }),
    )
    // R-CAL-2: sin intervalos el calendario nunca abriría (E-CAL-VACIO, § 17 de SEMANTICS.md).
    .min(1, 'E-CAL-VACIO: el calendario no tiene intervalos abiertos.'),
  // § 4 — reservados.
  holidays: z.unknown().optional(),
  timezone: z.unknown().optional(),
});

/* ------------------------------------------------------------------ *
 * § 2.4 — resources
 * ------------------------------------------------------------------ */

export const ResourceSchema = z.strictObject({
  name: z.string().optional(),
  type: z.enum(['role', 'equipment']).default('role'),
  capacity: z.int().min(1),
  costPerHour: nonNegative.default(0),
  fixedCost: nonNegative.default(0),
  calendar: z.string().optional(),
  // § 4 — reservados. `docs/SEMANTICS.md` R-RES-2 usa `resources.cajero.preempt` como ejemplo.
  priority: z.unknown().optional(),
  preempt: z.unknown().optional(),
});

/* ------------------------------------------------------------------ *
 * § 2.5 — elements
 * ------------------------------------------------------------------ */

export const ElementSchema = z.strictObject({
  processingTime: DistributionSchema.optional(),
  resources: z
    .array(z.strictObject({ ref: z.string(), quantity: z.int().min(1).default(1) }))
    .optional(),
  // Sin `.default('and')`: hay que distinguir "no declarado" de "declarado" para la regla R14.
  selection: z.enum(['and', 'or']).optional(),
  fixedCost: nonNegative.optional(),
  interTriggerTimer: DistributionSchema.optional(),
  triggerCount: z.int().min(1).optional(),
  calendar: z.string().optional(),
  probability: z.number().min(0).max(1).optional(),
  // § 4 — reservados.
  priority: z.unknown().optional(),
  preempt: z.unknown().optional(),
  batch: z.unknown().optional(),
  conditions: z.unknown().optional(),
});

export type ElementSpec = z.output<typeof ElementSchema>;

/* ------------------------------------------------------------------ *
 * § 2.1 — raíz
 * ------------------------------------------------------------------ */

export const ScenarioSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  // `model` y `run` son obligatorios en el escenario *resuelto* (§ 2.1 nota ¹), no en un delta.
  model: z.string().optional(),
  extends: z.string().optional(),
  run: RunSchema.optional(),
  calendars: z.record(z.string(), CalendarSchema).optional(),
  resources: z.record(z.string(), ResourceSchema).optional(),
  elements: z.record(z.string(), ElementSchema).optional(),
});

export type Scenario = z.output<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;

/** Escenario ya resuelto (`extends` aplicado): `model` y `run` dejan de ser opcionales. */
export type ResolvedScenario = Scenario & {
  model: string;
  run: NonNullable<Scenario['run']>;
};

/* ------------------------------------------------------------------ *
 * § 5 — Validación semántica contra el IR
 * ------------------------------------------------------------------ */

export type ScenarioProblemCode =
  | 'E-RESERVADO'
  | 'E-ELEMENTO-DESCONOCIDO'
  | 'E-REF-DESCONOCIDA'
  | 'E-REC-DESCONOCIDO'
  | 'E-REC-DUPLICADO'
  | 'E-REC-CANTIDAD'
  | 'E-CAMPO-NO-APLICA'
  | 'E-SIN-PARADA'
  | 'E-XOR-SUMA-CERO'
  | 'W-ELEMENTO-SIN-PARAMETROS'
  | 'W-XOR-NORMALIZADA'
  | 'W-XOR-RESIDUO-COMPARTIDO'
  | 'W-NORMAL-NEGATIVA'
  | 'W-USER-NORMALIZADA';

export interface ScenarioProblem {
  code: ScenarioProblemCode;
  /** Ruta JSON del campo desde la raíz del escenario resuelto (R-RES-2). */
  path: string;
  severity: 'error' | 'warning';
  message: string;
}

/** § 4 — campos reservados por sección del escenario. */
const RESERVED = {
  run: ['timezone'],
  calendars: ['holidays', 'timezone'],
  resources: ['priority', 'preempt'],
  elements: ['priority', 'preempt', 'batch', 'conditions'],
} as const;

/** R-RES-3: un reservado borrado por `extends` (valor `null`) no dispara el error. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function reserved(
  problems: ScenarioProblem[],
  path: string,
  holder: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (isPresent(holder[key])) {
      problems.push({
        code: 'E-RESERVADO',
        path: `${path}.${key}`,
        severity: 'error',
        message: `${path}.${key}: campo reservado, no soportado por el simulador en v1.`,
      });
    }
  }
}

/** Tipos de nodo que admiten `interTriggerTimer` / `triggerCount` (R5). */
const GENERATORS = new Set(['start', 'timer']);

/**
 * R10 — probabilidades de un XOR divergente (§ 6 de `docs/SEMANTICS.md`, R-XOR-1…5). Duplica a
 * propósito el cálculo de `core/sim.ts::xorWeights`: `core/` no se toca y esta versión corre
 * **sin simular**, así un gateway que ningún token visita también queda linteado.
 */
function checkXorGateway(
  problems: ScenarioProblem[],
  gatewayId: string,
  outs: readonly string[],
  elements: Record<string, ElementSpec>,
): void {
  if (outs.length === 0) return; // sin salidas: lo caza el validador del IR (E-GATEWAY-SIN-ARISTAS).
  const declared = outs.map((flowId) => elements[flowId]?.probability);
  const missingIds = outs.filter((_, i) => declared[i] === undefined);
  const declaredSum = declared.reduce<number>((acc, p) => acc + (p ?? 0), 0);
  const share =
    missingIds.length === outs.length ? 1 / outs.length : Math.max(0, 1 - declaredSum) / missingIds.length;

  // R-XOR-3: dos o más flujos sin probability se reparten el residuo por igual, con aviso.
  if (missingIds.length >= 2 && missingIds.length < outs.length) {
    problems.push({
      code: 'W-XOR-RESIDUO-COMPARTIDO',
      path: `elements.${gatewayId}`,
      severity: 'warning',
      message: `elements.${gatewayId}: el residuo se reparte entre ${missingIds.join(', ')}.`,
    });
  }

  const total = declared.reduce<number>((acc, p) => acc + (p ?? share), 0);
  if (total === 0) {
    // R-XOR-5: suma cero, ninguna ruta posible.
    problems.push({
      code: 'E-XOR-SUMA-CERO',
      path: `elements.${gatewayId}`,
      severity: 'error',
      message: `elements.${gatewayId}: las probabilidades del XOR suman 0; no hay ruta posible.`,
    });
  } else if (Math.abs(total - 1) > 1e-9) {
    // R-XOR-4: no suman 1, se normalizan con aviso.
    problems.push({
      code: 'W-XOR-NORMALIZADA',
      path: `elements.${gatewayId}`,
      severity: 'warning',
      message: `elements.${gatewayId}: las probabilidades sumaban ${total}; se normalizan.`,
    });
  }
}

/**
 * R11 — avisos de una distribución (`core/distributions.ts::checkDistribution`, § 16 R-DET-7):
 * `normal` con `P(x < 0) > 1 %` y `user` cuyas probabilidades no suman 1. Se reutiliza la función
 * de `core/` tal cual para no duplicar la matemática (erf); aquí solo se le añade el id.
 */
function checkElementDistributions(
  problems: ScenarioProblem[],
  id: string,
  element: ElementSpec,
): void {
  for (const field of ['processingTime', 'interTriggerTimer'] as const) {
    const dist = element[field];
    if (dist === undefined) continue;
    for (const warning of checkDistribution(dist)) {
      problems.push({
        code: warning.code,
        path: `elements.${id}.${field}`,
        severity: 'warning',
        message: `elements.${id}.${field}: ${warning.message}`,
      });
    }
  }
}

/**
 * Aplica al escenario **resuelto** las reglas de `docs/SCENARIO_FORMAT.md` § 5 que necesitan el
 * IR o el escenario completo: R3, R4, R5, R6, R9, R10, R11, R12 y R14.
 *
 * Devuelve la lista completa en una pasada; `severity: 'error'` impide simular.
 */
export function validateScenario(scenario: Scenario, ir: ProcessIR): ScenarioProblem[] {
  const problems: ScenarioProblem[] = [];
  const calendars = scenario.calendars ?? {};
  const resources = scenario.resources ?? {};
  const elements = scenario.elements ?? {};

  if (scenario.run) reserved(problems, 'run', scenario.run, RESERVED.run);
  for (const [key, calendar] of Object.entries(calendars)) {
    reserved(problems, `calendars.${key}`, calendar, RESERVED.calendars);
  }
  for (const [key, resource] of Object.entries(resources)) {
    reserved(problems, `resources.${key}`, resource, RESERVED.resources);
    if (resource.calendar !== undefined && calendars[resource.calendar] === undefined) {
      problems.push({
        code: 'E-REF-DESCONOCIDA',
        path: `resources.${key}.calendar`,
        severity: 'error',
        message: `resources.${key}.calendar: el calendario ${resource.calendar} no existe en calendars.`,
      });
    }
  }

  let triggerCounts = 0;

  for (const [id, element] of Object.entries(elements)) {
    reserved(problems, `elements.${id}`, element, RESERVED.elements);

    const node = ir.nodes[id];
    const flow = ir.flows[id];

    // R3 — la clave debe existir en el IR; el error cita el id.
    if (node === undefined && flow === undefined) {
      problems.push({
        code: 'E-ELEMENTO-DESCONOCIDO',
        path: `elements.${id}`,
        severity: 'error',
        message: `elements.${id}: el id ${id} no existe en el modelo.`,
      });
      continue;
    }

    checkElementDistributions(problems, id, element);

    // R4 — `probability` solo en sequence flows.
    if (element.probability !== undefined && flow === undefined) {
      problems.push({
        code: 'E-CAMPO-NO-APLICA',
        path: `elements.${id}.probability`,
        severity: 'error',
        message: `elements.${id}.probability: solo se admite en un sequence flow.`,
      });
    }

    // R5 — llegadas solo en starts y timers generadores.
    for (const field of ['interTriggerTimer', 'triggerCount'] as const) {
      if (element[field] !== undefined && (node === undefined || !GENERATORS.has(node.type))) {
        problems.push({
          code: 'E-CAMPO-NO-APLICA',
          path: `elements.${id}.${field}`,
          severity: 'error',
          message: `elements.${id}.${field}: solo se admite en un evento de inicio o un timer generador.`,
        });
      }
    }

    if (element.triggerCount !== undefined) triggerCounts += 1;

    // R-REC-2/9/10 — recursos solo en tareas; referencia, cantidad y duplicados se rechazan
    // antes de entrar al scheduler para que una solicitud imposible nunca quede en cola.
    if ((element.resources?.length ?? 0) > 0 && node?.type !== 'task') {
      problems.push({
        code: 'E-CAMPO-NO-APLICA',
        path: `elements.${id}.resources`,
        severity: 'error',
        message: `elements.${id}.resources: solo una tarea puede consumir recursos.`,
      });
    }
    const seenResources = new Set<string>();
    for (const [i, use] of (element.resources ?? []).entries()) {
      if (resources[use.ref] === undefined) {
        problems.push({
          code: 'E-REC-DESCONOCIDO',
          path: `elements.${id}.resources[${i}].ref`,
          severity: 'error',
          message: `elements.${id}.resources[${i}].ref: el recurso ${use.ref} no existe en resources.`,
        });
      }
      if (seenResources.has(use.ref)) {
        problems.push({
          code: 'E-REC-DUPLICADO',
          path: `elements.${id}.resources[${i}].ref`,
          severity: 'error',
          message: `elements.${id}.resources[${i}].ref: ${use.ref} aparece más de una vez; usa quantity.`,
        });
      }
      seenResources.add(use.ref);
      const capacity = resources[use.ref]?.capacity;
      if (capacity !== undefined && use.quantity > capacity) {
        problems.push({
          code: 'E-REC-CANTIDAD',
          path: `elements.${id}.resources[${i}].quantity`,
          severity: 'error',
          message: `elements.${id}.resources[${i}].quantity: ${use.quantity} excede capacity ${capacity} de ${use.ref}.`,
        });
      }
    }
    if (element.calendar !== undefined && calendars[element.calendar] === undefined) {
      problems.push({
        code: 'E-REF-DESCONOCIDA',
        path: `elements.${id}.calendar`,
        severity: 'error',
        message: `elements.${id}.calendar: el calendario ${element.calendar} no existe en calendars.`,
      });
    }

    // R14 — `selection` sin `resources` es error.
    if (element.selection !== undefined && element.resources === undefined) {
      problems.push({
        code: 'E-CAMPO-NO-APLICA',
        path: `elements.${id}.selection`,
        severity: 'error',
        message: `elements.${id}.selection: solo tiene sentido con resources.`,
      });
    }
  }

  // R10 — probabilidades de cada XOR divergente del IR (independiente de si algún caso lo visita).
  for (const [gatewayId, node] of Object.entries(ir.nodes)) {
    if (node.type === 'xor') checkXorGateway(problems, gatewayId, node.outgoing, elements);
  }

  // R6 — al menos uno de `run.duration` o un `triggerCount`.
  if (scenario.run?.duration === undefined && triggerCounts === 0) {
    problems.push({
      code: 'E-SIN-PARADA',
      path: 'run.duration',
      severity: 'error',
      message: 'run.duration: falta una condición de parada; declara run.duration o un triggerCount.',
    });
  }

  // R3 — un elemento del modelo sin parámetros es warning, no error.
  for (const id of Object.keys(ir.nodes)) {
    if (elements[id] === undefined) {
      problems.push({
        code: 'W-ELEMENTO-SIN-PARAMETROS',
        path: `elements.${id}`,
        severity: 'warning',
        message: `elements.${id}: el elemento existe en el modelo y no tiene parámetros; toma sus defaults.`,
      });
    }
  }

  return problems;
}

/** Errores de `validateScenario` (los que impiden simular). */
export function scenarioErrors(problems: ScenarioProblem[]): ScenarioProblem[] {
  return problems.filter((p) => p.severity === 'error');
}

/* ------------------------------------------------------------------ *
 * JSON Schema (solo para editores; lo normativo es este archivo)
 * ------------------------------------------------------------------ */

/**
 * JSON Schema del escenario, derivado del esquema zod. Lo escribe a `docs/scenario.schema.json`
 * el script `packages/engine/scripts/generate-json-schema.ts`; un test comprueba que el archivo
 * del repo coincide con lo que genera esta función.
 *
 * `io: 'input'` para que los campos con default salgan como opcionales, que es lo que escribe una
 * persona. Las restricciones entre parámetros (`min ≤ max`) no son representables y no viajan.
 */
export function toJsonSchema(): Record<string, unknown> {
  return {
    $id: 'https://lila-modeler.org/schema/scenario/1.json',
    title: 'Lila Modeler — escenario v1',
    ...z.toJSONSchema(ScenarioSchema, { io: 'input', unrepresentable: 'any' }),
  };
}

/* ------------------------------------------------------------------ *
 * § 6 — extends
 * ------------------------------------------------------------------ */

/**
 * Lee un escenario ya parseado a JSON desde una ruta. Se inyecta para que `scenario.ts` no toque
 * disco: la CLI pasa `readFileSync` + `JSON.parse`, la web pasa su sistema de archivos virtual.
 */
export type ScenarioReader = (path: string) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normaliza una ruta con `/`, resolviendo `.` y `..`.
 *
 * ponytail: solo separador `/`, sin unidades de Windows ni URLs. Es lo que hay en un repo y en el
 * FS virtual de la web; si algún día entra una ruta `C:\…`, se cambia por `node:path` en el borde
 * que la produce, no aquí.
 */
function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

/** Resuelve `ref` **relativa al archivo** `base`, no al directorio de trabajo (§ 6). */
export function resolveScenarioPath(base: string, ref: string): string {
  if (ref.startsWith('/')) return normalizePath(ref);
  const slash = base.lastIndexOf('/');
  const dir = slash === -1 ? '' : base.slice(0, slash);
  return normalizePath(dir === '' ? ref : `${dir}/${ref}`);
}

/**
 * Merge profundo del hijo sobre el padre.
 *
 * - Objeto sobre objeto: se fusiona clave a clave.
 * - `null`: **borra** la clave del resultado.
 * - Cualquier otra cosa, arrays incluidos, **reemplaza entera** (§ 6: es la única semántica
 *   predecible para una lista sin claves).
 */
function deepMerge(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parent };
  for (const [key, value] of Object.entries(child)) {
    const previous = out[key];
    if (value === null) delete out[key];
    else if (isPlainObject(previous) && isPlainObject(value)) out[key] = deepMerge(previous, value);
    else out[key] = value;
  }
  return out;
}

/**
 * Resuelve la cadena de `extends` de un escenario y devuelve el objeto fusionado, **sin validar**:
 * las reglas de `docs/SCENARIO_FORMAT.md` § 5 se aplican al escenario resuelto, no a cada archivo.
 *
 * - Cadenas permitidas: se resuelve de la raíz hacia abajo.
 * - Rutas relativas al archivo del hijo; `model` se reescribe relativo al archivo que lo declara,
 *   para que un `model` heredado de otro directorio siga apuntando al mismo `.bpmn`.
 * - Ciclos rechazados con error que cita los archivos implicados.
 * - El `extends` desaparece del resultado: ya está aplicado.
 */
export function resolveExtends(path: string, read: ScenarioReader): Record<string, unknown> {
  const chain: Array<{ path: string; scenario: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  let current = normalizePath(path);

  for (;;) {
    if (seen.has(current)) {
      const cycle = [...chain.map((link) => link.path), current].join(' -> ');
      throw new Error(`extends: ciclo en la cadena de herencia: ${cycle}`);
    }
    seen.add(current);

    const raw = read(current);
    if (!isPlainObject(raw)) throw new Error(`${current}: el escenario debe ser un objeto JSON.`);

    chain.push({ path: current, scenario: raw });

    const parent = raw['extends'];
    if (parent === undefined || parent === null) break;
    if (typeof parent !== 'string') {
      throw new Error(`${current}: extends debe ser una ruta a otro escenario.`);
    }
    current = resolveScenarioPath(current, parent);
  }

  let resolved: Record<string, unknown> = {};
  // De la raíz hacia abajo: el último de la cadena es el ancestro más lejano.
  for (const link of [...chain].reverse()) {
    const { extends: _ignored, ...own } = link.scenario;
    if (typeof own['model'] === 'string') {
      own['model'] = resolveScenarioPath(link.path, own['model']);
    }
    resolved = deepMerge(resolved, own);
  }
  return resolved;
}
