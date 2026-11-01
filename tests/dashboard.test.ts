import { describe, expect, it } from 'vitest';
import * as dash from '../src/lib/dashboard';
import type { Dashboard, Shortcut } from '../src/lib/model';

const shortcut = (id: string, imageId?: string): Shortcut => ({
  id,
  title: id,
  url: `https://${id}.example/`,
  note: '',
  tile: imageId ? { kind: 'image', imageId, scale: 100 } : { kind: 'letter', text: 'A' },
  color: '#000000',
});

function board(): Dashboard {
  return {
    groups: [
      { id: 'g1', name: 'One', symbol: '', shortcutIds: ['a', 'b', 'c'] },
      { id: 'g2', name: 'Two', symbol: '', shortcutIds: ['d'] },
      { id: 'g3', name: 'Three', symbol: '', shortcutIds: [] },
    ],
    shortcuts: { a: shortcut('a'), b: shortcut('b'), c: shortcut('c', 'img1'), d: shortcut('d') },
  };
}

const ids = (d: Dashboard, index: number) => d.groups[index]?.shortcutIds;

describe('moveShortcut', () => {
  it('moves forward within a group, accounting for the removed item', () => {
    const d = board();
    dash.moveShortcut(d, 'a', 'g1', 2);
    expect(ids(d, 0)).toEqual(['b', 'a', 'c']);
  });

  it('moves to the end of a group', () => {
    const d = board();
    dash.moveShortcut(d, 'a', 'g1', 3);
    expect(ids(d, 0)).toEqual(['b', 'c', 'a']);
  });

  it('moves backward within a group', () => {
    const d = board();
    dash.moveShortcut(d, 'c', 'g1', 0);
    expect(ids(d, 0)).toEqual(['c', 'a', 'b']);
  });

  it('leaves order alone when dropped on its own position', () => {
    const d = board();
    dash.moveShortcut(d, 'b', 'g1', 1);
    expect(ids(d, 0)).toEqual(['a', 'b', 'c']);
    dash.moveShortcut(d, 'b', 'g1', 2);
    expect(ids(d, 0)).toEqual(['a', 'b', 'c']);
  });

  it('moves between groups without losing or duplicating anything', () => {
    const d = board();
    dash.moveShortcut(d, 'b', 'g2', 0);
    expect(ids(d, 0)).toEqual(['a', 'c']);
    expect(ids(d, 1)).toEqual(['b', 'd']);
  });

  it('ignores unknown shortcuts and groups', () => {
    const d = board();
    dash.moveShortcut(d, 'nope', 'g2', 0);
    dash.moveShortcut(d, 'a', 'nope', 0);
    expect(d).toEqual(board());
  });
});

describe('neighbourGroup', () => {
  const groups = (...ids: string[]): Dashboard => ({ groups: ids.map((id) => ({ id, name: id, symbol: '', shortcutIds: [] })), shortcuts: {} });

  it('steps both ways', () => {
    expect(dash.neighbourGroup(groups('a', 'b', 'c'), 'b', 1)?.id).toBe('c');
    expect(dash.neighbourGroup(groups('a', 'b', 'c'), 'b', -1)?.id).toBe('a');
  });

  it('wraps at both ends', () => {
    expect(dash.neighbourGroup(groups('a', 'b', 'c'), 'c', 1)?.id).toBe('a');
    expect(dash.neighbourGroup(groups('a', 'b', 'c'), 'a', -1)?.id).toBe('c');
  });

  it('has nowhere to go with a single group', () => {
    expect(dash.neighbourGroup(groups('a'), 'a', 1)).toBeNull();
  });
});

describe('moveGroup', () => {
  it('reorders in both directions', () => {
    const d = board();
    dash.moveGroup(d, 'g1', 3);
    expect(d.groups.map((g) => g.id)).toEqual(['g2', 'g3', 'g1']);
    dash.moveGroup(d, 'g1', 0);
    expect(d.groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('takes the place of the group it lands on, one step down or up', () => {
    const d = board();
    dash.moveGroup(d, 'g1', 1);
    expect(d.groups.map((g) => g.id)).toEqual(['g2', 'g1', 'g3']);
    dash.moveGroup(d, 'g1', 0);
    expect(d.groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('reaches the last place', () => {
    const d = board();
    dash.moveGroup(d, 'g1', 2);
    expect(d.groups.map((g) => g.id)).toEqual(['g2', 'g3', 'g1']);
  });

  it('stays put when dropped on itself', () => {
    const d = board();
    dash.moveGroup(d, 'g2', 1);
    expect(d.groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
  });
});

describe('removing', () => {
  it('removes a group and only its own shortcuts', () => {
    const d = board();
    expect(dash.removeGroup(d, 'g1')).toBe(true);
    expect(Object.keys(d.shortcuts)).toEqual(['d']);
  });

  it('never removes the last group', () => {
    const d = board();
    dash.removeGroup(d, 'g1');
    dash.removeGroup(d, 'g2');
    expect(dash.removeGroup(d, 'g3')).toBe(false);
    expect(d.groups).toHaveLength(1);
  });

  it('removes shortcuts from their groups too', () => {
    const d = board();
    dash.removeShortcuts(d, ['a', 'd']);
    expect(ids(d, 0)).toEqual(['b', 'c']);
    expect(ids(d, 1)).toEqual([]);
    expect(d.shortcuts.a).toBeUndefined();
  });
});

describe('referencedImageIds', () => {
  it('keeps images used by shortcuts and wallpapers, so cleanup cannot delete them', () => {
    const used = dash.referencedImageIds({
      dashboard: board(),
      settings: { wallpaper: { imageIds: ['wall1'] } } as never,
    });
    expect([...used].sort()).toEqual(['img1', 'wall1']);
  });
});
