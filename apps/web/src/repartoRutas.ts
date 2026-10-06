/**
 * The split of a diverging gateway in percent (Lote M, C4): the pure half of the Routes step and of
 * the percentage fields on the canvas (`etiquetasPorcentaje.ts`).
 *
 * The scenario file keeps fractions (`elements[flowId].probability = 0.7`, docs/SCENARIO_FORMAT.md)
 * and nothing here changes that: a person reads and types percentages, `aFraccion`/`aPorcentaje`
 * convert at the edge, and the round trip is exact for every value with up to two decimals in
 * percent (70 → 0.7 → 70, 33.33 → 0.3333 → 33.33). So a split typed here simulates exactly like the
 * same fractions written by hand.
 *
 * The effective split follows the engine (`scenarioFields.ts::repartoXor`, which mirrors
 * `core/sim.ts::xorWeights`): on a XOR a flow without `probability` takes its share of the
 * remainder (R-XOR-1/2/3) and a sum other than 100 % is normalised with a warning (R-XOR-4); on an
 * inclusive gateway each path is independent and an undeclared one weighs 100 % (R-OR-2).
 */
import type { ProcessIR } from '@lila-modeler/engine';

import { borrar, conBorrados, escribir, esObjeto, leer, type Ruta } from './escenarioModelo.js';
import { roundDisplay } from './formatDisplay.js';
import { repartoXor } from './scenarioFields.js';

export type ClaseCompuerta = 'xor' | 'or';

export interface FlujoReparto {
  id: string;
  /** What the flow reads: its BPMN name, else its target's, else its id. */
  etiqueta: string;
  /** The target's name (or id), for «→ destino». */
  destino: string;
  /** The declared `probability` in percent, or `null` when the flow declares none. */
  porcentaje: number | null;
  /** What the engine will use, in percent (the implicit share of an undeclared XOR flow). */
  efectivo: number;
  /** The gateway's default flow: it takes the remainder and is not typed into. */
  porDefecto: boolean;
}

export interface Reparto {
  /** The gateway's IR id. */
  id: string;
  nombre: string;
  clase: ClaseCompuerta;
  flujos: FlujoReparto[];
  /** Sum of the effective percentages. */
  suma: number;
  /** XOR: the split adds up to 100 %. Always `true` on an inclusive gateway. */
  cuadra: boolean;
  /** `100 - suma` on a XOR (positive: points missing; negative: points over). 0 on an OR. */
  diferencia: number;
  /** The one-click fix («Set «No» to 30 %»), when one flow can absorb the difference. */
  arreglo: { flujo: string; etiqueta: string; porcentaje: number } | null;
}

/** Fraction of the file → percent on screen, two decimals at most (0.3 → 30, not 30.000000000000004). */
export function aPorcentaje(fraccion: number): number {
  return roundDisplay(fraccion * 100, 2);
}

/**
 * Percent on screen → fraction for the file. Two decimals of percent are four of fraction, and the
 * integer arithmetic keeps the binary error out: 70 → 0.7, 30 → 0.3, 33.33 → 0.3333.
 */
export function aFraccion(porcentaje: number): number {
  return Math.round(porcentaje * 100) / 10000;
}

/**
 * What a person typed into a percentage field: `'vacio'` (remove the value), the percent with two
 * decimals, or `null` when it is not a plain number from 0 to 100 — the field then shows itself
 * invalid and the file is left alone (nothing is clamped silently). Accepts «70», «70 %», «70,5» and
 * «70.5»; not «0x46», «1e2», «-5» or «150».
 */
export function leerPorcentaje(texto: string): number | 'vacio' | null {
  const limpio = texto.replace(/%/g, '').trim().replace(',', '.');
  if (limpio === '') return 'vacio';
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(limpio)) return null;
  const numero = Number(limpio);
  return numero > 100 ? null : roundDisplay(numero, 2);
}

/** ↑/↓ on a percentage field: ±5, clamped to 0–100. An empty field starts from its effective value. */
export function pasoPorcentaje(actual: number, sube: boolean): number {
  return roundDisplay(Math.min(100, Math.max(0, actual + (sube ? 5 : -5))), 2);
}

function nombreDe(ir: ProcessIR, id: string): string {
  const nombre = ir.nodes[id]?.name ?? '';
  return nombre.trim() === '' ? id : nombre;
}

/** A flow's label: its name, its target's name, or its id (same rule as the old gateway view). */
export function etiquetaFlujo(ir: ProcessIR, id: string): string {
  const flujo = ir.flows[id];
  if (flujo === undefined) return id;
  const nombre = flujo.name.trim() !== '' ? flujo.name : (ir.nodes[flujo.to]?.name ?? '');
  return nombre.trim() === '' ? id : nombre;
}

/** Whether `id` is a gateway whose split is parameterised: a XOR or OR with two or more exits. */
export function esCompuertaRepartible(ir: ProcessIR | null, id: string | null): boolean {
  if (ir === null || id === null) return false;
  const nodo = ir.nodes[id];
  return nodo !== undefined && (nodo.type === 'xor' || nodo.type === 'or') && nodo.outgoing.length >= 2;
}

/** The splittable gateways of the IR, in the order the diagram declares them. */
export function compuertasRepartibles(ir: ProcessIR | null): string[] {
  if (ir === null) return [];
  return Object.keys(ir.nodes).filter((id) => esCompuertaRepartible(ir, id));
}

