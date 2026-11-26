import type { CodeSymbol, DependencyGraph, RepositoryFile, SymbolReference } from '../../types';
import { db, type CodeContextDB } from '../../services/storage/db';

export interface ReferenceOptions {
  repositoryId: string;
  symbolName: string;
  database?: CodeContextDB;
  limit?: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findSymbolReferencesInFile(file: RepositoryFile, symbolName: string): SymbolReference[] {
  if (!file.content || !symbolName.trim()) return [];
  const regex = new RegExp(`\\b${escapeRegExp(symbolName.trim())}\\b`, 'g');
  const references: SymbolReference[] = [];
  const lines = file.content.split(/\r?\n/);
  lines.forEach((text, index) => {
    regex.lastIndex = 0;
    if (!regex.test(text)) return;
    const relation = /^\s*(?:import|from)\s/.test(text) ? 'import' : 'reference';
    references.push({
      repositoryId: file.repositoryId,
      fileId: file.id,
      filePath: file.path,
      symbolName,
      startLine: index + 1,
      endLine: index + 1,
      excerpt: text.trim().slice(0, 400),
      relation,
      confidence: 'lexical',
    });
  });
  return references;
}

export async function findSymbolReferences(options: ReferenceOptions): Promise<SymbolReference[]> {
  const database = options.database ?? db;
  const name = options.symbolName.trim().replace(/^[#.]+/, '').split('.').pop() ?? '';
  if (!name) return [];
  const [symbols, files] = await Promise.all([
    database.symbols.where('[repositoryId+name]').equals([options.repositoryId, name]).toArray(),
    database.files.where('repositoryId').equals(options.repositoryId).filter((file) => file.indexed && Boolean(file.content)).toArray(),
  ]);
  const definitions: SymbolReference[] = symbols.filter((symbol) => !['import', 'export'].includes(symbol.kind)).map((symbol) => ({
    repositoryId: symbol.repositoryId, fileId: symbol.fileId, filePath: symbol.filePath,
    symbolName: symbol.parentSymbol ? `${symbol.parentSymbol}.${symbol.name}` : symbol.name,
    startLine: symbol.startLine, endLine: symbol.endLine,
    excerpt: symbol.signature ?? symbol.name, relation: 'definition', confidence: 'exact',
  }));
  const references = files.flatMap((file) => findSymbolReferencesInFile(file, name));
  const unique = new Map<string, SymbolReference>();
  for (const ref of [...definitions, ...references]) {
    const key = `${ref.filePath}:${ref.startLine}:${ref.relation}`;
    if (!unique.has(key)) unique.set(key, ref);
  }
  return [...unique.values()].sort((a, b) => a.relation === 'definition' ? -1 : b.relation === 'definition' ? 1 : a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine).slice(0, options.limit ?? 250);
}

export function resolveImportPath(fromPath: string, importName: string, files: RepositoryFile[]): RepositoryFile | null {
  if (!importName.startsWith('.') && !importName.startsWith('/')) return null;
  const baseParts = fromPath.split('/').slice(0, -1);
  if (importName.startsWith('/')) baseParts.length = 0;
  for (const segment of importName.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') baseParts.pop();
    else baseParts.push(segment);
  }
  const base = baseParts.join('/');
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`, `${base}.py`, `${base}.go`, `${base}.rs`, `${base}.java`, `${base}.kt`, `${base}.cs`, `${base}.vue`, `${base}.svelte`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/__init__.py`, `${base}/mod.rs`];
  const aliases = new Map<string, RepositoryFile>();
  for (const candidate of candidates) {
    const match = files.find((file) => file.path === candidate);
    if (match) return match;
    const simplified = candidate.replace(/\.(d\.)?(ts|tsx|js|jsx|mjs|cjs)$/, '');
    aliases.set(simplified, files.find((file) => file.path.replace(/\.(d\.)?(ts|tsx|js|jsx|mjs|cjs)$/, '') === simplified)!);
  }
  return [...aliases.values()].find(Boolean) ?? null;
}

export function buildDependencyGraph(files: RepositoryFile[], symbols: CodeSymbol[]): DependencyGraph {
  const indexedFiles = files.filter((file) => file.indexed);
  const nodes = new Map<string, DependencyGraph['nodes'][number]>();
  const edges: DependencyGraph['edges'] = [];
  const external = new Set<string>();
  for (const file of indexedFiles) {
    nodes.set(file.id, {
      id: file.id, path: file.path, language: file.language,
      symbolCount: symbols.filter((symbol) => symbol.fileId === file.id && symbol.kind !== 'import').length,
      inbound: 0, outbound: 0,
    });
  }
  for (const file of indexedFiles) {
    const imports = symbols.filter((symbol) => symbol.fileId === file.id && symbol.kind === 'import');
    for (const item of imports) {
      const target = resolveImportPath(file.path, item.name, indexedFiles);
      if (target) {
        edges.push({ id: `${file.id}->${target.id}:${item.name}`, source: file.id, target: target.id, importName: item.name, resolution: 'resolved' });
        nodes.get(file.id)!.outbound++;
        nodes.get(target.id)!.inbound++;
      } else {
        external.add(item.name);
      }
    }
  }
  return { nodes: [...nodes.values()], edges, external: [...external].sort() };
}

export async function getRepositoryDependencyGraph(repositoryId: string, database = db): Promise<DependencyGraph> {
  const [files, symbols] = await Promise.all([
    database.files.where('repositoryId').equals(repositoryId).toArray(),
    database.symbols.where('repositoryId').equals(repositoryId).toArray(),
  ]);
  return buildDependencyGraph(files, symbols);
}

export function findDefinitionAtPosition(file: RepositoryFile, symbols: CodeSymbol[], line: number, column: number): CodeSymbol | undefined {
  const text = file.content?.split(/\r?\n/)[line - 1] ?? '';
  const left = text.slice(0, Math.max(0, column));
  const right = text.slice(Math.max(0, column));
  const match = `${left.match(/[A-Za-z_$][\w$]*$/)?.[0] ?? ''}${right.match(/^[\w$]*/)?.[0] ?? ''}`;
  return symbols.find((symbol) => symbol.name === match && !['import', 'export'].includes(symbol.kind)) ?? symbols.find((symbol) => symbol.name === match);
}
