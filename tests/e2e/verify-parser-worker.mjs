import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(process.cwd(), '.output/chrome-mv3');
const worker = fs.readdirSync(path.join(root, 'assets')).find((name) => /^sourceParser\.worker-.*\.js$/.test(name) && fs.statSync(path.join(root, 'assets', name)).size > 200000);
if (!worker) throw new Error('Bundled parser worker not found.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'codecontext-parser-'));
let context;
try {
  const args = [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox'];
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args });
  } catch {
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, args });
  }
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = serviceWorker.url().split('/')[2];
  const page = await context.newPage();
  page.on('console', (message) => console.log('Browser:', message.text()));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async (asset) => {
    const worker = new Worker(window.chrome.runtime.getURL(`assets/${asset}`), { type: 'module' });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Parser worker timed out.')); }, 20000);
      worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
      worker.onmessage = (event) => { clearTimeout(timeout); worker.terminate(); resolve(event.data); };
      worker.postMessage({ id: 1, repositoryId: 'probe', fileId: 'probe::auth.ts', filePath: 'auth.ts', language: 'typescript', content: 'export interface Credentials { token: string; }\nexport function validateCredentials(credentials: Credentials) { return credentials.token.length > 8; }' });
    });
  }, worker);
  console.log(JSON.stringify(result, null, 2));
  const symbol = result.symbols.find((item) => item.name === 'validateCredentials');
  if (result.parser !== 'tree-sitter' || !symbol) throw new Error('Tree-sitter did not produce the expected AST symbols.');
  if (!symbol.exported) throw new Error('Tree-sitter did not preserve the export modifier.');
  console.log('REAL TREE-SITTER WORKER PARSING PASSED');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
