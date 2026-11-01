import {
  BUILT_IN_ENGINES,
  type AppState,
  type Dashboard,
  type Engine,
  type Group,
  type SearchData,
  type Session,
  type Settings,
  type Shortcut,
  type Tile,
  defaultDashboard,
  defaultSettings,
  lettersFor,
  pickColor,
} from './model';

/**
 * Everything read from storage or a backup file passes through here. Values of
 * the wrong type fall back to defaults, so a damaged or hand-edited backup can
 * never put the dashboard into a state the UI can't render.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const color = (v: unknown, fallback: string): string =>
  typeof v === 'string' && HEX_COLOR.test(v) ? v : fallback;

/** Only web addresses are stored, so a shortcut can never hold javascript: or data: URLs. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const LOCAL_HOST = /^(?:localhost|127(?:\.\d+){3}|\[::1\])(?:[:/?#]|$)/i;

/** Finishes a typed address: example.com gets https://, and localhost:3000 gets http://. */
export function completeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const hostAndPort = /^[^/:]+:\d+(?:[/?#]|$)/.test(text);
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !hostAndPort) return safeUrl(text);
  return safeUrl(`${LOCAL_HOST.test(text) ? 'http' : 'https'}://${text}`);
}

/** Merges by the shape of `base`: unknown keys are dropped, wrong types are ignored. */
function mergeShape<T>(base: T, input: unknown): T {
  if (!isRecord(input) || !isRecord(base)) return base;
  const out: Record<string, unknown> = {};
  for (const [key, baseValue] of Object.entries(base)) {
    const value = input[key];
    if (isRecord(baseValue)) out[key] = mergeShape(baseValue, value);
    else if (Array.isArray(baseValue)) out[key] = Array.isArray(value) ? value : baseValue;
    else if (baseValue === null) out[key] = typeof value === 'string' ? value : null;
    else if (typeof value === typeof baseValue) {
      out[key] = typeof value === 'number' && !Number.isFinite(value) ? baseValue : value;
    } else out[key] = baseValue;
  }
  return out as T;
}

function oneOf<T extends string>(value: T, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value) ? value : fallback;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export function normalizeSettings(input: unknown): Settings {
  const d = defaultSettings();
  const s = mergeShape(d, input);
  const targets = ['current', 'new', 'background', 'private'] as const;

  s.theme = oneOf(s.theme, ['system', 'light', 'dark'], d.theme);
  s.sidebar.side = oneOf(s.sidebar.side, ['left', 'right'], d.sidebar.side);
  s.sidebar.extraWidth = clamp(s.sidebar.extraWidth, 0, 200);

  s.grid.tileStyle = oneOf(s.grid.tileStyle, ['card', 'icon'], d.grid.tileStyle);
  s.grid.mode = oneOf(s.grid.mode, ['fixedSize', 'fixedColumns'], d.grid.mode);
  s.grid.columns = clamp(Math.round(s.grid.columns), 2, 16);
  s.grid.tileSize = clamp(s.grid.tileSize, 32, 140);
  s.grid.rowGap = clamp(s.grid.rowGap, 0, 80);
  s.grid.columnGap = clamp(s.grid.columnGap, 0, 80);
  s.grid.displayWidth = clamp(s.grid.displayWidth, 30, 100);
  s.grid.opacity = clamp(s.grid.opacity, 10, 100);
  s.grid.fadeMs = clamp(Math.round(s.grid.fadeMs), 0, 1000);
  s.grid.openTarget = oneOf(s.grid.openTarget, targets, d.grid.openTarget);

  s.search.width = clamp(s.search.width, 240, 1000);
  s.search.height = clamp(s.search.height, 32, 72);
  s.search.roundness = clamp(s.search.roundness, 0, 36);
  s.search.opacity = clamp(s.search.opacity, 10, 100);
  s.search.openTarget = oneOf(s.search.openTarget, targets, d.search.openTarget);

  s.standby.inactivitySeconds = clamp(s.standby.inactivitySeconds, 5, 3600);
  s.standby.blur = clamp(s.standby.blur, 0, 40);

  const w = s.wallpaper;
  w.source = oneOf(w.source, ['color', 'image', 'scene'], d.wallpaper.source);
  w.color = color(w.color, d.wallpaper.color);
  w.imageIds = w.imageIds.filter((id): id is string => typeof id === 'string');
  w.activeImageId = w.activeImageId !== null && w.imageIds.includes(w.activeImageId) ? w.activeImageId : w.imageIds[0] ?? null;
  w.rotateMinutes = clamp(w.rotateMinutes, 0, 10080);
  w.blur = clamp(w.blur, 0, 40);
  w.scene = oneOf(w.scene, ['aurora', 'lanterns'], d.wallpaper.scene);
  return s;
}

