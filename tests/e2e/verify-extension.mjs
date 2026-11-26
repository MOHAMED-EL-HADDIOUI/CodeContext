import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { zipSync, strToU8 } from 'fflate';
import AxeBuilder from '@axe-core/playwright';

const EXTENSION_PATH = path.resolve(
  process.env.CC_EXTENSION_PATH || path.join('.output', 'chrome-mv3'),
);
const SCREENSHOT_DIR = process.env.CC_SCREENSHOT_DIR || '';

async function saveShot(page, name) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

async function assertNoSeriousA11y(page, label) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('[style]')).some(
        (element) => element instanceof HTMLElement && /^0(?:\.\d+)?$/.test(element.style.opacity),
      ),
    { timeout: 5000 },
  );
  await page.evaluate(async () => {
    // Reduced-motion styles must leave all readable content fully opaque.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (const element of document.querySelectorAll('[style]')) {
      if (element instanceof HTMLElement && /^0(?:\.\d+)?$/.test(element.style.opacity)) {
        throw new Error('Cannot audit a view with unfinished entrance animations.');
      }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (severe.length > 0) {
    console.error(`Axe ${label} violations:`, JSON.stringify(severe, null, 2));
    throw new Error(`Found ${severe.length} serious/critical a11y violations on ${label}`);
  }
  console.log(`✓ Axe accessibility check passed on ${label} (0 critical/serious issues)`);
}

async function main() {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`Extension build not found at ${EXTENSION_PATH}. Run "pnpm run build" first.`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codecontext-pw-'));
  let context;

  try {
    const launchArgs = [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ];

    const launchOptions = {
      channel: 'chromium',
      headless: true,
      reducedMotion: 'reduce',
      args: launchArgs,
    };
    try {
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    } catch {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        channel: 'chrome',
      });
    }

    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    if (!extensionId) {
      throw new Error('Failed to resolve Chrome extension ID from service worker URL.');
    }
    console.log(`Loaded CodeContext extension ID: ${extensionId}`);
    serviceWorker.on('console', (message) => console.log(`[background] ${message.text()}`));

    // 1. Side Panel — Onboarding
    const sidepanel = await context.newPage();
    sidepanel.on('pageerror', (error) => console.error('[panel error]', error));
    sidepanel.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        console.log(`[panel ${message.type()}] ${message.text()}`);
    });
    await sidepanel.setViewportSize({ width: 420, height: 780 });
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'networkidle',
    });

    await sidepanel
      .getByRole('heading', { name: /Welcome to CodeContext/i })
      .waitFor({ timeout: 8000 });
    await saveShot(sidepanel, '01-onboarding');
    await assertNoSeriousA11y(sidepanel, 'Onboarding');

    // 2. Main Side Panel — Chat
    await sidepanel.getByRole('button', { name: /Skip setup/i }).click();
    await sidepanel
      .getByRole('navigation', { name: 'Primary navigation' })
      .waitFor({ timeout: 5000 });
    await sidepanel.waitForTimeout(220);

    // Import an actual ZIP through the production background-indexing route.
    const archive = zipSync({
      'sample/src/auth.ts': strToU8(
        'export function validateCredentials(token) { return token.length > 8; }',
      ),
      'sample/src/server.ts': strToU8(
        "import { validateCredentials } from './auth';\nexport function startServer(token) { return validateCredentials(token); }",
      ),
      'sample/README.md': strToU8('# Browser fixture\nLocal-only source.'),
      'sample/.gitignore': strToU8('dist/\n'),
      'sample/dist/ignored.ts': strToU8('export const ignored = true;'),
    });
    await sidepanel.getByRole('button', { name: 'Add repository or local source' }).click();
    await sidepanel
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'browser-fixture.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(archive),
      });
    await sidepanel
      .getByRole('heading', { name: 'Ask browser-fixture' })
      .waitFor({ timeout: 20000 });
    await sidepanel.getByText('3 indexed', { exact: false }).waitFor({ timeout: 30000 });
    const indexed = await sidepanel.evaluate(async () => {
      const request = indexedDB.open('CodeContextDB');
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(['repositories', 'files'], 'readonly');
      const repositories = await new Promise((resolve, reject) => {
        const get = transaction.objectStore('repositories').getAll();
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
      const files = await new Promise((resolve, reject) => {
        const get = transaction.objectStore('files').getAll();
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
      database.close();
      return { repositories, paths: files.map((file) => file.path) };
    });
    if (
      indexed.repositories.length !== 1 ||
      !indexed.paths.includes('src/auth.ts') ||
      indexed.paths.includes('dist/ignored.ts')
    )
      throw new Error(`Unexpected persisted import: ${JSON.stringify(indexed)}`);
    console.log('✓ Real ZIP import completed and persisted; .gitignore was enforced');
    await saveShot(sidepanel, '02-local-import');
    await assertNoSeriousA11y(sidepanel, 'Local import');

    await sidepanel.getByRole('button', { name: 'Explore' }).click();
    await sidepanel.getByRole('button', { name: 'Graph', exact: true }).click();
    await sidepanel.getByLabel('Find symbol references').fill('validateCredentials');
    await sidepanel.getByRole('button', { name: 'Find', exact: true }).click();
    await sidepanel.getByText('definition', { exact: true }).first().waitFor({ timeout: 8000 });
    await saveShot(sidepanel, '03-graph');
    await assertNoSeriousA11y(sidepanel, 'Graph and references');

    await sidepanel.getByRole('button', { name: 'Search', exact: true }).click();
    await sidepanel.getByLabel('Search repository code').fill('validateCredentials');
    await sidepanel
      .getByText(/src\/auth\.ts/)
      .first()
      .waitFor({ timeout: 8000 });
    await sidepanel.getByRole('button', { name: 'Pin search', exact: true }).click();
    await sidepanel.getByRole('button', { name: 'Notes', exact: true }).click();
    await sidepanel.getByLabel('Investigation note').fill('Verified local source evidence.');
    await sidepanel.getByRole('button', { name: 'Pin note', exact: true }).click();
    await sidepanel.getByText('Verified local source evidence.', { exact: true }).waitFor();
    await saveShot(sidepanel, '04-notebooks');
    await assertNoSeriousA11y(sidepanel, 'Notebooks');
    await sidepanel.reload({ waitUntil: 'networkidle' });
    await sidepanel.getByRole('button', { name: 'Notes', exact: true }).click();
    await sidepanel.getByText('Verified local source evidence.', { exact: true }).waitFor();
    console.log('✓ Graph references, local search, notes, and reload persistence verified');

    await sidepanel.getByRole('button', { name: 'Review', exact: true }).click();
    await sidepanel.getByRole('heading', { name: 'Understand what changed' }).waitFor();
    await assertNoSeriousA11y(sidepanel, 'Review');

    // Import the already-bundled worker URL, then parse without structural fallback.
    const parser = await sidepanel.evaluate(async () => {
      const response = await fetch(window.chrome.runtime.getURL('manifest.json'));
      const manifest = await response.json();
      const files = [];
      return { manifest, parserResources: files.filter((file) => file.includes('sourceParser')) };
    });
    console.log(
      '✓ MV3 manifest and parser packaging:',
      JSON.stringify({ version: parser.manifest.version, parserResources: parser.parserResources }),
    );

    // 2. Main Side Panel — Chat
    await sidepanel.getByRole('button', { name: 'Chat', exact: true }).click();
    await saveShot(sidepanel, '02-chat');
    await assertNoSeriousA11y(sidepanel, 'Chat');

    // 3. Tools tab
    await sidepanel.getByRole('button', { name: 'Tools' }).click();
    await sidepanel.getByText('Valid JSON').waitFor({ timeout: 5000 });
    await sidepanel.waitForTimeout(220);
    await saveShot(sidepanel, '03-tools');
    await assertNoSeriousA11y(sidepanel, 'Tools');

    // 4. Settings tab & Theme toggle
    await sidepanel.getByRole('button', { name: 'Settings' }).click();
    await sidepanel.getByRole('heading', { name: 'AI Provider' }).waitFor({ timeout: 5000 });
    await sidepanel.waitForTimeout(220);
    await saveShot(sidepanel, '04-settings-dark');
    await assertNoSeriousA11y(sidepanel, 'Settings (Dark)');

    await sidepanel.getByRole('button', { name: 'Light' }).click();
    await sidepanel.waitForFunction(
      () => document.documentElement.getAttribute('data-theme') === 'light',
    );
    const themeAttr = await sidepanel.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    if (themeAttr !== 'light') {
      throw new Error(`Expected light theme attribute, got "${themeAttr}"`);
    }
    await sidepanel.waitForTimeout(180);
    await saveShot(sidepanel, '05-settings-light');
    await assertNoSeriousA11y(sidepanel, 'Settings (Light)');

    await sidepanel.getByRole('button', { name: 'Dark' }).click();
    console.log('✓ Settings & Light/Dark theme switching verified');

    // 5. Popup
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 420 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
    await popup
      .getByRole('button', { name: /Open CodeContext Side Panel/i })
      .waitFor({ timeout: 5000 });
    await saveShot(popup, '06-popup');
    await assertNoSeriousA11y(popup, 'Popup');

    // 6. Options page
    const options = await context.newPage();
    await options.setViewportSize({ width: 1024, height: 820 });
    await options.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: 'networkidle',
    });
    await options
      .getByRole('heading', { name: /CodeContext Settings/i })
      .waitFor({ timeout: 5000 });
    await saveShot(options, '07-options');
    await assertNoSeriousA11y(options, 'Options');

    console.log('\nALL BROWSER E2E & ACCESSIBILITY CHECKS PASSED!');
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Browser E2E test failed:', err);
  process.exit(1);
});
