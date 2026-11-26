import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Optional local secrets are loaded without printing or persisting them.
if (fs.existsSync('.env.test.local')) {
  for (const line of fs.readFileSync('.env.test.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run',
    '--config',
    'vitest.live.config.ts',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, CC_TEST_LIVE: '1' },
  },
);
process.exit(result.status ?? 1);
