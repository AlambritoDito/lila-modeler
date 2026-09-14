# Project memory

Read `CONTRIBUTING.md` before changing or publishing this project. Keep public
code/documentation and conventional commits in English; keep UI catalogs aligned
in English and Spanish.

## Approved Lila branding

- Lila Modeler is named after the owner's chihuahua. The approved identity is the
  detailed white/cream illustrated dog on purple, with a tilted head, asymmetrical
  folded ears, expressive glossy eyes, and detailed nose and fur.
- The owner rejected the generic minimal silhouette, the faceted/Obsidian-inspired
  treatment, and the subsequently simplified face. Do not replace the approved
  character with those variants or remove its expressive details unless requested.
- Use the committed sources and derivatives in `docs/design/branding/`. Do not
  regenerate the character to make routine sizes or platform exports. Preserve
  the illustration and use `tools/generate-branding.mjs` for those exports.
- Use the horizontal “Lila Modeler” logo on a white surface for the product hero
  and startup. Startup belongs in both the browser editor and desktop application,
  with the manifest version, no artificial minimum delay, and recovery on failure.
  The product landing page itself must not have a loading screen.
- The source images are raster, not editable vector masters. The monochrome asset
  is optional; experiments are archived and must not be used as active branding.

See `docs/design/branding/DECISION.md` for the owner's decision and
`docs/design/branding/README.md` for asset usage, export and validation instructions.

## Installation and delivery history

On 2026-09-14, build 357 (version 1.0.0-alpha.1, arm64) from commit `b165374`
was installed at `/Applications/Lila Modeler.app` and passed the installed-app smoke
check. The implementation was pushed through PR #350. This is a historical record,
not a claim about the currently installed build or the PR's current status: verify
those before future updates. See `docs/design/branding/INSTALLATION-2026-09-14.md`.
