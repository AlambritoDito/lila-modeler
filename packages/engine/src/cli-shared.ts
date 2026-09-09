/**
 * Lógica compartida entre `cli.ts` (`lila run`/`lila compare`) y `@lila/mcp`
 * (`run_simulation`/`compare_scenarios`, LILA-054): cargar y validar un modelo, resolver un
 * escenario con `extends`, aplicar overrides de `--seed`/`--replications`, fusionar avisos de
 * frontera (`resultWithBoundaryWarnings`), los avisos de `lila compare` que no caben en
 * `CompareResult` (`compareWarnings`) y publicar un JSON determinista de forma atómica
 * (`writeJsonAtomic`).
 *
 * Vive fuera de `core/`: usa `node:fs`/`node:path` y depende de `bpmn/` y `scenario.ts`, fuera
 * del núcleo puro. Extraído tal cual de `cli.ts` (LILA-054), sin cambiar su comportamiento: la
 * CLI ahora importa de aquí en vez de definirlo localmente.
 *
 * LILA-211 (parte 2): todo texto sale del catálogo (`messages(locale).cli`) y cada entrada acepta
 * un `locale` opcional que por defecto es inglés, el idioma base del proyecto. La CLI le pasa el
 * que resolvió de `--lang`/`LILA_LANG`/`LANG`; las tools MCP, el suyo.
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import { parseBpmn } from './bpmn/parse.js';
import { validate, type ValidationResult } from './bpmn/validate.js';
import type { RunResult } from './core/result.js';
import type { BaseTimeUnit } from './format.js';
import { messages, type Locale } from './messages/index.js';
import {
  resolveExtends,
  parseScenario,
  schemaIssueLines,
  type ResolvedScenario,
  type ScenarioProblem,
  type ScenarioReader,
} from './scenario.js';

/** Ruta absoluta relativa al cwd del proceso; `/` también en Windows (igual en toda la CLI/MCP). */
export function absolutePath(file: string): string {
  return resolve(file).replaceAll('\\', '/');
}

/**
 * Dos rutas distintas pueden nombrar el mismo archivo mediante un symlink. El contrato compara
 * el modelo real, no la ortografía usada para llegar a él.
 */
export function comparablePath(file: string): string {
  const normalized = existsSync(file) ? realpathSync(file) : resolve(file);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function readJsonFile(file: string, locale: Locale = 'en'): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(messages(locale).cli.invalidJson(file, error.message));
    }
    throw error;
  }
}

/**
 * `read` es `readJsonFile` por defecto (la ruta es un archivo real, como en la CLI). `@lila/mcp`
 * pasa un lector propio para aceptar un escenario ya en memoria (`run_simulation`/
 * `compare_scenarios` con `scenario` inline): `file` es entonces una ruta virtual anclada al cwd
 * del proceso, y su `extends` (si lo tiene) sigue resolviéndose contra archivos reales.
 */
export function loadResolvedScenario(
  file: string,
  read?: ScenarioReader,
  locale: Locale = 'en',
): ResolvedScenario {
  const C = messages(locale).cli;
  const raw = resolveExtends(file, read ?? ((path) => readJsonFile(path, locale)));
  const parsed = parseScenario(raw, { locale });
  if (!parsed.success) {
    const lines = schemaIssueLines(parsed.error.issues, { locale }).join('\n');
    throw new Error(`${file}: ${C.invalidScenarioLabel()}\n${lines}`);
  }
  if (parsed.data.model === undefined) throw new Error(C.missingModel(file));
  if (parsed.data.run === undefined) throw new Error(C.missingRun(file));
  return parsed.data as ResolvedScenario;
}

/** Overrides comunes de `--seed`/`--replications`; `run` y `compare` los aplican igual. */
export function withRunOverrides(
  scenario: ResolvedScenario,
  options: { seed?: number | undefined; replications?: number | undefined },
): ResolvedScenario {
  return {
    ...scenario,
    run: {
      ...scenario.run,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.replications === undefined ? {} : { replications: options.replications }),
    },
  };
}

export type ParsedIr = Awaited<ReturnType<typeof parseBpmn>>['ir'];

/** Lee y valida el modelo posicional; `run` y `compare` arrancan exactamente igual. */
export async function loadValidatedModel(
  modelFile: string,
  locale: Locale = 'en',
): Promise<{ path: string; ir: ParsedIr; validation: ValidationResult }> {
  const path = absolutePath(modelFile);
  const parsed = await parseBpmn(readFileSync(path, 'utf8'));
  const validation = validate(parsed.ir, {
    unsupported: parsed.unsupported,
    messageFlowCount: parsed.messageFlowCount,
    conditionFlowIds: parsed.conditionFlowIds,
    locale,
  });
  return { path, ir: parsed.ir, validation };
}

/** Avisos de modelo + escenario + motor, deduplicados; `--json` y las tools MCP los llevan igual. */
export function resultWithBoundaryWarnings(
  result: RunResult,
  modelValidation: ValidationResult,
  scenarioProblems: readonly ScenarioProblem[],
): RunResult {
  const warnings = new Set<string>();
  for (const warning of modelValidation.warnings) warnings.add(`${warning.code}: ${warning.message}`);
  for (const warning of scenarioProblems) {
    if (warning.severity === 'warning') warnings.add(`${warning.code}: ${warning.message}`);
  }
  for (const warning of result.warnings) warnings.add(warning);
  return { ...result, warnings: [...warnings] };
}

