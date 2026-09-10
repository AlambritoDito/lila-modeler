/**
 * Spanish translation of the `core/` message catalog (LILA-211).
 *
 * `docs/SEMANTICS.md` is normative for these texts: they are byte-for-byte the ones the engine
 * emitted before the catalog existed, so a Spanish run keeps producing the same strings.
 *
 * This file is `core/`: it imports nothing outside `core/`.
 */
import type { CoreCatalog } from './types.js';

export const coreEs: CoreCatalog = {
  codes: {
    'E-ID-DUPLICADO': (id) => `${id}: el id está declarado a la vez como nodo y como flujo.`,
    'E-REF-INEXISTENTE/entrante': (id, flowId) =>
      `${id}: el flujo entrante ${flowId} no existe en el proceso.`,
    'E-REF-INEXISTENTE/saliente': (id, flowId) =>
      `${id}: el flujo saliente ${flowId} no existe en el proceso.`,
    'E-FLUJO-COLGANTE/origen': (id, from) =>
      `${id}: el flujo sale del nodo ${from}, que no existe en el proceso.`,
    'E-FLUJO-COLGANTE/destino': (id, to) =>
      `${id}: el flujo entra al nodo ${to}, que no existe en el proceso.`,

    'E-CAPACIDAD-Y-CALENDARIO': (subject) =>
      `${subject}: capacity por intervalos y calendar son excluyentes; el calendario va en cada tramo.`,
    'E-REC-CAPACIDAD/sin-tramos': (poolId) => `${poolId}: capacity debe declarar al menos un tramo.`,
    'E-REC-CAPACIDAD/entero': (poolId) =>
      `${poolId}: capacity debe ser un entero mayor o igual que 1.`,
    'E-REC-DESCONOCIDO/en-elemento': (subject, poolId) =>
      `${subject}: el pool ${poolId} no existe.`,
    'E-REC-DESCONOCIDO/pool': (poolId) => `el pool ${poolId} no existe.`,
    'E-REC-DUPLICADO/pool': (subject, poolId) =>
      `${subject}: el pool ${poolId} aparece más de una vez.`,
    'E-REC-CANTIDAD/entero': (subject, poolId) =>
      `${subject}: quantity de ${poolId} debe ser un entero mayor o igual que 1.`,
    'E-REC-CANTIDAD/excede': (subject, quantity, capacity, poolId) =>
      `${subject}: quantity ${quantity} excede capacity ${capacity} de ${poolId}.`,

    'E-CAL-VACIO/sin-intervalos': (name) => `${name}: el calendario no tiene intervalos abiertos.`,
    'E-CAL-VACIO/anonimo': () => 'el calendario no tiene intervalos abiertos.',
    'E-CAL-VACIO/interseccion': (elementId) =>
      `${elementId}: la intersección de los calendarios de la tarea es vacía.`,
    'E-CAL-VACIO/pool-sin-tramos': () => 'el pool no tiene ningún tramo de capacidad abierto.',
    'E-CAL-DESCONOCIDO': (subject, calendar) =>
      `${subject}: el calendario ${calendar} no existe.`,

    'E-REC-LIBERACION': (requestId) => `${requestId} no tiene una asignación activa.`,
    'E-REC-SOLICITUD-DUPLICADA': (requestId) => `ya existe la solicitud ${requestId}.`,
    'E-REC-SIN-ASIGNACION': (requestId) => `${requestId}: falta un pool.`,
    'E-REC-ESTADO': (poolId) => `uso negativo en ${poolId}.`,

    'E-REPLICACIONES-INSUFICIENTES/valores': () =>
      'se requieren al menos 2 valores para calcular el IC 95 %.',
    'E-REPLICACIONES-INSUFICIENTES/replicaciones': () =>
      'se requieren al menos 2 replicaciones para calcular el IC 95 %.',
    'E-KPI-INCONSISTENTE': (replication) =>
      `la replicación ${replication} no contiene el mismo conjunto de KPI.`,
    'E-KPI-NO-FINITO': (replication, kpi) =>
      `la replicación ${replication}, KPI ${kpi}, no es un número finito.`,
    'E-AGREGADO-NO-NUMERICO': () => 'la estructura de métricas no es promediable.',
    'E-REPLICACIONES-VACIAS': () => 'no hay resultados que agregar.',
    'E-COMPARE-VACIO': () => 'compare() necesita al menos un resultado.',

    'W-TAREA-SIN-TIEMPO/ninguno': (ids) =>
      `${ids}: el escenario no declara ningún processingTime; esas tareas duran 0 segundos.`,
    'W-TAREA-SIN-TIEMPO/elemento': (nodeId) => `${nodeId}: sin processingTime; dura 0 segundos.`,
    'W-XOR-RESIDUO-COMPARTIDO': (gatewayId, flowIds) =>
      `${gatewayId}: el residuo se reparte entre ${flowIds}.`,
    'W-XOR-NORMALIZADA': (gatewayId, total) =>
      `${gatewayId}: las probabilidades sumaban ${total}; se normalizan.`,
    'W-OR-SIN-PROBABILIDAD': (gatewayId) =>
      `${gatewayId}: ninguna salida declara probability; todas valen 1.`,
    'W-OR-VACIO': (gatewayId) => `${gatewayId}: ningún sorteo activó una salida.`,
    'W-START-SIN-LLEGADAS': (nodeId) =>
      `${nodeId}: el start no declara interTriggerTimer ni triggerCount y no genera casos.`,
    'W-PROB-IGNORADA': (flowId, gatewayId) =>
      `${flowId}: sale de un gateway paralelo (${gatewayId}); probability se ignora.`,
    'W-TIMER-SIN-TIEMPO': (nodeId) => `${nodeId}: sin processingTime; retarda 0 segundos.`,
    'W-OR-JOIN-SIN-FORK': (nodeId) =>
      `${nodeId}: llegó un token sin marca de fork; se comporta como mezcla.`,
    'W-JOIN-BLOQUEADO': (nodeId, cases) =>
      `${nodeId}: ${cases} casos quedaron con tokens esperando en el join.`,

    'W-RECURSO-SATURADO': (poolId, rho) =>
      `${poolId}: la cola crece sin estabilizarse (λ/μ·c ≈ ${rho})`,
    'W-UTILIZACION-MAYOR-UNO': (poolId) =>
      `${poolId}: la ocupación medida supera la capacidad disponible integrada; puede ocurrir al cruzar una bajada de capacidad sin apropiación.`,

    'W-NORMAL-NEGATIVA': (mean, sd, percent) =>
      `normal(mean=${mean}, sd=${sd}): P(x < 0) = ${percent} % > 1 %; las muestras negativas se truncan a 0.`,
    'W-USER-NORMALIZADA': (total) =>
      `user: las probabilidades suman ${total} en vez de 1; se normalizan.`,
  },
  chrome: {
    repeated: (message, count) => `${message} (${count} veces)`,
  },
};
