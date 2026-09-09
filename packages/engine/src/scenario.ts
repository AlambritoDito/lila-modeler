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
import { poolCapacityBound } from './core/sim.js';
import type { ProcessIR } from './core/ir.js';
import { coded, messages, type Catalog, type Locale, type ZodMessages } from './messages/index.js';

/* ------------------------------------------------------------------ *
 * Mensajes del esquema (LILA-202, traducidos en LILA-211)
 * ------------------------------------------------------------------ */

/** `"texto"` entre comillas, el resto tal cual: los `values` de un enum son primitivos. */
function literal(valor: unknown): string {
  return typeof valor === 'string' ? `"${valor}"` : String(valor);
}

/** Tipo del valor recibido, con los mismos nombres que usa `zod.typeName`. */
function receivedType(zod: ZodMessages, valor: unknown): string {
  if (valor === null) return zod.typeName('null');
  return zod.typeName(Array.isArray(valor) ? 'array' : typeof valor);
}

/**
 * Los defectos del esquema en el idioma pedido, **sin la ruta**: la pone quien formatea (la CLI,
 * el MCP y el panel imprimen `${ruta}: ${mensaje}`), así los tres dicen lo mismo —
 * `run.warmup: must be ≥ 0`— sin repetir el catálogo.
 *
 * Zod solo consulta este mapa cuando el defecto **no** trae mensaje propio, así que los `refine`,
 * `regex` y `min` con texto del esquema siguen mandando (R11, R13, R8…).
 *
 * ponytail: solo se traducen los seis códigos que produce hoy `ScenarioSchema`; el resto cae en la
 * locale de zod, así nada sale en otro idioma aunque el esquema crezca. Si algún código de la
 * locale acaba sonando raro en un escenario, se le añade su `case` aquí.
 */
export function zodErrorMap(locale: Locale = 'en'): z.core.$ZodErrorMap {
  const zod = messages(locale).zod;
  /** Los textos que zod trae de fábrica para lo que no traduce este archivo. */
  const fallback = locale === 'es' ? z.locales.es().localeError : z.locales.en().localeError;

  return (issue) => {
    switch (issue.code) {
      case 'invalid_type': {
        const esperado = zod.typeName(issue.expected);
        // `input: undefined` es una clave que falta, no un valor de otro tipo.
        return issue.input === undefined
          ? zod.required(esperado)
          : zod.wrongType(esperado, receivedType(zod, issue.input));
      }
      case 'too_big':
        return issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint'
          ? zod.tooBigNumber(issue.inclusive === false ? '<' : '≤', String(issue.maximum))
          : zod.tooBigSize(String(issue.maximum), zod.units(issue.origin, issue.maximum));
      case 'too_small':
        return issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint'
          ? zod.tooSmallNumber(issue.inclusive === false ? '>' : '≥', String(issue.minimum))
          : zod.tooSmallSize(String(issue.minimum), zod.units(issue.origin, issue.minimum));
      case 'invalid_value':
        return issue.values.length === 1
          ? zod.invalidValue(literal(issue.values[0]))
          : zod.invalidValues(issue.values.map(literal).join(', '));
      case 'unrecognized_keys':
        return issue.keys.length === 1
          ? zod.unrecognizedKey(literal(issue.keys[0]))
          : zod.unrecognizedKeys(issue.keys.map(literal).join(', '));
      case 'invalid_union': {
        // Unión discriminada: la ruta ya apunta al discriminante y `options` son sus valores. El
        // tipo crudo del defecto no las declara en todas las variantes, de ahí el aserto.
        const opciones = issue.options as readonly unknown[] | undefined;
        return opciones === undefined
          ? zod.invalidUnion()
          : zod.invalidValues(opciones.map(literal).join(', '));
      }
      default:
        return fallback(issue);
    }
  };
}

/**
 * @deprecated Usa `zodErrorMap('es')`. Se conserva porque es público por `@lila/engine/schema`.
 */
export const erroresEnEspanol: z.core.$ZodErrorMap = zodErrorMap('es');

/* ------------------------------------------------------------------ *
 * Auxiliares del esquema que no dependen del idioma
 * ------------------------------------------------------------------ */

