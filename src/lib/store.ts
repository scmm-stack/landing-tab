import { useSyncExternalStore } from 'react';
import { browser } from 'wxt/browser';
import { type AppState, SCHEMA_VERSION, STATE_KEYS, type StateKey } from './model';
import { normalizeDashboard, normalizeSearch, normalizeSession, normalizeSettings, normalizeState } from './normalize';

export const newId = (): string => crypto.randomUUID();

const WRITE_DELAY_MS = 150;

// Data from removed features, cleared so nothing lingers that the app no longer shows.
const RETIRED_KEYS = ['todos'];

let state: AppState | null = null;
const listeners = new Set<() => void>();
const pending = new Set<StateKey>();
const lastWritten = new Map<StateKey, string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * JSON with sorted keys. Chromium returns stored objects with their keys sorted,
 * so comparing plain JSON would mistake this page's own writes for outside changes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

function notify(): void {
  for (const listener of listeners) listener();
}

function current(): AppState {
  if (!state) throw new Error('State used before loadState() finished');
  return state;
}

function normalizeSlice<K extends StateKey>(key: K, value: unknown): AppState[K] {
  const normalizers: { [P in StateKey]: (v: unknown) => AppState[P] } = {
    dashboard: (v) => normalizeDashboard(v, newId),
    search: normalizeSearch,
    settings: normalizeSettings,
    session: normalizeSession,
  };
  return normalizers[key](value);
}

function handleExternalChange(changes: Record<string, { newValue?: unknown }>, area: string): void {
  if (area !== 'local' || !state) return;
  let changed = false;
  for (const key of STATE_KEYS) {
    const change = changes[key];
    if (!change || pending.has(key)) continue;
    const incoming = canonicalJson(change.newValue);
    if (incoming === lastWritten.get(key)) continue;
    lastWritten.set(key, incoming);
    state = { ...state, [key]: normalizeSlice(key, change.newValue) };
    changed = true;
  }
  if (changed) notify();
}

/** Loads saved state, creating it on first run, and follows changes from other open tabs. */
export async function loadState(): Promise<AppState> {
  if (state) return state;
  await browser.storage.local.remove(RETIRED_KEYS);
  const saved = await browser.storage.local.get([...STATE_KEYS, 'schemaVersion']);
  const firstRun = saved.dashboard === undefined;
  state = normalizeState(saved, newId);
  for (const key of STATE_KEYS) lastWritten.set(key, canonicalJson(state[key]));
  if (firstRun) await browser.storage.local.set({ ...state, schemaVersion: SCHEMA_VERSION });
  browser.storage.onChanged.addListener(handleExternalChange);
  window.addEventListener('pagehide', () => void flush());
  return state;
}

function scheduleWrite(): void {
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void flush(), WRITE_DELAY_MS);
}

/** Writes pending changes now. Await it before closing a page such as the popup. */
export async function flush(): Promise<void> {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (pending.size === 0 || !state) return;
  const payload: Record<string, unknown> = {};
  for (const key of pending) {
    payload[key] = state[key];
    lastWritten.set(key, canonicalJson(state[key]));
  }
  pending.clear();
  await browser.storage.local.set(payload);
}

/**
 * Changes one slice. The recipe gets a private copy it may mutate freely, or it
 * may return a replacement. Other tabs pick the result up through storage.
 */
export function update<K extends StateKey>(key: K, recipe: (draft: AppState[K]) => AppState[K] | void): void {
  const draft = structuredClone(current()[key]);
  const next = recipe(draft) ?? draft;
  state = { ...current(), [key]: next };
  pending.add(key);
  notify();
  scheduleWrite();
}

/** Replaces all state at once, used when restoring a backup. */
export async function replaceState(next: AppState): Promise<void> {
  state = next;
  pending.clear();
  for (const key of STATE_KEYS) lastWritten.set(key, canonicalJson(next[key]));
  await browser.storage.local.set({ ...next, schemaVersion: SCHEMA_VERSION });
  notify();
}

export const getState = (): AppState => current();

/** What's on disk now, which can be ahead of this page while another tab is saving. */
export async function readSavedState(): Promise<AppState> {
  return normalizeState(await browser.storage.local.get([...STATE_KEYS]), newId);
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, current);
}
