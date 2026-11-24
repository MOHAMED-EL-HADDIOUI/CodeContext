import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, '.output', 'chrome-mv3');
const RELEASE_DIR = path.join(ROOT, 'release');
const UNPACKED_RELEASE = path.join(RELEASE_DIR, 'codecontext-chrome-mv3');

if (!fs.existsSync(path.join(OUTPUT_DIR, 'manifest.json'))) {
  console.error('Build output missing. Run "pnpm run build" first.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'manifest.json'), 'utf8'));

// Security verification on built manifest
const perms = manifest.permissions ?? [];
const forbiddenPerms = ['cookies', 'history', 'debugger', 'clipboardRead', 'webRequest'];
for (const fp of forbiddenPerms) {
  if (perms.includes(fp)) {
    throw new Error(`Security check failed: forbidden permission "${fp}" present in manifest.json`);
  }
}
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (csp.includes("'unsafe-eval'") || csp.includes("'unsafe-inline'")) {
  throw new Error(`Security check failed: insecure CSP directive in manifest.json: ${csp}`);
}
for (const [size, relPath] of Object.entries(manifest.icons ?? {})) {
  const full = path.join(OUTPUT_DIR, String(relPath));
  if (!fs.existsSync(full)) {
    throw new Error(`Manifest icon check failed: missing ${size}px icon at ${relPath}`);
  }
}

fs.rmSync(UNPACKED_RELEASE, { recursive: true, force: true });
fs.mkdirSync(RELEASE_DIR, { recursive: true });
fs.cpSync(OUTPUT_DIR, UNPACKED_RELEASE, { recursive: true });

// Build zip archive via WXT zip and copy into release/
execSync('pnpm exec wxt zip', { stdio: 'inherit' });
const outputFiles = fs.readdirSync(path.join(ROOT, '.output')).filter((f) => f.endsWith('.zip'));
for (const zipFile of outputFiles) {
  const targetName = `codecontext-v${pkg.version}-chrome-mv3.zip`;
  fs.copyFileSync(path.join(ROOT, '.output', zipFile), path.join(RELEASE_DIR, targetName));
  console.log(`Packaged ZIP: release/${targetName}`);
}

console.log(`Unpacked release ready at: release/codecontext-chrome-mv3/`);
console.log(`Manifest version: ${manifest.manifest_version}, Version: ${manifest.version}`);
console.log(`Permissions: ${perms.join(', ')}`);
