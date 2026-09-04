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
  count: z.number().int().min(2),
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
    if (result.cancelled === true && result.completedReplications !== undefined) {
      const completed = result.completedReplications;
      if (completed < 2 && result.replications !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['replications'],
          message: 'replications se omite cuando hay menos de dos replicaciones completas.',
        });
      }
      if (completed >= 2 && result.replications === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['replications'],
          message: 'replications es obligatorio con al menos dos replicaciones completas.',
        });
      }
      if (result.replications !== undefined && result.replications.count !== completed) {
        context.addIssue({
          code: 'custom',
          path: ['replications', 'count'],
          message: 'replications.count debe coincidir con completedReplications.',
        });
      }
    }
  });

export const eventLogRowSchema = z.object({
  replication: z.number(),
  caseId: z.string(),
  activityInstanceId: z.string(),
  elementId: z.string(),
  resourceId: z.string().nullable(),
  allocationIndex: z.number().int().nonnegative().nullable(),
  resourceQuantity: z.number().int().positive().nullable(),
  status: z.enum(['completed', 'terminated', 'inFlight']),
  enabledAt: z.number(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  observedUntil: z.number(),
  resourceWait: z.number(),
  offHoursWait: z.number(),
  elementCost: z.number(),
  resourceCost: z.number(),
  cost: z.number(),
}).superRefine((row, context) => {
  if (new Set([row.resourceId === null, row.resourceQuantity === null, row.allocationIndex === null]).size !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['resourceQuantity'],
      message: 'resourceId, resourceQuantity y allocationIndex son null juntos solo en sentinel.',
    });
  }
  if (row.status === 'completed' && (row.startedAt === null || row.endedAt === null)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'completed exige startedAt y endedAt.' });
  }
  if (row.status !== 'completed' && row.endedAt !== null) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'terminated/inFlight exigen endedAt null.' });
  }
  if (row.startedAt === null && row.resourceId !== null) {
    context.addIssue({ code: 'custom', path: ['resourceId'], message: 'sin startedAt todavía no existe asignación: exige sentinel.' });
  }
  if (row.startedAt === null && row.resourceCost !== 0) {
    context.addIssue({ code: 'custom', path: ['resourceCost'], message: 'una actividad nunca iniciada no puede tener costo de recurso.' });
  }
  if (row.status !== 'completed' && row.elementCost !== 0) {
    context.addIssue({ code: 'custom', path: ['elementCost'], message: 'el fijo del elemento se carga solo al completar.' });
  }
  if (row.status === 'completed' && row.endedAt !== row.observedUntil) {
    context.addIssue({ code: 'custom', path: ['observedUntil'], message: 'al completar, observedUntil = endedAt.' });
  }
  if (row.cost !== row.elementCost + row.resourceCost) {
    context.addIssue({ code: 'custom', path: ['cost'], message: 'cost debe ser elementCost + resourceCost.' });
  }
}) satisfies z.ZodType<EventLogRow>;
