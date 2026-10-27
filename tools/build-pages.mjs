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
 * `--stable-tag` (or `LILA_STABLE_TAG`) picks the stable tag without asking `gh`: use it where `gh`
 * is missing or not logged in. A tag that the clone lacks is fetched from `origin`, and the
 * worktree's `npm ci` needs the npm registry (or a warm cache), so only `--stable-tag HEAD` runs
 * fully offline. A ref naming the checked-out commit (`HEAD`) builds the stable app from the
 * working tree itself, uncommitted changes included: that is what `check:pwa`, the `e2e-*.mjs`
 * scripts and the capture scripts need, since they test `/lila-modeler/app/`.
 */
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { buildDocs } from './build-docs.mjs';
import { downloadsFrom, isNoLatestRelease, newestPublished } from './pages-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '_site');
const REPO = process.env.GITHUB_REPOSITORY || 'AlambritoDito/lila-modeler';
// `npm.cmd` is a batch file: since Node 20.12 Windows only spawns it through a shell.
const NPM = process.platform === 'win32' ? { cmd: 'npm.cmd', shell: true } : { cmd: 'npm', shell: false };

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.stdio !== 'inherit') process.stderr.write(result.stderr ?? '');
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`);
  }
  return (result.stdout ?? '').trim();
}

const npm = (args, options) => run(NPM.cmd, args, { stdio: 'inherit', shell: NPM.shell, ...options });

/** `gh <args> --repo <REPO>`: `{ json }` on success, `{ error }` (its stderr) otherwise. */
function gh(args) {
  const result = spawnSync('gh', [...args, '--repo', REPO], { cwd: root, encoding: 'utf8' });
  if (result.error) return { error: String(result.error) };
  if (result.status !== 0) return { error: result.stderr ?? '' };
  try { return { json: JSON.parse(result.stdout) }; } catch { return { error: 'gh returned invalid JSON' }; }
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

const PASS_THE_TAG = 'Pass the tag: node tools/build-pages.mjs --stable-tag <tag> (or LILA_STABLE_TAG=<tag>).';

/**
 * GitHub's «latest» Release; while none exists, the newest published (non-draft) prerelease. Only
 * «release not found» falls back: any other failure (network, auth) stops the build, so a
 * transient error never publishes a prerelease as stable over a real Release.
 */
function latestReleaseTag() {
  const latest = gh(['release', 'view', '--json', 'tagName']);
  if (latest.json?.tagName) return latest.json.tagName;
  if (!isNoLatestRelease(latest.error)) {
    throw new Error(`Cannot ask gh for the latest Release of ${REPO}: ${latest.error?.trim()}. ${PASS_THE_TAG}`);
  }
  const list = gh(['release', 'list', '--exclude-drafts', '--limit', '50', '--json', 'tagName,isDraft,publishedAt']);
  if (list.error !== undefined) throw new Error(`Cannot list the Releases of ${REPO}: ${list.error.trim()}. ${PASS_THE_TAG}`);
  const newest = newestPublished(list.json);
  if (newest === null) throw new Error(`${REPO} has no published Release. ${PASS_THE_TAG}`);
  return newest;
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
  npm(['run', 'build', '-w', '@lila-modeler/web'], { cwd: tree, env: { ...process.env, LILA_WEB_BASE: base } });
  cpSync(path.join(tree, 'apps/web/dist'), dest, { recursive: true });
}

const stableTag = stableTagOption() ?? latestReleaseTag();
const stableSha = commitOf(stableTag);
const headSha = run('git', ['rev-parse', 'HEAD']);
const fromWorkingTree = stableSha === headSha;
console.log(`[pages] beta from ${headSha.slice(0, 7)}, stable from ${stableTag} (${stableSha.slice(0, 7)})`);

// Everything is assembled in a staging folder; `_site/` is replaced only once the whole site built.
run('git', ['worktree', 'prune']);
const staging = mkdtempSync(path.join(tmpdir(), 'lila-pages-'));
const site = path.join(staging, 'site');
try {
  cpSync(path.join(root, 'site'), site, { recursive: true });
  buildWeb(root, '/lila-modeler/beta/', path.join(site, 'beta'));

  let stableVersion;
  const stableTree = fromWorkingTree ? root : path.join(staging, 'stable-tree');
  if (!fromWorkingTree) run('git', ['worktree', 'add', '--detach', stableTree, stableSha], { stdio: 'inherit' });
  try {
    // The desktop app's Electron binary is not needed to build the web app.
    if (!fromWorkingTree) npm(['ci', '--no-audit', '--no-fund'], { cwd: stableTree, env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } });
    buildWeb(stableTree, '/lila-modeler/app/', path.join(site, 'app'));
    stableVersion = versionOf(stableTree);
  } finally {
    if (!fromWorkingTree) {
      try { run('git', ['worktree', 'remove', '--force', stableTree]); } catch (error) { console.warn(`[pages] worktree not removed: ${error.message}`); }
    }
  }

  const versions = {
    stable: { version: stableVersion, tag: stableTag, sha: stableSha },
    beta: { version: versionOf(root), sha: headSha },
  };
  // `--stable-tag HEAD` (or any ref that is not a tag) is not a Release: it has no installers to link.
  const isTag = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${stableTag}`], { cwd: root }).status === 0;
  const downloads = isTag ? downloadsFrom(gh(['release', 'view', stableTag, '--json', 'assets']).json?.assets) : undefined;
  if (downloads) versions.stable.downloads = downloads;

  cpSync(path.join(root, 'docs/design/en'), path.join(site, 'img'), { recursive: true });
  cpSync(path.join(root, 'docs/design/branding/web'), path.join(site, 'branding'), { recursive: true });
  writeFileSync(path.join(site, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`);
  buildDocs(root, site);

  rmSync(output, { recursive: true, force: true });
  try { renameSync(site, output); } catch { cpSync(site, output, { recursive: true }); }
  console.log(`[pages] _site/versions.json: ${JSON.stringify(versions)}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
