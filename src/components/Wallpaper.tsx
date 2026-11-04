import { useEffect, useRef, useState } from 'react';
import { type LibraryEntry, currentEntry, getLibrary, getLibraryImage, libraryImageUrl, nextEntry } from '../lib/library';
import type { SceneId, Settings } from '../lib/model';
import { SCENES } from '../lib/scenes';
import { useImageUrl } from './Tile';

const FRAME_MS = 1000 / 24;

function Scene({ id }: { id: SceneId }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const render = SCENES[id];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let frame = 0;
    let last = 0;

    const resize = () => {
      // Half resolution: scenes are soft gradients, so this costs no visible detail.
      canvas.width = Math.max(1, Math.round(window.innerWidth / 2));
      canvas.height = Math.max(1, Math.round(window.innerHeight / 2));
      render(ctx, canvas.width, canvas.height, (performance.now() - start) / 1000 + 40);
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      render(ctx, canvas.width, canvas.height, (now - start) / 1000 + 40);
    };

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reduceMotion) frame = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (!reduceMotion) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [id]);

  return <canvas ref={ref} className={`wallpaper-media scene-${id}`} />;
}

// A tab can stay open for days, so it looks at the library's list again now and then.
const LIBRARY_RECHECK_MS = 60 * 60_000;

/** The images in the extension's library, or null until they're known. */
export function useLibrary(enabled: boolean): LibraryEntry[] | null {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  useEffect(() => {
    setEntries(null);
    if (!enabled) return;
    let live = true;
    const load = () =>
      void getLibrary().then((next) => {
        if (live) setEntries(next);
      });
    load();
    const timer = setInterval(load, LIBRARY_RECHECK_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return entries;
}

function useLibraryImageUrl(entry: LibraryEntry | null): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const name = entry?.name;
  const sha = entry?.sha;
  useEffect(() => {
    if (name === undefined || sha === undefined) {
      setUrl(null);
      return;
    }
    let live = true;
    void libraryImageUrl({ name, sha }).then((next) => {
      if (live) setUrl(next);
    });
    return () => {
      live = false;
    };
  }, [name, sha]);
  return url;
}

function LibraryImage({ entries, name }: { entries: LibraryEntry[]; name: string | null }) {
  const entry = currentEntry(entries, name);
  const url = useLibraryImageUrl(entry);
  const upcoming = entries.length > 1 ? nextEntry(entries, entry?.name ?? null) : null;

  useEffect(() => {
    // Fetched once the current image is showing, so the next change is instant.
    if (url && upcoming) void getLibraryImage(upcoming);
  }, [url, upcoming]);

  return url ? <img className="wallpaper-media" src={url} alt="" /> : null;
}

export function Wallpaper({ settings, library }: { settings: Settings['wallpaper']; library: LibraryEntry[] | null }) {
  const imageId = settings.source === 'image' ? settings.activeImageId : null;
  const url = useImageUrl(imageId);
  const filter = settings.blur > 0 ? `blur(${settings.blur}px)` : undefined;
  // Blur leaves soft transparent edges, so the layer is scaled slightly past the window.
  const transform = settings.blur > 0 ? 'scale(1.06)' : undefined;

  return (
    <div className="wallpaper" aria-hidden="true">
      <div className="wallpaper-layer" style={{ backgroundColor: settings.color, filter, transform }}>
        {settings.source === 'image' && url && <img className="wallpaper-media" src={url} alt="" />}
        {settings.source === 'scene' && <Scene id={settings.scene} />}
        {settings.source === 'library' && library && <LibraryImage entries={library} name={settings.libraryImage} />}
      </div>
    </div>
  );
}
