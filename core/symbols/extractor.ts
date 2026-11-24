import type { CodeSymbol, SymbolKind } from '../../types';

interface ExtractionInput {
  repositoryId: string;
  fileId: string;
  filePath: string;
  language: string;
  content: string;
}

function findBraceBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let seenOpen = false;
  const maxScan = Math.min(lines.length, startIndex + 400);

  for (let i = startIndex; i < maxScan; i++) {
    const line = lines[i] ?? '';
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const next = line[c + 1];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (!inSingle && !inDouble && !inTemplate && ch === '/' && next === '/') {
        break;
      }
      if (!inDouble && !inTemplate && ch === "'") {
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && !inTemplate && ch === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble && ch === '`') {
        inTemplate = !inTemplate;
        continue;
      }
      if (inSingle || inDouble || inTemplate) continue;

      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        depth--;
        if (seenOpen && depth <= 0) {
          return i + 1; // 1-based line number
        }
      }
    }

    // Single-line statement without braces (e.g., interface property, type alias, arrow expression)
    if (!seenOpen && i > startIndex + 2 && line.trim().endsWith(';')) {
      return i + 1;
    }
  }

  return Math.min(lines.length, startIndex + 1);
}

function findIndentBlockEnd(lines: string[], startIndex: number): number {
  const header = lines[startIndex] ?? '';
  const baseIndent = header.match(/^(\s*)/)?.[1]?.length ?? 0;
  let lastNonEmpty = startIndex;
  const maxScan = Math.min(lines.length, startIndex + 300);

  for (let i = startIndex + 1; i < maxScan; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent <= baseIndent) {
      break;
    }
    lastNonEmpty = i;
  }

  return lastNonEmpty + 1;
}

function makeSymbolId(fileId: string, kind: SymbolKind, name: string, startLine: number): string {
  return `${fileId}:${kind}:${name}:${startLine}`;
}

