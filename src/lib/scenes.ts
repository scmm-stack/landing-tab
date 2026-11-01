import type { SceneId } from './model';

/**
 * Animated wallpapers, drawn on a canvas with no external assets. Each scene
 * renders one frame for a time in seconds. A low frame rate keeps a background
 * tab's CPU use negligible, and the loop stops whenever the tab is hidden.
 */
export type SceneRenderer = (ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number) => void;

export const SCENE_ACCENTS: Record<SceneId, string> = { aurora: '#3fb8a6', lanterns: '#e0954a' };

function aurora(ctx: CanvasRenderingContext2D, w: number, h: number, s: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#071421');
  sky.addColorStop(0.6, '#0d2a3a');
  sky.addColorStop(1, '#10333a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'lighter';
  const bands = [
    { y: 0.3, hue: 168, speed: 0.09, swing: 0.09 },
    { y: 0.42, hue: 205, speed: 0.06, swing: 0.12 },
    { y: 0.22, hue: 275, speed: 0.04, swing: 0.07 },
  ];
  for (const [index, band] of bands.entries()) {
    const baseline = h * band.y;
    const glow = ctx.createLinearGradient(0, baseline - h * 0.22, 0, baseline + h * 0.3);
    glow.addColorStop(0, `hsla(${band.hue}, 80%, 60%, 0)`);
    glow.addColorStop(0.5, `hsla(${band.hue}, 80%, 60%, 0.24)`);
    glow.addColorStop(1, `hsla(${band.hue}, 80%, 60%, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(0, h);
    // Runs to the exact right edge, so the shape never closes short of the canvas.
    for (let x = 0; ; x = Math.min(x + 24, w)) {
      const u = x / w;
      const wave =
        Math.sin(u * 5 + s * band.speed * 7 + index) * 0.6 +
        Math.sin(u * 11 - s * band.speed * 4 + index * 2) * 0.3 +
        Math.sin(u * 2.3 + s * band.speed * 2) * 0.5;
      ctx.lineTo(x, baseline + wave * h * band.swing);
      if (x >= w) break;
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

interface Lantern {
  x: number;
  rise: number;
  size: number;
  sway: number;
  phase: number;
}

const LANTERNS: Lantern[] = Array.from({ length: 34 }, (_, i) => {
  // A fixed sequence, so the sky looks the same each time and needs no randomness.
  const a = (i * 0.61803398875) % 1;
  const b = (i * 0.75487766625) % 1;
  return { x: a, rise: 0.012 + b * 0.022, size: 3 + b * 9, sway: 0.008 + a * 0.02, phase: i * 1.7 };
});

function lanterns(ctx: CanvasRenderingContext2D, w: number, h: number, s: number): void {
  const dusk = ctx.createLinearGradient(0, 0, 0, h);
  dusk.addColorStop(0, '#120f2c');
  dusk.addColorStop(0.55, '#3a1f4d');
  dusk.addColorStop(1, '#a14b45');
  ctx.fillStyle = dusk;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#0d0a1e';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; ; x = Math.min(x + 32, w)) {
    const u = x / w;
    ctx.lineTo(x, h * (0.9 - Math.sin(u * 7) * 0.025 - Math.sin(u * 17 + 1) * 0.012));
    if (x >= w) break;
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  for (const lantern of LANTERNS) {
    const progress = (lantern.phase * 0.13 + s * lantern.rise) % 1;
    const x = (lantern.x + Math.sin(s * 0.2 + lantern.phase) * lantern.sway) * w;
    const y = h * (1.05 - progress * 1.15);
    const fade = Math.min(1, (1 - progress) * 2.5) * Math.min(1, progress * 8);
    const flicker = 0.8 + Math.sin(s * 1.6 + lantern.phase) * 0.2;
    const size = lantern.size * (1.2 - progress * 0.6);
    const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 5);
    halo.addColorStop(0, `rgba(255, 190, 110, ${0.9 * fade * flicker})`);
    halo.addColorStop(0.25, `rgba(240, 130, 60, ${0.4 * fade * flicker})`);
    halo.addColorStop(1, 'rgba(240, 130, 60, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(x - size * 5, y - size * 5, size * 10, size * 10);
  }
  ctx.globalCompositeOperation = 'source-over';
}

export const SCENES: Record<SceneId, SceneRenderer> = { aurora, lanterns };
