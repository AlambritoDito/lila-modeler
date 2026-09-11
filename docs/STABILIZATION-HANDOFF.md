# Stabilization handoff — 2026-09-10

This supersedes the 2026-09-09 integration-branch handoff. Everything listed below was already
merged into `main` through individual PRs; the stabilization branch's own copies of that work are
historical. What the branch carries **beyond** this handoff — per-outcome metrics and service level
(#321), XLSX export (#322), the credit-card example (#319), the `.lila` project container (#323),
the XLSX Summary fix (#324) and the e2e failure fix (#325) — is what the 1.0.0-alpha integration
brings across; each of those went through its own PR. Functional and documentation changes were reviewed and squash-merged
through their individual PRs, with strict up-to-date Node 22/24 CI and specific adversarial QA.

## Merged work

| PR | Scope | Verified squash commit |
|---|---|---|
| [#310](https://github.com/AlambritoDito/lila-modeler/pull/310) | English examples; #285 closed | `947b4914ce12cd90d430e3ad1ebc185eebfae26a` |
| [#311](https://github.com/AlambritoDito/lila-modeler/pull/311) | Complete bilingual public documentation; #281 closed | `5164a42d16ea9ac78069713d1a8a8023146f2b41` |
| [#312](https://github.com/AlambritoDito/lila-modeler/pull/312) | Pages build, explicit browser project save/restore | `46b770f6933f29824c9d1211be85ad11b252d65d` |
| [#313](https://github.com/AlambritoDito/lila-modeler/pull/313) | Complete English screenshots and reproducible acceptance; #287 closed | `01d91dc4b7fb53a0831ca5f0cbead23f5ac48d35` |

The example review compared every changed BPMN/JSON structurally, preserving IDs, references and
numerical parameters. Golden files were not changed. Documentation links and the ten required
English/Spanish pairs were checked against current contracts and implementation.

The browser review fixed two save-boundary defects: a failed download initiation no longer
replaces the last saved project, and returned documents cannot mutate the stored snapshot.
Regression tests cover both paths, including a subsequent legacy export.

## Validation evidence

- #310: 1,749 local tests passed, one optional skipped; typecheck and normal web build passed;
  [Node 22/24 CI](https://github.com/AlambritoDito/lila-modeler/actions/runs/34433348010).
- #311: 1,749 local tests passed, one optional skipped; typecheck and normal web build passed;
  [final-head CI](https://github.com/AlambritoDito/lila-modeler/actions/runs/34482285407).
- #312: 1,759 local tests passed, one optional skipped; typecheck, normal web and Pages builds
  passed; [final-head CI](https://github.com/AlambritoDito/lila-modeler/actions/runs/34482703462)
  and [Pages artifact, deployment skipped](https://github.com/AlambritoDito/lila-modeler/actions/runs/34482703476).
- #313: 1,759 local tests passed, one optional skipped after resolving integration conflicts;
  typecheck, normal web and Pages builds passed;
  [final-head CI](https://github.com/AlambritoDito/lila-modeler/actions/runs/34483521736) and
  [Pages artifact](https://github.com/AlambritoDito/lila-modeler/actions/runs/34483521744).
- Actual browser acceptance under `/lila-modeler/app/`: edit a BPMN label and numeric scenario
  field, simulate AS-IS and TO-BE with seed 42 and 30 replications, compare, explicitly save,
  reload the complete model/scenarios/revisions/two runs, discard an unsaved edit by reloading,
  reopen the downloaded `.lila.json`, and verify an identical re-export. No fabricated results
  or browser page errors. The [capture script](../tools/capture-screenshots.mjs) reproduces it.
- All 20 actual application PNGs were checked for file signature, dimensions and visual content:
  ten states at 1440×900 and 1920×1080, English and Eva-01. The
  [inventory](design/README.md) accounts for all 28 historical images, and the
  [gallery recipe](design/en/README.md) records data, source commit and browser. The 1440-wide
  comparison needs horizontal scrolling; the product page uses the readable 1920-wide view.

## Distribution PR remains open

[#223](https://github.com/AlambritoDito/lila-modeler/pull/223) preserves the existing preliminary
0.1.0 work and is updated against the stabilized main. It is intentionally **not merged**.
Engine and desktop versions remain aligned; typed exports include messages; LICENSE and NOTICE
are packaged. The private MCP server is not part of the engine tarball.

`npm run test:package` now installs a real archive outside the monorepo and verifies every runtime
export, the JSON descriptor, strict TypeScript Node16/Bundler resolution, English/Spanish CLI and
byte-identical installed/checkout simulation results. It runs in CI and before any future npm
publication. A local consumer in a path containing spaces passed. Local integrated distribution
validation: 1,763 tests passed, one optional skipped; typecheck, normal web build, then desktop
build passed; [Node 22/24 CI including the consumer check](https://github.com/AlambritoDito/lila-modeler/actions/runs/34483270114) passed. Unsigned installers passed on all three systems in the
[distribution workflow](https://github.com/AlambritoDito/lila-modeler/actions/runs/34483270069).

After final documentation integration, consult #223's latest head and final QA comment for its
matching CI and macOS/Windows/Linux run links. Do not reuse earlier checks if that head changes.
Source maps still reference unpublished sources, as in the existing package.

## Owner decisions and remaining acceptance

- **#67 acceptance completed after owner authorization on 2026-09-10.** The
  [first public deployment](https://github.com/AlambritoDito/lila-modeler/actions/runs/34485464026)
  published main `be0f695` successfully. Both [the landing](https://alambritodito.github.io/lila-modeler/)
  and [editor](https://alambritodito.github.io/lila-modeler/app/) were verified publicly, including
  both simulations, comparison, editing, saving, reload and reopening the download. Pages is
  configured for Actions; automatic publication remains disabled. This supersedes the earlier
  local-only Pages status. See [Pages instructions](PAGES.md) for subsequent manual publications.
- **#223 and #48 stay open.** Decide npm organization/package name, credentials, provenance policy
  and the first tag/publication. Registry-based `npx` acceptance cannot be completed beforehand.
- **#77 stays open.** This is preliminary 0.1.0 preparation, not a completed 1.0 release.
- No npm publication, tag, release, secret change or branch-protection change was performed.
  Scylla, external interoperability, AI, server and process mining remain outside this block.

## Reproduce and continue

Follow [CONTRIBUTING](../CONTRIBUTING.md): Node 22 or 24, `npm ci`, `npm test`, typecheck with its
exit code checked, and the regular web build. Use [Pages instructions](PAGES.md) for the subpath
preview. Run the screenshot script only in its disposable browser context; it changes generated
image files and must be followed by visual review and another Pages build.

For desktop, always build the regular web app before desktop:
`npm run build -w @lila/web` then `npm run build -w @lila/desktop`. Never package the Pages-base
web build. On the distribution branch, run `npm run test:package` after integration.

At the stabilization handoff, the original integration checkout and existing release worktree were preserved. Review worktrees
were isolated so branch changes never occurred during their suites. Final PR comments and the
session report record current remote heads, checks and local cleanliness; inspect `git status`,
`git worktree list`, and GitHub again before continuing.
