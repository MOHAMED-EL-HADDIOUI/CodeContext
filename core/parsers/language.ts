const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  pyi: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'c',
  c: 'c',
  php: 'php',
  swift: 'swift',
  scala: 'scala',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  lua: 'lua',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  md: 'markdown',
  mdx: 'mdx',
  txt: 'plaintext',
  dockerfile: 'dockerfile',
  prisma: 'prisma',
  proto: 'protobuf',
  tf: 'hcl',
  ini: 'ini',
  env: 'dotenv',
};

const FILENAME_LANGUAGE_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmakelists: 'cmake',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  procfile: 'yaml',
  '.gitignore': 'plaintext',
  '.editorconfig': 'ini',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  'license': 'plaintext',
  'license.md': 'markdown',
  'readme': 'markdown',
};

export function getFileExtension(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  const lastDot = base.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return base.slice(lastDot + 1).toLowerCase();
}

export function detectLanguageFromPath(filePath: string): string {
  const base = (filePath.split('/').pop() ?? filePath).toLowerCase();
  if (FILENAME_LANGUAGE_MAP[base]) {
    return FILENAME_LANGUAGE_MAP[base];
  }
  if (base.startsWith('dockerfile.')) return 'dockerfile';
  const ext = getFileExtension(filePath);
  if (ext && EXTENSION_LANGUAGE_MAP[ext]) {
    return EXTENSION_LANGUAGE_MAP[ext];
  }
  return 'plaintext';
}

export function detectLanguageFromSnippet(snippet: string): string {
  const trimmed = snippet.trim();
  if (!trimmed) return 'plaintext';

  // JSON check
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not strict JSON; keep checking
    }
  }

  if (/^<!DOCTYPE html|<html[\s>]|<\/div>|<\/span>/i.test(trimmed)) return 'html';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|WITH)\b/im.test(trimmed)) return 'sql';
  if (/^\s*(def |class \w+\(|import \w+|from [\w.]+ import |async def )/m.test(trimmed)) {
    return 'python';
  }
  if (/^\s*(package \w+|func (\(\w+ \*?\w+\) )?\w+\()/m.test(trimmed)) return 'go';
  if (/^\s*(pub\s+)?(fn |struct |enum |impl |trait |use [\w:]+;)/m.test(trimmed)) return 'rust';
  if (
    /\b(interface\s+\w+|type\s+\w+\s*=|:\s*(string|number|boolean|Promise<|Record<))/.test(
      trimmed,
    )
  ) {
    return /<\w+[\s/>]/.test(trimmed) ? 'tsx' : 'typescript';
  }
  if (/\b(const |let |function |export default |import .+ from )/.test(trimmed)) {
    return /<\w+[\s/>]/.test(trimmed) ? 'jsx' : 'javascript';
  }
  if (/^\s*(public|private|protected)\s+(static\s+)?(class|interface|void|int|String)\b/m.test(trimmed)) {
    return 'java';
  }
  if (/^\s*(#!\/bin\/(ba)?sh|curl\s+|npm\s+|pnpm\s+|git\s+)/m.test(trimmed)) return 'bash';
  if (/^#{1,6}\s+.+/m.test(trimmed)) return 'markdown';

  return 'plaintext';
}

export function getShikiLanguage(language: string): string {
  const supported = new Set([
    'typescript',
    'tsx',
    'javascript',
    'jsx',
    'python',
    'go',
    'rust',
    'java',
    'kotlin',
    'csharp',
    'cpp',
    'c',
    'php',
    'ruby',
    'swift',
    'bash',
    'powershell',
    'sql',
    'graphql',
    'html',
    'css',
    'scss',
    'vue',
    'svelte',
    'json',
    'jsonc',
    'yaml',
    'toml',
    'xml',
    'markdown',
    'mdx',
    'dockerfile',
    'makefile',
    'ini',
  ]);
  return supported.has(language) ? language : 'text';
}
