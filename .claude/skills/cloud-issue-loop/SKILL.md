---
name: cloud-issue-loop
description: Take the next eligible issue from the "Cloud loop queue" issue (labelled claude-ok, dependencies met, not claimed), implement it on its own branch against the batch branch the queue names, verify it with the CI commands plus adversarial QA, and open a draft PR. Use when a cloud session is started with "run the cloud-issue-loop skill once", or when asked to work the next claude-ok issue. Also has a research mode that only proposes issue changes.
---

# Cloud issue loop

One run = one issue = one draft PR. The maintainer reviews and merges; this loop never does.
Everything you need is in this file, `CONTRIBUTING.md` and the issue itself: do not rely on any
earlier conversation.

In this file, "a PR references #n" means its body has a line matching
`(?im)^(refs|closes)\b[^\n]*#<n>\b` (for example `Refs #631, #638`). `gh` search is fuzzy, so
always fetch `--json number,body,headRefName` and check the body with that pattern.

## 0. Preconditions (stop if any fails)

Stopping with a one-line reason is a valid, successful run. Report it in the run log (see 6).

1. Find the queue: `gh issue list --state open --search '"Cloud loop queue" in:title' --json number,body`.
   Exactly one open issue. Queue items are the lines matching
   `^- \[( |x)\] #(\d+) — base: (\S+)$`, in file order; ignore every other line. Order is priority.
   A checked item is done.
2. Review limit: `gh pr list --state open --label claude-loop --json number` returns fewer than **3**
   PRs. At 3 or more, stop: "review limit reached".
3. Another run is not in flight: no open issue carries `claude-wip` with a claim comment younger
   than 6 hours. If one does, stop: "another run is active on #n". A `claude-wip` issue whose
   newest claim comment is older than 6 hours and that has no open PR is a stale claim: remove
   the label and treat the issue as unclaimed.

## 1. Pick the issue

Walk the queue items in order and take the first one where all of these hold:

- the issue is open and labelled `claude-ok`, and not labelled `needs-info` or `claude-wip`;
- every `Depends on #<n>` line in the issue body is satisfied: `#<n>` is closed as completed
  (`stateReason` is `COMPLETED`; closed as not planned → stop with `needs-info`), or a PR that
  references `#<n>` has been **merged into the item's base branch**
  (`gh pr list --state merged --base <base> --search "<n> in:body" --json number,body,headRefName`);
- no open PR against any branch references it, except an earlier attempt you may continue (see 2);
- the base branch exists on origin (`git ls-remote --heads origin <base>`). Never create it.

If nothing qualifies, stop: "no eligible issue" (name the first blocked item and why).

Never pick by age, never pick an issue that is not in the queue, and never label anything
`claude-ok` yourself.

## 2. Claim

1. `gh issue edit <n> --add-label claude-wip`
2. Comment on the issue: `Claimed by the cloud issue loop at <UTC timestamp>. Branch: <branch>.`
   This comment is how later runs find this run's branch, so always name the branch you push to.
3. Your branch: if the session assigns one you must push to (cloud sessions get `claude/<name>`
   and may push nowhere else), use it. Otherwise use `feat/<n>-<slug>` or `fix/<n>-<slug>`.
4. Earlier attempts are found by evidence on GitHub, never by branch prefix. Branches of other
   agents (`codex/…`, `lote-…`) are never touched.
   - **Attempt PRs**: PRs labelled `claude-loop` that reference #n
     (`gh pr list --state all --label claude-loop --search "<n> in:body" --json number,state,body,headRefName,comments`).
   - **Attempt branches**: the branches named in the issue's `Claimed by the cloud issue loop`
     comments that still exist on origin.
   - A closed, unmerged attempt PR without a `Superseded by #<m>` comment means the maintainer
     rejected it: stop with `needs-info`.
   - An open draft attempt PR whose body says "incomplete": **continue** it.
     `git fetch origin <its branch>`, then `git checkout -B <your branch> origin/<its branch>`.
     If your branch is the same as its branch, push and do not open a second PR. If not, deliver
     a new draft PR from your branch, then comment `Superseded by #<new>` on the old PR and close it.
   - An attempt branch with commits ahead of `origin/<base>` and no attempt PR (a crashed run):
     continue it the same way, then open the PR.
   - Otherwise branch from `origin/<base>`.
   Add commits on top; never force-push, never rewrite or drop commits you did not make.

## 3. Work

1. Read `CONTRIBUTING.md` (the six repo rules, language, examples policy). Touching the engine
   means reading `docs/SEMANTICS.md`, `docs/SCENARIO_FORMAT.md` and `docs/RESULTS_FORMAT.md` first;
   touching the project format means `docs/PROJECT_FORMAT.md` (and `docs/REPOSITORY_CONTRACT.md`
   when it exists).
