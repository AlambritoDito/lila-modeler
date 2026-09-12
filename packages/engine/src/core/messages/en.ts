/**
 * English message catalog for `core/` (LILA-211). This is the default locale.
 *
 * This file is `core/`: it imports nothing outside `core/`.
 */
import type { CoreCatalog } from './types.js';

export const coreEn: CoreCatalog = {
  codes: {
    'E-ID-DUPLICADO': (id) => `${id}: the id is declared both as a node and as a flow.`,
    'E-REF-INEXISTENTE/entrante': (id, flowId) =>
      `${id}: the incoming flow ${flowId} does not exist in the process.`,
    'E-REF-INEXISTENTE/saliente': (id, flowId) =>
      `${id}: the outgoing flow ${flowId} does not exist in the process.`,
    'E-FLUJO-COLGANTE/origen': (id, from) =>
      `${id}: the flow leaves node ${from}, which does not exist in the process.`,
    'E-FLUJO-COLGANTE/destino': (id, to) =>
      `${id}: the flow enters node ${to}, which does not exist in the process.`,

    'E-CAPACIDAD-Y-CALENDARIO': (subject) =>
      `${subject}: capacity by intervals and calendar are mutually exclusive; the calendar belongs in each slice.`,
    'E-REC-CAPACIDAD/sin-tramos': (poolId) => `${poolId}: capacity must declare at least one slice.`,
    'E-REC-CAPACIDAD/entero': (poolId) => `${poolId}: capacity must be an integer greater than or equal to 1.`,
    'E-REC-DESCONOCIDO/en-elemento': (subject, poolId) => `${subject}: the pool ${poolId} does not exist.`,
    'E-REC-DESCONOCIDO/pool': (poolId) => `the pool ${poolId} does not exist.`,
    'E-REC-DUPLICADO/pool': (subject, poolId) => `${subject}: the pool ${poolId} appears more than once.`,
    'E-REC-CANTIDAD/entero': (subject, poolId) =>
      `${subject}: quantity of ${poolId} must be an integer greater than or equal to 1.`,
    'E-REC-CANTIDAD/excede': (subject, quantity, capacity, poolId) =>
      `${subject}: quantity ${quantity} exceeds capacity ${capacity} of ${poolId}.`,

    'E-CAL-VACIO/sin-intervalos': (name) => `${name}: the calendar has no open intervals.`,
    'E-CAL-VACIO/anonimo': () => 'the calendar has no open intervals.',
    'E-CAL-VACIO/interseccion': (elementId) =>
      `${elementId}: the intersection of the task's calendars is empty.`,
    'E-CAL-VACIO/pool-sin-tramos': () => 'the pool has no open capacity slice.',
    'E-CAL-DESCONOCIDO': (subject, calendar) => `${subject}: the calendar ${calendar} does not exist.`,

    'E-REC-LIBERACION': (requestId) => `${requestId} has no active allocation.`,
    'E-REC-SOLICITUD-DUPLICADA': (requestId) => `the request ${requestId} already exists.`,
    'E-REC-SIN-ASIGNACION': (requestId) => `${requestId}: a pool is missing.`,
    'E-REC-ESTADO': (poolId) => `negative usage in ${poolId}.`,

    'E-REPLICACIONES-INSUFICIENTES/valores': () =>
      'at least 2 values are required to compute the 95 % CI.',
    'E-REPLICACIONES-INSUFICIENTES/replicaciones': () =>
      'at least 2 replications are required to compute the 95 % CI.',
    'E-KPI-INCONSISTENTE': (replication) =>
      `replication ${replication} does not contain the same set of KPIs.`,
    'E-KPI-NO-FINITO': (replication, kpi) =>
      `replication ${replication}, KPI ${kpi}, is not a finite number.`,
    'E-AGREGADO-NO-NUMERICO': () => 'the metrics structure cannot be averaged.',
    'E-REPLICACIONES-VACIAS': () => 'there are no results to aggregate.',
    'E-COMPARE-VACIO': () => 'compare() needs at least one result.',

    'W-TAREA-SIN-TIEMPO/ninguno': (ids) =>
      `${ids}: the scenario declares no processingTime at all; those tasks take 0 seconds.`,
    'W-TAREA-SIN-TIEMPO/elemento': (nodeId) => `${nodeId}: no processingTime; it takes 0 seconds.`,
    'W-XOR-RESIDUO-COMPARTIDO': (gatewayId, flowIds) =>
      `${gatewayId}: the remainder is shared between ${flowIds}.`,
    'W-XOR-NORMALIZADA': (gatewayId, total) =>
      `${gatewayId}: the probabilities added up to ${total}; they are normalised.`,
    'W-OR-SIN-PROBABILIDAD': (gatewayId) =>
      `${gatewayId}: no outgoing flow declares probability; they all count as 1.`,
    'W-OR-VACIO': (gatewayId) => `${gatewayId}: no draw activated an outgoing flow.`,
    'W-START-SIN-LLEGADAS': (nodeId) =>
      `${nodeId}: the start declares neither interTriggerTimer nor triggerCount and generates no cases.`,
    'W-PROB-IGNORADA': (flowId, gatewayId) =>
      `${flowId}: it leaves a parallel gateway (${gatewayId}); probability is ignored.`,
    'W-TIMER-SIN-TIEMPO': (nodeId) => `${nodeId}: no processingTime; it delays 0 seconds.`,
    'W-OR-JOIN-SIN-FORK': (nodeId) =>
      `${nodeId}: a token arrived without a fork mark; it behaves as a merge.`,
    'W-JOIN-BLOQUEADO': (nodeId, cases) =>
      `${nodeId}: ${cases} cases were left with tokens waiting at the join.`,

    'W-RECURSO-SATURADO': (poolId, rho) =>
      `${poolId}: the queue grows without settling (λ/μ·c ≈ ${rho})`,
    'W-RECURSO-SATURADO/utilizacion': (poolId, percent) =>
      `${poolId}: the queue grows without settling (utilization ≈ ${percent} %)`,
    'W-UTILIZACION-MAYOR-UNO': (poolId) =>
      `${poolId}: the measured occupancy exceeds the integrated available capacity; this can happen when crossing a capacity drop without preemption.`,

    'W-NORMAL-NEGATIVA': (mean, sd, percent) =>
      `normal(mean=${mean}, sd=${sd}): P(x < 0) = ${percent} % > 1 %; negative samples are truncated to 0.`,
    'W-USER-NORMALIZADA': (total) =>
      `user: the probabilities add up to ${total} instead of 1; they are normalised.`,
  },
  chrome: {
    repeated: (message, count) => `${message} (${count} times)`,
  },
};
