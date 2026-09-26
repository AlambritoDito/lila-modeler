# Releasing

How a version of Lila Modeler is cut and how the engine reaches npm. Owner-facing; kept out of the
public docs site (`INTERNAL` in `tools/build-docs.mjs`).

## What is published

| Package | npm | Notes |
| --- | --- | --- |
| `@lila-modeler/engine` | public | Engine library and the `lila` CLI |
| `@lila-modeler/mcp`, `@lila-modeler/web`, `@lila-modeler/desktop` | private | Not published |

- Registry: <https://www.npmjs.com/package/@lila-modeler/engine>. The `@lila-modeler` npm org is
  owned by the maintainer's account. The `@lila` scope belongs to another npm account: do not go
  back to it. Changelog entries before 1.0.0-beta.9 and `docs/releases/` keep the old names on purpose.
- Install: `npm install -g @lila-modeler/engine` (or `npx -p @lila-modeler/engine lila --help`;
  `npx lila --version` hands `--version` to npx, not to `lila`).
- First publications: 1.0.0-beta.9 by hand (2026-09-26), 1.0.0-beta.11 from GitHub Actions with
  provenance (same day).

## Cutting a version

1. Every batch that reaches `main` bumps the version in the six places that
   `release.yml` checks, plus `CHANGELOG.md`:
   `packages/engine/package.json`, `packages/mcp/package.json`, `apps/web/package.json`,
   `apps/desktop/package.json`, `packages/engine/src/version.ts`, `packages/mcp/src/server.ts`
   (and the internal `@lila-modeler/engine` dependency ranges; run `npm install` to refresh the lockfile).
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git tag -a v1.0.0-beta.N -m "v1.0.0-beta.N" <commit>
   git push origin v1.0.0-beta.N
   ```

   The tag push runs `release.yml`: version check, build, test, typecheck, `test:package` and a
   pack dry run. It never publishes to npm. The desktop workflow opens a draft GitHub Release.

## Publishing to npm

Publication is an explicit owner action from the **tag** (not `main`):

```bash
gh workflow run release.yml --ref v1.0.0-beta.N -f publish_npm=true
```

or Actions → Release → Run workflow → pick the tag → tick `publish_npm`.

- Authentication is **npm trusted publishing (OIDC)**; no npm token is stored in the repository.
  On npmjs.com, `@lila-modeler/engine` → Settings → Trusted publishing trusts GitHub Actions
  `AlambritoDito/lila-modeler`, workflow `release.yml`, no environment, with **Allow npm publish**
  ticked. Renaming the workflow file or adding an environment breaks publication until that
  connection is recreated (it cannot be edited).
- The job runs on Node 24 because trusted publishing needs npm >= 11.5.1.
- `--provenance` attaches a signed SLSA statement. Check it with `npm audit signatures` in a
  project that installs the package.
- Prereleases (`1.0.0-beta.N`) go to the `beta` dist-tag; stable versions go to `latest`.

### Moving `latest` during the beta line

The workflow never moves `latest` for a prerelease. The package's very first publish set `latest`
to 1.0.0-beta.9. Until 1.0.0, point it at the newest beta by hand (npm asks for 2FA in the browser):

```bash
npm dist-tag add @lila-modeler/engine@1.0.0-beta.N latest
```

### Publishing by hand (fallback)

From a clean checkout of the tag, logged in with `npm login` (2FA through the browser):

```bash
npm publish -w @lila-modeler/engine --tag beta --access public --dry-run
npm publish -w @lila-modeler/engine --tag beta --access public
```

Read the dry run's warnings. npm 11 silently drops a `bin` entry whose path starts with `./`, and
without it the published package has no `lila` command. The package's `bin` is `bin/lila.js` for
that reason.

## Checking a publication

The registry can answer 404 for a minute or two after a publish.

```bash
npm view @lila-modeler/engine dist-tags --prefer-online
cd "$(mktemp -d)" && npm init -y >/dev/null && npm i @lila-modeler/engine@beta \
  && ./node_modules/.bin/lila --version && npm audit signatures
```
