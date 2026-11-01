import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/lib/model';
import { completeUrl, engineUrlIsValid, normalizeDashboard, normalizeSearch, normalizeSettings, normalizeState, safeUrl } from '../src/lib/normalize';

let counter = 0;
const newId = () => `id-${++counter}`;

describe('safeUrl', () => {
  it('accepts web addresses only', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('http://example.com')).toBe('http://example.com/');
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'file:///C:/secret', 'about:config', 'not a url', '', null, 42])(
    'rejects %s',
    (value) => {
      expect(safeUrl(value)).toBeNull();
    },
  );
});

describe('completeUrl', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['  example.com/page  ', 'https://example.com/page'],
    ['example.com:8080/a', 'https://example.com:8080/a'],
    ['nas:5000', 'https://nas:5000/'],
    ['localhost', 'http://localhost/'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['localhost:3000/app?x=1', 'http://localhost:3000/app?x=1'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080/'],
    ['[::1]:3000', 'http://[::1]:3000/'],
    ['localhost.example.com', 'https://localhost.example.com/'],
    ['http://example.com', 'http://example.com/'],
    ['https://example.com:8443/', 'https://example.com:8443/'],
  ])('%s becomes %s', (typed, url) => {
    expect(completeUrl(typed)).toBe(url);
  });

  it.each(['', '   ', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:someone@example.com', 'ftp://example.com/'])('refuses %s', (typed) => {
    expect(completeUrl(typed)).toBeNull();
  });

  it('never turns a typed address into anything but a web address', () => {
    expect(completeUrl('javascript:1')).toMatch(/^https:/);
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for garbage', () => {
    for (const input of [undefined, null, 'x', 7, []]) expect(normalizeSettings(input)).toEqual(defaultSettings());
  });

  it('keeps valid values and ignores unknown keys', () => {
    const s = normalizeSettings({ theme: 'dark', grid: { tileSize: 80 }, injected: true });
    expect(s.theme).toBe('dark');
    expect(s.grid.tileSize).toBe(80);
    expect(s.grid.columns).toBe(defaultSettings().grid.columns);
    expect(s).not.toHaveProperty('injected');
  });

  it('rejects wrong types and invalid choices', () => {
    const s = normalizeSettings({ theme: 'neon', grid: { tileSize: 'huge', openTarget: 'elsewhere' } });
    expect(s.theme).toBe('system');
    expect(s.grid.tileSize).toBe(64);
    expect(s.grid.openTarget).toBe('current');
  });

  it('gives saved settings from before tile styles the card style, and keeps a valid choice', () => {
    expect(normalizeSettings({ grid: { tileSize: 64 } }).grid.tileStyle).toBe('card');
    expect(normalizeSettings({ grid: { tileStyle: 'icon' } }).grid.tileStyle).toBe('icon');
    expect(normalizeSettings({ grid: { tileStyle: 'hologram' } }).grid.tileStyle).toBe('card');
  });

  it('keeps the fade-in time in range, with a default for older settings', () => {
    expect(normalizeSettings({ grid: { tileSize: 64 } }).grid.fadeMs).toBe(200);
    expect(normalizeSettings({ grid: { fadeMs: 0 } }).grid.fadeMs).toBe(0);
    expect(normalizeSettings({ grid: { fadeMs: 99999 } }).grid.fadeMs).toBe(1000);
    expect(normalizeSettings({ grid: { fadeMs: -5 } }).grid.fadeMs).toBe(0);
  });

  it('clamps numbers into range, including non-finite ones', () => {
    const s = normalizeSettings({ grid: { tileSize: 99999, opacity: -5, columns: Number.NaN } });
    expect(s.grid.tileSize).toBe(140);
    expect(s.grid.opacity).toBe(10);
    expect(s.grid.columns).toBe(8);
  });

  it('rejects colors that could smuggle CSS', () => {
    expect(normalizeSettings({ wallpaper: { color: 'url(https://evil.example/x)' } }).wallpaper.color).toBe(defaultSettings().wallpaper.color);
  });

  it('clears an active wallpaper that no longer exists', () => {
    expect(normalizeSettings({ wallpaper: { imageIds: ['a'], activeImageId: 'gone' } }).wallpaper.activeImageId).toBe('a');
    expect(normalizeSettings({ wallpaper: { imageIds: [], activeImageId: 'gone' } }).wallpaper.activeImageId).toBeNull();
  });

  it('allows the image source with an empty library, so images can be added to it', () => {
    expect(normalizeSettings({ wallpaper: { source: 'image', imageIds: [] } }).wallpaper.source).toBe('image');
  });
});

