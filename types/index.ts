import { z } from 'zod';

export const IndexingStatusSchema = z.enum([
  'idle',
  'fetching_metadata',
  'fetching_tree',
  'indexing',
  'ready',
  'partial',
  'cancelled',
  'error',
]);
export type IndexingStatus = z.infer<typeof IndexingStatusSchema>;

export const RepositorySchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  url: z.string().url(),
  description: z.string().optional(),
  defaultBranch: z.string().min(1),
  commitSha: z.string().min(1),
  languages: z.record(z.string(), z.number()),
  stars: z.number().int().nonnegative().optional(),
  isPrivate: z.boolean().default(false),
  fileCount: z.number().int().nonnegative().default(0),
  indexedFileCount: z.number().int().nonnegative().default(0),
  skippedFileCount: z.number().int().nonnegative().default(0),
  chunkCount: z.number().int().nonnegative().default(0),
  symbolCount: z.number().int().nonnegative().default(0),
  readmeContent: z.string().optional(),
  readmePath: z.string().optional(),
  truncatedTree: z.boolean().default(false),
  indexingStatus: IndexingStatusSchema,
  indexingError: z.string().optional(),
  indexedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Repository = z.infer<typeof RepositorySchema>;

export const RepositoryFileSchema = z.object({
  id: z.string().min(1),
  repositoryId: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  extension: z.string(),
  language: z.string(),
  size: z.number().int().nonnegative(),
  sha: z.string().min(1),
  content: z.string().optional(),
  lineCount: z.number().int().nonnegative().default(0),
  indexed: z.boolean().default(false),
  skippedReason: z.string().optional(),
});
export type RepositoryFile = z.infer<typeof RepositoryFileSchema>;

export const SymbolKindSchema = z.enum([
  'class',
  'function',
  'method',
  'interface',
  'type',
  'variable',
  'import',
  'export',
  'heading',
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const CodeSymbolSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  repositoryId: z.string().min(1),
  filePath: z.string().min(1),
  name: z.string().min(1),
  kind: SymbolKindSchema,
  signature: z.string().optional(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  parentSymbol: z.string().optional(),
  exported: z.boolean().default(false),
});
export type CodeSymbol = z.infer<typeof CodeSymbolSchema>;

export const CodeChunkSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  repositoryId: z.string().min(1),
  filePath: z.string().min(1),
  symbolName: z.string().optional(),
  symbolType: z.string().optional(),
  content: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  language: z.string(),
  tokenEstimate: z.number().int().nonnegative().default(0),
});
export type CodeChunk = z.infer<typeof CodeChunkSchema>;

export const SourceCitationSchema = z.object({
  repositoryId: z.string().min(1),
  filePath: z.string().min(1),
  commitSha: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  excerpt: z.string(),
  symbolName: z.string().optional(),
  githubUrl: z.string().url().optional(),
});
export type SourceCitation = z.infer<typeof SourceCitationSchema>;

export const ChatModeSchema = z.enum([
  'ask_codebase',
  'explain_selection',
  'explain_file',
  'explain_architecture',
  'trace_flow',
  'find_usages',
  'review_code',
  'explain_dependencies',
  'generate_docs',
]);
export type ChatMode = z.infer<typeof ChatModeSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  repositoryId: z.string().optional(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  mode: ChatModeSchema.optional(),
  citations: z.array(SourceCitationSchema).optional(),
  incompleteIndexWarning: z.string().optional(),
  createdAt: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatSessionSchema = z.object({
  id: z.string().min(1),
  repositoryId: z.string().optional(),
  title: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const SavedReferenceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string(),
  excerpt: z.string(),
  summary: z.string().optional(),
  language: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.number(),
});
export type SavedReference = z.infer<typeof SavedReferenceSchema>;

export const AIProviderTypeSchema = z.enum(['openai', 'anthropic', 'nvidia', 'custom']);
export type AIProviderType = z.infer<typeof AIProviderTypeSchema>;

export const AIConfigurationSchema = z.object({
  provider: AIProviderTypeSchema,
  model: z.string().min(1),
  baseUrl: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().min(128).max(32768).default(2048),
  contextWindow: z.number().int().min(2048).max(2000000).default(32000),
  enableLocalEmbeddings: z.boolean().default(false),
  consentGiven: z.boolean().default(false),
});
export type AIConfiguration = z.infer<typeof AIConfigurationSchema>;

export const IndexingLimitsSchema = z.object({
  maxFiles: z.number().int().min(10).max(2000).default(250),
  maxFileSizeKb: z.number().int().min(10).max(2048).default(256),
  maxTotalSizeMb: z.number().min(1).max(100).default(15),
  concurrency: z.number().int().min(1).max(12).default(5),
});
export type IndexingLimits = z.infer<typeof IndexingLimitsSchema>;

export const ThemeModeSchema = z.enum(['dark', 'light', 'system']);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export const AppSettingsSchema = z.object({
  theme: ThemeModeSchema.default('dark'),
  ai: AIConfigurationSchema,
  indexing: IndexingLimitsSchema,
  onboardingCompleted: z.boolean().default(false),
  activeRepositoryId: z.string().optional(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const SelectedCodeContextSchema = z.object({
  text: z.string().min(1),
  sourceUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  language: z.string().optional(),
  filePath: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  capturedAt: z.number(),
  kind: z.enum(['code', 'documentation']).default('code'),
});
export type SelectedCodeContext = z.infer<typeof SelectedCodeContextSchema>;

export interface IndexingProgress {
  repositoryId: string;
  phase: IndexingStatus;
  discoveredFiles: number;
  totalToIndex: number;
  indexedFiles: number;
  skippedFiles: number;
  currentFile?: string;
  message: string;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
  error?: string;
}

export interface SearchResult {
  chunkId: string;
  fileId: string;
  repositoryId: string;
  filePath: string;
  language: string;
  symbolName?: string;
  symbolType?: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
  matchSource: 'lexical' | 'symbol' | 'filename' | 'semantic' | 'hybrid';
}

export interface DependencyInfo {
  name: string;
  version: string;
  scope: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'python' | 'rust' | 'go';
  sourceFile: string;
}
