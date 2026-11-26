import { defineBackground } from 'wxt/utils/define-background';
import { SelectedCodeContextSchema, type SelectedCodeContext } from '../types';
import { validateExtensionMessage } from '../types/messages';
import { detectLanguageFromSnippet } from '../core/parsers/language';
import { startBackgroundIndexing, startBackgroundLocalZip, cancelBackgroundIndexing, resumeBackgroundIndexing, recoverInterruptedIndexing } from '../services/ingestion/backgroundIndexer';
import { db } from '../services/storage/db';

const MENU_ASK_SELECTION = 'codecontext-ask-selection';
const MENU_ASK_DOCS = 'codecontext-ask-docs';
const PENDING_SELECTION_KEY = 'codecontext_pending_selection_v1';

async function savePendingSelection(selection: SelectedCodeContext): Promise<void> {
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ [PENDING_SELECTION_KEY]: selection });
  }
}

async function readPendingSelection(): Promise<SelectedCodeContext | null> {
  if (!chrome.storage?.session) return null;
  const data = await chrome.storage.session.get(PENDING_SELECTION_KEY);
  const parsed = SelectedCodeContextSchema.safeParse(data[PENDING_SELECTION_KEY]);
  return parsed.success ? parsed.data : null;
}

async function removePendingSelection(): Promise<void> {
  if (chrome.storage?.session) {
    await chrome.storage.session.remove(PENDING_SELECTION_KEY);
  }
}

function registerContextMenus(): void {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ASK_SELECTION,
      title: 'Ask CodeContext about this selection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: MENU_ASK_DOCS,
      title: 'Analyze documentation passage in CodeContext',
      contexts: ['selection'],
    });
  });
}

async function flashConfirmationBadge(): Promise<void> {
  if (!chrome.action) return;
  try {
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: '#0284C7' });
    if (chrome.alarms) {
      await chrome.alarms.create('clear-badge', { delayInMinutes: 0.1 });
    }
  } catch {
    // Non-critical visual confirmation
  }
}

