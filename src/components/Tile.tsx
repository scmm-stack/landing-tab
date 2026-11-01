import { useEffect, useState } from 'react';
import { readableOn } from '../lib/color';
import { imageUrl } from '../lib/images';
import type { Tile as TileData } from '../lib/model';

export function useImageUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
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

export function TileFace({ tile, color, previewUrl }: { tile: TileData; color: string; previewUrl?: string | null }) {
  const storedUrl = useImageUrl(tile.kind === 'image' && !previewUrl ? tile.imageId : null);
  if (tile.kind === 'letter') {
    return (
      <span className="tile-face" style={{ backgroundColor: color, color: readableOn(color) }}>
        <span className="tile-letters">{tile.text}</span>
      </span>
    );
  }
  const src = previewUrl ?? storedUrl;
  return (
    <span className="tile-face" style={{ backgroundColor: color }}>
      {src && <img src={src} alt="" draggable={false} style={{ width: `${tile.scale}%`, height: `${tile.scale}%` }} />}
    </span>
  );
}
