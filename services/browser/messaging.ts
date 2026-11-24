import type { SelectedCodeContext } from '../../types';
import {
  ActiveTabInfoSchema,
  type ActiveTabInfo,
  type ExtensionMessage,
} from '../../types/messages';

export async function sendExtensionMessage<T = unknown>(
  message: ExtensionMessage,
): Promise<T | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return null;
  }
  try {
    const response = await chrome.runtime.sendMessage(message);
    return (response as T) ?? null;
  } catch {
    return null;
  }
}

export async function fetchActiveTabInfoViaBackground(): Promise<ActiveTabInfo> {
  const response = await sendExtensionMessage<{ tab?: unknown }>({
    type: 'GET_ACTIVE_TAB_INFO',
  });
  if (!response?.tab) return {};
  const parsed = ActiveTabInfoSchema.safeParse(response.tab);
  return parsed.success ? parsed.data : {};
}

export async function fetchPendingSelection(): Promise<SelectedCodeContext | null> {
  const response = await sendExtensionMessage<{ selection?: SelectedCodeContext | null }>({
    type: 'GET_PENDING_SELECTION',
  });
  return response?.selection ?? null;
}

export async function clearPendingSelection(): Promise<void> {
  await sendExtensionMessage({ type: 'CLEAR_PENDING_SELECTION' });
}

export async function requestPageSelectionExtraction(
  tabId?: number,
): Promise<SelectedCodeContext | null> {
  const response = await sendExtensionMessage<{ selection?: SelectedCodeContext | null }>({
    type: 'EXTRACT_PAGE_SELECTION',
    tabId,
  });
  return response?.selection ?? null;
}
