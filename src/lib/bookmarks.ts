import { browser } from 'wxt/browser';
import type { Dashboard } from './model';
import { safeUrl } from './normalize';

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}

export interface PickableBookmark {
  id: string;
  title: string;
  url: string;
}

export interface BookmarkFolder {
  id: string;
  title: string;
  items: PickableBookmark[];
}

/** Must be called directly from a click handler so the browser can show its prompt. */
export const requestBookmarkAccess = (): Promise<boolean> => browser.permissions.request({ permissions: ['bookmarks'] });

export async function readBookmarks(): Promise<BookmarkNode[]> {
  return (await browser.bookmarks.getTree()) as BookmarkNode[];
}

/** Flattens the tree into folders of importable web bookmarks. */
export function foldersFromTree(tree: BookmarkNode[]): BookmarkFolder[] {
  const folders: BookmarkFolder[] = [];
  const walk = (node: BookmarkNode, path: string): void => {
    const children = node.children ?? [];
    const items: PickableBookmark[] = [];
    for (const child of children) {
      const url = child.url ? safeUrl(child.url) : null;
      if (url) items.push({ id: child.id, title: child.title || new URL(url).hostname, url });
    }
    if (items.length > 0) folders.push({ id: node.id, title: path || node.title, items });
    for (const child of children) {
      if (child.children) walk(child, path ? `${path} / ${child.title}` : child.title);
    }
  };
  for (const root of tree) walk(root, '');
  return folders;
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
  return name;
}

/**
 * Copies every group into a new folder on the bookmarks toolbar. Firefox gives
 * the toolbar a fixed id; Chrome and Edge list it first among the root's children.
 */
export async function exportToBookmarks(dashboard: Dashboard, folderName: string): Promise<number> {
  const [root] = await browser.bookmarks.getTree();
  const children = root?.children ?? [];
  const toolbar = children.find((c) => c.id === 'toolbar_____') ?? children[0];
  if (!toolbar) throw new Error('No bookmarks toolbar');

  const taken = new Set((toolbar.children ?? []).filter((c) => !c.url).map((c) => c.title));
  const folder = await browser.bookmarks.create({ parentId: toolbar.id, title: uniqueName(folderName, taken) });

  let count = 0;
  for (const group of dashboard.groups) {
    const groupFolder = await browser.bookmarks.create({ parentId: folder.id, title: group.name });
    for (const id of group.shortcutIds) {
      const shortcut = dashboard.shortcuts[id];
      if (!shortcut) continue;
      await browser.bookmarks.create({ parentId: groupFolder.id, title: shortcut.title, url: shortcut.url });
      count++;
    }
  }
  return count;
}
