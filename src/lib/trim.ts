import { MAX_TILE_IMAGE_BYTES, decodeBlob } from './images';

/**
 * Some sites' larger icons are app icons drawn with wide empty margins, because
 * phones crop them. On a tile those margins just make the logo small, so they're
 * cut down to a thin even border. Icons with ordinary margins are left alone.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Pixels fainter than this count as empty, so a soft shadow doesn't stop the crop.
const ALPHA_THRESHOLD = 16;
/** Only margins wider than this share of the image on every side are worth cutting. */
export const MIN_MARGIN = 0.12;
const KEPT_MARGIN = 0.04;

/** The box around the visible pixels of RGBA data, or null when there's nothing worth cropping. */
export function contentBox(rgba: Uint8ClampedArray, width: number, height: number): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const box = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  // A wide logo keeps its margins above and below: squaring it would add them back.
  const fills = Math.max(box.width / width, box.height / height);
  return fills <= 1 - 2 * MIN_MARGIN ? box : null;
}

const CROPPABLE = /^image\/(?:png|webp)$/i;

/** The icon with wide empty margins cut down, or the same icon when it has none. */
export async function trimMargins(blob: Blob): Promise<Blob> {
  // SVG scales by itself, GIF may be animated, and an icon file holds several images.
  if (!CROPPABLE.test(blob.type)) return blob;
  try {
    const { image, release } = await decodeBlob(blob);
    try {
      const { naturalWidth: width, naturalHeight: height } = image;
      const source = document.createElement('canvas');
      source.width = width;
      source.height = height;
      const read = source.getContext('2d');
      if (!read || !width || !height) return blob;
      read.drawImage(image, 0, 0);
      const box = contentBox(read.getImageData(0, 0, width, height).data, width, height);
      if (!box) return blob;

      const content = Math.max(box.width, box.height);
      const side = Math.round(content * (1 + 2 * KEPT_MARGIN));
      const out = document.createElement('canvas');
      out.width = side;
      out.height = side;
      const draw = out.getContext('2d');
      if (!draw) return blob;
      draw.drawImage(image, box.x, box.y, box.width, box.height, (side - box.width) / 2, (side - box.height) / 2, box.width, box.height);
      const cropped = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
      return cropped && cropped.size <= MAX_TILE_IMAGE_BYTES ? cropped : blob;
    } finally {
      release();
    }
  } catch {
    return blob;
  }
}
