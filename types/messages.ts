import { z } from 'zod';
import { SelectedCodeContextSchema, IndexingLimitsSchema, IndexingProgressSchema } from './index';

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('OPEN_SIDEPANEL'),
    windowId: z.number().int().optional(),
    tabId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('SELECTION_CAPTURED'),
    payload: SelectedCodeContextSchema,
  }),
  z.object({
    type: z.literal('GET_ACTIVE_TAB_INFO'),
  }),
  z.object({
    type: z.literal('EXTRACT_PAGE_SELECTION'),
    tabId: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('GET_PENDING_SELECTION'),
  }),
  z.object({
    type: z.literal('CLEAR_PENDING_SELECTION'),
  }),
  z.object({
    type: z.literal('PING'),
  }),
  z.object({
    type: z.literal('INDEX_GITHUB'),
    urlOrSlug: z.string().min(1).max(3000),
    limits: IndexingLimitsSchema,
  }),
  z.object({
    type: z.literal('INDEX_LOCAL_ZIP'),
    name: z.string().min(1).max(300),
    files: z.array(z.object({ path: z.string().min(1).max(4000), content: z.string().max(2 * 1024 * 1024) })).max(10000),
    limits: IndexingLimitsSchema,
  }),
  z.object({
    type: z.literal('CANCEL_INDEXING'),
    repositoryId: z.string().min(1),
  }),
  z.object({
    type: z.literal('RESUME_INDEXING'),
    repositoryId: z.string().min(1),
    limits: IndexingLimitsSchema,
  }),
  z.object({
    type: z.literal('INDEXING_PROGRESS'),
    progress: IndexingProgressSchema,
  }),
  z.object({
    type: z.literal('GET_INDEXING_STATUS'),
  }),
]);

export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

export const ActiveTabInfoSchema = z.object({
  tabId: z.number().int().optional(),
  windowId: z.number().int().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
});

export type ActiveTabInfo = z.infer<typeof ActiveTabInfoSchema>;

export function validateExtensionMessage(raw: unknown): ExtensionMessage | null {
  const parsed = ExtensionMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
