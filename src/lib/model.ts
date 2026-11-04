export const SCHEMA_VERSION = 1;

export type OpenTarget = 'current' | 'new' | 'background' | 'private';
export type ThemeMode = 'system' | 'light' | 'dark';
export type SidebarSide = 'left' | 'right';
export type LayoutMode = 'fixedSize' | 'fixedColumns';
export type TileStyle = 'card' | 'icon';
export type WallpaperSource = 'color' | 'image' | 'scene' | 'library';
export type SceneId = 'aurora' | 'lanterns';

export type Tile =
  | { kind: 'letter'; text: string }
  | { kind: 'image'; imageId: string; scale: number };

export interface Shortcut {
  id: string;
  title: string;
  url: string;
  note: string;
  tile: Tile;
  color: string;
}

export interface Group {
  id: string;
  name: string;
  symbol: string;
  shortcutIds: string[];
}

export interface Dashboard {
  groups: Group[];
  shortcuts: Record<string, Shortcut>;
}

/** kind 'browser' hands the query to the browser's own default search engine. */
export interface Engine {
  id: string;
  name: string;
  kind: 'browser' | 'url';
  url: string;
  builtIn: boolean;
}

export interface SearchData {
  engines: Engine[];
  activeEngineId: string;
  history: string[];
}

export interface Settings {
  theme: ThemeMode;
  sidebar: {
    side: SidebarSide;
    autoHide: boolean;
    narrow: boolean;
    extraWidth: number;
    scrollToSwitch: boolean;
    rememberLastGroup: boolean;
  };
  grid: {
    tileStyle: TileStyle;
    mode: LayoutMode;
    columns: number;
    tileSize: number;
    rowGap: number;
    columnGap: number;
    displayWidth: number;
    opacity: number;
    shadow: boolean;
    shine: boolean;
    fadeMs: number;
    showLabels: boolean;
    showAddButton: boolean;
    websiteImages: boolean;
    openTarget: OpenTarget;
  };
  search: {
    show: boolean;
    width: number;
    height: number;
    roundness: number;
    opacity: number;
    openTarget: OpenTarget;
    historyEnabled: boolean;
  };
  clock: { show: boolean; hour24: boolean };
  standby: {
    enabled: boolean;
    showOnNewTab: boolean;
    inactivitySeconds: number;
    blur: number;
    showClock: boolean;
  };
  wallpaper: {
    source: WallpaperSource;
    color: string;
    imageIds: string[];
    activeImageId: string | null;
    rotateMinutes: number;
    lastRotatedAt: number;
    blur: number;
    scene: SceneId;
    pageColorsFollow: boolean;
    /** A file name in the extension's library. Null shows the first one. */
    libraryImage: string | null;
    libraryRotateMinutes: number;
    libraryRotatedAt: number;
  };
}

/** How often the library wallpaper can change by itself, in minutes. 0 is never. */
export const LIBRARY_INTERVALS = [0, 60, 120, 360, 720, 1440] as const;

/** UI state worth keeping between tabs but not worth backing up. */
export interface Session {
  lastGroupId: string | null;
}

export interface AppState {
  dashboard: Dashboard;
  search: SearchData;
  settings: Settings;
  session: Session;
}

export type StateKey = keyof AppState;
export const STATE_KEYS: StateKey[] = ['dashboard', 'search', 'settings', 'session'];

export const BUILT_IN_ENGINES: Engine[] = [
  { id: 'browser', name: 'Browser default', kind: 'browser', url: '', builtIn: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', kind: 'url', url: 'https://duckduckgo.com/?q=%s', builtIn: true },
  { id: 'google', name: 'Google', kind: 'url', url: 'https://www.google.com/search?q=%s', builtIn: true },
  { id: 'bing', name: 'Bing', kind: 'url', url: 'https://www.bing.com/search?q=%s', builtIn: true },
  { id: 'brave', name: 'Brave Search', kind: 'url', url: 'https://search.brave.com/search?q=%s', builtIn: true },
  { id: 'startpage', name: 'Startpage', kind: 'url', url: 'https://www.startpage.com/do/search?q=%s', builtIn: true },
];

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    sidebar: {
      side: 'left',
      autoHide: true,
      narrow: false,
      extraWidth: 0,
      scrollToSwitch: true,
      rememberLastGroup: true,
    },
    grid: {
      tileStyle: 'card',
      mode: 'fixedSize',
      columns: 8,
      tileSize: 64,
      rowGap: 28,
      columnGap: 28,
      displayWidth: 72,
      opacity: 100,
      shadow: true,
      shine: true,
      fadeMs: 200,
      showLabels: true,
      showAddButton: true,
      websiteImages: true,
      openTarget: 'current',
    },
    search: {
      show: true,
      width: 560,
      height: 48,
      roundness: 24,
      opacity: 90,
      openTarget: 'current',
      historyEnabled: false,
    },
    clock: { show: true, hour24: true },
    standby: {
      enabled: false,
      showOnNewTab: false,
      inactivitySeconds: 60,
      blur: 12,
      showClock: true,
    },
    wallpaper: {
      source: 'scene',
      color: '#23395b',
      imageIds: [],
      activeImageId: null,
      rotateMinutes: 0,
      lastRotatedAt: 0,
      blur: 0,
      scene: 'aurora',
      pageColorsFollow: false,
      libraryImage: null,
      libraryRotateMinutes: 0,
      libraryRotatedAt: 0,
    },
  };
}

export function defaultDashboard(newId: () => string): Dashboard {
  const groupId = newId();
  return { groups: [{ id: groupId, name: 'Home', symbol: '🏠', shortcutIds: [] }], shortcuts: {} };
}

export function defaultSearch(): SearchData {
  return { engines: BUILT_IN_ENGINES.map((e) => ({ ...e })), activeEngineId: 'browser', history: [] };
}

export function defaultState(newId: () => string): AppState {
  return {
    dashboard: defaultDashboard(newId),
    search: defaultSearch(),
    settings: defaultSettings(),
    session: { lastGroupId: null },
  };
}

type Layout = Pick<Settings['grid'], 'mode' | 'columns' | 'tileSize' | 'rowGap' | 'columnGap' | 'displayWidth'>;

export const LAYOUT_PRESETS: Record<'compact' | 'balanced' | 'spacious' | 'wide', Layout> = {
  compact: { mode: 'fixedSize', columns: 10, tileSize: 48, rowGap: 18, columnGap: 18, displayWidth: 60 },
  balanced: { mode: 'fixedSize', columns: 8, tileSize: 64, rowGap: 28, columnGap: 28, displayWidth: 72 },
  spacious: { mode: 'fixedSize', columns: 6, tileSize: 84, rowGap: 36, columnGap: 40, displayWidth: 72 },
  wide: { mode: 'fixedColumns', columns: 12, tileSize: 60, rowGap: 24, columnGap: 24, displayWidth: 92 },
};

export const LETTER_COLORS = [
  '#3b6fd4', '#2f9e8f', '#c2571a', '#a03fb5', '#c23b5a', '#5b7a1f', '#47536b', '#8a6d1f',
];

export function pickColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return LETTER_COLORS[Math.abs(hash) % LETTER_COLORS.length] ?? '#3b6fd4';
}

export function lettersFor(title: string): string {
  const clean = title.trim();
  return clean ? Array.from(clean).slice(0, 2).join('') : '?';
}
