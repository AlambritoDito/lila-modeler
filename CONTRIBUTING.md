# Contributing to Lila Modeler

Thanks for your interest in contributing. This document covers requirements, setup, the checks a
change needs to pass, the repo rules that keep the engine's contracts stable, and how the PR
process works.

## Requirements

- Node.js **22 or later** (`engines.node` in `package.json`). CI runs the full suite on Node 22 and
  24, so either works locally.

## Setup

```bash
git clone git@github.com:AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npm run build` runs `tsc --build` for `packages/engine` and `packages/mcp`: the CLI and the MCP
server consume `@lila/engine` through its published subpaths (`dist/`), not its sources, so the
build has to run before the tests.

## Running the checks

```bash
npm test        # runs the build first (see "pretest" in package.json), then vitest
npm run typecheck > /dev/null 2>&1; echo EXIT=$?
```

Run `typecheck` exactly like that: it covers `packages/engine` (`tsc --build --force`), the engine
benchmark project and `apps/web` (`tsc --noEmit`) in one invocation, and its output is large — piping
it to `tail` hides the actual failures, so redirect it and check the exit code instead. `EXIT=0`
means it passed; anything else means there's type-checking output to read.

For the web app in development:

```bash
npm run dev -w @lila/web    # builds the engine if needed + starts Vite on http://localhost:5173
```

## Repo rules

These are the six rules from the header of `BACKLOG.md`, which every ticket and PR has to follow:

1. Before touching the engine, read `docs/SEMANTICS.md`, `docs/SCENARIO_FORMAT.md` and
   `docs/RESULTS_FORMAT.md` — they are the contracts, written before the code that implements them.
2. `packages/engine/src/core/` imports nothing from outside `core/` — not `bpmn-moddle`, not
   `node:*`, not React. A test enforces this boundary
   (`packages/engine/test/worker-bundle.test.ts`): the core has to run unchanged in Node, in a
   browser Web Worker, and behind an MCP server.
3. No ticket or PR closes without its acceptance test green.
4. Result column names are Bizagi's (`docs/BIZAGI_PARITY.md`), not a name you'd otherwise pick.
5. All times are in seconds; all money is in `run.currency`.
6. The BPMN `id` is the only key — the name never disambiguates two elements.

### Stable contracts

Beyond the six rules above, the following are public contracts other tools and documents key off
of, and must not change casually: the `E-*`/`W-*` error and warning codes (catalogued in
`docs/SEMANTICS.md` §17), rule ids such as `R-XOR-1`, BPMN element ids, and the result column names
(`docs/BIZAGI_PARITY.md`). A PR that has to change one of these needs to say so explicitly and why.

### Language

English is the project's base language; Spanish is the first translation. New code, commit
messages and public documentation are written in English. Existing identifiers and comments in the
codebase are not renamed just to translate them.

Translations are **one plain file per language**, with no i18n library:

- UI text lives in one catalog file per language under `apps/web/src/` (`strings.en.ts` as the base
  and `strings.es.ts` as the translation, introduced by #279, which also adds a test that both
  catalogs have the same keys) — so a new UI string has to be added to both files in the same
  change.
- Engine, CLI and MCP messages will follow the same convention, one catalog file per language,
  once #280 lands.

`BACKLOG.md` and `LILA_MODELER_ESTRUCTURA.md` are working documents for this project's own team and
are kept in Spanish; they are not part of the English-first rule above.

## Pull request process

- One branch per ticket, opened against `main`.
- Commit messages are in English, with a conventional prefix:
  `feat/fix/docs/chore/test/ci(scope): summary`.
- The merge gate is: CI green (`npm ci`, build, test, typecheck, and the web build, on both Node 22
  and 24 — see `.github/workflows/ci.yml`) plus an adversarial QA review recorded as a `QA: OK`
  comment on the PR.
- PRs are squash-merged.

## Filing issues

Please search existing issues before opening a new one. Use the bug report or feature request
template — they ask for the details that speed up triage (a minimal `.bpmn`/scenario for bugs,
which surface for feature requests). If neither template fits, open an issue anyway and describe
what doesn't fit; blank issues are otherwise disabled in favor of the templates.

## Trademarks

"Lila Modeler" and any associated logos are not covered by the Apache-2.0 license grant; see
[`NOTICE`](NOTICE) for the project's copyright and attribution notices.