export default defineBackground(() => {
  void recoverInterruptedIndexing();
  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenus();
  });

  chrome.runtime.onStartup.addListener(() => {
    registerContextMenus();
  });

  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'clear-badge' && chrome.action) {
        await chrome.action.setBadgeText({ text: '' });
      }
    });
  }

  if (chrome.commands) {
    chrome.commands.onCommand.addListener(async (command, tab) => {
      if (command === 'open-sidepanel' && chrome.sidePanel) {
        try {
          if (tab?.windowId !== undefined) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
          } else {
            const win = await chrome.windows.getLastFocused();
            if (win.id !== undefined) {
              await chrome.sidePanel.open({ windowId: win.id });
            }
          }
        } catch (err) {
          console.error('Failed to open side panel via command:', err);
        }
      }
    });
  }

  if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== MENU_ASK_SELECTION && info.menuItemId !== MENU_ASK_DOCS) {
        return;
      }
      const selectedText = info.selectionText?.trim();
      if (!selectedText) return;

      const kind = info.menuItemId === MENU_ASK_DOCS ? 'documentation' : 'code';
      const language = kind === 'code' ? detectLanguageFromSnippet(selectedText) : 'markdown';

      const payload: SelectedCodeContext = {
        text: selectedText,
        sourceUrl: info.pageUrl ?? tab?.url,
        pageTitle: tab?.title,
        language,
        capturedAt: Date.now(),
        kind,
      };

      await savePendingSelection(payload);

      // Open Side Panel immediately on user gesture
      if (chrome.sidePanel && tab?.windowId !== undefined) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch (err) {
          console.error('Failed to open side panel from context menu:', err);
        }
      }

      await flashConfirmationBadge();

      // Notify open side panel if already mounted
      try {
        await chrome.runtime.sendMessage({
          type: 'SELECTION_CAPTURED',
          payload,
        });
      } catch {
        // Side panel may still be initializing and will read pending selection on mount
      }
    });
  }

  chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
    const message = validateExtensionMessage(rawMessage);
    if (!message) {
      sendResponse({ ok: false, error: 'Invalid message payload' });
      return false;
    }

    // Only accept messages from our own extension
    if (sender.id && sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: 'Unauthorized message sender' });
      return false;
    }

    (async () => {
      try {
        switch (message.type) {
          case 'PING': {
            sendResponse({ ok: true, pong: true });
            break;
          }
          case 'OPEN_SIDEPANEL': {
            if (chrome.sidePanel) {
              const targetWin =
                message.windowId ?? (await chrome.windows.getLastFocused()).id;
              if (targetWin !== undefined) {
                await chrome.sidePanel.open({ windowId: targetWin });
                sendResponse({ ok: true });
                return;
              }
            }
            sendResponse({ ok: false, error: 'Side Panel API unavailable' });
            break;
          }
          case 'GET_ACTIVE_TAB_INFO': {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            sendResponse({
              ok: true,
              tab: tab
                ? {
                    tabId: tab.id,
                    windowId: tab.windowId,
                    url: tab.url,
                    title: tab.title,
                  }
                : null,
            });
            break;
          }
          case 'GET_PENDING_SELECTION': {
            const selection = await readPendingSelection();
            sendResponse({ ok: true, selection });
            break;
          }
          case 'CLEAR_PENDING_SELECTION': {
            await removePendingSelection();
            sendResponse({ ok: true });
            break;
          }
          case 'EXTRACT_PAGE_SELECTION': {
            let targetTabId = message.tabId;
            if (targetTabId === undefined) {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              targetTabId = tab?.id;
            }
            if (targetTabId === undefined) {
              sendResponse({ ok: false, error: 'No active tab available' });
              return;
            }
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId: targetTabId },
                func: () => {
                  const sel = window.getSelection()?.toString().trim() ?? '';
                  return {
                    text: sel,
                    sourceUrl: window.location.href,
                    pageTitle: document.title,
                  };
                },
              });
              const extracted = results[0]?.result;
              if (!extracted || !extracted.text) {
                sendResponse({ ok: true, selection: null });
                return;
              }
              const payload: SelectedCodeContext = {
                text: extracted.text,
                sourceUrl: extracted.sourceUrl,
                pageTitle: extracted.pageTitle,
                language: detectLanguageFromSnippet(extracted.text),
                capturedAt: Date.now(),
                kind: 'code',
              };
              sendResponse({ ok: true, selection: payload });
            } catch (err) {
              sendResponse({
                ok: false,
                error:
                  err instanceof Error
                    ? err.message
                    : 'Unable to read selection from this page.',
              });
            }
            break;
          }
          case 'SELECTION_CAPTURED': {
            await savePendingSelection(message.payload);
            sendResponse({ ok: true });
            break;
          }
          case 'INDEX_GITHUB': {
            void startBackgroundIndexing(message.urlOrSlug, message.limits).catch((error) => {
              console.error('Background indexing failed:', error instanceof Error ? error.message : error);
            });
            sendResponse({ ok: true });
            break;
          }
          case 'INDEX_LOCAL_ZIP': {
            void startBackgroundLocalZip(message.name, message.files, message.limits).catch((error) => {
              console.error('Background ZIP indexing failed:', error instanceof Error ? error.message : error);
            });
            sendResponse({ ok: true });
            break;
          }
          case 'CANCEL_INDEXING': {
            cancelBackgroundIndexing(message.repositoryId);
            sendResponse({ ok: true });
            break;
          }
          case 'RESUME_INDEXING': {
            void resumeBackgroundIndexing(message.repositoryId, message.limits).catch(async (error) => {
              const text = error instanceof Error ? error.message : 'Background indexing resume failed.';
              await db.repositories.update(message.repositoryId, { indexingStatus: 'error', indexingError: text, updatedAt: Date.now() });
              await chrome.runtime.sendMessage({ type: 'INDEXING_PROGRESS', progress: { repositoryId: message.repositoryId, phase: 'error', discoveredFiles: 0, totalToIndex: 0, indexedFiles: 0, skippedFiles: 0, message: text, error: text } }).catch(() => undefined);
              console.error('Background indexing resume failed:', text);
            });
            sendResponse({ ok: true });
            break;
          }
          case 'GET_INDEXING_STATUS': {
            const jobs = await db.indexJobs.toArray();
            const repositories = await db.repositories.toArray();
            sendResponse({ ok: true, jobs, repositories });
            break;
          }
        }
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unexpected background error',
        });
      }
    })();

    return true;
  });
});
