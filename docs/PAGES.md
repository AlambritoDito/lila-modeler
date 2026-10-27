# GitHub Pages web app

The live public address is `https://alambritodito.github.io/lila-modeler/`.
The landing page lives at that root and links to two builds of the app (#704): the stable one at
`app/`, built from the latest GitHub Release, and the beta at `beta/`, built from `main`. The two
channels, the rule that picks the stable Release and how their storage is kept apart are described
in [RELEASING.md](RELEASING.md#the-web-app-on-github-pages-stable-and-beta). The owner authorized the first
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

The script builds the Vite app twice and assembles `_site/`: landing page, `beta/` (the checked-out
tree, `LILA_WEB_BASE=/lila-modeler/beta/`), `app/` (the stable Release's tag in a temporary
`git worktree`, `LILA_WEB_BASE=/lila-modeler/app/`), `versions.json`, local fonts/themes, English
screenshots and the rendered docs. It asks `gh` for the stable tag; where `gh` is missing or not
logged in, pass it: `npm run build:pages -- --stable-tag v1.0.0-beta.26` (or `LILA_STABLE_TAG`).
A tag the clone lacks is fetched from `origin` and the worktree runs `npm ci`, so that still needs
the network; only `--stable-tag HEAD` builds fully offline. The normal
desktop/web build retains its root base. To preview the real subpath, serve a directory containing
a `lila-modeler` link or copy of `_site`, then open `/lila-modeler/` on that server.

`check:pwa` and the `tools/e2e-*.mjs` scripts test `/lila-modeler/app/`. To point them at the code
in front of you instead of the last Release, build with `--stable-tag HEAD`: a ref that names the
checked-out commit builds the stable app from the working tree.

`tools/build-docs.mjs` renders every `.md` in `docs/`, `docs/es/` and `docs/releases/` to
`_site/docs/`, with an index at `docs/`. A new document is published by adding the file; to keep one
internal, add its name to `INTERNAL` in that script. `docs/design/**` is never published.

**Save project** downloads the complete project as a `.lila` file — the project folder zipped,
the same one the desktop app opens (see [project format](PROJECT_FORMAT.md)) — and stores a local
browser copy. Projects saved before that change, as `.lila.json`, still open.
Reload restores that saved model, draft scenarios, revisions and simulation results. Unsaved
changes are not autosaved. Storage failure does not prevent downloading; keep the download
as a portable backup. Clearing browser data removes the local copy.

In Chrome and Edge the same **Save** writes back to the `.lila` that was opened or last saved,
through the File System Access API, and the first save asks where with the system dialog; other
browsers download as described above (#573).

### Installable app (ADR-031)

The app is an installable Progressive Web App: `apps/web/manifest.webmanifest` (relative
`start_url`/`scope`, brand icons, a `.lila` file handler) is linked from `index.html`, and
`vite build` writes `sw.js`, a service worker that precaches the build under the cache
`lila-modeler-<version>-<hash of the built files>`, so any deploy that changes the app installs a
new worker (the version bump is still the project's rule for every batch). A new build is picked up
once every window of the old one has closed. Navigations and the files with fixed names (themes,
icons, manifest) go to the network first, Vite's hashed `assets/` come from the cache, and all of
it comes from the cache offline. Before asking someone to
test on Windows ([tester guide](WINDOWS-PWA-TESTER-GUIDE.md)), run

```bash
npm run build:pages -- --stable-tag HEAD && npm run check:pwa
```

which checks the manifest and installability over CDP, the service worker, save-in-place, the
offline start and the phone viewer in headless Chrome.

### Phone and tablet viewer (#653)

A phone (screen's short side under 600 CSS px) gets `Visor.tsx` instead of the editor: a read-only
bpmn-js viewer with finger pan and pinch zoom, a sheet with the tapped element's parameters, and
the heat map and KPIs of the last current run stored in the project. Tablets open it from View →
Viewer mode, any browser with `?visor`; «Full editor» links to `?editor` and «Report a problem…»
opens the same prefilled GitHub form as the editor (#651). It opens a `.lila` from the device's
files or an example and never writes the session, so a reload shows the editor's last saved
project. `check:pwa` drives it at 390×844 with touch emulation; opening a file from iCloud/Files
and the gestures on a real device are still a person's check.

## Publish an update (owner action)

1. Repository Settings → Pages is configured to use GitHub Actions.
2. Review the Pages workflow's uploaded artifact (its summary shows `versions.json`) and the
   model/simulate/compare/save/reload flow in both `app/` and `beta/`.
3. Run the Pages workflow from `main` with **publish** selected.
4. To publish future pushes to `main` and published Releases automatically, set repository
   variable `PAGES_PUBLISH_ENABLED=true`. Leave it unset to retain manual publication.

PRs, pushes and Releases build the artifact without publishing by default. A `release` event's
deployment runs from the tag's ref, so the `github-pages` environment must allow `v*` tags (as the
earlier tag-publishing procedure already required). Deployment uses the
`github-pages` environment with `pages: write` and `id-token: write`; build jobs only need
read access to repository contents. No npm token or backend server is required.

## Publishing from a release tag (superseded)

Until #704 the stable site was published by dispatching this workflow against a tag ref. That path
is gone: the site is always built from `main`, and `app/` comes from the latest Release by itself.
Publish the GitHub Release first, then run the workflow from `main` (or let the `release` event do
it once `PAGES_PUBLISH_ENABLED` is on).
