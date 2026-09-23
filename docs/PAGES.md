# GitHub Pages demo

The live public address is `https://alambritodito.github.io/lila-modeler/`.
The landing page lives at that root and links to the app at `app/`. The owner authorized the first
publication on 2026-09-10. [Deployment](https://github.com/AlambritoDito/lila-modeler/actions/runs/34485464026)
succeeded for main `be0f695`; the public landing and editor returned HTTP 200. Real browser
acceptance passed: editing, both seed-42/30-replication simulations, comparison, explicit saving,
reload, discard of unsaved edits and reopening the downloaded project. English and Eva-01 remain
the defaults. Automatic publishing is still disabled; subsequent releases use manual dispatch.

## Build and preview

```bash
npm ci
npm run build:pages
```

The script builds the existing Vite app with `LILA_WEB_BASE=/lila-modeler/app/` and assembles
`_site/`: landing page, app, local fonts/themes, English screenshots and the rendered docs. The normal desktop/web
build retains its root base. To preview the real subpath, serve a directory containing a
`lila-modeler` link or copy of `_site`, then open `/lila-modeler/` on that server.

`tools/build-docs.mjs` renders every `.md` in `docs/`, `docs/es/` and `docs/releases/` to
`_site/docs/`, with an index at `docs/`. A new document is published by adding the file; to keep one
internal, add its name to `INTERNAL` in that script. `docs/design/**` is never published.

**Save project** downloads the complete project as a `.lila` file — the project folder zipped,
the same one the desktop app opens (see [project format](PROJECT_FORMAT.md)) — and stores a local
browser copy. Projects saved before that change, as `.lila.json`, still open.
Reload restores that saved model, draft scenarios, revisions and simulation results. Unsaved
changes are not autosaved. Storage failure does not prevent downloading; keep the download
as a portable backup. Clearing browser data removes the local copy.

## Publish an update (owner action)

1. Repository Settings → Pages is configured to use GitHub Actions.
2. Review the Pages workflow's uploaded artifact and the model/simulate/compare/save/reload flow.
3. Run the Pages workflow from `main` with **publish** selected.
4. To publish future pushes automatically, set repository variable `PAGES_PUBLISH_ENABLED=true`.
   Leave it unset to retain manual publication.

PRs and pushes build the artifact without publishing by default. Deployment uses the
`github-pages` environment with `pages: write` and `id-token: write`; build jobs only need
read access to repository contents. No npm token or backend server is required.

## Publishing from a release tag (owner action)

For a tagged release such as `v1.0.0-beta.1`, publish the landing and demo that match that exact
tag, rather than whatever is currently on `main`. This requires `pages.yml`'s `deploy` job to
accept `main` or a `v*` tag ref (workflow #382) and the `github-pages` environment to carry a tag
deployment policy of `v*` — both added by the owner/lead. The procedure:

1. **Publish the GitHub release first.** The landing's download button links straight to
   `releases/tag/v1.0.0-beta.1`; publish that (pre)release before publishing the site, so the
   button resolves the moment the page goes live instead of 404ing.
2. **Dispatch the workflow against the tag ref**, once the environment accepts tag deployments
   (requires the environment policy above):

   ```bash
   gh workflow run pages.yml --ref v1.0.0-beta.1 -f publish=true
   ```

3. **Verify the SHA before and after.** Note the tag's commit SHA (`git rev-parse v1.0.0-beta.1`)
   before dispatching. After the run finishes, compare it against the SHA recorded in the run's job
   summary (or `gh run view <run-id> --json headSha`) to confirm the site was built from that exact
   tag commit, not a later commit on `main`.
4. **Automatic publication on push to `main` stays gated** by the repository variable
   `PAGES_PUBLISH_ENABLED` (currently unset) — this tag-based procedure does not change that; both
   remain manual until the owner opts in.
