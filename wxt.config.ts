import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [
      tailwindcss(),
      {
        name: 'codecontext-local-onnx-runtime',
        writeBundle() {
          const runtime = path.resolve('node_modules/@huggingface/transformers/dist');
          const target = path.resolve('.output/chrome-mv3/onnx');
          fs.mkdirSync(target, { recursive: true });
          for (const file of [
            'ort-wasm-simd-threaded.jsep.mjs',
            'ort-wasm-simd-threaded.jsep.wasm',
          ]) {
            fs.copyFileSync(path.join(runtime, file), path.join(target, file));
          }
        },
      },
    ],
    optimizeDeps: {
      exclude: ['web-tree-sitter'],
    },
    build: {
      target: 'esnext',
      rolldownOptions: {
        external: [/ort-wasm-simd-threaded\.jsep\.wasm$/],
      },
    },
  }),
  manifest: {
    name: 'CodeContext',
    short_name: 'CodeContext',
    description:
      'Understand any GitHub codebase in Chrome. Explore symbols, search indexed code, and ask AI with verifiable line citations.',
    version: '1.0.0',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    permissions: ['storage', 'sidePanel', 'tabs', 'activeTab', 'scripting', 'contextMenus'],
    host_permissions: [
      'https://api.github.com/*',
      'https://raw.githubusercontent.com/*',
      'https://github.com/*',
    ],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: {
      default_title: 'CodeContext — Understand Any Codebase',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'open-sidepanel': {
        suggested_key: {
          default: 'Alt+Shift+C',
          mac: 'Alt+Shift+C',
        },
        description: 'Open CodeContext Side Panel',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
