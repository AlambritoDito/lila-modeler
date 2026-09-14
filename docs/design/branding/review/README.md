# Branding integration review

The screenshots show the approved detailed character in the product page, startup
screen, and actual Electron editor. Screenshots were captured locally in September
2026 with disposable browser contexts or the desktop smoke runner.

- `product-desktop.png`, `product-mobile.png`: responsive product page.
- `startup-desktop.png`, `startup-mobile.png`: slow startup, logo, automatic version.
- `startup-error.png`: recoverable editor bundle download failure.
- `desktop.png`: actual Electron capture after startup.

Validated: startup status in English/Spanish, inert editor during loading, reduced
motion, clear/dark themes, invalid preferences, bundle failure and reload recovery,
subpath asset loading without 404s, native icon transparency, and preservation of
file-open requests during lazy startup. The monochrome variant is an optional asset;
the active brand is the full-color detailed illustration.
