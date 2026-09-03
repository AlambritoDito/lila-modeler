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

export const RunSchema = z.strictObject({
  start: z.string().regex(ISO_WITH_OFFSET, 'run.start debe ser ISO 8601 con offset'),
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

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const CalendarSchema = z.strictObject({
  intervals: z
    .array(
      z
        .strictObject({
          days: z.array(z.enum(WEEKDAYS)).min(1),
          from: z.string().regex(HHMM, 'from debe ser "HH:MM"'),
          to: z.string().regex(HHMM, 'to debe ser "HH:MM"'),
        })
        .refine((i) => i.to > i.from, {
          message: 'R13: se requiere to > from; una ventana nocturna se declara como dos intervalos',
        }),
    )
    .min(1),
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
  | 'E-CAMPO-NO-APLICA'
  | 'E-SIN-PARADA'
  | 'W-ELEMENTO-SIN-PARAMETROS';

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
 * Aplica al escenario **resuelto** las reglas de `docs/SCENARIO_FORMAT.md` § 5 que necesitan el
 * IR o el escenario completo: R3, R4, R5, R6, R9, R12 y R14.
 *
 * Devuelve la lista completa en una pasada; `severity: 'error'` impide simular.
 *
 * ponytail: las reglas puramente numéricas (R10 normalización de probabilidades, R11 aviso de
 * `normal` con P(x<0) > 1 %) se comprueban donde se usan, en el motor, no aquí.
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

    // R9 — toda `ref` debe existir en `resources`; todo `calendar`, en `calendars`.
    for (const [i, use] of (element.resources ?? []).entries()) {
      if (resources[use.ref] === undefined) {
        problems.push({
          code: 'E-REF-DESCONOCIDA',
          path: `elements.${id}.resources[${i}].ref`,
          severity: 'error',
          message: `elements.${id}.resources[${i}].ref: el recurso ${use.ref} no existe en resources.`,
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
