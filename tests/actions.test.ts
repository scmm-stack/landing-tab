import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ saved: {} as Record<string, unknown> }));

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: async () => disk.saved, set: async () => undefined } } },
}));

import { collectUnusedImages, storingImages } from '../src/lib/actions';
import { deleteImage, listImageIds, saveImage } from '../src/lib/images';

const image = new Blob(['x'], { type: 'image/png' });

const savedWith = (imageId?: string) => ({
  dashboard: {
    groups: [{ id: 'g', name: 'Group', symbol: '', shortcutIds: imageId ? ['s'] : [] }],
    shortcuts: imageId ? { s: { title: 'Site', url: 'https://site.example/', tile: { kind: 'image', imageId } } } : {},
  },
});

describe('collectUnusedImages', () => {
  beforeEach(async () => {
    disk.saved = savedWith();
    await Promise.all((await listImageIds()).map(deleteImage));
  });

  it('deletes images nothing refers to and keeps the rest', async () => {
    disk.saved = savedWith('used');
    await saveImage('used', image);
    await saveImage('unused', image);
    await collectUnusedImages();
    expect(await listImageIds()).toEqual(['used']);
  });

  it('waits for an image still being recorded, so a restore or save keeps it', async () => {
    let finish = () => {};
    const saving = storingImages(async () => {
      await saveImage('arriving', image);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await vi.waitFor(async () => expect(await listImageIds()).toContain('arriving'));

    const cleanup = collectUnusedImages();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await listImageIds()).toContain('arriving');

    disk.saved = savedWith('arriving');
    finish();
    await Promise.all([saving, cleanup]);
    expect(await listImageIds()).toEqual(['arriving']);
  });

  it('lets cleanup run after work that failed', async () => {
    await saveImage('unused', image);
    await expect(storingImages(() => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full');
    await collectUnusedImages();
    expect(await listImageIds()).toEqual([]);
  });
});