function extractTsJsSymbols(input: ExtractionInput, lines: string[]): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  let currentClass: { name: string; endLine: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNum = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (currentClass && lineNum > currentClass.endLine) {
      currentClass = null;
    }

    // Import statements
    const importMatch = trimmed.match(
      /^import\s+(?:type\s+)?(?:(?:\{([^}]+)\})|(\*\s+as\s+\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/,
    );
    if (importMatch) {
      const source = importMatch[4] ?? '';
      symbols.push({
        id: makeSymbolId(input.fileId, 'import', source, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name: source,
        kind: 'import',
        signature: trimmed.slice(0, 140),
        startLine: lineNum,
        endLine: lineNum,
        exported: false,
      });
      continue;
    }

    // Class declaration
    const classMatch = trimmed.match(
      /^(export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    );
    if (classMatch) {
      const name = classMatch[2]!;
      const endLine = findBraceBlockEnd(lines, i);
      currentClass = { name, endLine };
      symbols.push({
        id: makeSymbolId(input.fileId, 'class', name, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: 'class',
        signature: trimmed.replace(/\{.*$/, '').trim(),
        startLine: lineNum,
        endLine,
        exported: Boolean(classMatch[1]),
      });
      continue;
    }

    // Interface declaration
    const ifaceMatch = trimmed.match(/^(export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
    if (ifaceMatch) {
      const name = ifaceMatch[2]!;
      const endLine = findBraceBlockEnd(lines, i);
      symbols.push({
        id: makeSymbolId(input.fileId, 'interface', name, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: 'interface',
        signature: trimmed.replace(/\{.*$/, '').trim(),
        startLine: lineNum,
        endLine,
        exported: Boolean(ifaceMatch[1]),
      });
      continue;
    }

    // Type alias
    const typeMatch = trimmed.match(/^(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*=/);
    if (typeMatch) {
      const name = typeMatch[2]!;
      const endLine = trimmed.includes('{') ? findBraceBlockEnd(lines, i) : lineNum;
      symbols.push({
        id: makeSymbolId(input.fileId, 'type', name, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: 'type',
        signature: trimmed.slice(0, 140),
        startLine: lineNum,
        endLine,
        exported: Boolean(typeMatch[1]),
      });
      continue;
    }

    // Function declaration
    const fnMatch = trimmed.match(
      /^(export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/,
    );
    if (fnMatch) {
      const name = fnMatch[2]!;
      const endLine = findBraceBlockEnd(lines, i);
      symbols.push({
        id: makeSymbolId(input.fileId, 'function', name, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: 'function',
        signature: trimmed.replace(/\{.*$/, '').trim().slice(0, 140),
        startLine: lineNum,
        endLine,
        exported: Boolean(fnMatch[1]),
      });
      continue;
    }

    // Const arrow function or function expression
    const arrowMatch = trimmed.match(
      /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
    );
    if (arrowMatch) {
      const name = arrowMatch[2]!;
      const endLine = trimmed.includes('{') ? findBraceBlockEnd(lines, i) : lineNum;
      symbols.push({
        id: makeSymbolId(input.fileId, 'function', name, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: 'function',
        signature: trimmed.replace(/\{.*$/, '').trim().slice(0, 140),
        startLine: lineNum,
        endLine,
        exported: Boolean(arrowMatch[1]),
      });
      continue;
    }

    // Class method
    if (currentClass && lineNum > 0) {
      const methodMatch = trimmed.match(
        /^(?:public|private|protected|static|readonly|override|async|\s)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{]+)?\{/,
      );
      if (
        methodMatch &&
        methodMatch[1] &&
        !['if', 'for', 'while', 'switch', 'catch', 'return', 'new'].includes(methodMatch[1])
      ) {
        const name = methodMatch[1];
        const endLine = findBraceBlockEnd(lines, i);
        symbols.push({
          id: makeSymbolId(input.fileId, 'method', `${currentClass.name}.${name}`, lineNum),
          fileId: input.fileId,
          repositoryId: input.repositoryId,
          filePath: input.filePath,
          name,
          kind: 'method',
          signature: trimmed.replace(/\{.*$/, '').trim().slice(0, 140),
          startLine: lineNum,
          endLine,
          parentSymbol: currentClass.name,
          exported: false,
        });
        continue;
      }
    }

    // Exported top-level variable / const
    const exportVarMatch = trimmed.match(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/);
    if (exportVarMatch) {
      const name = exportVarMatch[1]!;
      symbols.push({
        id: makeSymbolId(input.fileId, 'variable', name, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: 'variable',
        signature: trimmed.slice(0, 140),
        startLine: lineNum,
        endLine: lineNum,
        exported: true,
      });
    }
  }

  return symbols;
}

function extractPythonSymbols(input: ExtractionInput, lines: string[]): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  let currentClass: { name: string; endLine: number; indent: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNum = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (currentClass && (lineNum > currentClass.endLine || indent <= currentClass.indent)) {
      currentClass = null;
    }

    const impMatch = trimmed.match(/^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/);
    if (impMatch) {
      const mod = impMatch[1] ?? impMatch[2] ?? '';
      symbols.push({
        id: makeSymbolId(input.fileId, 'import', mod, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name: mod,
        kind: 'import',
        signature: trimmed.slice(0, 140),
        startLine: lineNum,
        endLine: lineNum,
        exported: false,
      });
      continue;
    }

    const clsMatch = trimmed.match(/^class\s+([A-Za-z_]\w*)/);
    if (clsMatch) {
      const name = clsMatch[1]!;
      const endLine = findIndentBlockEnd(lines, i);
      currentClass = { name, endLine, indent };
      symbols.push({
        id: makeSymbolId(input.fileId, 'class', name, lineNum),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: 'class',
        signature: trimmed.replace(/:$/, ''),
        startLine: lineNum,
        endLine,
        exported: !name.startsWith('_'),
      });
      continue;
    }

    const defMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (defMatch) {
      const name = defMatch[1]!;
      const endLine = findIndentBlockEnd(lines, i);
      const isMethod = Boolean(currentClass && indent > currentClass.indent);
      symbols.push({
        id: makeSymbolId(
          input.fileId,
          isMethod ? 'method' : 'function',
          isMethod && currentClass ? `${currentClass.name}.${name}` : name,
          lineNum,
        ),
        fileId: input.fileId,
        repositoryId: input.repositoryId,
        filePath: input.filePath,
        name,
        kind: isMethod ? 'method' : 'function',
        signature: trimmed.replace(/:$/, '').slice(0, 140),
        startLine: lineNum,
        endLine,
        parentSymbol: isMethod ? currentClass?.name : undefined,
        exported: !name.startsWith('_'),
      });
    }
  }

  return symbols;
}

function extractGoRustJavaSymbols(input: ExtractionInput, lines: string[]): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lang = input.language;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNum = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    if (lang === 'go') {
      const fnMatch = trimmed.match(/^func\s+(?:\((\w+\s+\*?[\w[\]]+)\)\s+)?([A-Za-z_]\w*)\s*\(/);
      if (fnMatch) {
        const receiver = fnMatch[1];
        const name = fnMatch[2]!;
        const endLine = findBraceBlockEnd(lines, i);
        symbols.push({
          id: makeSymbolId(input.fileId, receiver ? 'method' : 'function', name, lineNum),
          fileId: input.fileId,
          repositoryId: input.repositoryId,
          filePath: input.filePath,
          name,
          kind: receiver ? 'method' : 'function',
          signature: trimmed.replace(/\{.*$/, '').trim(),
          startLine: lineNum,
          endLine,
          parentSymbol: receiver,
          exported: /^[A-Z]/.test(name),
        });
        continue;
      }
      const typeMatch = trimmed.match(/^type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/);
      if (typeMatch) {
        const name = typeMatch[1]!;
        const kind: SymbolKind = typeMatch[2] === 'interface' ? 'interface' : 'class';
        const endLine = findBraceBlockEnd(lines, i);
        symbols.push({
          id: makeSymbolId(input.fileId, kind, name, lineNum),
          fileId: input.fileId,
          repositoryId: input.repositoryId,
          filePath: input.filePath,
          name,
          kind,
          signature: trimmed.replace(/\{.*$/, '').trim(),
          startLine: lineNum,
          endLine,
          exported: /^[A-Z]/.test(name),
        });
      }
    } else if (lang === 'rust') {
      const fnMatch = trimmed.match(/^(pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/);
      if (fnMatch) {
        const name = fnMatch[2]!;
        const endLine = findBraceBlockEnd(lines, i);
        symbols.push({
          id: makeSymbolId(input.fileId, 'function', name, lineNum),
          fileId: input.fileId,
          repositoryId: input.repositoryId,
          filePath: input.filePath,
          name,
          kind: 'function',
          signature: trimmed.replace(/\{.*$/, '').trim(),
          startLine: lineNum,
          endLine,
          exported: Boolean(fnMatch[1]),
        });
        continue;
      }
      const structMatch = trimmed.match(/^(pub(?:\([^)]+\))?\s+)?(struct|enum|trait)\s+([A-Za-z_]\w*)/);
      if (structMatch) {
        const name = structMatch[3]!;
        const kind: SymbolKind = structMatch[2] === 'trait' ? 'interface' : 'class';
        const endLine = findBraceBlockEnd(lines, i);
        symbols.push({
          id: makeSymbolId(input.fileId, kind, name, lineNum),
          fileId: input.fileId,
          repositoryId: input.repositoryId,
          filePath: input.filePath,
          name,
          kind,
          signature: trimmed.replace(/\{.*$/, '').trim(),
          startLine: lineNum,
          endLine,
          exported: Boolean(structMatch[1]),
        });
      }
    } else {
      // Java / Kotlin / C# / C++ / PHP generic brace language extractor
      const clsMatch = trimmed.match(
        /^(?:public|private|protected|internal|abstract|final|sealed|static|\s)*(class|interface|struct|enum)\s+([A-Za-z_]\w*)/,
      );
      if (clsMatch) {
        const name = clsMatch[2]!;
        const kind: SymbolKind = clsMatch[1] === 'interface' ? 'interface' : 'class';
        const endLine = findBraceBlockEnd(lines, i);
        symbols.push({
          id: makeSymbolId(input.fileId, kind, name, lineNum),
          fileId: input.fileId,
          repositoryId: input.repositoryId,
          filePath: input.filePath,
          name,
          kind,
          signature: trimmed.replace(/\{.*$/, '').trim(),
          startLine: lineNum,
          endLine,
          exported: trimmed.includes('public'),
        });
        continue;
      }

      const fnMatch = trimmed.match(
        /^(?:public|private|protected|internal|static|async|virtual|override|suspend|fun|function|\s)+(?:[\w<>[\]?]+\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:\{|throws|where)/,
      );
      if (
        fnMatch &&
        fnMatch[1] &&
        !['if', 'for', 'while', 'switch', 'catch', 'class', 'new'].includes(fnMatch[1])
      ) {
        const name = fnMatch[1];
        const endLine = findBraceBlockEnd(lines, i);
        symbols.push({
          id: makeSymbolId(input.fileId, 'function', name, lineNum),
          fileId: input.fileId,
          repositoryId: input.repositoryId,
          filePath: input.filePath,
          name,
          kind: 'function',
          signature: trimmed.replace(/\{.*$/, '').trim(),
          startLine: lineNum,
          endLine,
          exported: trimmed.includes('public'),
        });
      }
    }
  }

  return symbols;
}

function extractMarkdownHeadings(input: ExtractionInput, lines: string[]): CodeSymbol[] {
  const headings: Array<{ name: string; level: number; startLine: number }> = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (match) {
      headings.push({
        level: match[1]!.length,
        name: match[2]!.trim(),
        startLine: i + 1,
      });
    }
  }

  return headings.map((heading, idx) => {
    const nextHeading = headings[idx + 1];
    const endLine = nextHeading ? Math.max(heading.startLine, nextHeading.startLine - 1) : lines.length;
    return {
      id: makeSymbolId(input.fileId, 'heading', heading.name.slice(0, 48), heading.startLine),
      fileId: input.fileId,
      repositoryId: input.repositoryId,
      filePath: input.filePath,
      name: heading.name,
      kind: 'heading',
      signature: `${'#'.repeat(heading.level)} ${heading.name}`,
      startLine: heading.startLine,
      endLine,
      exported: true,
    };
  });
}

export function extractSymbols(input: ExtractionInput): CodeSymbol[] {
  if (!input.content) return [];
  const lines = input.content.split(/\r?\n/);

  switch (input.language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'jsx':
    case 'vue':
    case 'svelte':
      return extractTsJsSymbols(input, lines);
    case 'python':
      return extractPythonSymbols(input, lines);
    case 'go':
    case 'rust':
    case 'java':
    case 'kotlin':
    case 'csharp':
    case 'cpp':
    case 'c':
    case 'php':
    case 'swift':
      return extractGoRustJavaSymbols(input, lines);
    case 'markdown':
    case 'mdx':
      return extractMarkdownHeadings(input, lines);
    default:
      return [];
  }
}
