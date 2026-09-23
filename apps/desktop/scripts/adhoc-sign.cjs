// electron-builder afterPack hook: seal the macOS bundle with an ad-hoc signature.
// No Developer ID is involved (see docs/BETA-MAC-GUIDE.md, unsigned beta): an ad-hoc seal only
// makes the bundle internally consistent so Gatekeeper reports "unidentified developer" (which
// "Open Anyway" can override) instead of "damaged" (which nothing can override).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
