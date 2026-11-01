import type { Engine } from './model';

/** Builds the results URL. Nothing is added beyond the engine's template and the query. */
export function buildSearchUrl(engine: Engine, query: string): string {
  return engine.url.replace('%s', encodeURIComponent(query));
}

export function addToHistory(history: string[], query: string, limit = 50): string[] {
  const clean = query.trim();
  if (!clean) return history;
  return [clean, ...history.filter((h) => h !== clean)].slice(0, limit);
}

export function matchHistory(history: string[], query: string, limit = 6): string[] {
  const needle = query.trim().toLowerCase();
  const list = needle ? history.filter((h) => h.toLowerCase().includes(needle)) : history;
  return list.slice(0, limit);
}
