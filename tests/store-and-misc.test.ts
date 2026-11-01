import { describe, expect, it } from 'vitest';
import { isRotationDue } from '../src/lib/actions';
import { foldersFromTree } from '../src/lib/bookmarks';
import { hexToRgb, readableOn, rgbToHex } from '../src/lib/color';
import { LAYOUT_PRESETS, lettersFor, pickColor } from '../src/lib/model';
import { normalizeSettings } from '../src/lib/normalize';

describe('isRotationDue', () => {
  const HOUR = 60;
  it('rotates once the interval has passed', () => {
    expect(isRotationDue(HOUR, 0, 2, 60 * 60_000)).toBe(true);
    expect(isRotationDue(HOUR, 0, 2, 59 * 60_000)).toBe(false);
  });

  it('never rotates when turned off or with a single image', () => {
    expect(isRotationDue(0, 0, 5, 1e12)).toBe(false);
    expect(isRotationDue(HOUR, 0, 1, 1e12)).toBe(false);
  });
});

describe('color helpers', () => {
  it('converts both ways', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#f80')).toEqual([255, 136, 0]);
    expect(rgbToHex([255, 128, 0])).toBe('#ff8000');
  });

  it('picks readable text', () => {
    expect(readableOn('#ffffff')).toBe('#14181f');
    expect(readableOn('#101010')).toBe('#ffffff');
  });
});

describe('tile helpers', () => {
  it('takes whole characters, so an emoji is not cut in half', () => {
    expect(lettersFor('😀 Smile')).toBe('😀 ');
    expect(lettersFor('Ab')).toBe('Ab');
    expect(lettersFor('   ')).toBe('?');
  });

  it('gives the same name the same color', () => {
    expect(pickColor('site')).toBe(pickColor('site'));
  });
});

describe('layout presets', () => {
  it('all stay within what settings allow', () => {
    for (const preset of Object.values(LAYOUT_PRESETS)) {
      expect(normalizeSettings({ grid: preset }).grid).toMatchObject(preset);
    }
  });
});

describe('foldersFromTree', () => {
  const tree = [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          title: 'Toolbar',
          children: [
            { id: '1', title: 'One', url: 'https://one.example/' },
            { id: '2', title: 'Script', url: 'javascript:alert(1)' },
            { id: '3', title: 'Config', url: 'about:config' },
            { id: 'sub', title: 'Work', children: [{ id: '4', title: '', url: 'https://four.example/' }] },
          ],
        },
        { id: 'empty', title: 'Empty', children: [] },
      ],
    },
  ];

  it('keeps web bookmarks only, and labels nested folders by path', () => {
    const folders = foldersFromTree(tree);
    expect(folders.map((f) => f.title)).toEqual(['Toolbar', 'Toolbar / Work']);
    expect(folders[0]?.items.map((i) => i.id)).toEqual(['1']);
  });

  it('gives untitled bookmarks a usable name', () => {
    expect(foldersFromTree(tree)[1]?.items[0]?.title).toBe('four.example');
  });
});
