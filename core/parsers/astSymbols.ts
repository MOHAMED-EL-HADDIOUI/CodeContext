import type Parser from 'web-tree-sitter';
import type { CodeSymbol, SymbolKind } from '../../types';
import { initTreeSitterRuntime, getParserResourceUrl } from './treesitter';

const GRAMMARS: Record<string, string> = {
  typescript: 'tree-sitter-typescript',
  tsx: 'tree-sitter-tsx',
  javascript: 'tree-sitter-javascript',
  jsx: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  ruby: 'tree-sitter-ruby',
  php: 'tree-sitter-php',
  bash: 'tree-sitter-bash',
};

const KIND_BY_NODE: Record<string, SymbolKind> = {
  class_declaration: 'class', class_specifier: 'class', class_definition: 'class',
  function_declaration: 'function', function_definition: 'function', function_item: 'function',
  method_definition: 'method', method_declaration: 'method', method: 'method',
  interface_declaration: 'interface', type_alias_declaration: 'type', struct_item: 'type',
  enum_item: 'type', lexical_declaration: 'variable', variable_declaration: 'variable',
  import_statement: 'import', import_from_statement: 'import', use_declaration: 'import',
  import_declaration: 'import', atx_heading: 'heading',
};
const NAME_FIELDS = new Set(['name', 'declarator']);

const parserCache = new Map<string, Promise<Parser.Parser | null>>();

function resourceUrl(path: string): string {
  const url = getParserResourceUrl(path);
  if (!url) throw new Error('Tree-sitter is only available in an extension context.');
  return url;
}

async function createParser(language: string): Promise<Parser.Parser | null> {
  if (!(await initTreeSitterRuntime()) || !GRAMMARS[language]) return null;
  const mod = await import('web-tree-sitter');
  const ParserClass = mod.Parser;
  const grammar = await mod.Language.load(resourceUrl(`wasm/${GRAMMARS[language]}.wasm`));
  const parser = new ParserClass();
  parser.setLanguage(grammar);
  return parser;
}

function getName(node: Parser.Node): Parser.Node | null {
  for (const field of NAME_FIELDS) {
    const child = node.childForFieldName(field);
    if (child) {
      const identifier = child.type === 'identifier' || child.type === 'property_identifier' || child.type === 'type_identifier'
        ? child
        : child.descendantsOfType(['identifier', 'property_identifier', 'type_identifier']).find((entry): entry is Parser.Node => entry !== null);
      if (identifier) return identifier;
    }
  }
  if (node.type.includes('import')) {
    const source = node.descendantsOfType(['string', 'string_literal']).find((entry): entry is Parser.Node => entry !== null);
    if (source) return source;
  }
  return node.descendantsOfType(['identifier', 'property_identifier', 'type_identifier']).find((entry): entry is Parser.Node => entry !== null) ?? null;
}

/** Actual Tree-sitter AST extraction, with bounded output and no repository-code execution. */
export async function extractTreeSitterSymbols(input: {
  repositoryId: string;
  fileId: string;
  filePath: string;
  language: string;
  content: string;
}): Promise<CodeSymbol[] | null> {
  if (input.content.length > 2 * 1024 * 1024 || !GRAMMARS[input.language]) return null;
  try {
    let parserPromise = parserCache.get(input.language);
    if (!parserPromise) {
      parserPromise = createParser(input.language).catch((error) => {
        parserCache.delete(input.language);
        throw error;
      });
      parserCache.set(input.language, parserPromise);
    }
    const parser = await parserPromise;
    if (!parser) { parserCache.delete(input.language); return null; }
    const tree = parser.parse(input.content);
    if (!tree) return null;
    const symbols: CodeSymbol[] = [];
    for (const node of tree.rootNode.descendantsOfType(Object.keys(KIND_BY_NODE))) {
      if (!node) continue;
      const kind = KIND_BY_NODE[node.type];
      const name = getName(node);
      if (!kind || !name?.text || name.text.length > 250) continue;
      const startLine = node.startPosition.row + 1;
      const endLine = Math.max(startLine, node.endPosition.row + 1);
      symbols.push({
        id: `${input.fileId}:${kind}:${name.text}:${startLine}`,
        fileId: input.fileId, repositoryId: input.repositoryId, filePath: input.filePath,
        name: name.text.replace(/^['"]|['"]$/g, ''), kind, signature: node.text.split(/\r?\n/, 1)[0]?.slice(0, 240),
        startLine, endLine, exported: node.parent?.type === 'export_statement' || /^(?:export\s|pub\s)/.test(node.text),
      });
      if (symbols.length >= 3000) break;
    }
    return symbols;
  } catch (error) {
    console.warn(`Tree-sitter parsing failed for ${input.filePath}:`, error instanceof Error ? error.message : error);
    return null;
  }
}
