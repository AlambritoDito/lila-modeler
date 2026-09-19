# Approved branding decision

**Accepted by the owner:** 2026-09-14.

Lila Modeler is named after the owner's chihuahua. The brand should retain the
character and warmth of the detailed illustration derived from the owner's
reference: white/cream fur, purple background, tilted head, asymmetrical folded
ears, glossy expressive eyes, detailed nose and small fur accents.

The owner explored a minimal negative-space head, a faceted icon inspired by the
visual economy of Obsidian, and a simplified version of the illustrated face.
Those alternatives lost the expression the owner wanted. The detailed illustration
is the approved source; routine asset work must not simplify or redraw it.

## Approved applications

- Native app icon and browser favicon: the detailed character on purple, exported
  to the required dimensions and platform containers.
- Editor toolbar and product header: recognizable detailed icon.
- Product hero and startup: horizontal “Lila Modeler” logo on its white surface.
- Startup in **both browser editor and desktop**, showing the real manifest version
  until preferences, theme and initial canvas are ready. No forced minimum delay;
  provide accessible localized loading/error states and reload recovery.
- No loading overlay on the product landing page, and no character animation.
- The monochrome illustration is an optional reproduction variant, not the default.

## Sources and implementation

The originals live in `sources/`; shared web exports live in `web/`; native exports
live in `apps/desktop/resources/icons/`. They are raster PNG-based artwork, not
vector masters. Use the [branding guide](README.md) for exports and validation.
The owner's reference photos are not part of the repository.

The implementation is recorded in commits `84f6c45` (assets and exports) and
`b165374` (integration and startup), through
[PR #350](https://github.com/AlambritoDito/lila-modeler/pull/350).
A separately dated [installation record](INSTALLATION-2026-09-14.md) identifies the
local validation build. Neither that record nor this decision implies PR merge,
website deployment, or publication of a new release.

Revisit this decision when the owner explicitly requests a redesign, or when a
platform adaptation requires a new export. An export requirement alone is not
permission to change the character's expression.

## Transparent companion — 2026-09-18

The owner accepted the isolated Lila PNG and requested project integration.
Use the transparent companion in the editor toolbar, welcome view and product
header, where the character sits alongside text on the current surface. Preserve
the detailed illustration and alpha channel. The horizontal hero/startup lockup
and purple platform icons remain the approved applications described above.
