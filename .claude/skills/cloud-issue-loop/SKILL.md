---
name: cloud-issue-loop
description: Take the next eligible issue from the "Cloud loop queue" issue (labelled claude-ok, dependencies met, not claimed), implement it on its own branch against the batch branch the queue names, verify it with the CI commands plus adversarial QA, and open a draft PR. Use when a cloud session is started with "run the cloud-issue-loop skill once", or when asked to work the next claude-ok issue. Also has a research mode that only proposes issue changes.
---

# Cloud issue loop

One run = one issue = one draft PR. The maintainer reviews and merges; this loop never does.
Everything you need is in this file, `CONTRIBUTING.md` and the issue itself: do not rely on any
earlier conversation.

## 0. Preconditions (stop if any fails)

Stopping with a one-line reason is a valid, successful run. Post that reason as a comment on the
queue issue (see 6) so the maintainer sees it.

1. Find the queue: `gh issue list --state open --search '"Cloud loop queue" in:title' --json number,body`.
   Exactly one open issue. Its body is an ordered list; each item reads
   `- [ ] #<number> — base: <branch>`. Order is priority. A checked item is done.
2. Review limit: `gh pr list --state open --label claude-loop --json number` returns fewer than **3**
   PRs. At 3 or more, stop: "review limit reached".
3. Another run is not in flight: no open issue carries `claude-wip` with a claim comment younger
   than 6 hours (see 2. Claim). If one does, stop: "another run is active on #n".

## 1. Pick the issue

Walk the queue items in order and take the first one where all of these hold:

- the issue is open and labelled `claude-ok`, and not labelled `needs-info` or `claude-wip`;
- every `Depends on #<n>` line in the issue body is satisfied: `#<n>` is closed, or a PR that
  says `Refs #<n>` or `Closes #<n>` has been **merged into the item's base branch**
  (`gh pr list --state merged --base <base> --search "<n> in:body" --json number,body`, then
  check the body really contains `Refs #<n>` or `Closes #<n>`: the search is fuzzy);
- no open PR already references it (same search with `--state open`, same body check);
- the base branch exists on origin (`git ls-remote --heads origin <base>`). Never create it.

If nothing qualifies, stop: "no eligible issue" (name the first blocked item and why).

Never pick by age, never pick an issue that is not in the queue, and never label anything
`claude-ok` yourself.

## 2. Claim

1. `gh issue edit <n> --add-label claude-wip`
2. Comment on the issue: `Claimed by the cloud issue loop at <UTC timestamp>. Branch: <branch>.`
3. Branch name: `feat/<n>-<slug>` or `fix/<n>-<slug>`. If a remote branch `*/<n>-*` already exists
   with no open PR, it is an earlier attempt: check it out and **continue** it. Add commits on
   top; never force-push, never rewrite or drop commits you did not make. Otherwise branch from
   `origin/<base>`.

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
5. Verify with the same commands CI runs. All must pass:
   ```bash
   npm ci && npm run check:links && npm run build && npm test && npm run typecheck && npm run build -w @lila-modeler/web
   ```
   If one fails, fix it and rerun from the start. Stop after **5** failed rounds, or after about
   **2 hours** of wall-clock time (check `date`), and deliver what you have as a draft PR marked
   "incomplete" with the failures.
   Never weaken, skip or delete a test to get green.
6. Adversarial QA: a subagent with fresh context reviews the diff and tries to break it
   (boundaries, stable contracts such as `E-*`/`W-*` codes and Bizagi column names, determinism,
   persistence round trips, missing translations, comments that describe behavior the code
   doesn't have). Fix what it finds and verify again.

## 4. Deliver

- Commit in English with a conventional prefix: `feat/fix/docs/chore/test/ci(scope): summary`.
- Push the branch and open a **draft** PR against the item's base branch, labelled `claude-loop`.
  Use `Refs #<n>`, not `Closes`: the issue closes when the batch reaches `main`.
- PR body, in this order:
  - **Tested SHA** and the exact commands run, with results.
  - What changed, and how each acceptance criterion is met.
  - **Not verified here**: anything the cloud cannot run (desktop app, canvas interaction,
    other browsers). Say it plainly; do not mark it as checked.
  - Persistence evidence when the format changed (save → reopen → compare).
  - QA findings and how they were resolved.
  - Proposed CHANGELOG line.
  - Duration, verification rounds, errors and retries.
- QA comment on the PR (`CONTRIBUTING.md` merge gate):
  - Headless change (engine, CLI, MCP, format, docs) and QA passed: a comment that starts with
    `QA: OK`, followed by what QA checked.
  - Any UI change: a comment `QA pending local app check:` with the checklist from the issue.
    Never post `QA: OK` for UI that nobody saw running.
- On the issue: comment the PR link, then remove `claude-wip` and `claude-ok`. Do not close it.

## 5. Ambiguous or blocked

Don't guess. Comment the concrete question on the issue, replace `claude-ok` and `claude-wip`
with `needs-info`, and stop. Do the same if the change needs a product or architecture decision
the issue does not record, or a change to a stable contract (`CONTRIBUTING.md`).

## 6. Run log

End every run, including stops, with one comment on the queue issue:

`<UTC date> · #<n> or none · <PR link | stopped: reason> · <duration> · <verification rounds> · <errors/retries>`

The maintainer adds the observed cost next to it; this log is how the loop is evaluated.

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
