import { unzipSync } from 'fflate';
import type { IndexingLimits, RepositorySource } from '../../types';

export interface SourceFileInput {
  path: string;
  content: string;
  sha?: string;
}

export interface CollectedSource {
  name: string;
  source: Extract<RepositorySource, 'local-folder' | 'local-zip'>;
  files: SourceFileInput[];
}

interface IgnoreRule {
  pattern: RegExp;
  negated: boolean;
  basePath?: string;
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/** A focused .gitignore matcher supporting directory, glob, anchored and negated rules. */
export function compileGitIgnore(contents: string): IgnoreRule[] {
  return contents.split(/\r?\n/).flatMap((raw) => {
    let line = raw.trim();
    if (!line || line.startsWith('#')) return [];
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    const anchored = line.startsWith('/');
    const directory = line.endsWith('/');
    line = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!line) return [];
    let pattern = '';
    for (let index = 0; index < line.length; index++) {
      const char = line[index]!;
      if (char === '*') {
        const isDouble = line[index + 1] === '*';
        if (isDouble) index++;
        const isGlobstar = isDouble && line[index + 1] === '/';
        if (isGlobstar) index++;
        pattern += isGlobstar ? '(?:.*/)?' : isDouble ? '.*' : '[^/]*';
      } else if (char === '?') pattern += '[^/]';
      else if (char === '[') {
        const close = line.indexOf(']', index + 1);
        if (close !== -1) {
          const content = line.slice(index + 1, close);
          pattern += `[${content.startsWith('!') ? `^${content.slice(1)}` : content}]`;
          index = close;
        } else pattern += '\\[';
      } else pattern += escapeRegex(char);
    }
    const containsSlash = line.includes('/');
    pattern = `${anchored || containsSlash ? '^' : '(?:^|/)'}${pattern}${directory ? '(?:/|$)' : '(?:$|/)'}`;
    return [{ pattern: new RegExp(pattern), negated }];
  });
}

