import { useEffect, useRef } from 'react';
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

export function Wallpaper({ settings }: { settings: Settings['wallpaper'] }) {
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
      </div>
    </div>
  );
}
