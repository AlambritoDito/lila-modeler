# English application screenshots

Real Chromium browser captures, generated on 2026-09-10 from the built application at
`/lila-modeler/app/`. English is selected explicitly, with the default Eva-01 theme, normal
density, America/Mexico_City timezone and device scale factor 1. Each state has a 1440×900 PNG and a 1920×1080 PNG.
The [manifest](capture-manifest.json) records the exact application source commit, browser
version and dimensions. The source commit precedes the documentation-only #311 integration;
its application code includes #312 and the English examples from #310. These are local
validation artifacts, not evidence that Pages has been published.

| State | 1440×900 | 1920×1080 |
|---|---|---|
| Model, grouped palette, minimap, validation markers | [model](model.png) | [model](model-1920.png) |
| Selected task properties | [properties](properties.png) | [properties](properties-1920.png) |
| Selected task documentation | [documentation](documentation.png) | [documentation](documentation-1920.png) |
| AS-IS scenario, run parameters | [simulate](simulate.png) | [simulate](simulate-1920.png) |
| Weekly calendar editor | [calendar](calendar.png) | [calendar](calendar-1920.png) |
| AS-IS bottleneck overlay | [overlay](overlay.png) | [overlay](overlay-1920.png) |
| AS-IS results | [results](results.png) | [results](results-1920.png) |
| AS-IS versus TO-BE, saved and reloaded | [compare](compare.png) | [compare](compare-1920.png) |
| Path validation mode (token animation, not simulation) | [routes](routes.png) | [routes](routes-1920.png) |
| Settings and appearance | [appearance](appearance.png) | [appearance](appearance-1920.png) |

The current application uses horizontally scrolling result tables. At 1440 pixels the comparison
extends beyond the first viewport; the landing page uses the 1920-pixel comparison so both
scenario columns are visible. At 900 pixels tall the appearance dialog scrolls to reveal its
lower token groups and Close button; the 1080-pixel view shows the full dialog. Captures preserve actual viewport behavior without cropping,
rescaling, CSS overrides, hidden warnings or composited interface elements. IDs such as
`Task_Preparar`, `cajero` and `oficina`, diagnostic codes, schema keys and numerical values are
unchanged; these contract identifiers are not untranslated interface labels.

## Reproduce

Use Node 22 or 24 and the checked-out commit to reproduce the source, then run from the repository
root. Install Playwright in a separate tools directory so the repository lockfile is unchanged:

```bash
npm ci
npm run build:pages
capture_tools=$(mktemp -d)
npm install --prefix "$capture_tools" playwright
"$capture_tools/node_modules/.bin/playwright" install chromium
PLAYWRIGHT_MODULE="$capture_tools/node_modules/playwright/index.mjs" \
  node tools/capture-screenshots.mjs
```

Alternatively use an already installed Playwright module and Chrome executable by setting
`PLAYWRIGHT_MODULE` and `CHROME_PATH` to their absolute paths. The script serves `_site` on an
ephemeral localhost port under `/lila-modeler/`, launches an isolated headless browser context,
and closes both at the end. It does not touch an existing browser profile or publish anything.
The PNGs come directly from CDP `Page.captureScreenshot` with `format: 'png'`; the script asserts
PNG magic bytes and IHDR dimensions. Rebuild with `npm run build:pages` afterwards to copy the
new images into `_site/img/`. Inspect every image at both sizes before committing.

## Data and acceptance

The maintained restaurant example is `examples/pedido/model.bpmn` with `as-is.scenario.json`
and `to-be-3-cajeros.scenario.json`. Both real browser-worker runs use seed **42**, **30
replications**, the unchanged 30-day duration and one-hour warmup, minutes for display and MXN.
The calendar `oficina` is Monday–Friday, 09:00–18:00. No outputs are injected or invented.

Before capture, the script verifies the browser round-trip through visible controls:

1. Edit `Task_TomarPedido` to “Take order — checked” and the AS-IS seed to 43, then back to 42.
2. Run both scenarios, open Compare and explicitly save the downloaded `.lila.json` project.
3. Assert the saved label, two completed run results and seed/replication inputs; reload and
   compare the restored document with the saved one.
4. Make an unsaved label edit, reload and verify the saved label wins.
5. Open the downloaded project through File → Open and save it again; assert identical contents.
6. Clear only the disposable browser context's storage and capture the original maintained
   example. Run both scenarios again; explicitly save/reload before capturing Compare.

Validation on 2026-09-10: all round-trip assertions passed, with no browser page errors.
The 20 PNGs were checked for format/dimensions and visually reviewed for English interface,
Eva-01, the expected calendar, genuine overlay, numerical results and comparison data.
See [the historical inventory](../README.md) for all 28 retired or retained image dispositions.
