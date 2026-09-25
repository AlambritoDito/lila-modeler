# Theme format

> Read this in: [Español](es/THEMES.md)

A Lila Modeler theme is a single JSON file with a flat object:

```json
{ "name": "Eva-01", "tokens": { "bg.base": "#12101A", "font.size.base": "13px" } }
```

`name` is the label the user sees in the theme list. `tokens` is a map
from token name to value. The valid keys are **only** those in
`apps/web/src/theme/tokens.ts` (`TOKEN_NAMES`), which are the ones from the
brief `prompts/claude-design-ui.md`; the two built-in themes carry all 40. Color
values are hex (`#rgb`, `#rrggbb`, or `#rrggbbaa`, the last one for `shadow`);
`font.ui`, `font.mono`, and `font.diagram` are lists of CSS font
families; `font.size.base` is a CSS length, and `density` is `compacta`,
`normal`, or `comoda`. It is a flat object, not a nested tree, on purpose: that
way the exported JSON reads at a glance, the diff is legible, and there is no
second way to write the same theme.

`applyTheme(theme, root)` (in `apps/web/src/theme/applyTheme.ts`) writes each
token as a CSS variable on `root`, converting the name with `tokenToCssVar`:
dots become hyphens and nothing else, without touching case
(`bg.base` → `--bg-base`, `diagram.marker.error` → `--diagram-marker-error`,
`fg.onAccent` → `--fg-onAccent`). The conversion is reversible, which is what
lets the Appearance screen (LILA-114) export back to the same JSON.
The default values (Eva-01) also live in `apps/web/src/theme/tokens.css`
as `:root`, so the app paints correctly before any theme loads. That is where
the three behaviors of `applyTheme` toward an imperfect theme come from:

- **Missing token**: not an error. It keeps `tokens.css`'s default value,
  so a partial theme (`{ "accent.primary": "#00FFAA" }`) is legal and only
  changes what it brings. For that to hold **even when another theme was
  already applied**, whoever applies a theme afterward clears the inline
  variables the previous one left that this one does not bring (`aplicarTema`
  in `App.tsx`): without that sweep, `applyTheme` only writes and never
  clears, so a partial theme would silently inherit the previous theme's
  tokens, and the same file would look different depending on what came
  before. It clears after writing, not before, so as not to lose the other
  guarantee: a bad theme throws without touching anything and leaves the
  previous one intact.
- **Unknown key**: `Error`. Writing it would leave a garbage variable
  (`--foo-bar`) that no component reads and that no one would ever see.
- **Value that is not text** (number, `null`, object): `Error`. Writing it
  would leave invalid CSS, and the element would render wrong with no
  warning.

Whoever calls `applyTheme` with an outside theme (a JSON file from disk, an
import from LILA-114) has to catch that error and show it to the user; the
smoke page in `main.tsx` does so in `--status-error`. Built-in
themes are served as static files and requested via `fetch`, so
changing a value in the JSON and reloading changes the UI without recompiling.

## Choosing a theme (LILA-113, minimal version)

`App.tsx` knows the built-in themes by id (`eva-01`, `papel`, `tieso`, `akira`, `montana`, `lila-light`,
`lila-dark`), requests `./<id>.json`, and passes it to
`applyTheme`. Density (`compacta` / `normal` / `comoda`) is written on top of the theme's `density` token
and comes out as `data-densidad` on `.app` for the CSS. There is no `ThemeProvider`: with two themes and
a `useState`, a context would be overkill.

