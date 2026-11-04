import { readCapped } from './stream';

/**
 * ONE OF TWO MODULES ALLOWED TO USE THE NETWORK. The other is favicon.ts.
 *
 * The extension's own wallpapers live in the library folder of its public
 * repository rather than in the extension, so new ones arrive without a release.
 * Nothing here names an image: the folder is listed, and every file that passes
 * the checks below is offered. It runs only while the library is the chosen
 * wallpaper. The list is asked for at most once a day and each image once, with
 * no cookies and no referrer, and both are kept on the device.
 */

export const LISTING_URL = 'https://api.github.com/repos/scmm-stack/landing-tab/contents/library?ref=main';
export const RAW_BASE = 'https://raw.githubusercontent.com/scmm-stack/landing-tab/main/library/';

export const MAX_LIBRARY_IMAGE_BYTES = 8 * 1024 * 1024;
export const LIBRARY_FILE_NAME = /^[\w.-]+\.(?:jpe?g|webp)$/i;

const MAX_LISTING_BYTES = 512 * 1024;
const LISTING_MAX_AGE_MS = 24 * 60 * 60_000;
// After a failure, such as being offline or over GitHub's hourly limit, the list
// isn't asked for again for a while, however many tabs are opened.
const RETRY_AFTER_MS = 10 * 60_000;
const LISTING_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 60_000;

export interface LibraryEntry {
  name: string;
  /** Changes whenever the file does, so a replaced image is downloaded again. */
  sha: string;
}

interface CachedListing {
  entries: LibraryEntry[];
  checkedAt: number;
  failedAt: number;
}

interface CachedFile {
  sha: string;
  blob: Blob;
}

const REQUEST: RequestInit = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  redirect: 'follow',
  mode: 'cors',
};

async function get(url: string, limit: number, timeoutMs: number): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...REQUEST, signal: controller.signal });
    if (!response.ok) return null;
    return await readCapped(response, limit);
  } finally {
    clearTimeout(timer);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps only images in the folder itself, small enough, and served from the library's own address. */
export function parseListing(json: unknown): LibraryEntry[] {
  if (!Array.isArray(json)) return [];
  const byName = new Map<string, LibraryEntry>();
  for (const item of json) {
    if (!isRecord(item)) continue;
    const { type, name, sha, size, download_url: downloadUrl } = item;
    if (type !== 'file' || typeof name !== 'string' || !LIBRARY_FILE_NAME.test(name)) continue;
    if (typeof sha !== 'string' || !sha) continue;
    if (typeof size !== 'number' || size <= 0 || size > MAX_LIBRARY_IMAGE_BYTES) continue;
    if (downloadUrl !== RAW_BASE + encodeURIComponent(name)) continue;
    byName.set(name, { name, sha });
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The image to show: the remembered one, or the first when it's gone or none is remembered. */
export function currentEntry(entries: LibraryEntry[], name: string | null): LibraryEntry | null {
  return entries.find((e) => e.name === name) ?? entries[0] ?? null;
}

export function nextEntry(entries: LibraryEntry[], name: string | null): LibraryEntry | null {
  const current = currentEntry(entries, name);
  if (!current) return null;
  return entries[(entries.indexOf(current) + 1) % entries.length] ?? null;
}

// Storage. A separate database from the user's own images, so backups and image
// cleanup never see these. Where IndexedDB can't be reached, as in a Firefox
// private window, the copies in memory last for the page.

const DB_NAME = 'landing-tab-library';
const FILES = 'files';
const META = 'meta';
const LISTING_KEY = 'listing';

const memory: { listing: CachedListing | null; files: Map<string, CachedFile> } = { listing: null, files: new Map() };
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FILES);
      request.result.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Could not open library storage'));
    };
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? new Error('Library storage failed'));
        tx.onabort = () => reject(tx.error ?? new Error('Library storage was aborted'));
      }),
  );
}

async function readListing(): Promise<CachedListing | null> {
  const stored = await run<CachedListing | undefined>(META, 'readonly', (s) => s.get(LISTING_KEY)).catch(() => undefined);
  return stored ?? memory.listing;
}

async function writeListing(listing: CachedListing): Promise<void> {
  memory.listing = listing;
  await run(META, 'readwrite', (s) => s.put(listing, LISTING_KEY)).catch(() => undefined);
}

async function readFile(name: string): Promise<CachedFile | null> {
  const stored = await run<CachedFile | undefined>(FILES, 'readonly', (s) => s.get(name)).catch(() => undefined);
  return stored ?? memory.files.get(name) ?? null;
}

