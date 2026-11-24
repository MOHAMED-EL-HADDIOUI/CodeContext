import { describe, expect, it } from 'vitest';
import { extractDependenciesFromFiles } from '../../core/analysis/dependencies';
import { chunkSourceFile } from '../../core/chunking/chunker';
import { computeFilePriority, isLikelyBinaryContent, shouldIndexFile } from '../../core/parsers/filter';
import { detectLanguageFromPath, detectLanguageFromSnippet } from '../../core/parsers/language';
import { extractSymbols } from '../../core/symbols/extractor';
import type { IndexingLimits, RepositoryFile } from '../../types';

const LIMITS: IndexingLimits = {
  maxFiles: 250,
  maxFileSizeKb: 256,
  maxTotalSizeMb: 15,
  concurrency: 5,
};

describe('File filtering and language detection', () => {
  it('excludes vendor, node_modules, lockfiles, minified, binary, and oversized files', () => {
    expect(shouldIndexFile('node_modules/react/index.js', 500, LIMITS).include).toBe(false);
    expect(shouldIndexFile('dist/bundle.js', 500, LIMITS).include).toBe(false);
    expect(shouldIndexFile('package-lock.json', 5000, LIMITS).include).toBe(false);
    expect(shouldIndexFile('assets/logo.png', 1024, LIMITS).include).toBe(false);
    expect(shouldIndexFile('public/app.min.js', 1024, LIMITS).include).toBe(false);
    expect(shouldIndexFile('src/huge.ts', 512 * 1024, LIMITS).include).toBe(false);
    expect(shouldIndexFile('src/auth.service.ts', 2048, LIMITS).include).toBe(true);
  });

  it('prioritizes README and manifests ahead of test files', () => {
    expect(computeFilePriority('README.md')).toBeGreaterThan(computeFilePriority('src/index.ts'));
    expect(computeFilePriority('package.json')).toBeGreaterThan(computeFilePriority('tests/auth.test.ts'));
  });

  it('detects binary content accurately', () => {
    expect(isLikelyBinaryContent('const ok = "hello world";\n')).toBe(false);
    expect(isLikelyBinaryContent('ELF\u0000\u0001\u0002binary')).toBe(true);
  });

  it('detects languages from file paths and code snippets', () => {
    expect(detectLanguageFromPath('src/app.tsx')).toBe('tsx');
    expect(detectLanguageFromPath('Dockerfile')).toBe('dockerfile');
    expect(detectLanguageFromPath('backend/main.py')).toBe('python');
    expect(detectLanguageFromSnippet('def compute(x):\n    return x * 2')).toBe('python');
    expect(detectLanguageFromSnippet('export interface User { id: string; }')).toBe('typescript');
    expect(detectLanguageFromSnippet('{"key": "value"}')).toBe('json');
  });
});

describe('Symbol extraction and AST-aware chunking', () => {
  const sampleTs = [
    "import { verifyJwt } from './jwt';",
    '',
    'export interface AuthResult {',
    '  token: string;',
    '  userId: string;',
    '}',
    '',
    'export class AuthService {',
    '  async login(email: string): Promise<AuthResult> {',
    '    const token = verifyJwt(email);',
    '    return { token, userId: email };',
    '  }',
    '}',
    '',
    'export function formatUser(id: string): string {',
    '  return `user:${id}`;',
    '}',
  ].join('\n');

  it('extracts TypeScript imports, interfaces, classes, methods, and functions with exact lines', () => {
    const symbols = extractSymbols({
      repositoryId: 'r1',
      fileId: 'f1',
      filePath: 'src/auth.service.ts',
      language: 'typescript',
      content: sampleTs,
    });

    const names = symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain('import:./jwt');
    expect(names).toContain('interface:AuthResult');
    expect(names).toContain('class:AuthService');
    expect(names).toContain('method:login');
    expect(names).toContain('function:formatUser');

    const loginSym = symbols.find((s) => s.name === 'login');
    expect(loginSym?.parentSymbol).toBe('AuthService');
    expect(loginSym?.startLine).toBe(9);
    expect(loginSym?.endLine).toBe(12);
  });

  it('extracts Python classes and methods with indentation boundaries', () => {
    const py = [
      'import os',
      '',
      'class TokenStore:',
      '    def get(self, key):',
      '        return os.environ.get(key)',
      '',
      'def helper():',
      '    return True',
    ].join('\n');

    const symbols = extractSymbols({
      repositoryId: 'r1',
      fileId: 'f2',
      filePath: 'store.py',
      language: 'python',
      content: py,
    });

    expect(symbols.some((s) => s.kind === 'class' && s.name === 'TokenStore')).toBe(true);
    expect(symbols.some((s) => s.kind === 'method' && s.name === 'get' && s.parentSymbol === 'TokenStore')).toBe(true);
    expect(symbols.some((s) => s.kind === 'function' && s.name === 'helper')).toBe(true);
  });

  it('creates symbol-aware chunks preserving exact 1-based line numbers', () => {
    const longFileLines: string[] = [];
    for (let i = 0; i < 6; i++) {
      longFileLines.push(`export function fn${i}() {`);
      for (let j = 0; j < 20; j++) {
        longFileLines.push(`  const v${j} = ${i * 100 + j};`);
      }
      longFileLines.push('}');
    }
    const content = longFileLines.join('\n');
    const symbols = extractSymbols({
      repositoryId: 'r1',
      fileId: 'f3',
      filePath: 'src/long.ts',
      language: 'typescript',
      content,
    });
    const chunks = chunkSourceFile({
      repositoryId: 'r1',
      fileId: 'f3',
      filePath: 'src/long.ts',
      language: 'typescript',
      content,
      symbols,
      maxChunkLines: 30,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(6);
    const fn0Chunk = chunks.find((c) => c.symbolName === 'fn0');
    expect(fn0Chunk?.startLine).toBe(1);
    expect(fn0Chunk?.endLine).toBe(22);
    expect(fn0Chunk?.content.startsWith('export function fn0()')).toBe(true);
  });

  it('extracts dependencies from package.json and requirements.txt', () => {
    const files: RepositoryFile[] = [
      {
        id: '1',
        repositoryId: 'r1',
        path: 'package.json',
        name: 'package.json',
        extension: 'json',
        language: 'json',
        size: 100,
        sha: 's1',
        lineCount: 5,
        indexed: true,
        content: JSON.stringify({
          dependencies: { react: '^19.0.0' },
          devDependencies: { vitest: '^3.0.0' },
        }),
      },
      {
        id: '2',
        repositoryId: 'r1',
        path: 'requirements.txt',
        name: 'requirements.txt',
        extension: 'txt',
        language: 'plaintext',
        size: 40,
        sha: 's2',
        lineCount: 2,
        indexed: true,
        content: 'fastapi>=0.115.0\n# comment\nuvicorn==0.30.0',
      },
    ];
    const deps = extractDependenciesFromFiles(files);
    expect(deps).toHaveLength(4);
    expect(deps.some((d) => d.name === 'react' && d.scope === 'dependencies')).toBe(true);
    expect(deps.some((d) => d.name === 'fastapi' && d.scope === 'python')).toBe(true);
  });
});
