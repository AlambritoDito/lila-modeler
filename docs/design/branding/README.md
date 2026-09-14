# Lila Modeler — detailed illustrated branding

Lila is a white chihuahua with a tilted head, asymmetrical folded ears, bright eyes,
and detailed nose and fur. The owner selected this illustrated design in September
2026. Do not substitute the simplified or faceted experiments. These are raster PNG
masters, **not vectors**. The brand and associated logos remain subject to NOTICE.

## Sources and usage

`sources/lila-original.png` preserves the selected illustration unchanged.
`lila-app-master.png` adapts it to a full purple square; `lila-horizontal.png` adds the
name. `lila-monochrome.png` is a single-color visual alternative with tonal variations,
not a print-ready ink separation. `generation-prompts.json` documents the variants
created with the built-in image_gen tool from the owner's reference. Generated
variants can contain small drawing differences. `explorations/` archives the rejected
simplification for provenance only; it is never used by the application.

- App and favicon: `web/app-icon.png`, `web/icon-*.png`, `web/favicon.ico`.
- Product header: icon with adjacent text; hero and startup: horizontal logo.
- Keep the horizontal logo's white background on a white surface. Never recolor the
  face, crop the ears, stretch the image, or animate the character.
- The app uses the mark at 32 px. The horizontal logo works from about 280 px wide.
  At 16 px the silhouette is recognizable but fine illustrated detail is lost.
- Preserve the approved colors independently of UI themes. Supply alternative text
  unless an adjacent name already identifies the product.

## Reproducible exports

Run `npm run icons -w @lila/desktop` on macOS with Playwright available. Optional
`PLAYWRIGHT_MODULE` points to its index.mjs; `CHROME_PATH` selects installed Chrome,
matching the existing screenshot tools. No AI calls or network access are involved.
Canvas rescales the original and applies only the native icon's container. `sips`
and `iconutil` produce native sizes and ICNS; the existing ICO script packs Windows
icons. The illustration is never redrawn. Commit the exported derivatives.

`web/` contains the shared derivatives. Vite stages them and the theme sources in its
ignored public directory while preserving theme URLs and live edits. `build:pages`
copies branding into the product site. Builds do not depend on `output/`, external
services, or personal paths. Native PNGs have a transparent outer margin and rounded
corners; web PNGs remain square for platform-specific masking.

## Startup and version

The initial HTML includes the logo, version, and recovery link before React loads.
The small controller loads the editor dynamically and dismisses the screen once the
canvas has imported its initial model after preferences and theme resolution. There
is no artificial minimum display duration. A 30-second timeout offers recovery; late
readiness can still continue normally. Fatal errors and failed downloads offer reload.
Only the indicator animates, respecting `prefers-reduced-motion`.

The version comes from the web manifest; Vite requires the desktop version to match.
The screen appears once per editor startup, in browser and desktop, never on the
product site. Startup translations are separately exported from the existing English
and Spanish catalogs so the early controller can use them without importing React.

## Verification

After `npm run build:pages`, `node tools/capture-branding.mjs` checks browser behavior
and writes review screenshots into `output/branding/review/`. After building web with
the default base and desktop, `node tools/check-branding-desktop.mjs` uses a temporary
profile to verify that file-open requests received during startup are preserved.
It uses the existing `pendingOpenPath` handshake, without new IPC channels.
`npm run smoke -w @lila/desktop` also checks logo loading and startup dismissal.
See [review/README.md](review/README.md) for the saved visual evidence.
