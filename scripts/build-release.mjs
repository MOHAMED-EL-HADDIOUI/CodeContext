import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const root = process.cwd();
const wxtBin = path.join(root, 'node_modules', 'wxt', 'bin', 'wxt.mjs');
const outputDir = path.join(root, '.output', 'chrome-mv3');
const releaseDir = path.join(root, 'release');
const unpackedDir = path.join(releaseDir, 'codecontext-chrome-mv3');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zipName = `codecontext-v${pkg.version}-chrome-mv3.zip`;
const manifestName = `codecontext-v${pkg.version}-manifest.json`;
const checksumName = `codecontext-v${pkg.version}-SHA256SUMS.txt`;
const forbiddenPermissions = new Set([
  'cookies',
  'history',
  'debugger',
  'clipboardRead',
  'webRequest',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filesBelow(directory, prefix = '') {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? filesBelow(path.join(directory, entry.name), relative)
        : [relative];
    })
    .sort();
}

function verifyExtension(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert(manifest.manifest_version === 3, 'Release must use Manifest V3.');
  assert(
    manifest.version === pkg.version,
    `Manifest version ${manifest.version} does not match package ${pkg.version}.`,
  );
  for (const permission of manifest.permissions ?? [])
    assert(!forbiddenPermissions.has(permission), `Forbidden permission: ${permission}`);
  const csp = manifest.content_security_policy?.extension_pages ?? '';
  assert(
    !csp.includes("'unsafe-eval'") && !csp.includes("'unsafe-inline'"),
    `Insecure CSP: ${csp}`,
  );
  for (const permission of manifest.host_permissions ?? []) {
    const url = new URL(permission);
    assert(url.protocol === 'https:', `Non-HTTPS required host permission: ${permission}`);
  }
  for (const relative of Object.values(manifest.icons ?? {}))
    assert(fs.existsSync(path.join(directory, String(relative))), `Missing icon: ${relative}`);
  for (const relative of [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.options_ui?.page,
    manifest.action?.default_popup,
  ]) {
    assert(
      relative && fs.existsSync(path.join(directory, relative)),
      `Missing manifest entrypoint: ${relative}`,
    );
  }
  const files = filesBelow(directory);
  const sourceMaps = files.filter((file) => file.endsWith('.map'));
  assert(sourceMaps.length === 0, `Source maps must not be shipped: ${sourceMaps.join(', ')}`);
  let totalBytes = 0;
  for (const relative of files) {
    const filePath = path.join(directory, relative);
    totalBytes += fs.statSync(filePath).size;
    if (relative.endsWith('.js') || relative.endsWith('.html')) {
      const text = fs.readFileSync(filePath, 'utf8');
      assert(
        !/https?:\/\/localhost(?::\d+)?\/[^\s"']*\/dist\//.test(text),
        `Development server reference in ${relative}`,
      );
    }
  }
  assert(
    totalBytes <= 200 * 1024 * 1024,
    `Uncompressed release exceeds 200 MB: ${totalBytes} bytes.`,
  );
  assert(
    files.some((file) => /^assets\/sourceParser\.worker-.*\.js$/.test(file)),
    'Bundled parser worker is missing.',
  );
  for (const relative of [
    'wasm/tree-sitter.wasm',
    'wasm/tree-sitter-typescript.wasm',
    'wasm/tree-sitter-javascript.wasm',
    'onnx/ort-wasm-simd-threaded.jsep.mjs',
    'onnx/ort-wasm-simd-threaded.jsep.wasm',
  ]) {
    assert(
      fs.existsSync(path.join(directory, relative)),
      `Missing local runtime asset: ${relative}`,
    );
  }
  return { manifest, files };
}

if (process.argv.includes('--verify-only')) {
  const result = verifyExtension(outputDir);
  console.log(
    `Verified existing production build: ${result.manifest.version}, ${result.files.length} files.`,
  );
  process.exit(0);
}

execFileSync(process.execPath, [wxtBin, 'build'], { stdio: 'inherit' });
const { manifest, files } = verifyExtension(outputDir);
fs.rmSync(unpackedDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });
fs.cpSync(outputDir, unpackedDir, { recursive: true });
verifyExtension(unpackedDir);

execFileSync(process.execPath, [wxtBin, 'zip'], { stdio: 'inherit' });
const generatedZip = `codecontext-${pkg.version}-chrome.zip`;
assert(
  fs.existsSync(path.join(root, '.output', generatedZip)),
  `Expected WXT archive ${generatedZip} is missing.`,
);
const zipPath = path.join(releaseDir, zipName);
fs.copyFileSync(path.join(root, '.output', generatedZip), zipPath);
const entries = unzipSync(fs.readFileSync(zipPath));
assert(
  !Object.keys(entries).some(
    (entry) => entry.startsWith('/') || entry.split('/').some((part) => part === '..'),
  ),
  'ZIP contains unsafe paths.',
);
for (const relative of [
  'manifest.json',
  'sidepanel.html',
  'background.js',
  'wasm/tree-sitter.wasm',
  'wasm/tree-sitter-typescript.wasm',
  'onnx/ort-wasm-simd-threaded.jsep.mjs',
  'onnx/ort-wasm-simd-threaded.jsep.wasm',
]) {
  assert(entries[relative], `ZIP missing ${relative}`);
}
assert(
  JSON.parse(new TextDecoder().decode(entries['manifest.json'])).version === pkg.version,
  'ZIP manifest version mismatch.',
);

const checksum = (buffer) => createHash('sha256').update(buffer).digest('hex');
const checksums = `${checksum(fs.readFileSync(zipPath))}  ${zipName}\n`;
fs.writeFileSync(path.join(releaseDir, checksumName), checksums);
fs.writeFileSync(
  path.join(releaseDir, manifestName),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      createdAt: new Date().toISOString(),
      zip: zipName,
      sha256: checksum(fs.readFileSync(zipPath)),
      files: files.length,
      unpacked: 'codecontext-chrome-mv3',
      manifest: manifest,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Verified release: release/${zipName}`);
console.log(`Unpacked: release/codecontext-chrome-mv3/ (${files.length} files)`);
console.log(`SHA-256: ${checksum(fs.readFileSync(zipPath))}`);
