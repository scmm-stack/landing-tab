import { describe, expect, it } from 'vitest';
import { SMALL_ICON_SIZE, contentBox, needsBorder } from '../src/lib/trim';

/** RGBA pixels, transparent except for a filled rectangle. */
function image(width: number, height: number, fill: { x: number; y: number; width: number; height: number }, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = fill.y; y < fill.y + fill.height; y++) {
    for (let x = fill.x; x < fill.x + fill.width; x++) data[(y * width + x) * 4 + 3] = alpha;
  }
  return data;
}

describe('contentBox', () => {
  it('finds a logo inside wide empty margins', () => {
    expect(contentBox(image(100, 100, { x: 30, y: 30, width: 40, height: 40 }), 100, 100)).toEqual({ x: 30, y: 30, width: 40, height: 40 });
  });

  it('leaves an icon with ordinary margins alone', () => {
    expect(contentBox(image(100, 100, { x: 10, y: 10, width: 80, height: 80 }), 100, 100)).toBeNull();
  });

  it('leaves a wide logo alone, since squaring it would add the margins back', () => {
    expect(contentBox(image(100, 100, { x: 2, y: 35, width: 96, height: 30 }), 100, 100)).toBeNull();
  });

  it('ignores faint pixels such as a soft shadow', () => {
    const data = image(100, 100, { x: 30, y: 30, width: 40, height: 40 });
    data[3] = 8;
    expect(contentBox(data, 100, 100)).toEqual({ x: 30, y: 30, width: 40, height: 40 });
  });

  it('has nothing to crop in an empty image', () => {
    expect(contentBox(new Uint8ClampedArray(10 * 10 * 4), 10, 10)).toBeNull();
  });
});

describe('needsBorder', () => {
  it('borders icons too small to stretch across a tile', () => {
    expect(needsBorder(32)).toBe(true);
    expect(needsBorder(SMALL_ICON_SIZE - 1)).toBe(true);
    expect(needsBorder(SMALL_ICON_SIZE)).toBe(false);
    expect(needsBorder(Infinity)).toBe(false);
  });
});
