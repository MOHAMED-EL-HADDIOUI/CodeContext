import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const EXTENSION_PATH = path.resolve(process.cwd(), '.output', 'chrome-mv3');
const SCREENSHOT_DIR = process.env.CC_SCREENSHOT_DIR || '';

async function saveShot(page, name) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

async function assertNoSeriousA11y(page, label) {
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

    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        args: launchArgs,
      });
    } catch {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: true,
        args: launchArgs,
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

    // 1. Side Panel — Onboarding
    const sidepanel = await context.newPage();
    await sidepanel.setViewportSize({ width: 420, height: 780 });
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'networkidle',
    });

    await sidepanel.getByRole('heading', { name: /Welcome to CodeContext/i }).waitFor({ timeout: 8000 });
    await saveShot(sidepanel, '01-onboarding');
    await assertNoSeriousA11y(sidepanel, 'Onboarding');

    // 2. Main Side Panel — Chat
    await sidepanel.getByRole('button', { name: /Skip setup/i }).click();
    await sidepanel.getByRole('navigation', { name: 'Primary navigation' }).waitFor({ timeout: 5000 });
    await sidepanel.waitForTimeout(220);
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
    const themeAttr = await sidepanel.evaluate(() => document.documentElement.getAttribute('data-theme'));
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
    await popup.getByRole('button', { name: /Open CodeContext Side Panel/i }).waitFor({ timeout: 5000 });
    await saveShot(popup, '06-popup');
    await assertNoSeriousA11y(popup, 'Popup');

    // 6. Options page
    const options = await context.newPage();
    await options.setViewportSize({ width: 1024, height: 820 });
    await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle' });
    await options.getByRole('heading', { name: /CodeContext Settings/i }).waitFor({ timeout: 5000 });
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
