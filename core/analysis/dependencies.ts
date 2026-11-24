import type { DependencyInfo, RepositoryFile } from '../../types';

export function extractDependenciesFromFiles(files: RepositoryFile[]): DependencyInfo[] {
  const deps: DependencyInfo[] = [];

  for (const file of files) {
    if (!file.content) continue;
    const base = (file.path.split('/').pop() ?? file.path).toLowerCase();

    if (base === 'package.json') {
      try {
        const parsed = JSON.parse(file.content) as Record<string, unknown>;
        const scopes: Array<'dependencies' | 'devDependencies' | 'peerDependencies'> = [
          'dependencies',
          'devDependencies',
          'peerDependencies',
        ];
        for (const scope of scopes) {
          const section = parsed[scope];
          if (section && typeof section === 'object' && !Array.isArray(section)) {
            for (const [name, version] of Object.entries(section as Record<string, unknown>)) {
              if (typeof version === 'string') {
                deps.push({ name, version, scope, sourceFile: file.path });
              }
            }
          }
        }
      } catch {
        // Invalid package.json — skip cleanly
      }
    } else if (base === 'requirements.txt') {
      const lines = file.content.split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('-')) continue;
        const match = line.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*([=<>!~]+.+)?$/);
        if (match && match[1]) {
          deps.push({
            name: match[1],
            version: match[2]?.trim() || '*',
            scope: 'python',
            sourceFile: file.path,
          });
        }
      }
    } else if (base === 'go.mod') {
      const lines = file.content.split(/\r?\n/);
      let inRequire = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (line.startsWith('require (')) {
          inRequire = true;
          continue;
        }
        if (inRequire && line === ')') {
          inRequire = false;
          continue;
        }
        const singleReq = line.match(/^require\s+(\S+)\s+(\S+)/);
        if (singleReq && singleReq[1] && singleReq[2]) {
          deps.push({
            name: singleReq[1],
            version: singleReq[2],
            scope: 'go',
            sourceFile: file.path,
          });
        } else if (inRequire && line && !line.startsWith('//')) {
          const parts = line.split(/\s+/);
          if (parts[0] && parts[1]) {
            deps.push({
              name: parts[0],
              version: parts[1],
              scope: 'go',
              sourceFile: file.path,
            });
          }
        }
      }
    } else if (base === 'cargo.toml') {
      const lines = file.content.split(/\r?\n/);
      let inDeps = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (line.startsWith('[')) {
          inDeps = /^\[(dev-|build-)?dependencies\]$/i.test(line);
          continue;
        }
        if (!inDeps || !line || line.startsWith('#')) continue;
        const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/);
        if (match && match[1]) {
          deps.push({
            name: match[1],
            version: match[2] ?? match[3] ?? '*',
            scope: 'rust',
            sourceFile: file.path,
          });
        }
      }
    }
  }

  return deps;
}