async function writeFile(name: string, file: CachedFile): Promise<void> {
  // Kept in memory only when it can't be stored, so a page doesn't hold every image twice.
  await run(FILES, 'readwrite', (s) => s.put(file, name)).catch(() => void memory.files.set(name, file));
}

async function prune(entries: LibraryEntry[]): Promise<void> {
  const keep = new Set(entries.map((e) => e.name));
  for (const name of memory.files.keys()) if (!keep.has(name)) memory.files.delete(name);
  const stored = await run<IDBValidKey[]>(FILES, 'readonly', (s) => s.getAllKeys()).catch(() => []);
  await Promise.all(
    stored
      .map(String)
      .filter((name) => !keep.has(name))
      .map((name) => run(FILES, 'readwrite', (s) => s.delete(name)).catch(() => undefined)),
  );
}

// The list.

async function refresh(now: number): Promise<LibraryEntry[]> {
  const cached = await readListing();
  const fresh = cached !== null && now - cached.checkedAt < LISTING_MAX_AGE_MS;
  const waiting = cached !== null && now - cached.failedAt < RETRY_AFTER_MS;
  if (fresh || waiting) return cached.entries;

  const bytes = await get(LISTING_URL, MAX_LISTING_BYTES, LISTING_TIMEOUT_MS).catch(() => null);
  let entries: LibraryEntry[] | null = null;
  if (bytes) {
    try {
      const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (Array.isArray(json)) entries = parseListing(json);
    } catch {
      // Not a listing, so it counts as a failure and the last good one stays.
    }
  }
  if (entries === null) {
    await writeListing({ entries: cached?.entries ?? [], checkedAt: cached?.checkedAt ?? 0, failedAt: now });
    return cached?.entries ?? [];
  }
  await writeListing({ entries, checkedAt: now, failedAt: 0 });
  await prune(entries);
  return entries;
}

let pendingListing: Promise<LibraryEntry[]> | null = null;

/** The images on offer. Empty when the library has never been reached. */
export function getLibrary(now = Date.now()): Promise<LibraryEntry[]> {
  pendingListing ??= refresh(now).finally(() => {
    pendingListing = null;
  });
  return pendingListing;
}

// The images.

function looksLikeImage(bytes: Uint8Array, name: string): boolean {
  if (/\.webp$/i.test(name)) {
    const text = String.fromCharCode(...bytes.subarray(0, 12));
    return text.startsWith('RIFF') && text.endsWith('WEBP');
  }
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function loadImage(entry: LibraryEntry): Promise<Blob | null> {
  const cached = await readFile(entry.name);
  if (cached?.sha === entry.sha) return cached.blob;
  const bytes = await get(RAW_BASE + encodeURIComponent(entry.name), MAX_LIBRARY_IMAGE_BYTES, IMAGE_TIMEOUT_MS).catch(() => null);
  // An older copy of a replaced image is still better than none while offline.
  if (!bytes || !looksLikeImage(bytes, entry.name)) return cached?.blob ?? null;
  const blob = new Blob([bytes.slice().buffer], { type: /\.webp$/i.test(entry.name) ? 'image/webp' : 'image/jpeg' });
  await writeFile(entry.name, { sha: entry.sha, blob });
  return blob;
}

const imageLoads = new Map<string, Promise<Blob | null>>();
const urls = new Map<string, Promise<string | null>>();
const keyOf = (entry: LibraryEntry) => `${entry.name}@${entry.sha}`;

/** The image, from the device when it's there, otherwise downloaded once. Null when it can't be had. */
export function getLibraryImage(entry: LibraryEntry): Promise<Blob | null> {
  const key = keyOf(entry);
  let load = imageLoads.get(key);
  if (!load) {
    load = loadImage(entry)
      .catch(() => null)
      .then((blob) => {
        // A failure isn't remembered, so the next try can succeed.
        if (!blob) imageLoads.delete(key);
        return blob;
      });
    imageLoads.set(key, load);
  }
  return load;
}

export function libraryImageUrl(entry: LibraryEntry): Promise<string | null> {
  const key = keyOf(entry);
  let url = urls.get(key);
  if (!url) {
    url = getLibraryImage(entry).then((blob) => {
      if (blob) return URL.createObjectURL(blob);
      urls.delete(key);
      return null;
    });
    urls.set(key, url);
  }
  return url;
}
