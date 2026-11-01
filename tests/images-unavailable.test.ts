import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: async () => ({}), set: async () => undefined } } },
}));

import { collectUnusedImages } from '../src/lib/actions';
import { imageUrl, saveImage } from '../src/lib/images';

/** What a Firefox private window does: every open fails. */
const refusingStorage = {
  open() {
    const request: { error: DOMException; onerror?: () => void } = { error: new DOMException('No mutations', 'InvalidStateError') };
    queueMicrotask(() => request.onerror?.());
    return request;
  },
};

describe('when image storage cannot be reached', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports no image instead of rejecting', async () => {
    vi.stubGlobal('indexedDB', refusingStorage);
    await expect(imageUrl('tile')).resolves.toBeNull();
  });

  it('skips cleanup without an error', async () => {
    vi.stubGlobal('indexedDB', refusingStorage);
    await expect(collectUnusedImages()).resolves.toBeUndefined();
  });

  it('tries again once storage is back', async () => {
    vi.stubGlobal('indexedDB', refusingStorage);
    await imageUrl('later');
    vi.stubGlobal('indexedDB', new IDBFactory());
    await saveImage('later', new Blob(['x'], { type: 'image/png' }));
    expect(await imageUrl('later')).toMatch(/^blob:/);
  });
});