/** ISO 8601 con offset explícito (R8). `Z` cuenta como offset. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** Descompone un `start` que ya pasó `ISO_WITH_OFFSET` en fecha, hora y offset. */
const ISO_PARTS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * `run.start` con fecha u hora civil inexistente (`2026-02-31`, `2026-13-01`, `23:60`, `+24:00`)
 * pasaba el regex de arriba y seguía adelante en silencio (hallazgo de QA de LILA-037/LILA-040 y
 * de LILA-042): `Date.parse` devuelve `NaN` y las tres columnas ISO del `log.csv` salen **vacías**
 * en todas las filas, o peor, `2026-02-31` se normaliza sola a `2026-03-03`.
 *
 * Aritmética civil pura, sin `Date` (R-DET-5): meses de 1 a 12 y bisiesto = múltiplo de 4, salvo
 * de 100 que no sea también de 400. La hora `24:00` se rechaza aunque ISO 8601 la admita como fin
 * de día: es ambigua como instante de arranque y `24:00:01` ya no la entiende nadie; se escribe
 * como las `00:00` del día siguiente (R8 de `docs/SCENARIO_FORMAT.md`).
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

/** Mensaje del primer defecto civil de `start`, o `null` si el instante existe. */
function civilStartError(start: string, zod: ZodMessages): string | null {
  const match = ISO_PARTS.exec(start);
  if (match === null) return null; // ya lo rechazó `ISO_WITH_OFFSET`.
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  if (!isValidCivilDate(Number(year), Number(month), Number(day))) {
    return zod.startInvalidDate(start, `${month}-${day}`);
  }
  if (Number(hour) > 23 || Number(minute) > 59 || (second !== undefined && Number(second) > 59)) {
    const clock = second === undefined ? `${hour}:${minute}` : `${hour}:${minute}:${second}`;
    return zod.startInvalidTime(start, clock);
  }
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    return zod.startInvalidOffset(start, `${offsetHour}:${offsetMinute}`);
  }
  return null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/**
 * `to` admite además `"24:00"`, la medianoche del día siguiente (LILA-041). Sin ella el formato
 * no sabe decir "hasta el final del día": `to` es exclusivo y el tope de `HHMM` es `23:59`, así
 * que un 24×7 escrito a mano o una ventana nocturna perdían 60 s cada noche en silencio. El
 * orden lexicográfico sigue valiendo para `to > from` y `compileCalendar` lo mapea a 86400.
 */
const HHMM_TO = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/* ------------------------------------------------------------------ *
 * El esquema, por idioma (LILA-211)
 * ------------------------------------------------------------------ */

/**
 * Construye el esquema completo con los textos de `locale`. Es una fábrica y no un módulo de
 * constantes porque una decena de `message:` viven **dentro** del esquema (`refine`, `regex`,
 * `min`) y zod no consulta el mapa de errores para ellos: la única forma de traducirlos es
 * construir el esquema con el idioma ya elegido.
 *
 * `scenarioSchema(locale)` memoiza el resultado, así que construir el esquema sigue costando una
 * vez por idioma y no una por llamada.
 */
