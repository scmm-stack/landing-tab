import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { t } from '../lib/i18n';
import { safeUrl } from '../lib/normalize';
import { flush, useAppState } from '../lib/store';
import { type Draft, ShortcutForm } from './ShortcutEditor';

// A file dialog takes focus, and that closes the toolbar panel in Firefox and on
// Chromium outside Windows. There the form moves to a small window of its own first.
const FILE_DIALOG_CLOSES_PANEL = import.meta.env.FIREFOX || !navigator.userAgent.includes('Windows');
const WINDOW_SIZE = { width: 530, height: 680 };

/** The address arrives in the window's own URL, which stays on this device. */
const passed = new URLSearchParams(location.search);
const inWindow = passed.has('url');

function openInWindow(draft: Draft) {
  const { groupId, ...rest } = draft;
  const query = new URLSearchParams({ ...rest, group: groupId });
  void browser.windows
    .create({ url: `${browser.runtime.getURL('/popup.html')}?${query.toString()}`, type: 'popup', ...WINDOW_SIZE })
    .then(() => window.close());
}

function closeForm() {
  if (!inWindow) {
    window.close();
    return;
  }
  void browser.tabs.getCurrent().then((tab) => {
    if (tab?.id !== undefined) void browser.tabs.remove(tab.id);
  });
}

/**
 * Adds the current page to a group. The URL and title are read only because the
 * person clicked the toolbar button, and they are kept in local storage. The site
 * is asked only for its image, through its home page, never with this page's URL.
 */
export function Popup() {
  const { dashboard, session } = useAppState();
  const [page, setPage] = useState<{ url: string; title: string; note?: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (inWindow) {
      const url = safeUrl(passed.get('url'));
      if (url) setPage({ url, title: passed.get('title') ?? '', note: passed.get('note') ?? '' });
      else setFailed(true);
      return;
    }
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        const url = safeUrl(tab?.url);
        if (url) setPage({ url, title: tab?.title ?? '' });
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
  }, []);

  const wanted = [passed.get('group'), session.lastGroupId].find((id) => dashboard.groups.some((g) => g.id === id));
  const groupId = wanted ?? dashboard.groups[0]?.id;

  if (failed) return <p className="popup-message">{t('popupCantAdd')}</p>;
  if (!page || !groupId) return null;

  return (
    <div className="popup">
      <h1>{t('addShortcut')}</h1>
      <ShortcutForm
        groupId={groupId}
        initial={page}
        showGroupPicker
        popup={!inWindow}
        onNeedWindow={!inWindow && FILE_DIALOG_CLOSES_PANEL ? openInWindow : undefined}
        onDone={(saved) => {
          if (saved) void flush().then(closeForm);
          else closeForm();
        }}
      />
    </div>
  );
}
