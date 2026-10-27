/**
 * Assembles the GitHub Pages site in `_site/` (#704): the landing (`site/`), the rendered docs,
 * the screenshots, the branding exports and two builds of the web app.
 *
 * - `_site/beta/`: the web app built from the checked-out tree (`main` in CI) with
 *   `LILA_WEB_BASE=/lila-modeler/beta/`. Its storage is kept apart from the stable app's
 *   (`apps/web/src/channel.ts`).
 * - `_site/app/`: the stable web app, built from the latest GitHub Release's tag in a temporary
 *   `git worktree` with `LILA_WEB_BASE=/lila-modeler/app/`. The tag is GitHub's «latest» Release
 *   (no prereleases, no drafts); while there is none, the newest published prerelease.
 * - `_site/versions.json`: `{ stable: { version, tag, sha, downloads? }, beta: { version, sha } }`,
 *   read by the landing (`site/landing.js`). `downloads` holds the `.dmg` and `.exe` URLs of the
 *   stable Release when `gh` can list its assets.
 *
 * Usage:
 *
 *   node tools/build-pages.mjs                          # stable tag from `gh` (CI: GH_TOKEN)
 *   node tools/build-pages.mjs --stable-tag v1.0.0-beta.26
 *   LILA_STABLE_TAG=v1.0.0-beta.26 node tools/build-pages.mjs
 *   node tools/build-pages.mjs --stable-tag HEAD        # both apps from the working tree
 *
 * `--stable-tag` (or `LILA_STABLE_TAG`) skips `gh` and the network for picking the tag: use it for
 * local runs. Any git ref works; one that names the checked-out commit (`HEAD`) builds the stable
 * app from the working tree itself, uncommitted changes included, which is what `check:pwa` and the
 * `e2e-*.mjs` scripts need to test the code in front of you at `/lila-modeler/app/`. A tag missing
 * from a shallow clone is fetched from `origin`.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { buildDocs } from './build-docs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '_site');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const REPO = 'https://github.com/AlambritoDito/lila-modeler';

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.stdio !== 'inherit') process.stderr.write(result.stderr ?? '');
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`);
  }
  return (result.stdout ?? '').trim();
}

/** `gh … --json` parsed, or `null` when `gh` is missing, unauthenticated or offline. */
function gh(args) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function stableTagOption() {
  const i = process.argv.indexOf('--stable-tag');
  if (i !== -1) {
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error('--stable-tag needs a tag, e.g. --stable-tag v1.0.0-beta.26');
    return value;
  }
  const flag = process.argv.find((a) => a.startsWith('--stable-tag='));
  return flag ? flag.slice('--stable-tag='.length) : process.env.LILA_STABLE_TAG || null;
}

/** GitHub's «latest» Release; while none exists, the newest published (non-draft) prerelease. */
function latestReleaseTag() {
  const latest = gh(['release', 'view', '--json', 'tagName']);
  if (latest?.tagName) return latest.tagName;
  const list = gh(['release', 'list', '--exclude-drafts', '--limit', '50', '--json', 'tagName,isDraft,publishedAt']);
  const newest = (list ?? []).filter((r) => !r.isDraft && r.publishedAt).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  if (newest) return newest.tagName;
  throw new Error('Cannot find the stable Release with `gh` (missing, not logged in, offline, or no published Release). '
    + 'Pass the tag: node tools/build-pages.mjs --stable-tag <tag> (or LILA_STABLE_TAG=<tag>).');
}

/** The commit `ref` names, fetching a tag that a shallow clone does not have yet. */
function commitOf(ref) {
  const sha = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
  if (sha.status === 0) return sha.stdout.trim();
  run('git', ['fetch', '--no-tags', '--depth=1', 'origin', `+refs/tags/${ref}:refs/tags/${ref}`], { stdio: 'inherit' });
  return run('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
}

const versionOf = (tree) => JSON.parse(readFileSync(path.join(tree, 'apps/web/package.json'), 'utf8')).version;

/** Builds the web app of `tree` at `base` and copies it to `dest`. */
function buildWeb(tree, base, dest) {
  run(NPM, ['run', 'build', '-w', '@lila-modeler/web'], { cwd: tree, stdio: 'inherit', env: { ...process.env, LILA_WEB_BASE: base } });
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(tree, 'apps/web/dist'), dest, { recursive: true });
}

/** The `.dmg` and `.exe` of the Release, when `gh` can list its assets. */
function downloadsOf(tag) {
  const assets = gh(['release', 'view', tag, '--json', 'assets'])?.assets ?? [];
  const url = (ext) => assets.find((a) => a.name.endsWith(ext))?.url;
  const downloads = { dmg: url('.dmg'), exe: url('.exe') };
  return downloads.dmg || downloads.exe ? downloads : undefined;
}

const stableTag = stableTagOption() ?? latestReleaseTag();
const stableSha = commitOf(stableTag);
const headSha = run('git', ['rev-parse', 'HEAD']);
console.log(`[pages] beta from ${headSha.slice(0, 7)}, stable from ${stableTag} (${stableSha.slice(0, 7)})`);

// Built into a staging folder first: `_site/` is only replaced once both apps have built.
const staging = mkdtempSync(path.join(tmpdir(), 'lila-pages-'));
try {
  buildWeb(root, '/lila-modeler/beta/', path.join(staging, 'beta'));

  let stableTree = root;
  let stableVersion;
  if (stableSha !== headSha) {
    stableTree = path.join(staging, 'stable-tree');
    run('git', ['worktree', 'add', '--detach', stableTree, stableSha], { stdio: 'inherit' });
  }
  try {
    if (stableTree !== root) run(NPM, ['ci', '--no-audit', '--no-fund'], { cwd: stableTree, stdio: 'inherit' });
    buildWeb(stableTree, '/lila-modeler/app/', path.join(staging, 'app'));
    stableVersion = versionOf(stableTree);
  } finally {
    if (stableTree !== root) run('git', ['worktree', 'remove', '--force', stableTree]);
  }

  const versions = {
    stable: { version: stableVersion, tag: stableTag, sha: stableSha },
    beta: { version: versionOf(root), sha: headSha },
  };
  const downloads = downloadsOf(stableTag);
  if (downloads) versions.stable.downloads = downloads;

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(path.join(root, 'site'), output, { recursive: true });
  cpSync(path.join(staging, 'app'), path.join(output, 'app'), { recursive: true });
  cpSync(path.join(staging, 'beta'), path.join(output, 'beta'), { recursive: true });
  cpSync(path.join(root, 'docs/design/en'), path.join(output, 'img'), { recursive: true });
  cpSync(path.join(root, 'docs/design/branding/web'), path.join(output, 'branding'), { recursive: true });
  writeFileSync(path.join(output, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`);
  buildDocs(root, output);
  console.log(`[pages] _site/versions.json: ${JSON.stringify(versions)}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