function buildSchemas(locale: Locale) {
  const zod = messages(locale).zod;

  /* ------------------------------------------------------------------ *
   * § 3 — Distribuciones (14, parámetros nombrados, segundos)
   * ------------------------------------------------------------------ */

  const nonNegative = z.number().nonnegative();
  const positive = z.number().positive();

  /**
   * Las restricciones entre parámetros (`min ≤ mode ≤ max`) van como `refine`: zod las aplica, pero
   * no viajan al JSON Schema generado, que solo sirve al autocompletado del editor.
   */
  const DistributionSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('constant'), value: nonNegative }),
    z
      .strictObject({ type: z.literal('uniform'), min: nonNegative, max: nonNegative })
      .refine((d) => d.min <= d.max, { message: zod.distributionMinMax('uniform') }),
    z
      .strictObject({
        type: z.literal('triangular'),
        min: nonNegative,
        mode: nonNegative,
        max: nonNegative,
      })
      .refine((d) => d.min <= d.mode && d.mode <= d.max, {
        message: zod.distributionMinModeMax('triangular'),
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
      .refine((d) => d.min <= d.max, { message: zod.distributionMinMax('truncatedNormal') }),
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
      .refine((d) => d.min <= d.max, { message: zod.distributionMinMax('beta') }),
    z.strictObject({ type: z.literal('poisson'), mean: positive }),
    z.strictObject({ type: z.literal('binomial'), n: z.int().min(1), p: z.number().min(0).max(1) }),
    z.strictObject({
      type: z.literal('user'),
      points: z
        .array(z.strictObject({ value: z.number(), probability: nonNegative }))
        .min(1),
    }),
  ]);


  /* ------------------------------------------------------------------ *
   * § 2.2 — run
   * ------------------------------------------------------------------ */

  const RunSchema = z.strictObject({
    start: z
      .string()
      .regex(ISO_WITH_OFFSET, zod.startIso())
      .superRefine((value, ctx) => {
        const message = civilStartError(value, zod);
        if (message !== null) ctx.addIssue({ code: 'custom', message });
      }),
    duration: positive.optional(),
    warmup: nonNegative.default(0),
    replications: z.int().min(1).default(1),
    // Sin `.default(1)`: R-DEG-4 pide avisar (`W-SIN-SEED`) cuando el escenario no la declara, y
    // con default el lint no puede distinguir "no declarada" de "declarada en 1" (LILA-198). El
    // valor neutro sigue siendo 1 y lo aplica quien simula (`core/sim.ts`).
    //
    // El `default: 1` sí sigue en el JSON Schema publicado, como **anotación** (que es lo único
    // que significa ahí): el panel de escenario lo lee para saber qué escribir al añadir el campo
    // (`valorVacio` en `ScenarioPanel.tsx`). Sin él escribiría el `minimum` del entero seguro.
    seed: z.int().meta({ default: 1 }).optional(),
    baseTimeUnit: z.enum(['s', 'min', 'h', 'day']).default('s'),
    currency: z.string().regex(/^[A-Z]{3}$/, zod.currencyIso()).optional(),
    // § 4 — reservado: aceptado por el esquema, rechazado por el motor.
    timezone: z.unknown().optional(),
  });

  /* ------------------------------------------------------------------ *
   * § 2.3 — calendars
   * ------------------------------------------------------------------ */

  const CalendarSchema = z.strictObject({
    intervals: z
      .array(
        z
          .strictObject({
            days: z.array(z.enum(WEEKDAYS)).min(1),
            from: z.string().regex(HHMM, zod.intervalFrom()),
            to: z.string().regex(HHMM_TO, zod.intervalTo()),
          })
          .refine((i) => i.to > i.from, {
            message: zod.intervalOrder(),
          }),
      )
      // R-CAL-2: sin intervalos el calendario nunca abriría (E-CAL-VACIO, § 17 de SEMANTICS.md).
      .min(1, coded('E-CAL-VACIO', messages(locale).codes['E-CAL-VACIO/anonimo']())),
    // § 4 — reservados.
    holidays: z.unknown().optional(),
    timezone: z.unknown().optional(),
  });

  /* ------------------------------------------------------------------ *
   * § 2.4 — resources
   * ------------------------------------------------------------------ */

  /**
   * Un tramo de capacidad (§ 2.4, R-CAL-11, LILA-164): `capacity` unidades mientras `calendar` esté
   * abierto. Bizagi lo llama "Resources → Calendars → quantity" (3 enfermeras de día, 1 de noche).
   */
  const CapacityIntervalSchema = z.strictObject({
    calendar: z.string(),
    capacity: z.int().min(1),
  });

  const ResourceSchema = z.strictObject({
    name: z.string().optional(),
    type: z.enum(['role', 'equipment']).default('role'),
    /** Entero ≥ 1, o la lista de tramos por calendario. Excluyente con `calendar` (§ 5, R16). */
    capacity: z.union([z.int().min(1), z.array(CapacityIntervalSchema).min(1)]),
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

  const ElementSchema = z.strictObject({
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
    // Sin `.min(0).max(1)`: el rango lo comprueba `validateScenario` para poder emitir
    // `E-PROB-RANGO` del catálogo (§ 17) con su código y su ruta, en vez del defecto genérico de
    // zod que no lleva código (LILA-198).
    probability: z.number().optional(),
    // § 4 — reservados.
    priority: z.unknown().optional(),
    preempt: z.unknown().optional(),
    batch: z.unknown().optional(),
    conditions: z.unknown().optional(),
  });


  /* ------------------------------------------------------------------ *
   * § 2.1 — raíz
   * ------------------------------------------------------------------ */

  const ScenarioSchema = z.strictObject({
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

  return {
    Distribution: DistributionSchema,
    Run: RunSchema,
    CapacityInterval: CapacityIntervalSchema,
    Calendar: CalendarSchema,
    Resource: ResourceSchema,
    Element: ElementSchema,
    Scenario: ScenarioSchema,
  };
}

const SCHEMAS = new Map<Locale, ReturnType<typeof buildSchemas>>();

function schemas(locale: Locale): ReturnType<typeof buildSchemas> {
  let built = SCHEMAS.get(locale);
  if (built === undefined) {
    built = buildSchemas(locale);
    SCHEMAS.set(locale, built);
  }
  return built;
}

/** El esquema del escenario con los textos de `locale`; memoizado por idioma. */
export function scenarioSchema(locale: Locale = 'en'): ReturnType<typeof buildSchemas>['Scenario'] {
  return schemas(locale).Scenario;
}

// Los esquemas en el idioma por defecto, que es la forma en que los consume el resto del
// repositorio (el panel de escenario, el generador de JSON Schema, las pruebas).
export const DistributionSchema = schemas('en').Distribution;
export const RunSchema = schemas('en').Run;
export const CapacityIntervalSchema = schemas('en').CapacityInterval;
export const CalendarSchema = schemas('en').Calendar;
export const ResourceSchema = schemas('en').Resource;
export const ElementSchema = schemas('en').Element;
export const ScenarioSchema = schemas('en').Scenario;

export type Distribution = z.output<typeof DistributionSchema>;
export type ElementSpec = z.output<typeof ElementSchema>;
export type Scenario = z.output<typeof ScenarioSchema>;

/** Opciones comunes de las funciones públicas que producen texto (LILA-211). */
export interface LocaleOptions {
  /** Idioma de los mensajes; `'en'` por defecto. */
  locale?: Locale | undefined;
}

/**
 * La única puerta de entrada al esquema para quien enseña los defectos a una persona: aplica
 * `zodErrorMap(locale)` **y** construye el esquema en ese idioma. La CLI (`cli-shared.ts`), el
 * MCP (`packages/mcp`) y el panel de escenario la usan, y por eso los tres dicen exactamente lo
 * mismo (LILA-202).
 *
 * Es un `safeParse` con mapa, no un `z.config()` global: `@lila/engine` es una librería y
 * reconfigurar el zod del proceso al importarla cambiaría también los mensajes de esquemas que
 * no son suyos (los `inputSchema` del servidor MCP, por ejemplo).
 */
export function parseScenario(
  raw: unknown,
  options: LocaleOptions = {},
): z.ZodSafeParseResult<Scenario> {
  const locale = options.locale ?? 'en';
  return scenarioSchema(locale).safeParse(raw, { error: zodErrorMap(locale) });
}

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
  | 'E-CAPACIDAD-Y-CALENDARIO'
  | 'E-CAMPO-NO-APLICA'
  | 'E-PROB-EN-NODO'
  | 'E-PROB-RANGO'
  | 'E-SUBPROC-PARAMETRO'
  | 'E-TIMER-RECURSO'
  | 'E-SIN-PARADA'
  | 'E-XOR-SUMA-CERO'
  | 'W-SIN-SEED'
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
  M: Catalog['codes'],
): void {
  for (const key of keys) {
    if (isPresent(holder[key])) {
      problems.push({
        code: 'E-RESERVADO',
        path: `${path}.${key}`,
        severity: 'error',
        message: M['E-RESERVADO'](`${path}.${key}`),
      });
    }
  }
}

/**
 * Tipos de nodo que admiten `interTriggerTimer` / `triggerCount` (R5).
 *
 * Solo `start`. El «timer generador» de R5 es el `bpmn:startEvent` con `timerEventDefinition`,
 * que la § 2 de `docs/SEMANTICS.md` ya mapea a `start`: un `timer` en el IR es siempre el
 * `bpmn:intermediateCatchEvent` de retardo (§ 9), y `core/sim.ts` solo monta generador de
 * llegadas sobre nodos `start` (R-ARR-1, R-PERF-5). Aceptarlo en un `timer` dejaba pasar un
 * campo que no hace nada y, peor, un `triggerCount` ahí satisfacía R6 sin dar ninguna parada
 * real: la corrida no terminaba nunca. (LILA-186 QA.)
 */
const GENERATORS = new Set(['start']);

/**
 * R10 — probabilidades de un XOR divergente (§ 6 de `docs/SEMANTICS.md`, R-XOR-1…5). Duplica a
 * propósito el cálculo de `core/sim.ts::xorWeights`: `core/` no se toca y esta versión corre
 * **sin simular**, así un gateway que ningún token visita también queda linteado.
 *
 * El `message` es **byte a byte** el que emite `core/sim.ts` para el mismo gateway (`Gateway_X: …`,
 * sin el prefijo `elements.` que llevan los demás problemas de este archivo). No es cosmético: la
 * CLI mezcla los avisos del lint y los del motor en un `Set<string>` de `${code}: ${message}`
 * (`cli.ts::resultWithBoundaryWarnings`), así que un texto distinto salía **dos veces** en consola
 * y en `RunResult.warnings[]`. El `path` sí conserva `elements.${gatewayId}` para el panel y el
 * JSON. Desde LILA-211 los dos salen de la **misma** entrada del catálogo, así que ya no pueden
 * separarse por descuido.
 *
 * `E-XOR-SUMA-CERO` no entra en el trato: es error, aborta antes de simular y el motor nunca lo
 * emite, así que conserva el prefijo `elements.` de los demás errores de este archivo.
 */
function checkXorGateway(
  problems: ScenarioProblem[],
  gatewayId: string,
  outs: readonly string[],
  elements: Record<string, ElementSpec>,
  M: Catalog['codes'],
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
      message: M['W-XOR-RESIDUO-COMPARTIDO'](gatewayId, missingIds.join(', ')),
    });
  }

  const total = declared.reduce<number>((acc, p) => acc + (p ?? share), 0);
  if (total === 0) {
    // R-XOR-5: suma cero, ninguna ruta posible.
    problems.push({
      code: 'E-XOR-SUMA-CERO',
      path: `elements.${gatewayId}`,
      severity: 'error',
      message: M['E-XOR-SUMA-CERO'](`elements.${gatewayId}`),
    });
  } else if (Math.abs(total - 1) > 1e-9) {
    // R-XOR-4: no suman 1, se normalizan con aviso.
    problems.push({
      code: 'W-XOR-NORMALIZADA',
      path: `elements.${gatewayId}`,
      severity: 'warning',
      message: M['W-XOR-NORMALIZADA'](gatewayId, total),
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
  locale: Locale,
): void {
  for (const field of ['processingTime', 'interTriggerTimer'] as const) {
    const dist = element[field];
    if (dist === undefined) continue;
    for (const warning of checkDistribution(dist, locale)) {
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
export function validateScenario(
  scenario: Scenario,
  ir: ProcessIR,
  options: LocaleOptions = {},
): ScenarioProblem[] {
  const locale = options.locale ?? 'en';
  const M = messages(locale).codes;
  const problems: ScenarioProblem[] = [];
  const calendars = scenario.calendars ?? {};
  const resources = scenario.resources ?? {};
  const elements = scenario.elements ?? {};

  if (scenario.run) reserved(problems, 'run', scenario.run, RESERVED.run, M);
  for (const [key, calendar] of Object.entries(calendars)) {
    reserved(problems, `calendars.${key}`, calendar, RESERVED.calendars, M);
  }
  for (const [key, resource] of Object.entries(resources)) {
    reserved(problems, `resources.${key}`, resource, RESERVED.resources, M);
    if (resource.calendar !== undefined && calendars[resource.calendar] === undefined) {
      problems.push({
        code: 'E-REF-DESCONOCIDA',
        path: `resources.${key}.calendar`,
        severity: 'error',
        message: M['E-REF-DESCONOCIDA'](`resources.${key}.calendar`, resource.calendar),
      });
    }
    // R16 — `capacity` por intervalos y `calendar` del pool son excluyentes (R-CAL-11): el
    // calendario ya va en cada tramo y declarar los dos deja sin definir cuál manda.
    if (typeof resource.capacity !== 'number' && resource.calendar !== undefined) {
      problems.push({
        code: 'E-CAPACIDAD-Y-CALENDARIO',
        path: `resources.${key}.capacity`,
        severity: 'error',
        message: M['E-CAPACIDAD-Y-CALENDARIO'](`resources.${key}.capacity`),
      });
    }
    // R9 — el calendario de cada tramo también tiene que existir.
    if (typeof resource.capacity !== 'number') {
      for (const [i, slice] of resource.capacity.entries()) {
        if (calendars[slice.calendar] === undefined) {
          problems.push({
            code: 'E-REF-DESCONOCIDA',
            path: `resources.${key}.capacity[${i}].calendar`,
            severity: 'error',
            message: M['E-REF-DESCONOCIDA'](
              `resources.${key}.capacity[${i}].calendar`,
              slice.calendar,
            ),
          });
        }
      }
    }
  }

  let triggerCounts = 0;
  // R-PLAN-1: el `bpmn:subProcess` embebido desaparece del IR al aplanar, pero sus nodos
  // conservan de quién venían. Sin este conjunto, `elements[subProcessId]` sería un id
  // desconocido y no `E-SUBPROC-PARAMETRO` (R-PLAN-3, § 17).
  //
  // ponytail: `subprocessId` guarda solo el subproceso inmediato (`bpmn/parse.ts`, `walk`), así
  // que con anidamiento se reconoce el más interno y no la cadena. Techo declarado en R-PLAN-3;
  // subirlo pide llevar los ids de todas las cajas al IR, que no es de este ticket.
  const subprocessIds = new Set(
    Object.values(ir.nodes)
      .map((node) => node.subprocessId)
      .filter((subprocessId): subprocessId is string => subprocessId !== undefined),
  );

  for (const [id, element] of Object.entries(elements)) {
    reserved(problems, `elements.${id}`, element, RESERVED.elements, M);

    const node = ir.nodes[id];
    const flow = ir.flows[id];

    // R3 — la clave debe existir en el IR; el error cita el id.
    if (node === undefined && flow === undefined) {
      // R-PLAN-3 — el subproceso embebido sí es un id del modelo, solo que aplanado: darle tiempo,
      // recursos o costo propios es `E-SUBPROC-PARAMETRO`, no un id desconocido.
      const subprocessFields = subprocessIds.has(id)
        ? (['processingTime', 'resources', 'fixedCost'] as const).filter((field) => element[field] !== undefined)
        : [];
      for (const field of subprocessFields) {
        problems.push({
          code: 'E-SUBPROC-PARAMETRO',
          path: `elements.${id}.${field}`,
          severity: 'error',
          message: M['E-SUBPROC-PARAMETRO'](`elements.${id}.${field}`, id),
        });
      }
      if (subprocessFields.length === 0) {
        problems.push({
          code: 'E-ELEMENTO-DESCONOCIDO',
          path: `elements.${id}`,
          severity: 'error',
          message: M['E-ELEMENTO-DESCONOCIDO'](`elements.${id}`, id),
        });
      }
      continue;
    }

    checkElementDistributions(problems, id, element, locale);

    // R4 / R-XOR-8 — `probability` solo en sequence flows.
    if (element.probability !== undefined && flow === undefined) {
      problems.push({
        code: 'E-PROB-EN-NODO',
        path: `elements.${id}.probability`,
        severity: 'error',
        message: M['E-PROB-EN-NODO'](`elements.${id}.probability`),
      });
    }
    // R-XOR-6 — rango de `probability`. Lo comprueba el lint, no el esquema: así el defecto
    // llega con su código del catálogo y su ruta (§ 17, LILA-198).
    if (element.probability !== undefined && (element.probability < 0 || element.probability > 1)) {
      problems.push({
        code: 'E-PROB-RANGO',
        path: `elements.${id}.probability`,
        severity: 'error',
        message: M['E-PROB-RANGO'](`elements.${id}.probability`, element.probability),
      });
    }

    // R5 — llegadas solo en starts (el start con timer ya es `start` en el IR).
    for (const field of ['interTriggerTimer', 'triggerCount'] as const) {
      if (element[field] !== undefined && (node === undefined || !GENERATORS.has(node.type))) {
        problems.push({
          code: 'E-CAMPO-NO-APLICA',
          path: `elements.${id}.${field}`,
          severity: 'error',
          message: M['E-CAMPO-NO-APLICA/solo-inicio'](`elements.${id}.${field}`),
        });
      }
    }

    // R6: solo cuenta como parada el `triggerCount` de un elemento que de verdad genera; en
    // cualquier otro nodo es `E-CAMPO-NO-APLICA` y la corrida seguiría sin condición de parada.
    if (element.triggerCount !== undefined && node !== undefined && GENERATORS.has(node.type)) triggerCounts += 1;

    // R-REC-2/9/10 — recursos solo en tareas; referencia, cantidad y duplicados se rechazan
    // antes de entrar al scheduler para que una solicitud imposible nunca quede en cola.
    if ((element.resources?.length ?? 0) > 0 && node?.type !== 'task') {
      // R-EVT-1: el timer es un retardo, nunca ocupa a nadie; tiene código propio en § 17.
      const enTimer = node?.type === 'timer';
      problems.push({
        code: enTimer ? 'E-TIMER-RECURSO' : 'E-CAMPO-NO-APLICA',
        path: `elements.${id}.resources`,
        severity: 'error',
        message: enTimer
          ? M['E-TIMER-RECURSO'](`elements.${id}.resources`)
          : M['E-CAMPO-NO-APLICA/solo-tarea'](`elements.${id}.resources`),
      });
    }
    const seenResources = new Set<string>();
    for (const [i, use] of (element.resources ?? []).entries()) {
      if (resources[use.ref] === undefined) {
        problems.push({
          code: 'E-REC-DESCONOCIDO',
          path: `elements.${id}.resources[${i}].ref`,
          severity: 'error',
          message: M['E-REC-DESCONOCIDO/recurso'](`elements.${id}.resources[${i}].ref`, use.ref),
        });
      }
      if (seenResources.has(use.ref)) {
        problems.push({
          code: 'E-REC-DUPLICADO',
          path: `elements.${id}.resources[${i}].ref`,
          severity: 'error',
          message: M['E-REC-DUPLICADO/ref'](`elements.${id}.resources[${i}].ref`, use.ref),
        });
      }
      seenResources.add(use.ref);
      // R-CAL-11: con capacidad por intervalos el tope es el máximo de la semana; una `quantity`
      // mayor no cabe en ningún turno y la tarea esperaría para siempre.
      const pool = resources[use.ref];
      const capacity = pool === undefined ? undefined : poolCapacityBound(pool, calendars);
      if (capacity !== undefined && use.quantity > capacity) {
        problems.push({
          code: 'E-REC-CANTIDAD',
          path: `elements.${id}.resources[${i}].quantity`,
          severity: 'error',
          message: M['E-REC-CANTIDAD/excede-ruta'](
            `elements.${id}.resources[${i}].quantity`,
            use.quantity,
            capacity,
            use.ref,
          ),
        });
      }
    }
    if (element.calendar !== undefined && calendars[element.calendar] === undefined) {
      problems.push({
        code: 'E-REF-DESCONOCIDA',
        path: `elements.${id}.calendar`,
        severity: 'error',
        message: M['E-REF-DESCONOCIDA'](`elements.${id}.calendar`, element.calendar),
      });
    }

    // R14 — `selection` sin `resources` es error.
    if (element.selection !== undefined && element.resources === undefined) {
      problems.push({
        code: 'E-CAMPO-NO-APLICA',
        path: `elements.${id}.selection`,
        severity: 'error',
        message: M['E-CAMPO-NO-APLICA/selection'](`elements.${id}.selection`),
      });
    }
  }

  // R10 — probabilidades de cada XOR divergente del IR (independiente de si algún caso lo visita).
  for (const [gatewayId, node] of Object.entries(ir.nodes)) {
    if (node.type === 'xor') checkXorGateway(problems, gatewayId, node.outgoing, elements, M);
  }

  // R6 — al menos uno de `run.duration` o un `triggerCount`.
  if (scenario.run?.duration === undefined && triggerCounts === 0) {
    problems.push({
      code: 'E-SIN-PARADA',
      path: 'run.duration',
      severity: 'error',
      message: M['E-SIN-PARADA']('run.duration'),
    });
  }

  // R-DEG-4 — sin `seed` la corrida usa 1: sigue siendo determinista, pero el escenario no dice
  // con qué semilla se reproduce.
  if (scenario.run !== undefined && scenario.run.seed === undefined) {
    problems.push({
      code: 'W-SIN-SEED',
      path: 'run.seed',
      severity: 'warning',
      message: M['W-SIN-SEED']('run.seed'),
    });
  }

  // R3 — un elemento del modelo sin parámetros es warning, no error.
  for (const id of Object.keys(ir.nodes)) {
    if (elements[id] === undefined) {
      problems.push({
        code: 'W-ELEMENTO-SIN-PARAMETROS',
        path: `elements.${id}`,
        severity: 'warning',
        message: M['W-ELEMENTO-SIN-PARAMETROS'](`elements.${id}`),
      });
    }
  }

  return problems;
}

/**
 * Defectos del **esquema** (zod) como líneas `ruta: mensaje`, con el código del catálogo (§ 17)
 * delante cuando el catálogo le da uno propio.
 *
 * Hoy solo `E-CLAVE-DESCONOCIDA`: el esquema es cerrado (`strictObject`), así que una errata como
 * `capacty: 3` la caza zod **antes** del lint contra el IR y nunca llega a `validateScenario`
 * (LILA-198). El resto conserva el mensaje que ya trae el defecto, que desde LILA-202 viene del
 * mapa de `parseScenario` y desde LILA-211 en el idioma pedido. Para `unrecognized_keys` el texto
 * del catálogo § 17 manda sobre el del mapa (regla 7 de BACKLOG), así que esta rama lo reemplaza
 * entero.
 *
 * ponytail: una función de formato, no un mapa código↔defecto. Techo: si algún día otro código de
 * § 17 lo emite el esquema, aquí se añade su rama.
 */
export function schemaIssueLines(
  issues: readonly z.core.$ZodIssue[],
  options: LocaleOptions = {},
): string[] {
  const M = messages(options.locale).codes;
  return issues.map((issue) => {
    const path = issue.path.length === 0 ? '$' : issue.path.map(String).join('.');
    return issue.code === 'unrecognized_keys'
      ? `${path}: ${coded('E-CLAVE-DESCONOCIDA', M['E-CLAVE-DESCONOCIDA'](issue.keys.join(', ')))}`
      : `${path}: ${issue.message}`;
  });
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
 * Claves que en JavaScript no crean una clave propia sino que escriben en el prototipo (LILA-204).
 * `JSON.parse('{"__proto__":{…}}')` **sí** crea la clave propia, así que un escenario hijo o un
 * `patch_scenario` podían colarlas hasta el `out[key] = value` de `deepMerge`.
 */
const CLAVES_DE_PROTOTIPO = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Merge profundo del hijo sobre el padre.
 *
 * - Objeto sobre objeto: se fusiona clave a clave.
 * - `null`: **borra** la clave del resultado.
 * - Cualquier otra cosa, arrays incluidos, **reemplaza entera** (§ 6: es la única semántica
 *   predecible para una lista sin claves).
 * - `__proto__`, `constructor` y `prototype` se ignoran en cualquier objeto, a cualquier
 *   profundidad (LILA-204). Dentro de un array no: un array se reemplaza entero sin mirarlo, y una
 *   clave así en un elemento suyo la caza el esquema (`strictObject`) con `E-CLAVE-DESCONOCIDA`.
 *
 * ponytail: se ignoran **en silencio** en vez de emitir `E-CLAVE-DESCONOCIDA` (§ 17, R-RES-4).
 * El filtro corre en la fusión, antes del esquema, y `resolveExtends` hoy solo lanza por ciclos y
 * rutas: devolver defectos desde aquí obligaría a cambiarle la firma a la única función que la web,
 * la CLI y el MCP comparten. El techo es que una errata `"constructor": …` se pierde sin aviso;
 * ningún escenario legítimo tiene esas claves (`docs/SCENARIO_FORMAT.md` § 2). Si algún día hace
 * falta avisar, el sitio es el validador, con el escenario **sin** fusionar.
 */
function deepMerge(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parent };
  for (const [key, value] of Object.entries(child)) {
    if (CLAVES_DE_PROTOTIPO.has(key)) continue;
    const previous = out[key];
    if (value === null) delete out[key];
    else if (isPlainObject(previous) && isPlainObject(value)) out[key] = deepMerge(previous, value);
    // Objeto que el padre no trae: también se filtra, o `run: {"__proto__": …}` sobre un padre sin
    // `run` entraba entero por referencia y el resuelto se quedaba con la clave propia.
    else if (isPlainObject(value)) out[key] = deepMerge({}, value);
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
