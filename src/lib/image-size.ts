/**
 * The real size of an image, read from its header without decoding it, so an
 * icon can be judged by what it is rather than by what the page claims. Returns
 * the shorter side in pixels, Infinity for SVG, which scales to any size, or
 * null for a format this doesn't know.
 */
export function imageSize(bytes: Uint8Array, type: string): number | null {
  if (type.toLowerCase().startsWith('image/svg')) return Infinity;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (offset: number, text: string) => Array.from(text).every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  const shorter = (width: number, height: number) => (width > 0 && height > 0 ? Math.min(width, height) : null);

  try {
    if (bytes[0] === 0x89 && at(1, 'PNG')) return shorter(view.getUint32(16), view.getUint32(20));

    if (view.getUint16(0, true) === 0 && view.getUint16(2, true) === 1) {
      // An icon file holds several sizes. A stored 0 means 256 or more.
      const count = view.getUint16(4, true);
      let best = 0;
      for (let i = 0; i < count; i++) {
        const entry = 6 + i * 16;
        const width = bytes[entry] || 256;
        const height = bytes[entry + 1] || 256;
        best = Math.max(best, Math.min(width, height));
      }
      return best || null;
    }

    if (at(0, 'GIF8')) return shorter(view.getUint16(6, true), view.getUint16(8, true));

    if (at(0, 'RIFF') && at(8, 'WEBP')) {
      if (at(12, 'VP8 ')) return shorter(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
      if (at(12, 'VP8L')) {
        const bits = view.getUint32(21, true);
        return shorter((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      if (at(12, 'VP8X')) {
        const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return shorter(width, height);
      }
      return null;
    }

    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1]!;
        if (marker === 0xff) {
          offset += 1;
          continue;
        }
        // Start-of-frame markers hold the size. 0xc4, 0xc8 and 0xcc share the range but don't.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return shorter(view.getUint16(offset + 7), view.getUint16(offset + 5));
        }
        offset += 2 + view.getUint16(offset + 2);
      }
    }
  } catch {
    // A header cut short: the size can't be known.
  }
  return null;
}
