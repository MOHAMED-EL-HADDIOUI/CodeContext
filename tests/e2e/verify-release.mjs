import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { spawnSync } from 'node:child_process';

const release = path.resolve('release');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifestPath = path.join(release, `codecontext-v${packageJson.version}-manifest.json`);
if (!fs.existsSync(manifestPath))
  throw new Error('Release manifest missing. Run pnpm run release first.');
const releaseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const archive = path.join(release, releaseManifest.zip);
const actualHash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
if (actualHash !== releaseManifest.sha256)
  throw new Error('Release ZIP checksum does not match its manifest.');
const entries = unzipSync(fs.readFileSync(archive));
for (const required of [
  'manifest.json',
  'background.js',
  'sidepanel.html',
  'wasm/tree-sitter.wasm',
]) {
  if (!entries[required]) throw new Error(`Release ZIP missing ${required}.`);
}
const checksumPath = path.join(release, `codecontext-v${packageJson.version}-SHA256SUMS.txt`);
if (!fs.readFileSync(checksumPath, 'utf8').includes(actualHash))
  throw new Error('Release checksum file mismatch.');

for (const script of ['tests/e2e/verify-extension.mjs', 'tests/e2e/verify-parser-worker.mjs']) {
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: { ...process.env, CC_EXTENSION_PATH: path.join(release, 'codecontext-chrome-mv3') },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Packaged release, checksum, Chromium workflows, and AST parsing verified.');
