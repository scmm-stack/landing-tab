import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRotationDue } from '../src/lib/actions';
import {
  LIBRARY_FILE_NAME,
  LISTING_URL,
  MAX_LIBRARY_IMAGE_BYTES,
  RAW_BASE,
  currentEntry,
  nextEntry,
  parseListing,
} from '../src/lib/library';
import { LIBRARY_INTERVALS, defaultSettings } from '../src/lib/model';
import { normalizeSettings } from '../src/lib/normalize';

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: async () => ({}), set: async () => undefined } } },
}));

const DAY = 24 * 60 * 60_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const file = (name: string, sha = `sha-${name}`, extra: Record<string, unknown> = {}) => ({
  type: 'file',
  name,
  sha,
  size: 1000,
  download_url: RAW_BASE + name,
  ...extra,
});

describe('parseListing', () => {
  it('keeps images from the library folder, in name order', () => {
    const entries = parseListing([file('b-lake.jpg'), file('a-hill.webp'), file('c.JPEG')]);
    expect(entries.map((e) => e.name)).toEqual(['a-hill.webp', 'b-lake.jpg', 'c.JPEG']);
  });

  it('skips folders, other files, oversized images and foreign addresses', () => {
    const entries = parseListing([
      { ...file('nested.jpg'), type: 'dir' },
      file('README.md'),
      file('vector.svg'),
      file('huge.jpg', 'x', { size: MAX_LIBRARY_IMAGE_BYTES + 1 }),
      file('empty.jpg', 'x', { size: 0 }),
      file('elsewhere.jpg', 'x', { download_url: 'https://example.com/elsewhere.jpg' }),
      file('no-sha.jpg', ''),
      file('with space.jpg'),
      'not an object',
    ]);
    expect(entries).toEqual([]);
  });

  it('treats anything but a list as empty', () => {
    expect(parseListing({ message: 'API rate limit exceeded' })).toEqual([]);
    expect(parseListing(null)).toEqual([]);
  });
});

describe('choosing the image', () => {
  const entries = parseListing([file('a.jpg'), file('b.jpg'), file('c.jpg')]);

  it('starts at the first image and wraps around', () => {
    expect(currentEntry(entries, null)?.name).toBe('a.jpg');
    expect(nextEntry(entries, null)?.name).toBe('b.jpg');
    expect(nextEntry(entries, 'b.jpg')?.name).toBe('c.jpg');
    expect(nextEntry(entries, 'c.jpg')?.name).toBe('a.jpg');
  });

  it('carries on from the first image when the remembered one was removed', () => {
    expect(currentEntry(entries, 'gone.jpg')?.name).toBe('a.jpg');
    expect(nextEntry(entries, 'gone.jpg')?.name).toBe('b.jpg');
  });

  it('has nothing to show from an empty library', () => {
    expect(currentEntry([], null)).toBeNull();
    expect(nextEntry([], null)).toBeNull();
  });
});

describe('library interval', () => {
  it.each(LIBRARY_INTERVALS.filter((m) => m > 0))('changes after %i minutes, even when the browser was closed meanwhile', (minutes) => {
    const changedAt = 1_000_000;
    expect(isRotationDue(minutes, changedAt, 3, changedAt + minutes * 60_000 - 1)).toBe(false);
    // A restart is just a later clock reading against the stored time.
    expect(isRotationDue(minutes, changedAt, 3, changedAt + minutes * 60_000)).toBe(true);
    expect(isRotationDue(minutes, changedAt, 3, changedAt + 30 * DAY)).toBe(true);
  });

  it('never changes when set to never', () => {
    expect(isRotationDue(0, 0, 3, 30 * DAY)).toBe(false);
  });
});

describe('library settings', () => {
  it('accepts the library as a wallpaper type', () => {
    expect(normalizeSettings({ wallpaper: { source: 'library' } }).wallpaper.source).toBe('library');
  });

  it('drops a stored image name that the library could never offer', () => {
    expect(normalizeSettings({ wallpaper: { libraryImage: '../secret.jpg' } }).wallpaper.libraryImage).toBeNull();
    expect(normalizeSettings({ wallpaper: { libraryImage: 'lake.jpg' } }).wallpaper.libraryImage).toBe('lake.jpg');
  });

  it('only keeps the offered intervals', () => {
    expect(normalizeSettings({ wallpaper: { libraryRotateMinutes: 120 } }).wallpaper.libraryRotateMinutes).toBe(120);
    expect(normalizeSettings({ wallpaper: { libraryRotateMinutes: 7 } }).wallpaper.libraryRotateMinutes).toBe(defaultSettings().wallpaper.libraryRotateMinutes);
  });
});

