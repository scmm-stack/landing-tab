import { describe, expect, it } from 'vitest';
import { imageSize } from '../src/lib/image-size';

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

// The opening bytes of 40×30 images, so each reads as 30, the shorter side.
const HEADERS: [string, string, string][] = [
  ['PNG', 'image/png', '89504e470d0a1a0a0000000d49484452000000280000001e01030000006413ce9e'],
  ['GIF', 'image/gif', '47494638396128001e00f00000ff000000000021f904'],
  ['lossy WebP', 'image/webp', '524946464e0000005745425056503820420000005003009d012a28001e003e91469e4b25'],
  ['lossless WebP', 'image/webp', '524946461c000000574542505650384c0f0000002f274007000710fd8ffe0722a2ff0100'],
  ['extended WebP', 'image/webp', '524946467200000057454250565038580a000000100000002700001d0000414c50480a00'],
  [
    'JPEG',
    'image/jpeg',
    'ffd8ffe000104a46494600010100000000000000ffdb00430006040506050406060506070706080a100a0a09090a140e0f0c1017141818171416161a1d251f1a1b231c1616202c20232627292a29191f2d302d283025282928ffdb0043010707070a080a130a0a13281a161a2828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828ffc0001108001e002803012200021101031101ffc400',
  ],
];

describe('imageSize', () => {
  it.each(HEADERS)('reads a %s header', (_, type, bytes) => {
    expect(imageSize(hex(bytes), type)).toBe(30);
  });

  it('reads the width of an extended WebP when it is the shorter side', () => {
    // 20×50: the stored sizes are one less than the real ones.
    const header = hex('52494646000000005745425056503858' + '0a000000' + '10000000' + '130000' + '310000');
    expect(imageSize(header, 'image/webp')).toBe(20);
  });

  it('ignores the scaling bits stored above a lossy WebP size', () => {
    // 40×30 with the top two bits of each size set, which only ask for upscaling.
    const header = hex('524946464e0000005745425056503820420000005003009d012a' + '28c0' + '1ec0');
    expect(imageSize(header, 'image/webp')).toBe(30);
  });

  it('skips a JPEG Huffman table that comes before the frame', () => {
    // A Huffman table marker sits in the frame-marker range but holds no size.
    const jpeg = hex('ffd8' + 'ffc40006' + '00010203' + 'ffc0001108001e002803012200');
    expect(imageSize(jpeg, 'image/jpeg')).toBe(30);
  });

  it('gives up on a JPEG that loses its place, rather than reading noise as a size', () => {
    const jpeg = hex('ffd8' + '00c0001108001e0028030122000211010311');
    expect(imageSize(jpeg, 'image/jpeg')).toBeNull();
  });

  it('takes the largest image in an icon file, where 0 means 256', () => {
    // Three images: 16×16, 48×48 and 256×256.
    const ico = hex('000001000300101000000100200068040000360000003030000001002000a82500009e040000000000000100200067000000462a0000');
    expect(imageSize(ico, 'image/x-icon')).toBe(256);
  });

  it('treats SVG as sharp at any size', () => {
    expect(imageSize(new TextEncoder().encode('<svg/>'), 'image/svg+xml')).toBe(Infinity);
  });

  it("returns null when it can't tell", () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4]), 'image/png')).toBeNull();
    expect(imageSize(hex('89504e470d0a1a0a00'), 'image/png')).toBeNull();
    expect(imageSize(hex('ffd8ffe00010'), 'image/jpeg')).toBeNull();
  });
});
