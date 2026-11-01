import { referencedImageIds } from './dashboard';
import { type AppState, SCHEMA_VERSION } from './model';
import { MAX_WALLPAPER_BYTES, isAllowedImage } from './images';
import { normalizeState } from './normalize';

export const BACKUP_FORMAT = 'landing-tab-backup';

export interface BackupImage {
  id: string;
  type: string;
  data: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  state: Omit<AppState, 'session'>;
  images: BackupImage[];
}

export interface ImageAccess {
  load(id: string): Promise<Blob | undefined>;
  save(id: string, blob: Blob): Promise<unknown>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function createBackup(state: AppState, images: Pick<ImageAccess, 'load'>, now = new Date()): Promise<BackupFile> {
  const entries: BackupImage[] = [];
  for (const id of referencedImageIds(state)) {
    const blob = await images.load(id);
    if (!blob) continue;
    entries.push({ id, type: blob.type, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  const { dashboard, search, settings } = state;
  return {
    format: BACKUP_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    state: { dashboard, search, settings },
    images: entries,
  };
}

export class BackupError extends Error {}

/** Checks a backup without changing anything. Throws BackupError if it can't be used. */
export function parseBackup(text: string, newId: () => string): { state: AppState; images: { id: string; blob: Blob }[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('not-json');
  }
  const file = raw as Partial<BackupFile> | null;
  if (typeof file !== 'object' || file === null || file.format !== BACKUP_FORMAT) throw new BackupError('wrong-format');
  if (typeof file.version !== 'number' || file.version > SCHEMA_VERSION) throw new BackupError('newer-version');

  const state = normalizeState({ ...file.state, session: { lastGroupId: null } }, newId);
  const images: { id: string; blob: Blob }[] = [];
  for (const entry of Array.isArray(file.images) ? file.images : []) {
    if (typeof entry?.id !== 'string' || typeof entry.type !== 'string' || typeof entry.data !== 'string') continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ToBytes(entry.data);
    } catch {
      continue;
    }
    const blob = new Blob([bytes], { type: entry.type });
    if (isAllowedImage(blob) && blob.size <= MAX_WALLPAPER_BYTES) images.push({ id: entry.id, blob });
  }

  // A shortcut whose image didn't survive falls back to a letter tile instead of a broken icon.
  const available = new Set(images.map((i) => i.id));
  for (const shortcut of Object.values(state.dashboard.shortcuts)) {
    if (shortcut.tile.kind === 'image' && !available.has(shortcut.tile.imageId)) {
      shortcut.tile = { kind: 'letter', text: Array.from(shortcut.title).slice(0, 2).join('') };
    }
  }
  const wallpaper = state.settings.wallpaper;
  wallpaper.imageIds = wallpaper.imageIds.filter((id) => available.has(id));
  if (wallpaper.imageIds.length === 0 && wallpaper.source === 'image') wallpaper.source = 'scene';
  return { state: normalizeState(state, newId), images };
}

export function backupFileName(now = new Date()): string {
  return `landing-tab-backup-${now.toISOString().slice(0, 10)}.json`;
}