/** A stand-in for GitHub: the listing, then images by name. */
function fakeGitHub() {
  const state = {
    listing: [file('a.jpg'), file('b.jpg')] as unknown,
    images: new Map<string, Uint8Array>([
      ['a.jpg', JPEG],
      ['b.jpg', JPEG],
    ]),
    offline: false,
    calls: [] as string[],
  };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    state.calls.push(url);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    if (state.offline) throw new TypeError('Failed to fetch');
    if (url === LISTING_URL) return new Response(JSON.stringify(state.listing));
    const bytes = url.startsWith(RAW_BASE) ? state.images.get(url.slice(RAW_BASE.length)) : undefined;
    return bytes ? new Response(bytes.slice()) : new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return state;
}

/** A fresh copy of the module, as after a browser restart, sharing the same storage. */
const restart = async () => {
  vi.resetModules();
  return import('../src/lib/library');
};

describe('fetching the library', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the list at most once a day, across restarts', async () => {
    const github = fakeGitHub();
    const first = await restart();
    expect((await first.getLibrary(0)).map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
    const second = await restart();
    await second.getLibrary(DAY - 1);
    expect(github.calls.filter((u) => u === LISTING_URL)).toHaveLength(1);

    github.listing = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    expect((await second.getLibrary(DAY)).map((e) => e.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(github.calls.filter((u) => u === LISTING_URL)).toHaveLength(2);
  });

  it('keeps the last good list when GitHub refuses, and waits before asking again', async () => {
    const github = fakeGitHub();
    const library = await restart();
    await library.getLibrary(0);
    github.listing = { message: 'API rate limit exceeded' };
    expect((await library.getLibrary(DAY)).map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
    await library.getLibrary(DAY + 60_000);
    expect(github.calls.filter((u) => u === LISTING_URL)).toHaveLength(2);
  });

  it('is empty when the library has never been reached', async () => {
    const github = fakeGitHub();
    github.offline = true;
    const library = await restart();
    expect(await library.getLibrary(0)).toEqual([]);
  });

  it('downloads an image once and keeps it across restarts', async () => {
    const github = fakeGitHub();
    const library = await restart();
    const [a] = await library.getLibrary(0);
    expect(await library.getLibraryImage(a!)).toBeInstanceOf(Blob);
    const again = await restart();
    const blob = await again.getLibraryImage(a!);
    expect(blob?.type).toBe('image/jpeg');
    expect(github.calls.filter((u) => u === `${RAW_BASE}a.jpg`)).toHaveLength(1);
  });

  it('downloads a replaced image again, but shows the old one while offline', async () => {
    const github = fakeGitHub();
    const library = await restart();
    await library.getLibraryImage({ name: 'a.jpg', sha: 'one' });
    await library.getLibraryImage({ name: 'a.jpg', sha: 'two' });
    expect(github.calls.filter((u) => u === `${RAW_BASE}a.jpg`)).toHaveLength(2);

    github.offline = true;
    const offline = await restart();
    expect(await offline.getLibraryImage({ name: 'a.jpg', sha: 'three' })).toBeInstanceOf(Blob);
  });

  it('refuses a download that is not an image', async () => {
    const github = fakeGitHub();
    github.images.set('a.jpg', new TextEncoder().encode('<html>'));
    const library = await restart();
    expect(await library.getLibraryImage({ name: 'a.jpg', sha: 'one' })).toBeNull();
  });

  it('forgets images that left the library', async () => {
    const github = fakeGitHub();
    const library = await restart();
    await library.getLibraryImage({ name: 'b.jpg', sha: 'sha-b.jpg' });
    github.listing = [file('a.jpg')];
    await library.getLibrary(0);
    github.offline = true;
    const later = await restart();
    expect(await later.getLibraryImage({ name: 'b.jpg', sha: 'sha-b.jpg' })).toBeNull();
  });
});

describe('the library folder in this repository', () => {
  const dir = join(import.meta.dirname, '..', 'library');
  const images = readdirSync(dir).filter((name) => name !== 'README.md');

  it.each(images)('%s is offered by the extension', (name) => {
    expect(name).toMatch(LIBRARY_FILE_NAME);
    expect(statSync(join(dir, name)).size).toBeLessThanOrEqual(MAX_LIBRARY_IMAGE_BYTES);
    const head = readFileSync(join(dir, name)).subarray(0, 12);
    const ok = /\.webp$/i.test(name) ? head.toString('latin1', 8, 12) === 'WEBP' : head[0] === 0xff && head[1] === 0xd8;
    expect(ok).toBe(true);
  });

  it('is never named in the extension code', () => {
    const sources: string[] = [];
    const walk = (path: string) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(path, entry.name));
        else sources.push(readFileSync(join(path, entry.name), 'utf8'));
      }
    };
    walk(join(import.meta.dirname, '..', 'src'));
    for (const name of images) expect(sources.some((text) => text.includes(name))).toBe(false);
  });
});