/**
 * The gateway the step is about, from what the canvas selected: the gateway itself, or the source
 * of a selected outgoing flow. `null` when the selection is not part of a split.
 */
export function compuertaDeSeleccion(ir: ProcessIR | null, id: string | null): string | null {
  if (ir === null || id === null) return null;
  if (esCompuertaRepartible(ir, id)) return id;
  const origen = ir.flows[id]?.from;
  return origen !== undefined && esCompuertaRepartible(ir, origen) ? origen : null;
}

/**
 * The split of gateway `id` as the scenario `resuelto` (extends applied) declares it.
 * `ultimoEditado` is the flow the person just typed into: the one-click fix never proposes to
 * undo it, it moves another flow instead.
 */
export function repartoDe(
  ir: ProcessIR,
  id: string,
  resuelto: Record<string, unknown>,
  ultimoEditado: string | null = null,
): Reparto | null {
  if (!esCompuertaRepartible(ir, id)) return null;
  const nodo = ir.nodes[id]!;
  const clase = nodo.type as ClaseCompuerta;
  const salientes = nodo.outgoing;
  const declaradas = salientes.map((f) => {
    const p = leer(resuelto, ['elements', f, 'probability']);
    return typeof p === 'number' ? p : undefined;
  });
  const pesos = clase === 'xor' ? repartoXor(declaradas).pesos : declaradas.map((p) => p ?? 1);
  const flujos: FlujoReparto[] = salientes.map((f, i) => {
    const declarada = declaradas[i];
    return {
      id: f,
      etiqueta: etiquetaFlujo(ir, f),
      destino: nombreDe(ir, ir.flows[f]?.to ?? ''),
      porcentaje: declarada === undefined ? null : aPorcentaje(declarada),
      efectivo: aPorcentaje(pesos[i]!),
      porDefecto: ir.flows[f]?.isDefault === true,
    };
  });
  const suma = roundDisplay(flujos.reduce((acc, f) => acc + f.efectivo, 0), 2);
  const cuadra = clase === 'or' || Math.abs(suma - 100) < 0.005;
  const diferencia = clase === 'or' ? 0 : roundDisplay(100 - suma, 2);
  return { id, nombre: nombreDe(ir, id), clase, flujos, suma, cuadra, diferencia, arreglo: arregloDe(flujos, cuadra, ultimoEditado) };
}

/**
 * The flow that absorbs the difference: the last typed-into flow that is not the one just edited
 * (with two exits, «the other one»). `null` when no flow can take it within 0–100 %.
 */
function arregloDe(flujos: readonly FlujoReparto[], cuadra: boolean, ultimoEditado: string | null): Reparto['arreglo'] {
  if (cuadra) return null;
  const editables = flujos.filter((f) => !f.porDefecto);
  const candidatos = editables.filter((f) => f.id !== ultimoEditado);
  const flujo = candidatos[candidatos.length - 1] ?? editables[editables.length - 1];
  if (flujo === undefined) return null;
  const resto = flujos.reduce((acc, f) => acc + (f.id === flujo.id ? 0 : f.efectivo), 0);
  const porcentaje = roundDisplay(100 - resto, 2);
  if (porcentaje < 0 || porcentaje > 100) return null;
  return { flujo: flujo.id, etiqueta: flujo.etiqueta, porcentaje };
}

/**
 * «Split evenly»: the typed-into flows get equal explicit shares and the last one rounds; a default
 * flow keeps no number and takes the remainder (R-XOR-2), which is then its equal share too.
 */
export function repartoIgual(reparto: Reparto): { flujo: string; porcentaje: number }[] {
  const editables = reparto.flujos.filter((f) => !f.porDefecto);
  const n = reparto.flujos.length;
  const parte = Math.floor((100 / n) * 100) / 100;
  const hayDefecto = editables.length < n;
  return editables.map((f, i) => ({
    flujo: f.id,
    porcentaje: !hayDefecto && i === editables.length - 1 ? roundDisplay(100 - parte * (n - 1), 2) : parte,
  }));
}

/** One line per gateway for lists and the properties panel: «Yes 70 % · No 30 %». */
export function resumenReparto(reparto: Reparto): string {
  return reparto.flujos.map((f) => `${f.etiqueta} ${f.efectivo} %`).join(' · ');
}

/**
 * Writes a percentage into the scenario **delta** (`porcentaje = null` removes it), with the same
 * extends rules as the panel's `Contexto` (docs/SCENARIO_FORMAT.md § 6): removing a value the parent
 * defines writes `null`. For a host without the panel's `Contexto` at hand (the canvas fields wired
 * in `App.tsx`).
 */
export function escribirPorcentaje(
  delta: Record<string, unknown>,
  padre: Record<string, unknown> | null,
  flujo: string,
  porcentaje: number | null,
): Record<string, unknown> {
  const ruta: Ruta = ['elements', flujo, 'probability'];
  if (porcentaje !== null) return escribir(delta, ruta, conBorrados(aFraccion(porcentaje), leer(padre, ruta)));
  if (padre !== null && leer(padre, ruta) !== undefined) return escribir(delta, ruta, null);
  const sinValor = borrar(delta, ruta);
  // Leave no empty `elements[flujo] = {}` behind.
  const elementos = sinValor['elements'];
  if (esObjeto(elementos) && esObjeto(elementos[flujo]) && Object.keys(elementos[flujo]).length === 0) {
    return borrar(sinValor, ['elements', flujo]);
  }
  return sinValor;
}
