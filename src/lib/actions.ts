import * as dash from './dashboard';
import { type Shortcut } from './model';
import { listImageIds, removeImage } from './images';
import { flush, readSavedState, update } from './store';

const IMAGE_LOCK = 'landing-tab-images';

/**
 * For anything that stores an image and then records it. Until the record is
 * saved the image looks unused, so cleanup in any tab waits for this to finish.
 */
export function storingImages<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks.request(IMAGE_LOCK, async () => {
    try {
      return await work();
    } finally {
      await flush();
    }
  });
}

/**
 * Deletes stored images nothing refers to any more, such as a replaced tile icon.
 * Does nothing where image storage can't be reached, as in a Firefox private window.
 */
export function collectUnusedImages(): Promise<void> {
  return navigator.locks.request(IMAGE_LOCK, async () => {
    await flush();
    const used = dash.referencedImageIds(await readSavedState());
    const stored = await listImageIds().catch(() => []);
    await Promise.all(stored.filter((id) => !used.has(id)).map(removeImage));
  });
}

const RESTORE_CHANNEL = 'landing-tab-restore';
const RESTORED_FLAG = 'landing-tab-restored';

/** Open pages keep what they've already loaded, including which images were missing. */
export function reloadAfterRestore(): void {
  sessionStorage.setItem(RESTORED_FLAG, '1');
  const channel = new BroadcastChannel(RESTORE_CHANNEL);
  channel.postMessage('restored');
  channel.close();
  location.reload();
}

/** Reloads this page when a backup is restored in another one. */
export function followRestores(): void {
  new BroadcastChannel(RESTORE_CHANNEL).onmessage = () => location.reload();
}

/** True once after a restore in this tab, so the reloaded page can confirm it. */
export function takeRestoredFlag(): boolean {
  const restored = sessionStorage.getItem(RESTORED_FLAG) !== null;
  sessionStorage.removeItem(RESTORED_FLAG);
  return restored;
}

export function saveShortcut(shortcut: Shortcut, groupId: string): void {
  update('dashboard', (d) => {
    if (d.shortcuts[shortcut.id]) d.shortcuts[shortcut.id] = shortcut;
    else dash.addShortcut(d, groupId, shortcut);
  });
  void collectUnusedImages();
}

export function deleteShortcuts(ids: Iterable<string>): void {
  update('dashboard', (d) => dash.removeShortcuts(d, ids));
  void collectUnusedImages();
}

export function deleteGroup(groupId: string): void {
  update('dashboard', (d) => {
    dash.removeGroup(d, groupId);
  });
  void collectUnusedImages();
}

/** Advances to the next wallpaper in the local library. */
export function nextWallpaper(now = Date.now()): void {
  update('settings', (s) => {
    const { imageIds, activeImageId } = s.wallpaper;
    if (imageIds.length === 0) return;
    const index = activeImageId === null ? -1 : imageIds.indexOf(activeImageId);
    s.wallpaper.activeImageId = imageIds[(index + 1) % imageIds.length] ?? null;
    s.wallpaper.lastRotatedAt = now;
  });
}

export function isRotationDue(rotateMinutes: number, lastRotatedAt: number, imageCount: number, now: number): boolean {
  return rotateMinutes > 0 && imageCount > 1 && now - lastRotatedAt >= rotateMinutes * 60_000;
}
