/**
 * Stable ids for the things the shell keeps in state: modes of the top bar, tabs of the right
 * panel, the verb of the loss dialog and the density preference (LILA-210).
 *
 * Until now the Spanish label WAS the id: `useState('Modelar')`, `modo === 'Validar rutas'`,
 * `aceptaPerdida('Guardar')`. That works while the app has exactly one language; with a second
 * one every comparison would depend on the catalog that happens to be loaded, and switching
 * language mid-session would leave the state pointing at a label nobody renders any more.
 *
 * So the id lives here, in code, and the catalogs (`strings.en.ts`, `strings.es.ts`) map id →
 * label. The ids are deliberately the Spanish-flavoured short words the rest of the repo already
 * uses (`modelar`, `rutas`, `documentacion`): identifiers are not renamed by this ticket, and an
 * id is not a text a person reads.
 */

/** Modes of the top bar, in the order they are painted. */
export const MODO_IDS = ['modelar', 'simular', 'resultados', 'comparar', 'animar', 'rutas'] as const;
export type ModoId = (typeof MODO_IDS)[number];

/** Tabs of the right panel, in the order they are painted. */
export const PESTANA_IDS = ['propiedades', 'documentacion', 'simulacion'] as const;
export type PestanaId = (typeof PESTANA_IDS)[number];

/**
 * The action waiting on the loss dialog (LILA-192): the two of them write a mutilated `.bpmn`,
 * and the verb is what the title of the confirmation button says.
 */
export type VerboPerdida = 'exportar' | 'guardar';

/** Density preference (LILA-113); the id is what goes to `localStorage`/`estado.json`. */
export const DENSIDAD_IDS = ['compacta', 'normal', 'comoda'] as const;
export type Densidad = (typeof DENSIDAD_IDS)[number];

/**
 * Steps of the Simulate panel (#333, renamed in #396), in the order they are painted.
 *
 * Parameters (the run window, gateway branches and activity times), Resources, Calendars and
 * Arrivals (start events: how many cases and how often). They started as Bizagi's four levels of
 * simulation; the owner relabelled them after the design (Turno 2) so each step is named after
 * what it edits, and `docs/COMING-FROM-BIZAGI.md` maps them back to the levels. They are a
 * reading order, not a wizard: there is no "enable level N" switch anywhere, every step writes
 * into the same scenario document, and going back to Parameters after Calendars costs nothing. The id
 * lives only in the panel's state (nothing persists it), so the rename needs no migration.
 */
export const PASO_IDS = ['parameters', 'resources', 'calendars', 'arrivals'] as const;
export type PasoId = (typeof PASO_IDS)[number];
