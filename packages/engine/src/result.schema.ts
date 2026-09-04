// Esquema zod que valida un RunResult en tiempo de ejecución (docs/RESULTS_FORMAT.md).
// Vive fuera de packages/engine/src/core/: el issue #15 pedía "tipos + zod" en
// core/result.ts, pero core/ no puede importar zod (regla del repositorio verificada por
// el ticket #32). core/result.ts tiene solo los tipos; este archivo es la validación.
import { z } from 'zod';
import type { EventLogRow } from './core/result.js';

const statSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  total: z.number(),
});

const statSdSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  sd: z.number(),
  total: z.number(),
});

const percentilesSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  sd: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
});

const elementMetricsSchema = z.object({
  started: z.number(),
  completed: z.number(),
  processing: statSchema,
  resourceWait: statSdSchema,
  offHoursWait: statSdSchema,
  queueLength: z.object({ mean: z.number(), max: z.number() }),
  fixedCostTotal: z.number(),
});

const flowMetricsSchema = z.object({
  count: z.number(),
});

const resourceMetricsSchema = z.object({
  utilization: z.number(),
  busyTime: z.number(),
  fixedCost: z.number(),
  unitCost: z.number(),
  totalCost: z.number(),
});

const processMetricsSchema = z.object({
  started: z.number(),
  completed: z.number(),
  inFlight: z.number(),
  cycleTime: percentilesSchema,
  waitTime: percentilesSchema,
  throughputPerHour: z.number(),
  costPerCase: z.number(),
  totalCost: z.number(),
});

const bottleneckEntrySchema = z.object({
  elementId: z.string(),
  resourceWaitTotal: z.number(),
  utilization: z.number(),
});

const kpiSummarySchema = z.object({
  mean: z.number(),
  sd: z.number(),
  ci95: z.tuple([z.number(), z.number()]),
});

const replicationSummarySchema = z.object({
  count: z.number(),
  kpis: z.record(z.string(), kpiSummarySchema),
});

// Nota: sin `satisfies z.ZodType<RunResult>` — zod modela un campo `.optional()` como
// "puede valer undefined" (`T | undefined`), mientras que `exactOptionalPropertyTypes`
// exige que un campo opcional de RunResult, si está presente, tenga el tipo exacto (nunca
// `undefined` explícito). Ambas cosas describen el mismo contrato en la práctica (JSON no
// tiene un valor `undefined`); el desacuerdo es solo de representación en TypeScript. El
// mínimo que funciona: los tests (`result.test.ts`) verifican que este esquema valida
// contra `RunResult` de verdad, en tiempo de ejecución.
export const runResultSchema = z
  .object({
    elements: z.record(z.string(), elementMetricsSchema),
    flows: z.record(z.string(), flowMetricsSchema),
    resources: z.record(z.string(), resourceMetricsSchema),
    process: processMetricsSchema,
    bottlenecks: z.array(bottleneckEntrySchema),
    replications: replicationSummarySchema.optional(),
    cancelled: z.literal(true).optional(),
    completedReplications: z.number().int().nonnegative().optional(),
    warnings: z.array(z.string()),
  })
  .superRefine((result, context) => {
    if (result.cancelled === true && result.completedReplications === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['completedReplications'],
        message: 'completedReplications es obligatorio cuando cancelled es true.',
      });
    }
    if (result.cancelled === undefined && result.completedReplications !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['completedReplications'],
        message: 'completedReplications solo puede aparecer cuando cancelled es true.',
      });
    }
  });

export const eventLogRowSchema = z.object({
  replication: z.number(),
  caseId: z.string(),
  elementId: z.string(),
  resourceId: z.string().nullable(),
  enabledAt: z.number(),
  startedAt: z.number(),
  endedAt: z.number(),
  resourceWait: z.number(),
  offHoursWait: z.number(),
  cost: z.number(),
}) satisfies z.ZodType<EventLogRow>;
