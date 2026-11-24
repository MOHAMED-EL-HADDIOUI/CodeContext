import { defineContentScript } from 'wxt/utils/define-content-script';
import { validateExtensionMessage } from '../types/messages';

/**
 * Minimal, passive content script scoped strictly to GitHub pages.
 * Never scrapes tabs automatically and never accesses credentials.
 * Only responds when explicitly invoked by the user via extension messages.
 */
export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
      const message = validateExtensionMessage(rawMessage);
      if (!message) return false;

      if (message.type === 'EXTRACT_PAGE_SELECTION') {
        const selectionText = window.getSelection()?.toString().trim() ?? '';
        sendResponse({
          ok: true,
          selection: selectionText
            ? {
                text: selectionText,
                sourceUrl: window.location.href,
                pageTitle: document.title,
                capturedAt: Date.now(),
                kind: 'code',
              }
            : null,
        });
        return false;
      }
      return false;
    });
  },
});