export interface LoadedScenarioResult {
  /** Ruta o etiqueta del escenario, solo para mensajes de error; `compareWarnings` no la usa. */
  file: string;
  scenario: ResolvedScenario;
  result: RunResult;
}

/**
 * Avisos de la corrida completa de `compare`, en un solo bloque.
 *
 * Incluye los avisos de modelo y escenario que `lila run` ya imprime (`resultWithBoundaryWarnings`)
 * y dos que solo tienen sentido comparando: unidad de tiempo distinta entre escenarios —la tabla
 * usa siempre la del base— y semillas distintas —se pierden los números aleatorios comunes de
 * R-DET-3, sobre los que descansa la lectura limpia de los deltas (RESULTS_FORMAT.md § 11)—.
 */
export function compareWarnings(
  loaded: readonly LoadedScenarioResult[],
  unit: BaseTimeUnit,
  locale: Locale = 'en',
): string[] {
  const C = messages(locale).cli;
  const lines: string[] = [];
  const label = (entry: LoadedScenarioResult): string => `"${entry.scenario.name}"`;

  const otherUnits = loaded.filter((entry) => entry.scenario.run.baseTimeUnit !== unit);
  if (otherUnits.length > 0) {
    lines.push(
      C.mixedTimeUnit(
        unit,
        otherUnits
          .map((entry) => `${label(entry)} (${entry.scenario.run.baseTimeUnit})`)
          .join(', '),
      ),
    );
  }

  const seeds = new Set(loaded.map((entry) => entry.scenario.run.seed ?? 1));
  if (seeds.size > 1) lines.push(C.differentSeeds([...seeds].join(', ')));

  for (const entry of loaded.filter((entry) => entry.result.replications === undefined)) {
    lines.push(C.fewReplications(label(entry)));
  }

  // Los avisos del motor llegan uno por replicación (W-JOIN-BLOQUEADO cita un conteo distinto en
  // cada una): 30 réplicas × N escenarios enterrarían la tabla. `compare` es una vista de resumen,
  // así que se queda con el primero de cada código y dice cuántos más hubo; el detalle completo
  // está en `lila run` y en su `--json`.
  for (const entry of loaded) {
    const byCode = new Map<string, { first: string; count: number }>();
    for (const warning of entry.result.warnings) {
      const code = warning.split(':')[0] ?? warning;
      const group = byCode.get(code);
      if (group === undefined) byCode.set(code, { first: warning, count: 1 });
      else group.count++;
    }
    for (const { first, count } of byCode.values()) {
      const more = count > 1 ? ` ${C.moreWarnings(count - 1)}` : '';
      lines.push(`${label(entry)} ${first}${more}`);
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * Publicación atómica de JSON (LILA-046): `rename` publica cada archivo de una vez.
 * ------------------------------------------------------------------ */

export interface StagedFile {
  readonly target: string;
  write(contents: string): void;
  close(): void;
  commit(): void;
  abort(): void;
}

let temporarySequence = 0;

/**
 * Crea un temporal exclusivo en el mismo directorio: `rename` publica cada archivo atómicamente.
 * Exportado además de `writeJsonAtomic`: `lila run --csv` publica varios archivos (`elements.csv`,
 * `log.csv`, ...) con la misma técnica, uno por uno, no como un único JSON.
 */
export function stageFile(target: string, locale: Locale = 'en'): StagedFile {
  let temporary = '';
  let descriptor: number | undefined;
  for (;;) {
    temporary = `${target}.tmp-${process.pid}-${temporarySequence++}`;
    try {
      descriptor = openSync(temporary, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  const close = (): void => {
    if (descriptor === undefined) return;
    const openDescriptor = descriptor;
    descriptor = undefined;
    closeSync(openDescriptor);
  };

  return {
    target,
    write(contents) {
      if (descriptor === undefined) {
        throw new Error(messages(locale).cli.temporaryFileClosed(temporary));
      }
      // `writeFileSync(fd, ...)` completa todo el buffer; un único `writeSync` puede ser parcial.
      writeFileSync(descriptor, contents, 'utf8');
    },
    close,
    commit() {
      close();
      renameSync(temporary, target);
    },
    abort() {
      try {
        close();
      } catch {
        // El error original de escritura/publicación es el que debe llegar al usuario.
      }
      try {
        unlinkSync(temporary);
      } catch {
        // Si ya se publicó o nunca llegó a crearse, no queda temporal que limpiar.
      }
    },
  };
}

export function assertReplaceableFile(target: string, locale: Locale = 'en'): void {
  if (existsSync(target) && lstatSync(target).isDirectory()) {
    throw new Error(messages(locale).cli.cannotWrite(target));
  }
}

/**
 * Publica cualquier valor serializable como JSON determinista y devuelve la ruta absoluta escrita.
 * Usado por `lila run --json`/`lila compare --json` y por `saveTo` de las tools MCP: mismos bytes,
 * misma publicación atómica.
 */
export function writeJsonAtomic(file: string, data: unknown, locale: Locale = 'en'): string {
  const target = absolutePath(file);
  mkdirSync(dirname(target), { recursive: true });
  assertReplaceableFile(target, locale);
  const staged = stageFile(target, locale);
  try {
    staged.write(`${JSON.stringify(data, null, 2)}\n`);
    staged.commit();
  } catch (error) {
    staged.abort();
    throw error;
  }
  return target;
}