2. Implement the smallest change that meets the issue's acceptance criteria and nothing else.
   New UI strings go in both `strings.en.ts` and `strings.es.ts`.
3. Do **not** bump versions and do **not** edit `CHANGELOG.md`: the batch integration PR does that
   (`docs/RELEASING.md`). Write the proposed CHANGELOG line in the PR body instead.
4. Changes to the project format or persistence need a test that saves, reopens and compares,
   and a test that an existing v1/v2 project still opens unchanged.
5. Before the last verification round, `git merge origin/<base>` (never rebase, never force-push)
   and resolve conflicts, so the PR is current with work merged meanwhile.
6. Verify with the same commands CI runs. All must pass:
   ```bash
   npm ci && npm run check:links && npm run build && npm test && npm run typecheck && npm run build -w @lila-modeler/web
   ```
   If one fails, fix it and rerun from the start. Stop after **5** failed rounds, or after about
   **2 hours** of wall-clock time (check `date`), and deliver what you have as a draft PR whose
   body says "incomplete", with the failures.
   Never weaken, skip or delete a test to get green.
7. Adversarial QA: a subagent with fresh context reviews the diff and tries to break it
   (boundaries, stable contracts such as `E-*`/`W-*` codes and Bizagi column names, determinism,
   persistence round trips, missing translations, comments that describe behavior the code
   doesn't have). Fix what it finds and verify again.

## 4. Deliver

- Commit in English with a conventional prefix: `feat/fix/docs/chore/test/ci(scope): summary`.
- Push the branch and open a **draft** PR against the item's base branch, labelled `claude-loop`.
  Fill `.github/PULL_REQUEST_TEMPLATE.md`, but write `Refs #<n>` instead of `Closes #<n>`: the
  issue closes when the batch integration PR to `main` lists `Closes #<n>`.
- PR body, in this order:
  - **Tested SHA** and the exact commands run, with results.
  - What changed, and how each acceptance criterion is met.
  - **Not verified here**: anything the cloud cannot run (desktop app, canvas interaction,
    other browsers). Say it plainly; do not mark it as checked.
  - Persistence evidence when the format changed (save → reopen → compare).
  - Generated files the issue asks for (HTML, Word, PNG): do not commit or attach them. Give the
    exact command that produces each, its sha256 and size, and for text formats the first 40
    lines in a collapsed `<details>` block.
  - QA findings and how they were resolved.
  - Proposed CHANGELOG line.
  - Duration, verification rounds, errors and retries.
- What counts as a UI change: a change to rendered components, CSS or canvas behavior in
  `apps/web` or `apps/desktop`. A pure move of logic or an import change in `apps/web` whose
  existing jsdom tests pass unchanged, with a green web build, counts as headless.
- QA comment on the PR (`CONTRIBUTING.md` merge gate):
  - Headless change and QA passed: a comment that starts with
    `QA: OK (cloud loop, automated subagent review, run <UTC timestamp>)`, followed by what QA checked.
  - UI change: a comment `QA pending local app check:` with the issue's "Local app check" list
    (if the issue has none, write the list yourself from what you changed). Never post `QA: OK`
    for UI that nobody saw running.
- On the issue: comment the PR link and remove `claude-wip`. Remove `claude-ok` too, unless the
  PR is incomplete: then keep `claude-ok` so a later run continues it. Do not close the issue.

## 5. Ambiguous or blocked

Don't guess. Comment the concrete question on the issue, replace `claude-ok` and `claude-wip`
with `needs-info`, and stop. Do the same if the change needs a product or architecture decision
the issue does not record, or a change to a stable contract (`CONTRIBUTING.md`).

## 6. Run log

End every run, including stops, with exactly one comment on the queue issue:

`<UTC date> · #<n> or none · <PR link | stopped: reason> · <duration> · <verification rounds> · <errors/retries>`

If the newest queue comment is already a stop with the same reason, skip the comment. The
maintainer adds the observed cost next to each line; this log is how the loop is evaluated.

## Research mode

Started with "run the cloud-issue-loop skill in research mode for #<n>". It only produces
evidence: read the issue, the code and the cited references, then comment on the issue with
findings, gaps and a proposed rewrite of its scope and acceptance criteria. No branches, no PRs,
no labels, no decisions: the maintainer decides what becomes `claude-ok`.

## Never

- merge, push to `main` or to a batch branch, tag, release, publish to npm, or deploy
- close issues, or add `claude-ok`
- post private coursework, case statements or student data in code, issues or PRs
  (`docs/EXAMPLES_POLICY.md`)
- work on more than one issue per run

## Launching a run

The maintainer starts a cloud session on this repository's default branch with the prompt:

```
Run the cloud-issue-loop skill once.
```

One session at a time. This skill must be on the default branch: cloud sessions clone the
repository from GitHub, not from a local checkout. A scheduled routine can use the same prompt;
check how routines are billed before turning one on.
