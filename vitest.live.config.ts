import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['tests/integration/liveIntegrations.test.ts'],
    testTimeout: 120000,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      '~': path.resolve(import.meta.dirname, '.'),
    },
  },
});
