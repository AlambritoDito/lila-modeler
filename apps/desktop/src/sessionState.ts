/**
 * Estado de sesión de la app de escritorio (OP-14, incremento 2): tamaño/posición de ventana y
 * proyectos recientes, persistidos en `<userData>/estado.json`. Puro — solo `node:fs/promises` y
 * `node:path`, sin `electron` — para poder probarlo con `mkdtemp` y JSON roto sin Electron detrás
 * (`app.getPath`/`BrowserWindow`/`screen` viven en `main.ts`, que es quien decide la ruta real y
 * llama a estas funciones).
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
// Solo el tipo (se borra al compilar): `Ajustes` es parte del contrato del puente, así que se
// define una vez en `bridge.ts` y aquí se reusa en vez de duplicar la forma.
import type { Ajustes } from './bridge.js';

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RecentEntry {
  readonly dir: string;
  readonly name: string;
  readonly openedAt: string;
}

export interface SessionState {
  readonly version: 1;
  readonly window: WindowBounds | null;
  readonly recents: readonly RecentEntry[];
  /** Preferencias de apariencia del renderer (LILA-113). `{}` mientras el usuario no toque nada. */
  readonly ajustes: Ajustes;
}

export const MAX_RECENTS = 10;

export function defaultSessionState(): SessionState {
  return { version: 1, window: null, recents: [], ajustes: {} };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (!isPlainObject(value)) return false;
  return typeof value.dir === 'string' && typeof value.name === 'string' && typeof value.openedAt === 'string';
}

/**
 * Saneado de las preferencias de apariencia: se queda solo con las claves conocidas y solo si su
 * valor es texto. Mismo criterio que `recents` —descartar lo inválido en vez de tirarlo todo—, y
 * misma función para lo que llega de disco y para lo que llega por IPC (`lila:writeSettings`), que
 * es igual de ajeno: el renderer no es de fiar por ser el nuestro.
 */
export function parseAjustes(value: unknown): Ajustes {
  if (!isPlainObject(value)) return {};
  const ajustes: { tema?: string; densidad?: string } = {};
  if (typeof value.tema === 'string') ajustes.tema = value.tema;
  if (typeof value.densidad === 'string') ajustes.densidad = value.densidad;
  return ajustes;
}

/**
 * Lee el estado de `path`. Tolerante: archivo ausente, JSON roto, o forma inválida devuelven el
 * estado por defecto en vez de lanzar — perder la sesión anterior es aceptable, romper el arranque
 * de la app no. Una `recents` con algunas entradas inválidas se sanea (se descartan solo esas),
 * en vez de tirar toda la lista.
 */
export async function readSessionState(path: string): Promise<SessionState> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return defaultSessionState();
    return defaultSessionState();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return defaultSessionState();
    const window = isWindowBounds(parsed.window) ? parsed.window : null;
    const recents = Array.isArray(parsed.recents) ? parsed.recents.filter(isRecentEntry).slice(0, MAX_RECENTS) : [];
    return { version: 1, window, recents, ajustes: parseAjustes(parsed.ajustes) };
  } catch {
    return defaultSessionState();
  }
}

function randomSuffix(): string {
  return `${process.pid}-${Math.random().toString(36).slice(2)}`;
}

/** Escritura atómica (temporal + rename), igual que `projectIO.ts`: sin dejar el archivo a medias. */
export async function writeSessionState(path: string, state: SessionState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomSuffix()}`;
  try {
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/** Nuevo estado con `bounds` como ventana recordada (o `null` para olvidarla). */
export function withWindowBounds(state: SessionState, bounds: WindowBounds | null): SessionState {
  return { ...state, window: bounds };
}

/**
 * Nuevo estado con `entry` al frente de `recents`: sin duplicar `dir` (una reapertura mueve la
 * entrada existente al frente con el `openedAt` nuevo, no añade una segunda), como máximo
 * `MAX_RECENTS`, más reciente primero.
 */
export function addRecent(state: SessionState, entry: RecentEntry): SessionState {
  const sinDuplicado = state.recents.filter((r) => r.dir !== entry.dir);
  return { ...state, recents: [entry, ...sinDuplicado].slice(0, MAX_RECENTS) };
}

/**
 * Nuevo estado con `ajustes` FUSIONADO sobre el guardado (LILA-113): el renderer manda solo la
 * preferencia que acaba de cambiar, y reemplazar el objeto entero borraría la otra.
 */
export function withAjustes(state: SessionState, ajustes: Ajustes): SessionState {
  return { ...state, ajustes: { ...state.ajustes, ...ajustes } };
}

/** Nuevo estado sin la entrada de `dir` (carpeta que ya no existe, ver `openRecent` en `main.ts`). */
export function removeRecent(state: SessionState, dir: string): SessionState {
  return { ...state, recents: state.recents.filter((r) => r.dir !== dir) };
}

/** Rectángulo de una pantalla, en la misma forma que `Electron.Display.bounds` (sin importar `electron`). */
export interface DisplayBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** `true` si `bounds` cabe entera dentro de al menos una de `displays` (mismo criterio que "está en pantalla"). */
export function fitsAnyDisplay(bounds: WindowBounds, displays: readonly DisplayBounds[]): boolean {
  return displays.some(
    (d) =>
      bounds.x >= d.x &&
      bounds.y >= d.y &&
      bounds.x + bounds.width <= d.x + d.width &&
      bounds.y + bounds.height <= d.y + d.height,
  );
}
