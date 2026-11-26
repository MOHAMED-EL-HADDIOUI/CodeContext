import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
    ],
    exclude: ['tests/e2e/**', 'tests/integration/liveIntegrations.test.ts', 'node_modules/**'],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      '~': path.resolve(import.meta.dirname, '.'),
    },
  },
});
