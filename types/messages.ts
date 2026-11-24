import { z } from 'zod';
import { SelectedCodeContextSchema } from './index';

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