export function isIgnoredByGitIgnore(path: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const relativePath = rule.basePath ? (path === rule.basePath || path.startsWith(`${rule.basePath}/`) ? path.slice(rule.basePath.length).replace(/^\//, '') : null) : path;
    if (relativePath !== null && (rule.pattern.test(`/${relativePath}`) || rule.pattern.test(relativePath))) ignored = !rule.negated;
  }
  return ignored;
}

export function filterLocalSourceFiles(files: SourceFileInput[], limits: IndexingLimits): SourceFileInput[] {
  const ignoreRules = files.filter((file) => file.path.split('/').pop() === '.gitignore').flatMap((file) => {
    const basePath = file.path.split('/').slice(0, -1).join('/');
    return compileGitIgnore(file.content).map((rule) => ({ ...rule, basePath }));
  });
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const selected: SourceFileInput[] = [];
  let bytes = 0;
  for (const file of sorted) {
    if (!file.path || file.path.split('/').some((segment) => segment === '..' || segment === '.gitignore') || isIgnoredByGitIgnore(file.path, ignoreRules)) continue;
    const size = new TextEncoder().encode(file.content).byteLength;
    if (size > limits.maxFileSizeKb * 1024 || size === 0) continue;
    if (bytes + size > limits.maxTotalSizeMb * 1024 * 1024) continue;
    selected.push(file);
    bytes += size;
    if (selected.length >= limits.maxFiles) break;
  }
  return selected;
}

function decodeArchiveText(bytes: Uint8Array): string | null {
  if (bytes.some((byte) => byte === 0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function readZipSource(bytes: Uint8Array, name: string, maxTotalSizeMb = 100, maxEntries = 10000): SourceFileInput[] {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); }
  catch { throw new Error('This ZIP archive is corrupt or uses an unsupported compression format.'); }
  const paths = Object.keys(entries).filter((path) => path && !path.endsWith('/') && !path.split('/').some((segment) => segment === '..' || segment === ''));
  if (paths.length > maxEntries) throw new Error(`ZIP contains ${paths.length} files; the maximum is ${maxEntries}.`);
  const totalBytes = paths.reduce((total, path) => total + (entries[path]?.byteLength ?? 0), 0);
  if (totalBytes > maxTotalSizeMb * 1024 * 1024) throw new Error(`Expanded ZIP is larger than ${maxTotalSizeMb} MB. Choose a smaller archive.`);
  const firstSegments = new Set(paths.map((path) => path.split('/')[0]));
  const stripRoot = firstSegments.size === 1 && paths.every((path) => path.includes('/'));
  const root = stripRoot ? `${[...firstSegments][0]}/` : '';
  return paths.flatMap((originalPath) => {
    const path = originalPath.slice(root.length).replace(/^\/+/, '');
    const data = entries[originalPath];
    if (!path || !data || path.split('/').some((segment) => segment === '..' || segment === '')) return [];
    const content = decodeArchiveText(data);
    return content === null ? [] : [{ path, content }];
  }).map((file) => ({ ...file, path: file.path || name }));
}

export async function readDirectoryHandle(
  root: FileSystemDirectoryHandle,
  limits: IndexingLimits,
  onProgress?: (path: string, count: number) => void,
): Promise<SourceFileInput[]> {
  const files: SourceFileInput[] = [];
  let bytes = 0;
  async function readRules(directory: FileSystemDirectoryHandle, prefix: string): Promise<IgnoreRule[]> {
    try {
      if (!directory.getFileHandle) return [];
      const file = await (await directory.getFileHandle('.gitignore')).getFile();
      return compileGitIgnore(await file.text()).map((rule) => ({ ...rule, basePath: prefix.replace(/\/$/, '') || undefined }));
    } catch { return []; }
  }
  const rootRules = await readRules(root, '');
  async function visit(directory: FileSystemDirectoryHandle, prefix: string, inheritedRules: IgnoreRule[]): Promise<void> {
    const rules = prefix ? [...inheritedRules, ...await readRules(directory, prefix)] : inheritedRules;
    for await (const [name, handle] of directory.entries()) {
      if (files.length >= limits.maxFiles || bytes >= limits.maxTotalSizeMb * 1024 * 1024) return;
      const path = `${prefix}${name}`;
      if (isIgnoredByGitIgnore(handle.kind === 'directory' ? `${path}/` : path, rules)) continue;
      if (handle.kind === 'directory') {
        if (['.git', 'node_modules', 'dist', 'build', '.next', '.output', 'coverage', 'vendor', 'target'].includes(name)) continue;
        await visit(handle as FileSystemDirectoryHandle, `${path}/`, rules);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (file.size > limits.maxFileSizeKb * 1024 || file.size === 0) continue;
        if (bytes + file.size > limits.maxTotalSizeMb * 1024 * 1024) continue;
        const content = await file.text();
        if (content.includes('\0')) continue;
        files.push({ path, content });
        bytes += file.size;
        onProgress?.(path, files.length);
      }
    }
  }
  await visit(root, '', rootRules);
  return filterLocalSourceFiles(files, limits);
}

export function readFileList(files: FileList | File[], limits: IndexingLimits): Promise<SourceFileInput[]> {
  return (async () => {
    const collected: SourceFileInput[] = [];
    let bytes = 0;
    for (const file of Array.from(files)) {
      if (collected.length >= limits.maxFiles) break;
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (file.size > limits.maxFileSizeKb * 1024 || file.size === 0) continue;
      if (bytes + file.size > limits.maxTotalSizeMb * 1024 * 1024) continue;
      const content = await file.text();
      if (content.includes('\0')) continue;
      collected.push({ path: path.replace(/^[^/]+\//, (match) => path.includes('/') ? match : ''), content });
      bytes += file.size;
    }
    const firstRoot = collected[0]?.path.split('/')[0];
    const normalized = firstRoot && collected.every((file) => file.path.startsWith(`${firstRoot}/`))
      ? collected.map((file) => ({ ...file, path: file.path.slice(firstRoot.length + 1) }))
      : collected;
    return filterLocalSourceFiles(normalized, limits);
  })();
}
