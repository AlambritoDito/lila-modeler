# Stabilization handoff — 2026-09-09

The implementation is saved on `codex/stabilization-integration`. This branch combines the functional changes and preliminary 0.1.0 distribution for local validation; it is not a replacement for the individual PRs.

## Saved work

- PRs #305–#308: reviewed and merged (documentation, desktop language, UI locale, CLI/MCP locale).
- PR #309: merged; close-time saving distinguishes complete, diagram-only, cancelled and failed outcomes. Pending scenarios/runs keep the window open with an English/Spanish Save as explanation.
- PR #310: English examples with stable BPMN IDs and numerical inputs; ready for integration.
- PR #311: remaining bilingual MCP documentation; ready for integration.
- PR #312: Pages landing/demo, explicit browser project persistence and current English screenshots; ready for integration.
- PR #223: updated existing distribution branch, engine and desktop version 0.1.0, typed exports including messages, LICENSE and NOTICE. Publication remains an owner decision.

PRs are at `https://github.com/AlambritoDito/lila-modeler/pull/<number>`. Recheck CI and branch freshness before merging. At handoff, the checks for #310–#312 and #223 passed.

## Validation completed

- Combined suite: 1,761 passed, one optional test skipped.
- Typecheck, Pages build, regular web build and desktop build passed.
- Combined unsigned desktop installers passed on macOS, Windows and Linux: [workflow run](https://github.com/AlambritoDito/lila-modeler/actions/runs/34433142338).
- Actual tarball installed outside the monorepo: runtime exports, TypeScript Node16/bundler resolution, CLI validation in English/Spanish and simulation passed. The installed CLI result matched the checkout byte-for-byte for seed 42 and one replication.
- Browser acceptance under `/lila-modeler/app/`: edit, simulate two scenarios, compare, explicitly save, reload and verify the saved BPMN name edit. Unsaved changes are not automatically persisted.

## Remaining work and owner decisions

1. Integrate #310, #311 and #312 through the normal up-to-date CI gate.
2. Activate GitHub Pages and approve its first publication; validate the public URL before closing #67. The workflow builds artifacts without deploying by default.
3. Resolve npm organization/name, credentials and provenance policy before the first tag/publication associated with #223. No tag, npm publication or first Pages deployment was performed.
4. #287: current public screenshots are English, Eva-01, 1280×720 in `docs/design/en/`; the 28 historical views were not regenerated at 1440/1920. They remain historical evidence.
5. Keep release 1.0 (#77) open. This work prepares preliminary 0.1.0 only. Scylla, external interoperability, AI, server and process mining remain outside this block.

## Recreate the local preview

Run `npm ci` and `npm run build:pages`. Serve `_site` mounted at `/lila-modeler/`; the landing links to `app/`. See [Pages instructions](PAGES.md). The session's localhost preview is temporary and is not a public deployment.

For desktop, build the regular web app before the desktop app so it receives the desktop-compatible asset base: `npm run build -w @lila/web` followed by `npm run build -w @lila/desktop`.
