import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BackupError, base64ToBytes, bytesToBase64, createBackup, parseBackup } from '../src/lib/backup';
import { defaultSettings, defaultState } from '../src/lib/model';

let counter = 0;
const newId = () => `id-${++counter}`;

function sampleState() {
  const state = defaultState(() => 'g1');
  state.dashboard.shortcuts = {
    a: { id: 'a', title: 'Alpha', url: 'https://a.example/', note: '', tile: { kind: 'image', imageId: 'img-a', scale: 100 }, color: '#ffffff' },
    b: { id: 'b', title: 'Beta', url: 'https://b.example/', note: 'n', tile: { kind: 'letter', text: 'Be' }, color: '#112233' },
  };
  state.dashboard.groups[0]!.shortcutIds = ['a', 'b'];
  state.settings = defaultSettings();
  state.settings.wallpaper.imageIds = ['wall'];
  state.settings.wallpaper.activeImageId = 'wall';
  state.settings.wallpaper.source = 'image';
  return state;
}

const stored: Record<string, Blob> = {
  'img-a': new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' }),
  wall: new Blob([new Uint8Array(70_000).fill(9)], { type: 'image/jpeg' }),
  orphan: new Blob([new Uint8Array([7])], { type: 'image/png' }),
};
const images = { load: async (id: string) => stored[id] };

describe('base64', () => {
  it('round-trips every byte value, in sizes larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('backup round trip', () => {
  it('restores shortcuts, settings and image bytes', async () => {
    const state = sampleState();
    const text = JSON.stringify(await createBackup(state, images, new Date('2026-01-02T03:04:05Z')));
    const restored = parseBackup(text, newId);

    expect(restored.state.dashboard).toEqual(state.dashboard);
    expect(restored.state.settings).toEqual(state.settings);

    const image = restored.images.find((i) => i.id === 'img-a');
    expect(image?.blob.type).toBe('image/png');
    expect(new Uint8Array(await image!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 250]));
  });

  it('includes only images still in use', async () => {
    const backup = await createBackup(sampleState(), images);
    expect(backup.images.map((i) => i.id).sort()).toEqual(['img-a', 'wall']);
  });

  it('leaves out per-tab session state', async () => {
    const backup = await createBackup(sampleState(), images);
    expect(backup.state).not.toHaveProperty('session');
  });
});

describe('backups from before tasks were removed', () => {
  it('still restore, leaving the tasks behind', async () => {
    const backup = await createBackup(sampleState(), images, new Date('2026-01-02T03:04:05Z'));
    const older = { ...backup, state: { ...backup.state, todos: [{ id: 't', text: 'Buy milk' }], settings: { ...backup.state.settings, todos: { showBadge: true } } } };
    const restored = parseBackup(JSON.stringify(older), newId);
    expect(restored.state.dashboard.groups).toHaveLength(1);
    expect(restored.state).not.toHaveProperty('todos');
    expect(restored.state.settings).not.toHaveProperty('todos');
  });
});

describe('parseBackup rejects', () => {
  const reason = (text: string) => {
    try {
      parseBackup(text, newId);
      return 'accepted';
    } catch (error) {
      expect(error).toBeInstanceOf(BackupError);
      return (error as Error).message;
    }
  };

  it('files that are not JSON', () => expect(reason('not json')).toBe('not-json'));
  it('unrelated JSON', () => expect(reason('{"hello":1}')).toBe('wrong-format'));
  it('null', () => expect(reason('null')).toBe('wrong-format'));
  it('backups from a newer version', () => {
    expect(reason(JSON.stringify({ format: BACKUP_FORMAT, version: 999 }))).toBe('newer-version');
  });
});

describe('parseBackup sanitizes', () => {
  const file = (state: unknown, list: unknown[] = []) => JSON.stringify({ format: BACKUP_FORMAT, version: 1, state, images: list });

  it('removes unsafe shortcuts from a tampered file', () => {
    const { state } = parseBackup(
      file({
        dashboard: {
          groups: [{ id: 'g', name: 'G', shortcutIds: ['x'] }],
          shortcuts: { x: { title: 'Bad', url: 'javascript:alert(1)' } },
        },
      }),
      newId,
    );
    expect(state.dashboard.shortcuts).toEqual({});
  });

  it('skips images of disallowed types', () => {
    const { images: kept } = parseBackup(file({}, [{ id: 'h', type: 'text/html', data: btoa('<script>') }]), newId);
    expect(kept).toEqual([]);
  });

  it('skips corrupt image data instead of failing the whole restore', () => {
    const { images: kept } = parseBackup(file({}, [{ id: 'c', type: 'image/png', data: '***not base64***' }]), newId);
    expect(kept).toEqual([]);
  });

  it('turns a shortcut with a missing image into a letter tile', () => {
    const { state } = parseBackup(
      file({
        dashboard: {
          groups: [{ id: 'g', name: 'G', shortcutIds: ['x'] }],
          shortcuts: { x: { title: 'Site', url: 'https://x.example', tile: { kind: 'image', imageId: 'lost', scale: 100 } } },
        },
      }),
      newId,
    );
    expect(state.dashboard.shortcuts.x?.tile).toEqual({ kind: 'letter', text: 'Si' });
  });

  it('forgets wallpapers whose image is missing', () => {
    const { state } = parseBackup(file({ settings: { wallpaper: { source: 'image', imageIds: ['lost'], activeImageId: 'lost' } } }), newId);
    expect(state.settings.wallpaper.imageIds).toEqual([]);
    expect(state.settings.wallpaper.source).toBe('scene');
  });
});
