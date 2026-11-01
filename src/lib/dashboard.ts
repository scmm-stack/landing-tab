import type { AppState, Dashboard, Group, Shortcut } from './model';

/** Pure operations on the dashboard. Each mutates the draft it is handed. */

export function findGroupOf(d: Dashboard, shortcutId: string): Group | undefined {
  return d.groups.find((g) => g.shortcutIds.includes(shortcutId));
}

export function addShortcut(d: Dashboard, groupId: string, shortcut: Shortcut): void {
  const group = d.groups.find((g) => g.id === groupId) ?? d.groups[0];
  if (!group) return;
  d.shortcuts[shortcut.id] = shortcut;
  group.shortcutIds.push(shortcut.id);
}

export function removeShortcuts(d: Dashboard, ids: Iterable<string>): void {
  const gone = new Set(ids);
  for (const id of gone) delete d.shortcuts[id];
  for (const group of d.groups) group.shortcutIds = group.shortcutIds.filter((id) => !gone.has(id));
}

/** Moves a shortcut to a position in a group, which may be the group it is already in. */
export function moveShortcut(d: Dashboard, shortcutId: string, targetGroupId: string, targetIndex: number): void {
  const source = findGroupOf(d, shortcutId);
  const target = d.groups.find((g) => g.id === targetGroupId);
  if (!source || !target) return;
  const from = source.shortcutIds.indexOf(shortcutId);
  source.shortcutIds.splice(from, 1);
  const adjusted = source === target && from < targetIndex ? targetIndex - 1 : targetIndex;
  target.shortcutIds.splice(Math.min(Math.max(adjusted, 0), target.shortcutIds.length), 0, shortcutId);
}

/** Puts a group where it ends up at targetIndex, so dropping on a group takes its place. */
export function moveGroup(d: Dashboard, groupId: string, targetIndex: number): void {
  const from = d.groups.findIndex((g) => g.id === groupId);
  if (from < 0) return;
  const [group] = d.groups.splice(from, 1);
  if (!group) return;
  d.groups.splice(Math.min(Math.max(targetIndex, 0), d.groups.length), 0, group);
}

/** The group one step away, wrapping at both ends. Null when there's nowhere else to go. */
export function neighbourGroup(d: Dashboard, groupId: string, step: 1 | -1): Dashboard['groups'][number] | null {
  if (d.groups.length < 2) return null;
  const from = Math.max(d.groups.findIndex((g) => g.id === groupId), 0);
  return d.groups[(from + step + d.groups.length) % d.groups.length] ?? null;
}

/** Removes a group and its shortcuts, except the last group, which always stays. */
export function removeGroup(d: Dashboard, groupId: string): boolean {
  if (d.groups.length <= 1) return false;
  const group = d.groups.find((g) => g.id === groupId);
  if (!group) return false;
  for (const id of group.shortcutIds) delete d.shortcuts[id];
  d.groups = d.groups.filter((g) => g.id !== groupId);
  return true;
}

export function shortcutImageIds(d: Dashboard): Set<string> {
  const ids = new Set<string>();
  for (const shortcut of Object.values(d.shortcuts)) {
    if (shortcut.tile.kind === 'image') ids.add(shortcut.tile.imageId);
  }
  return ids;
}

/** Every image the app still needs. Anything else in image storage is unused. */
export function referencedImageIds(state: Pick<AppState, 'dashboard' | 'settings'>): Set<string> {
  const ids = shortcutImageIds(state.dashboard);
  for (const id of state.settings.wallpaper.imageIds) ids.add(id);
  return ids;
}
