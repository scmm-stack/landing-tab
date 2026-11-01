/**
 * Images are kept as Blobs in IndexedDB rather than as base64 in storage.local,
 * so large wallpapers don't have to be parsed on every new tab.
 */
const DB_NAME = 'landing-tab-images';
const STORE = 'images';

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
export const MAX_TILE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_WALLPAPER_BYTES = 30 * 1024 * 1024;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Could not open image storage'));
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? new Error('Image storage failed'));
        tx.onabort = () => reject(tx.error ?? new Error('Image storage was aborted'));
      }),
  );
}

export const saveImage = (id: string, blob: Blob): Promise<IDBValidKey> => run('readwrite', (s) => s.put(blob, id));
export const loadImage = (id: string): Promise<Blob | undefined> => run<Blob | undefined>('readonly', (s) => s.get(id));
export const deleteImage = (id: string): Promise<undefined> => run('readwrite', (s) => s.delete(id));
export const listImageIds = async (): Promise<string[]> =>
  (await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String);

export function isAllowedImage(blob: Blob): boolean {
  return ALLOWED_IMAGE_TYPES.includes(blob.type.split(';')[0]?.trim().toLowerCase() ?? '');
}

const urlCache = new Map<string, Promise<string | null>>();

/** Object URL for a stored image, cached for the lifetime of the page. */
export function imageUrl(id: string): Promise<string | null> {
  let cached = urlCache.get(id);
  if (!cached) {
    cached = loadImage(id).then((blob) => (blob ? URL.createObjectURL(blob) : null));
    urlCache.set(id, cached);
  }
  return cached;
}

export function forgetImageUrl(id: string): void {
  const cached = urlCache.get(id);
  urlCache.delete(id);
  void cached?.then((url) => url && URL.revokeObjectURL(url));
}

/** Removes an image from disk and from this page's cache. */
export async function removeImage(id: string): Promise<void> {
  forgetImageUrl(id);
  await deleteImage(id);
}

/** Decodes a local Blob into an element, for canvas use. Accepts only local object URLs. */
export function decodeBlob(blob: Blob): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image could not be read'));
    };
    image.src = url;
  });
}
