import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { zipSync, strToU8 } from 'fflate';

const extensionPath = path.resolve(process.env.CC_EXTENSION_PATH || '.output/chrome-mv3');
if (!fs.existsSync(path.join(extensionPath, 'manifest.json')))
  throw new Error('Build the extension before capturing store assets.');
const destination = path.resolve('docs/store');
fs.mkdirSync(destination, { recursive: true });
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'codecontext-store-'));
let context;
try {
  const args = [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
  ];
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
      args,
    });
  } catch {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: true,
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
      args,
    });
  }
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = worker.url().split('/')[2];
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${id}/sidepanel.html`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Skip setup/i }).click();
  const archive = zipSync({
    'store-demo/src/auth.ts': strToU8(
      'export interface Credentials { token: string; }\nexport function validateCredentials(credentials: Credentials) {\n  return credentials.token.length > 8;\n}\n',
    ),
    'store-demo/src/server.ts': strToU8(
      "import { validateCredentials } from './auth';\nexport function startServer(credentials) {\n  return validateCredentials(credentials);\n}\n",
    ),
    'store-demo/README.md': strToU8(
      '# Authentication service\nLocal code exploration with verifiable evidence.',
    ),
  });
  await page.getByRole('button', { name: 'Add repository or local source' }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'store-demo.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(archive),
    });
  await page.getByRole('heading', { name: 'Ask store-demo' }).waitFor({ timeout: 20000 });
  await page.getByText('3 indexed', { exact: false }).waitFor();
  async function capture(name, setup) {
    await page.addStyleTag({
      content: `body { margin: 0 !important; width: 1280px !important; min-height: 800px !important; padding: 24px !important; background: #090b10 !important; } #root { width: 720px !important; height: 750px !important; max-width: 720px !important; border: 1px solid #334155; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px #0008; } body::after { content: attr(data-store-caption); position: fixed; left: 770px; top: 80px; width: 460px; color: #f1f5f9; font: 600 30px/1.35 system-ui; white-space: pre-line; } body::before { content: 'CodeContext  /  Local-first code intelligence'; position: fixed; left: 28px; top: 8px; color: #38bdf8; font: 600 13px system-ui; }`,
    });
    await page.evaluate(
      (caption) => document.body.setAttribute('data-store-caption', caption),
      {
        chat: 'Ask with evidence.\n\nMulti-repository retrieval, source citations, and explicit AI consent.',
        explorer:
          'Understand the code.\n\nAST symbols, source lines, and dependency navigation in your browser.',
        search:
          'Search without an API key.\n\nLocal lexical, symbol, import, and optional vector retrieval.',
        settings:
          'Your code. Your choices.\n\nLocal storage, session credentials, and explicit transmission controls.',
      }[name],
    );
    await setup();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(destination, `${name}.png`) });
  }
  await capture('chat', async () => {
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
  });
  await capture('explorer', async () => {
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
  });
  await capture('search', async () => {
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByLabel('Search repository code').fill('validateCredentials');
    await page
      .getByText(/src\/auth\.ts/)
      .first()
      .waitFor();
  });
  await capture('settings', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'AI Provider' }).waitFor();
  });
  console.log(`Store screenshots written to ${destination}`);
} finally {
  if (context) await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
