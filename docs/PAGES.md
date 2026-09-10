# GitHub Pages demo

The prepared public address is `https://alambritodito.github.io/lila-modeler/`.
The landing page lives at that root and links to the app at `app/`. Publication is not enabled
by adding the workflow: the deployment job requires a separate owner-controlled switch.

## Build and preview

```bash
npm ci
npm run build:pages
```

The script builds the existing Vite app with `LILA_WEB_BASE=/lila-modeler/app/` and assembles
`_site/`: landing page, app, local fonts/themes and English screenshots. The normal desktop/web
build retains its root base. To preview the real subpath, serve a directory containing a
`lila-modeler` link or copy of `_site`, then open `/lila-modeler/` on that server.

**Save project** downloads the complete `.lila.json` document and stores a local browser copy.
Reload restores that saved model, draft scenarios, revisions and simulation results. Unsaved
changes are not autosaved. Storage failure does not prevent downloading; keep the download
as a portable backup. Clearing browser data removes the local copy.

## First publication (owner action)

1. In repository Settings → Pages, choose GitHub Actions as the source.
2. Review the Pages workflow's uploaded artifact and the model/simulate/compare/save/reload flow.
3. Run the Pages workflow from `main` with **publish** selected.
4. To publish future pushes automatically, set repository variable `PAGES_PUBLISH_ENABLED=true`.
   Leave it unset to retain manual publication.

PRs and pushes build the artifact without publishing by default. Deployment uses the
`github-pages` environment with `pages: write` and `id-token: write`; build jobs only need
read access to repository contents. No npm token or backend server is required.
