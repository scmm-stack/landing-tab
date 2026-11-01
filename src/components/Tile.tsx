import { useEffect, useState } from 'react';
import { readableOn } from '../lib/color';
import { imageUrl } from '../lib/images';
import type { Tile as TileData } from '../lib/model';

/** Undefined while loading, and null when there's no image to show. */
export function useImageUrl(id: string | null): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (id === null) {
      setUrl(null);
      return;
    }
    void imageUrl(id).then((next) => {
      if (live) setUrl(next);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

interface TileFaceProps {
  tile: TileData;
  color: string;
  previewUrl?: string | null;
  /** Shown in place of an image that can't be loaded. */
  fallbackLetters?: string;
}

export function TileFace({ tile, color, previewUrl, fallbackLetters }: TileFaceProps) {
  const storedUrl = useImageUrl(tile.kind === 'image' && !previewUrl ? tile.imageId : null);
  const src = previewUrl ?? storedUrl;
  const letters = tile.kind === 'letter' ? tile.text : src === null ? fallbackLetters : undefined;
  if (letters) {
    return (
      <span className="tile-face" style={{ backgroundColor: color, color: readableOn(color) }}>
        <span className="tile-letters">{letters}</span>
      </span>
    );
  }
  if (tile.kind === 'letter') return <span className="tile-face" style={{ backgroundColor: color }} />;
  return (
    <span className="tile-face" style={{ backgroundColor: color }}>
      {src && <img src={src} alt="" draggable={false} style={{ width: `${tile.scale}%`, height: `${tile.scale}%` }} />}
    </span>
  );
}
