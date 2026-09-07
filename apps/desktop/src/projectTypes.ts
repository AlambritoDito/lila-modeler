/**
 * Espejo local de `ProjectDocument`/`ScenarioDocument`/`StoredRun`, cuya fuente de verdad es
 * `apps/web/src/store/ProjectStore.ts` (contrato de A, OP-01/LILA-058/ADR-018/023).
 *
 * No se importa el tipo original: bajo el `tsconfig.json` de este paquete (`rootDir: "src"`,
 * `composite: false`, sin `references`), un `import type` a un archivo de `apps/web/src` revienta
 * con `TS6059 ("File is not under 'rootDir'")` incluso siendo type-only — verificado a mano antes
 * de escribir esto (`npx tsc -p apps/desktop/tsconfig.json --noEmit` con ese import). La dirección
 * opuesta (`apps/web` importando `type` de `apps/desktop/src/bridge.ts`) sí compila, porque el
 * `tsconfig.json` de `apps/web` no fija `rootDir`.
 *
 * `StoredRun.result` queda en `unknown` en vez de `RunResult` de `@lila/engine`: añadir esa
 * dependencia a `@lila/desktop` está fuera de alcance de OP-08 (aislamiento del ticket: "sin
 * dependencias nuevas"), y el proceso main nunca interpreta el contenido de `result` — solo lo
 * serializa/deserializa tal cual. `DesktopStore` (apps/web), que sí depende de `@lila/engine`,
 * hace el único cast puntual de `unknown` a `RunResult` en la frontera IPC (ver comentario ahí).
 *
 * Entrega a A: mover esta forma a un paquete compartido (p. ej. `packages/contracts`) evitaría
 * mantener dos copias sincronizadas a mano; queda anotado en `estado/OP-08-claude.md`.
 */

/** Documento editable; su contenido puede ser un borrador aún inválido (igual que en A). */
export type ScenarioDocument = Record<string, unknown>;

export interface StoredRun {
  readonly id: string;
  readonly scenarioName: string;
  readonly result: unknown;
  readonly inputs: {
    readonly modelRevision: number;
    readonly scenarioRevision: number;
    readonly xml: string;
    readonly scenario: ScenarioDocument;
  };
}

export interface ProjectDocument {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly model: {
    readonly id: string;
    readonly name: string;
    readonly xml: string;
    readonly revision: number;
  };
  readonly scenarios: Readonly<Record<string, ScenarioDocument>>;
  readonly scenarioRevisions: Readonly<Record<string, number>>;
  readonly runs: readonly StoredRun[];
}

/** Un `*.scenario.json` (o `runs/*.result.json`, ver `projectIO.ts`) que no se pudo leer. */
export interface ProjectProblem {
  readonly file: string;
  readonly message: string;
}