**Following the system scheme (#472).** By default the theme follows the OS light/dark scheme while
the app runs: there are two theme slots, one for light and one for dark (Lila Light and Lila Dark by
default), and a `change` listener on `matchMedia('(prefers-color-scheme: dark)')` applies the other
slot when the OS switches — in Electron too, where `nativeTheme.themeSource` stays `'system'` and
Chromium reports the OS scheme to the renderer. Picking a theme while following writes the slot of
the current scheme, so it shows at once. The first time the theme switches on its own, a small
prompt says so and offers **Keep** (Esc too) or **Turn off**, which restores the previous theme,
stops following and keeps that theme as the explicit choice; the prompt is shown once. With
following off, the saved `tema` rules as before #472. The slots start from the old single `tema`
once: nothing or a Lila theme gives the Lila defaults; any other theme (built-in or the user's)
goes into both slots, so whoever had picked Akira sees no change until they pick a second theme. A
slot naming a deleted user theme falls back to its Lila theme.

**Where the choice is stored.** In the browser, in `localStorage['lila.tema']` and
`localStorage['lila.densidad']`, plus `lila.seguirSistema` (`'0'` when off), `lila.temaClaro`,
`lila.temaOscuro` and `lila.avisoSeguirSistema` (`'1'` once the prompt was shown) for #472. On
desktop, in `<userData>/estado.json`, under `ajustes`, through the bridge (`readSettings()` /
`writeSettings(ajustes)`, `apps/desktop/src/bridge.ts`), where the window and recents already live;
the #472 four go there as `seguirSistema`, `temaClaro`, `temaOscuro` and `avisoSeguirSistema`
(booleans and text). They are mutually exclusive: if `window.lila` exists, `localStorage` is neither
read nor written. Until now it was `localStorage` in both modes, with the — correct — argument that
`lila://` is a scheme with its own origin and therefore has its own store; what fails is not the
isolation but the location: that store sits inside the app's Chromium profile, is not visible from
outside, is not copied to another machine, and goes away with the site's data. `writeSettings` **merges**
(sending only `{ tema }` does not clear the density) and `main.ts` passes whatever arrives through
`parseAjustes`, which discards any key or value that does not have the expected shape (the two text
values, and, since LILA-114, the `temas` list). Reading is asynchronous —
on desktop it is IPC —, so `temaId` and `densidad` start out at their factory defaults and the first
effect overwrites them: it is the same instant at which `tema` stops being `undefined`, and the canvas
is not mounted until then.

**Hot-swapping the theme.** `cambiarTema` applies the JSON and calls `Modelador.repintar()`. The
canvas **does not** remount — it used to change `<Lienzo>`'s `key`, and that swept away the undo
stack and the selection. `repintar()` rebuilds `bpmnRenderer` because bpmn-js copies
`defaultFillColor`/`defaultStrokeColor`/`defaultLabelColor` into local variables of its constructor and
offers neither a setter nor an event to change them: that constructor is re-run on the same instance
(with a muted `eventBus`, so as not to stack `render.shape` listeners), and afterward `elements.changed`
fires, which is diagram-js's normal path for redrawing. It does not go through the
`commandStack`, so it neither dirties the document nor adds an undo step, and the colors an element
carries in its DI still override the theme's.

That last rule has a consequence for «Validar rutas» (Validate paths): the mode's neutral colors
(`ColoresNeutrosDelTema`, `TokenSim.tsx`) are written into the DI when it is activated, so they win
over whatever `repintar()` repaints. The module rereads the tokens on every activation, not on every
repaint, so `App.tsx` mounts `<TokenSim key={temaId}>`: changing the theme with the mode on turns it
off and back on, so the diagram comes out with the current theme. Without that `key` the diagram used
to keep the previous theme's fill with the new one's label color.

**`font.size.base`** is wired onto `body` (`app.css`), and everything that does not set its own size
inherits it from there. It is deliberately not on `html`: the CSS's `rem` measurements would resolve
against the token, and dialogs would shrink when the font size is lowered.

## Settings → General / Appearance / Shortcuts (#407)

`apps/web/src/settings/Ajustes.tsx` is the content of the Settings dialog (artboard 09); the
`<dialog>` and how it opens (⚙, ⌘, and the native menu) stay in `App.tsx`. It splits into three
sections behind a left `role="tablist"` nav — **General** (language, density, and **Advanced**, which shows BPMN element ids next to names), **Appearance**
(theme editor, below) and **Shortcuts** (a read-only table of the current keyboard map) — all
three mounted at once and toggled with `hidden`, not remounted, so `Apariencia`'s live-preview
wiring survives switching tabs and a test can reach any control without first clicking through the
nav. General starts active every time the dialog opens.

`apps/web/src/settings/Apariencia.tsx` is the Appearance section; `App.tsx` remains **the only
one** that calls `applyTheme` and `Modelador.repintar()`. The component neither applies nor
persists anything: it builds the user's new theme list and says which one stays active
(`onTemas(lista, seleccion)`), and the live preview follows from that — every valid change repaints
the whole app, dialog included. The sample box (text, dimmed text, accent) is just a shortcut so
you don't have to look behind the dialog.

The controls:

- **Theme list**: the built-in ones (Eva-01, Papel) and the user's own, each group in an
  `<optgroup>`. Picking one applies it live; built-in themes are requested via `fetch`, user themes
  come from storage and request nothing.
- **Follow the system theme** (#472): a toggle, on by default, with a **Light theme** and a **Dark
  theme** selector below it while it is on (see "Following the system scheme" above).
- **Duplicate**: copies the active theme as a user theme, with an editable name next to it.
- **Token editor**, grouped just like `TOKEN_NAMES` (Base, Texto/Text, Acentos/Accents,
  Estados/States, Lienzo y diagrama/Canvas and diagram, Simulación/Simulation,
  Tipografía/Typography), one `<details>` per group. Colors carry an `<input type="color">`
  alongside the hex value, both editable; `type="color"` only understands `#rrggbb`, so picking a
  color re-attaches whatever alpha the token had (`shadow`). `font.ui`/`font.mono`/`font.diagram`
  are a `<select>` with the families the app bundles (Archivo, JetBrains Mono) plus «Sistema»
  (System); `font.size.base` is a number in pixels.
- **Editing a built-in theme does not modify it**: the first edit on Eva-01 creates «Eva-01
  (copia)» (Eva-01 (copy)) and continues on that copy. This was preferred over a "duplicate
  first" warning because the change the user asked for happens anyway, and the theme's name,
  changing right in front of them, already tells the story of what happened.
- **Density lives in the General section** (LILA-113), not here: it is a preference applied on
  top of any theme, so it does not touch the `density` token of the theme being edited in
  Appearance; that token still travels in the exported JSON exactly as it came from the source
  theme.
- **Reset**: returns a user theme to the tokens it was born with, and a built-in one to its JSON
  (which is re-fetched).
- **Export**: downloads `{ name, tokens }` — exactly the format shown above, with no `id` or
  anything app-specific — via an `<a download>` and a Blob. On Electron it works the same way:
  there is no `will-download` intercepting it, and `lila://`'s CSP does not govern downloads, so
  Chromium saves it through the normal path.
- **Import**: an `<input type="file" accept=".json">`. The whole JSON is validated before touching
  anything (`validarTema`, `apps/web/src/theme/temas.ts`); if something fails, the message
  appears inside the dialog and nothing is applied or saved. If it is valid, it comes in as a user
  theme and is applied.
- **Delete** removes the active user theme and falls back to the system rule as on first launch
  (no theme saved): `App.tsx`'s selector shows and applies Lila Dark or Lila Light by
  `temaPorDefecto()` (`apps/web/src/theme/temaPorDefecto.ts`), but persists an empty `tema` instead
  of that resolved id, not the fixed Eva-01 of before (#422). An empty `tema` is re-resolved by the
  same rule on every future launch, so a later OS scheme change is picked up again instead of
  freezing on the scheme at the moment of deletion (QA of #432, should-fix S1).
- **Closing the dialog undoes nothing.** The «Cerrar» (Close) button and the Escape key do the
  same thing: whatever was edited is already applied and already saved from the keystroke that
  changed it, because the editor has no «Aceptar» (Accept). To go back there is «Restablecer»
  (Reset). Enter inside a text field does **not** close it: the `<form method="dialog">` would
  submit it midway through typing a hex value or a name, so `App.tsx` calls `preventDefault` on
  it when the target is an `<input>`.
- **A half-typed value never leaves the control.** A hex value passes through `#`, `#1`, `#12`…
  and none of those is a color; the name passes through empty, and the base size through a
  numberless field (which used to leave the token at `"px"`) or outside the 9–32 px range, where
  `-5px` and `0px` are lengths CSS silently discards. Those values stay in the field's own state
  — which marks them with `--status-error` — and are neither applied nor saved: only a valid
  value calls `onTemas`, and until there is one, the last good value keeps being sent. **Leaving
  the field discards the half-typed value** and restores the last good one: otherwise it used to
  stay on screen after switching theme, after «Restablecer» (Reset), or after closing and
  reopening Settings, showing in red a value the active theme does not have.

**What `validarTema` validates, and why `applyTheme` is not enough.** `applyTheme` checks only
what keeps it from writing sane CSS: a known key and a text value. A file the user picked can
also carry a color that is not a color (`"azul"`) or a made-up density: CSS silently ignores the
invalid value, and the app ends up half-painted with no explanation. `validarTema` adds those two
rules — hex `#rgb`/`#rrggbb`/`#rrggbbaa` on color tokens, `density` among the three known values
—, **normalizes** the theme to `{ name, tokens }` (whatever extra the file brings does not get in
and does not come back out, which is why export → import → export yields the same file), and
throws the Spanish-language message that is read in the dialog. It is the same function for
importing and for rereading what was saved.

**Where user themes are stored.** In the same place as the rest of the appearance settings
(LILA-113) and with the same shape in both modes: `ajustes.temas` in `<userData>/estado.json` on
desktop, `localStorage['lila.temas']` on the web. Each entry is `{ id, tema: { name, tokens },
origen }`: `id` is `u:<n>` (the built-in ones are `eva-01`, `papel`, `tieso`, `akira`, `montana`, `lila-light` and
`lila-dark`), and `origen` is the
starting tokens, which is all «Restablecer» (Reset) needs — no need to re-fetch the built-in
theme or trust that its JSON stayed the same, and it works the same way for an imported theme,
which has no built-in behind it. `id` and `origen` belong to the app: they do not appear in the
exported file, nor are they expected in an imported one. On desktop, `parseAjustes` discards
entries that are not shaped like a theme (`sessionState.ts`, with a cap of `MAX_TEMAS` = 50
entries: this is the app's configuration, not a gallery), and the renderer validates them again
with `validarTema`; a theme a hand-edited `estado.json` left broken **is repaired token by
token** (`saneaTemas`): a value that does not hold up falls back to the theme's `origen`, and if
that does not hold up either, it drops out of the list and the `tokens.css` default paints it.
The whole theme is discarded only when there is no way to reconstruct it — no user `id` or no
`name`. Discarding it at the first broken token, which is what used to happen, turned any edit
left half-done into the silent loss of the other 39 on reload.

## Montana decoration

The built-in Montana theme takes its purple, bubblegum pink and gold direction from
[Hannah Montana Linux](https://hannahmontana.sourceforge.net/screenshots.html).
Its static gradients, sparkles and corner stars are CSS decoration scoped to the
editor's `data-theme="montana"` attribute, set only after the theme loads successfully.
Switching to another theme removes that decoration. The Lila branding and startup
remain unchanged. External canvas labels use a pale fill and plum outline over the
purple backdrop; BPMN exports retain their original diagram data without CSS decoration.

Duplicating, importing or exporting Montana preserves the existing `{ name, tokens }`
format and its palette, including a lighter canvas for dark labels. The built-in
decoration does not travel with custom themes. No new tokens or dependencies are required.
