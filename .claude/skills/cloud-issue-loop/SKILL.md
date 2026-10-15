---
name: cloud-issue-loop
description: Take the next open GitHub issue labelled claude-ok, fix it on its own branch, verify it with the CI commands, and open a draft PR. Use when a scheduled cloud routine runs, or when asked to "work the next claude-ok issue" or to triage issues for the cloud loop.
---

# Cloud issue loop

One run = one issue = one draft PR. The maintainer reviews and merges; this loop never does.

## Intake

The queue is the `claude-ok` label on GitHub, not a list in this file.

1. `gh issue list --label claude-ok --state open --json number,title,labels,body`
2. Skip issues that already have an open PR linked (`gh pr list --search "<number> in:body"`).
3. Take the oldest one left. If none, stop: "queue empty" is a valid result.

The maintainer only labels issues that fit the cloud. The labeller must exclude these:

- epics, and `size:L` (split them into `size:S`/`size:M` sub-issues first)
- anything that needs real hardware or accounts: Windows installer, Safari, macOS install,
  signing/notarization, auto-update, releases and npm publishing
- anything that needs a product decision the issue does not already make

## Work

1. Read `CONTRIBUTING.md` (the six repo rules, language, examples policy). Touching the engine
   means reading `docs/SEMANTICS.md`, `docs/SCENARIO_FORMAT.md` and `docs/RESULTS_FORMAT.md` first.
2. Branch from `main`: `fix/<number>-<slug>` or `feat/<number>-<slug>`.
3. Implement the smallest change that meets the issue's acceptance criteria. New UI strings go in
   both `strings.en.ts` and `strings.es.ts`.
4. Verify with the same commands CI runs. All of them must pass:
   ```bash
   npm ci && npm run check:links && npm run build && npm test && npm run typecheck && npm run build -w @lila-modeler/web
   ```
   If one fails, fix it and rerun from the start. Stop after 5 failed rounds and report instead.
5. Adversarial QA: a subagent with fresh context reviews the diff and tries to break it
   (boundaries, stable contracts such as `E-*`/`W-*` codes and Bizagi column names, determinism,
   missing translations, comments that describe behavior the code doesn't have). Fix what it
   finds and verify again.

## Deliver

- Commit in English with a conventional prefix: `feat/fix/docs/chore/test/ci(scope): summary`.
- Open a **draft** PR against `main` whose body says `Closes #<number>`, what changed, how it was
  verified, and the QA findings and how they were resolved.
- Comment on the issue in plain text: the PR link and how to try the change.
- Remove `claude-ok` from the issue.

## Ambiguous or blocked

Don't guess. Comment the concrete question on the issue, replace `claude-ok` with `needs-info`,
and stop. Do the same if the fix needs a change to a stable contract (`CONTRIBUTING.md`).

## Never

- merge, push to `main`, tag, release or publish to npm
- post private coursework, case statements or student data in code, issues or PRs (`docs/EXAMPLES_POLICY.md`)
- work on more than one issue per run

## Routine setup

Create the labels once:

```bash
gh label create claude-ok --color 5319e7 --description "Ready for the cloud issue loop"
```

```bash
gh label create needs-info --color d4c5f9 --description "Cloud loop needs an answer from the maintainer"
```

Routine prompt for `/schedule` (start daily; raise the frequency once the cost per issue is known):

```
/schedule daily at 7am: run the cloud-issue-loop skill. /goal: one claude-ok issue ends with a green draft PR, or with a needs-info comment, or the queue is empty.
```

This skill has to be on `main` for cloud routines to see it: they run from the GitHub repo, not
from a local checkout.
