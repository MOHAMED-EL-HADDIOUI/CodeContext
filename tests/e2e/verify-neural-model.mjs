import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

if (process.env.CC_TEST_MODEL_DOWNLOAD !== '1') {
  console.log(
    'Skipped browser neural-model probe. Set CC_TEST_MODEL_DOWNLOAD=1 to permit the download.',
  );
  process.exit(0);
}
const root = path.resolve(process.env.CC_EXTENSION_PATH || '.output/chrome-mv3');
const chunk = fs
  .readdirSync(path.join(root, 'chunks'))
  .find((name) => name.startsWith('transformers.web-') && name.endsWith('.js'));
if (!chunk) throw new Error('Bundled Transformers.js runtime not found.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'codecontext-neural-'));
let context;
const modelId = 'Xenova/all-MiniLM-L6-v2';
async function launch() {
  const args = [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox'];
  try {
    return await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args,
    });
  } catch {
    return await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: true,
      args,
    });
  }
}
async function openPage(browser) {
  let [worker] = browser.serviceWorkers();
  if (!worker) worker = await browser.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);
  page.on('console', (message) => console.log(`[neural ${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => console.error('[neural page error]', error.message));
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/sidepanel.html`, {
    waitUntil: 'networkidle',
  });
  return page;
}
async function embed(page, allowNetwork) {
  return page.evaluate(
    async ({ path: modulePath, allowNetwork, modelId }) => {
      const { env, pipeline } = await import(modulePath);
      env.allowRemoteModels = allowNetwork;
      env.allowLocalModels = !allowNetwork;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.wasmPaths = '/onnx/';
      env.backends.onnx.wasm.proxy = false;
      env.backends.onnx.wasm.numThreads = 1;
      const extractor = await pipeline('feature-extraction', modelId, {
        device: 'wasm',
        dtype: 'q8',
      });
      const vector = await extractor('function validates credentials', {
        pooling: 'mean',
        normalize: true,
      });
      await extractor.dispose();
      return {
        dimensions: vector.data.length,
        finite: Array.from(vector.data).every(Number.isFinite),
      };
    },
    { path: `/chunks/${chunk}`, allowNetwork, modelId },
  );
}
try {
  context = await launch();
  let page = await openPage(context);
  const downloaded = await embed(page, true);
  if (downloaded.dimensions !== 384 || !downloaded.finite)
    throw new Error(`Unexpected browser vector: ${JSON.stringify(downloaded)}`);
  console.log(`Browser model download and real inference passed (${downloaded.dimensions}D).`);
  await context.close();
  context = await launch();
  await context.setOffline(true);
  page = await openPage(context);
  const cached = await embed(page, false);
  if (cached.dimensions !== 384 || !cached.finite)
    throw new Error(`Unexpected offline vector: ${JSON.stringify(cached)}`);
  console.log(
    `Cold browser restart with network offline and remote models disabled passed (${cached.dimensions}D cached inference).`,
  );
} finally {
  if (context) await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
