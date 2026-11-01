import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  extension: { isAllowedIncognitoAccess: vi.fn() },
  windows: { create: vi.fn() },
  tabs: { create: vi.fn(), update: vi.fn() },
  search: { query: vi.fn() },
}));

vi.mock('wxt/browser', () => ({ browser: api }));

import { searchWithBrowser } from '../src/lib/open';

describe('searchWithBrowser in a private window', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.extension.isAllowedIncognitoAccess.mockResolvedValue(true);
    api.windows.create.mockResolvedValue({ tabs: [{ id: 7 }] });
  });

  it('runs the search in the tab of a new private window', async () => {
    expect(await searchWithBrowser('query', 'private')).toBe('ok');
    expect(api.windows.create).toHaveBeenCalledWith({ incognito: true });
    expect(api.search.query).toHaveBeenCalledWith({ text: 'query', tabId: 7 });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('runs nowhere without access to private windows', async () => {
    api.extension.isAllowedIncognitoAccess.mockResolvedValue(false);
    expect(await searchWithBrowser('query', 'private')).toBe('private-not-allowed');
    expect(api.windows.create).not.toHaveBeenCalled();
    expect(api.search.query).not.toHaveBeenCalled();
  });

  // Without a tab id the browser would search in the current, normal tab.
  it.each([[undefined], [{}], [{ tabs: [] }], [{ tabs: [{}] }]])('never falls back to the current tab when the window gives %j', async (opened) => {
    api.windows.create.mockResolvedValue(opened);
    expect(await searchWithBrowser('query', 'private')).toBe('failed');
    expect(api.search.query).not.toHaveBeenCalled();
  });

  it('reports a window that could not be opened', async () => {
    api.windows.create.mockRejectedValue(new Error('refused'));
    expect(await searchWithBrowser('query', 'private')).toBe('failed');
    expect(api.search.query).not.toHaveBeenCalled();
  });
});

describe('searchWithBrowser elsewhere', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.tabs.create.mockResolvedValue({ id: 3 });
  });

  it('uses the current or a new tab', async () => {
    expect(await searchWithBrowser('query', 'current')).toBe('ok');
    expect(api.search.query).toHaveBeenLastCalledWith({ text: 'query', disposition: 'CURRENT_TAB' });
    expect(await searchWithBrowser('query', 'new')).toBe('ok');
    expect(api.search.query).toHaveBeenLastCalledWith({ text: 'query', disposition: 'NEW_TAB' });
  });

  it('opens a background tab without taking focus', async () => {
    expect(await searchWithBrowser('query', 'background')).toBe('ok');
    expect(api.tabs.create).toHaveBeenCalledWith({ active: false });
    expect(api.search.query).toHaveBeenCalledWith({ text: 'query', tabId: 3 });
  });

  it('reports a failed search', async () => {
    api.search.query.mockRejectedValue(new Error('no engine'));
    expect(await searchWithBrowser('query', 'current')).toBe('failed');
  });
});
