import { browser } from 'wxt/browser';
import type { OpenTarget } from './model';

export type OpenResult = 'ok' | 'private-not-allowed' | 'failed';

export async function openUrl(url: string, target: OpenTarget): Promise<OpenResult> {
  try {
    switch (target) {
      case 'current':
        await browser.tabs.update({ url });
        break;
      case 'new':
        await browser.tabs.create({ url, active: true });
        break;
      case 'background':
        await browser.tabs.create({ url, active: false });
        break;
      case 'private':
        await browser.windows.create({ url, incognito: true });
        break;
    }
    return 'ok';
  } catch {
    return target === 'private' ? 'private-not-allowed' : 'failed';
  }
}

/**
 * A private search stops here rather than run somewhere else, because a search
 * without a tab to go to lands in the current tab and in normal history.
 */
async function searchInPrivateWindow(text: string): Promise<OpenResult> {
  if (!(await browser.extension.isAllowedIncognitoAccess())) return 'private-not-allowed';
  const opened = await browser.windows.create({ incognito: true });
  const tabId = opened?.tabs?.[0]?.id;
  if (tabId === undefined) return 'failed';
  await browser.search.query({ text, tabId });
  return 'ok';
}

/** Hands a query to the browser's own default search engine. */
export async function searchWithBrowser(text: string, target: OpenTarget): Promise<OpenResult> {
  try {
    if (target === 'private') return await searchInPrivateWindow(text);
    if (target === 'background') {
      const tab = await browser.tabs.create({ active: false });
      await browser.search.query({ text, tabId: tab.id });
      return 'ok';
    }
    await browser.search.query({ text, disposition: target === 'new' ? 'NEW_TAB' : 'CURRENT_TAB' });
    return 'ok';
  } catch {
    return 'failed';
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
