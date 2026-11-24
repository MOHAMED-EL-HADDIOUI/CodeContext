import type { IndexingLimits } from '../../types';
import { getFileExtension } from './language';

const EXCLUDED_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.wxt',
  'coverage',
  'vendor',
  'third_party',
  'target',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  '.gradle',
  'Pods',
  'bin',
  'obj',
]);

const EXCLUDED_FILENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
  '.ds_store',
  'thumbs.db',
]);

const BINARY_OR_MEDIA_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'tiff',
  'svg',
  'avif',
  'mp3',
  'mp4',
  'wav',
  'ogg',
  'webm',
  'mov',
  'avi',
  'pdf',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'wasm',
  'exe',
  'dll',
  'so',
  'dylib',
  'o',
  'a',
  'class',
  'jar',
  'war',
  'pyc',
  'pyo',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'sqlite',
  'db',
  'bin',
  'dat',
  'psd',
  'ai',
  'sketch',
  'fig',
  'map',
]);

const GENERATED_PATTERNS = [
  /\.min\.(js|css|mjs)$/i,
  /\.bundle\.(js|css)$/i,
  /\.chunk\.(js|css)$/i,
  /\.generated\.\w+$/i,
  /\.pb\.(go|ts|js|py)$/i,
  /\.d\.ts\.map$/i,
  /\.snap$/i,
];

export interface FilterDecision {
  include: boolean;
  reason?: string;
}

export function shouldIndexFile(
  filePath: string,
  sizeBytes: number,
  limits: IndexingLimits,
): FilterDecision {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  const filename = (segments[segments.length - 1] ?? '').toLowerCase();

  // Check directory segments (exclude last segment which is filename)
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg && EXCLUDED_DIR_SEGMENTS.has(seg.toLowerCase())) {
      return { include: false, reason: `Excluded directory: ${seg}` };
    }
  }

  if (EXCLUDED_FILENAMES.has(filename)) {
    return { include: false, reason: `Excluded lockfile or system file: ${filename}` };
  }

  for (const pattern of GENERATED_PATTERNS) {
    if (pattern.test(filename)) {
      return { include: false, reason: 'Minified or generated artifact' };
    }
  }

  const ext = getFileExtension(normalized);
  if (ext && BINARY_OR_MEDIA_EXTENSIONS.has(ext)) {
    return { include: false, reason: `Binary or media extension: .${ext}` };
  }

  const maxBytes = limits.maxFileSizeKb * 1024;
  if (sizeBytes > maxBytes) {
    return {
      include: false,
      reason: `Exceeds file size limit (${Math.round(sizeBytes / 1024)} KB > ${limits.maxFileSizeKb} KB)`,
    };
  }

  if (sizeBytes === 0) {
    return { include: false, reason: 'Empty file' };
  }

  return { include: true };
}

export function computeFilePriority(filePath: string): number {
  const lower = filePath.toLowerCase();
  const base = lower.split('/').pop() ?? lower;

  // Highest priority: README and project manifests
  if (/^readme(\.\w+)?$/i.test(base)) return 1000;
  if (
    base === 'package.json' ||
    base === 'pyproject.toml' ||
    base === 'cargo.toml' ||
    base === 'go.mod' ||
    base === 'pom.xml' ||
    base === 'composer.json'
  ) {
    return 950;
  }

  // Architecture / top-level docs
  if (
    lower.startsWith('docs/') ||
    base === 'architecture.md' ||
    base === 'contributing.md' ||
    base === 'openapi.yaml' ||
    base === 'openapi.json' ||
    base === 'schema.prisma' ||
    base === 'schema.graphql'
  ) {
    return 850;
  }

  // Config files at root
  if (!lower.includes('/') && (base.endsWith('.json') || base.endsWith('.ts') || base.endsWith('.js') || base.endsWith('.toml') || base.endsWith('.yaml') || base.endsWith('.yml'))) {
    return 800;
  }

  // Source directories
  let score = 500;
  if (
    lower.startsWith('src/') ||
    lower.startsWith('lib/') ||
    lower.startsWith('app/') ||
    lower.startsWith('core/') ||
    lower.startsWith('services/') ||
    lower.startsWith('pkg/') ||
    lower.startsWith('internal/') ||
    lower.startsWith('cmd/')
  ) {
    score += 200;
  }

  // Entrypoints
  if (/^(index|main|app|server|client|router|routes|api|auth)\.\w+$/.test(base)) {
    score += 120;
  }

  // Tests and fixtures get slightly lower priority so core source is indexed first under file limits
  if (
    lower.includes('test') ||
    lower.includes('spec') ||
    lower.includes('__mocks__') ||
    lower.includes('fixture')
  ) {
    score -= 180;
  }

  // Prefer shallower paths slightly
  const depth = lower.split('/').length;
  score -= depth * 8;

  return score;
}

export function isLikelyBinaryContent(content: string): boolean {
  const sample = content.slice(0, 2000);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0) return true;
    if (code < 9 || (code > 13 && code < 32)) {
      nonPrintable++;
    }
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.1;
}