describe('normalizeDashboard', () => {
  it('creates a usable dashboard from garbage', () => {
    const d = normalizeDashboard('broken', newId);
    expect(d.groups).toHaveLength(1);
    expect(d.shortcuts).toEqual({});
  });

  it('drops shortcuts with unsafe addresses and their references', () => {
    const d = normalizeDashboard(
      {
        groups: [{ id: 'g', name: 'G', symbol: '', shortcutIds: ['good', 'bad'] }],
        shortcuts: { good: { url: 'https://ok.example' }, bad: { url: 'javascript:alert(1)' } },
      },
      newId,
    );
    expect(Object.keys(d.shortcuts)).toEqual(['good']);
    expect(d.groups[0]?.shortcutIds).toEqual(['good']);
  });

  it('keeps a shortcut in one group only, and removes dangling references', () => {
    const d = normalizeDashboard(
      {
        groups: [
          { id: 'a', name: 'A', shortcutIds: ['s', 'missing'] },
          { id: 'b', name: 'B', shortcutIds: ['s'] },
        ],
        shortcuts: { s: { url: 'https://ok.example' } },
      },
      newId,
    );
    expect(d.groups[0]?.shortcutIds).toEqual(['s']);
    expect(d.groups[1]?.shortcutIds).toEqual([]);
  });

  it.each(['constructor', 'toString', 'hasOwnProperty'])('drops a reference to the inherited name %s, which would break the page', (name) => {
    const d = normalizeDashboard({ groups: [{ id: 'a', name: 'A', shortcutIds: [name, 's'] }], shortcuts: { s: { url: 'https://ok.example' } } }, newId);
    expect(d.groups[0]?.shortcutIds).toEqual(['s']);
  });

  it('keeps real shortcuts that happen to use those names, without touching the object', () => {
    const shortcuts = JSON.parse('{"__proto__":{"url":"https://proto.example"},"constructor":{"url":"https://ctor.example"}}') as unknown;
    const d = normalizeDashboard({ groups: [{ id: 'a', name: 'A', shortcutIds: ['__proto__', 'constructor'] }], shortcuts }, newId);
    expect(d.groups[0]?.shortcutIds).toEqual(['__proto__', 'constructor']);
    expect(Object.keys(d.shortcuts).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(d.shortcuts)).toBe(Object.prototype);
    expect(structuredClone(d)).toEqual(d);
  });

  it('drops orphan shortcuts, which could otherwise never be seen or deleted', () => {
    const d = normalizeDashboard({ groups: [{ id: 'a', name: 'A', shortcutIds: [] }], shortcuts: { s: { url: 'https://ok.example' } } }, newId);
    expect(d.shortcuts).toEqual({});
  });

  it('gives a nameless shortcut a title and a tile', () => {
    const d = normalizeDashboard({ groups: [{ id: 'a', name: 'A', shortcutIds: ['s'] }], shortcuts: { s: { url: 'https://ok.example' } } }, newId);
    expect(d.shortcuts.s?.title).toBe('ok.example');
    expect(d.shortcuts.s?.tile.kind).toBe('letter');
  });
});

describe('normalizeSearch', () => {
  it('always restores built-in engines with their clean addresses', () => {
    const s = normalizeSearch({ engines: [{ id: 'google', name: 'Google', url: 'https://www.google.com/search?partner=abc&q=%s', builtIn: true }] });
    expect(s.engines.find((e) => e.id === 'google')?.url).toBe('https://www.google.com/search?q=%s');
  });

  it('keeps valid custom engines and drops invalid ones', () => {
    const s = normalizeSearch({
      engines: [
        { id: 'mine', name: 'Mine', url: 'https://mine.example/?q=%s' },
        { id: 'noplaceholder', name: 'X', url: 'https://x.example/' },
        { id: 'js', name: 'Y', url: 'javascript:alert("%s")' },
      ],
    });
    expect(s.engines.map((e) => e.id)).toContain('mine');
    expect(s.engines.map((e) => e.id)).not.toContain('noplaceholder');
    expect(s.engines.map((e) => e.id)).not.toContain('js');
  });

  it('falls back when the active engine is gone', () => {
    expect(normalizeSearch({ activeEngineId: 'deleted' }).activeEngineId).toBe('browser');
  });

  it('caps history', () => {
    expect(normalizeSearch({ history: Array.from({ length: 200 }, (_, i) => `q${i}`) }).history).toHaveLength(50);
  });

  it('validates engine templates', () => {
    expect(engineUrlIsValid('https://a.example/?q=%s')).toBe(true);
    expect(engineUrlIsValid('https://a.example/')).toBe(false);
  });
});

describe('normalizeState', () => {
  it('survives completely empty storage', () => {
    const state = normalizeState({}, newId);
    expect(state.dashboard.groups).toHaveLength(1);
    expect(state.settings).toEqual(defaultSettings());
  });

  it('is stable when applied twice', () => {
    const once = normalizeState({}, () => 'fixed');
    expect(normalizeState(once, () => 'other')).toEqual(once);
  });
});
