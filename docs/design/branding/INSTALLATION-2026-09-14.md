# Local installation record — 2026-09-14

This records the local validation build installed on the owner's Mac. Verify the
installed app's metadata before relying on this record for a later update.

| Item | Recorded value |
| --- | --- |
| Application | Lila Modeler |
| Installed path | `/Applications/Lila Modeler.app` |
| Version | `1.0.0-alpha.1` |
| Build number | `357` |
| Architecture | Apple Silicon (`arm64`) |
| Source commit | `b165374f486b31e21f860236b985c7a95b38b2c1` |
| Branch | `codex/lila-branding-startup` |
| Pull request | [#350](https://github.com/AlambritoDito/lila-modeler/pull/350) |
| Local signing | Ad-hoc code signature, verified with `codesign --verify --deep --strict` |
| Provenance in app | `Contents/Resources/BUILD-INFO.txt` and `buildCommit` in the packaged manifest |

## Validation performed

- Full local suite: 1,956 passed, 1 skipped.
- Typecheck, product-page build, web build, and desktop build passed.
- The **installed copy** passed smoke checks for the canvas, theme, fonts, desktop
  bridge, branding, and completed startup, with no console errors or load failures.
- Browser checks covered slow loading, English/Spanish, version, inert state,
  reduced motion, both themes, invalid preferences, failed downloads and recovery.
- A temporary Electron profile verified file-open requests received during loading.
- The app was opened after verification for the owner's hands-on validation.

The code was pushed to GitHub in two implementation commits. This installation was
built locally from the PR branch; it was not a tagged release or a website deploy.
For current CI and merge status, consult the PR rather than this historical record.

## Inspect or reopen

```sh
cat '/Applications/Lila Modeler.app/Contents/Resources/BUILD-INFO.txt'
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' '/Applications/Lila Modeler.app/Contents/Info.plist'
open '/Applications/Lila Modeler.app'
```

For future builds, follow [the desktop beta guide](../../BETA-MAC-GUIDE.md) and
[the branding export guide](README.md). Derive provenance from the actual source
commit; do not reuse build 357's metadata for a different build.