function normalizeTile(input: unknown, title: string): Tile {
  if (isRecord(input) && input.kind === 'image' && typeof input.imageId === 'string' && input.imageId) {
    const scale = typeof input.scale === 'number' && Number.isFinite(input.scale) ? clamp(input.scale, 20, 150) : 100;
    return { kind: 'image', imageId: input.imageId, scale };
  }
  const text = isRecord(input) ? str(input.text) : '';
  return { kind: 'letter', text: Array.from(text.trim()).slice(0, 3).join('') || lettersFor(title) };
}

export function normalizeShortcut(id: string, input: unknown): Shortcut | null {
  if (!isRecord(input)) return null;
  const url = safeUrl(input.url);
  if (url === null) return null;
  const title = str(input.title).trim() || new URL(url).hostname;
  return {
    id,
    title,
    url,
    note: str(input.note),
    tile: normalizeTile(input.tile, title),
    color: color(input.color, pickColor(title)),
  };
}

export function normalizeDashboard(input: unknown, newId: () => string): Dashboard {
  if (!isRecord(input) || !Array.isArray(input.groups) || !isRecord(input.shortcuts)) {
    return defaultDashboard(newId);
  }
  // A Map, because a backup can use names every object inherits, such as "constructor".
  const valid = new Map<string, Shortcut>();
  for (const [id, raw] of Object.entries(input.shortcuts)) {
    const shortcut = normalizeShortcut(id, raw);
    if (shortcut) valid.set(id, shortcut);
  }

  const placed = new Set<string>();
  const seenGroups = new Set<string>();
  const groups: Group[] = [];
  for (const raw of input.groups) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id) || newId();
    if (seenGroups.has(id)) continue;
    seenGroups.add(id);
    const ids = Array.isArray(raw.shortcutIds) ? raw.shortcutIds : [];
    const shortcutIds = ids.filter((sid): sid is string => {
      if (typeof sid !== 'string' || !valid.has(sid) || placed.has(sid)) return false;
      placed.add(sid);
      return true;
    });
    groups.push({ id, name: str(raw.name).trim() || 'Group', symbol: str(raw.symbol), shortcutIds });
  }

  if (groups.length === 0) {
    const fallback = defaultDashboard(newId);
    groups.push(...fallback.groups);
  }

  // A shortcut no group points at would be invisible and undeletable, so drop it.
  return { groups, shortcuts: Object.fromEntries([...valid].filter(([id]) => placed.has(id))) };
}

export const engineUrlIsValid = (url: string): boolean => url.includes('%s') && safeUrl(url.replace('%s', 'x')) !== null;

export function normalizeSearch(input: unknown): SearchData {
  const engines: Engine[] = BUILT_IN_ENGINES.map((e) => ({ ...e }));
  const custom = isRecord(input) && Array.isArray(input.engines) ? input.engines : [];
  for (const raw of custom) {
    if (!isRecord(raw) || raw.builtIn === true) continue;
    const id = str(raw.id);
    const name = str(raw.name).trim();
    const url = str(raw.url).trim();
    if (!id || !name || !engineUrlIsValid(url) || engines.some((e) => e.id === id)) continue;
    engines.push({ id, name, kind: 'url', url, builtIn: false });
  }
  const active = isRecord(input) ? str(input.activeEngineId) : '';
  const history = isRecord(input) && Array.isArray(input.history) ? input.history : [];
  return {
    engines,
    activeEngineId: engines.some((e) => e.id === active) ? active : 'browser',
    history: history.filter((h): h is string => typeof h === 'string').slice(0, 50),
  };
}

export function normalizeSession(input: unknown): Session {
  return { lastGroupId: isRecord(input) && typeof input.lastGroupId === 'string' ? input.lastGroupId : null };
}

export function normalizeState(input: unknown, newId: () => string): AppState {
  const raw = isRecord(input) ? input : {};
  return {
    dashboard: normalizeDashboard(raw.dashboard, newId),
    search: normalizeSearch(raw.search),
    settings: normalizeSettings(raw.settings),
    session: normalizeSession(raw.session),
  };
}
