import type { ActiveTabInfo } from '../../types/messages';

export function normalizeOriginPattern(urlString: string): string | null {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (
      parsed.protocol === 'http:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    ) {
      return null;
    }
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

export async function hasOriginPermission(urlString: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) {
    return true;
  }
  const pattern = normalizeOriginPattern(urlString);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Must be called directly from a user gesture handler (button click in Side Panel or Options).
 */
export async function requestOriginPermission(urlString: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) {
    return true;
  }
  const pattern = normalizeOriginPattern(urlString);
  if (!pattern) return false;
  const already = await hasOriginPermission(urlString);
  if (already) return true;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

export async function getActiveTabInfo(): Promise<ActiveTabInfo> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return {};
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return {};
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
    };
  } catch {
    return {};
  }
}

export async function openSidePanelForCurrentWindow(windowId?: number): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.sidePanel) {
    return false;
  }
  try {
    let targetWindowId = windowId;
    if (targetWindowId === undefined && chrome.windows) {
      const current = await chrome.windows.getLastFocused();
      targetWindowId = current.id;
    }
    if (targetWindowId !== undefined) {
      await chrome.sidePanel.open({ windowId: targetWindowId });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
