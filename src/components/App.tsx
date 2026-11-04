import { type MouseEvent, type WheelEvent, useCallback, useEffect, useRef, useState } from 'react';
import { deleteGroup, deleteShortcuts, isRotationDue, nextLibraryImage, nextWallpaper, takeRestoredFlag } from '../lib/actions';
import type { BookmarkFolder } from '../lib/bookmarks';
import { averageColor } from '../lib/color';
import { neighbourGroup } from '../lib/dashboard';
import { t } from '../lib/i18n';
import { loadImage } from '../lib/images';
import { type LibraryEntry, currentEntry, getLibraryImage } from '../lib/library';
import type { Group, Shortcut } from '../lib/model';
import { SCENE_ACCENTS } from '../lib/scenes';
import { update, useAppState } from '../lib/store';
import { BookmarkImport } from './BookmarkImport';
import { Clock } from './Clock';
import { Grid, useOpenShortcut } from './Grid';
import { GroupEditor } from './GroupEditor';
import { SearchBox } from './SearchBox';
import { SettingsPanel } from './Settings';
import { ShortcutForm } from './ShortcutEditor';
import { Sidebar } from './Sidebar';
import { Standby, useStandby } from './Standby';
import { Wallpaper, useLibrary } from './Wallpaper';
import { ContextMenu, type MenuItem, Modal, useFeedback } from './ui';

type Dialog =
  | { kind: 'shortcut'; shortcut?: Shortcut; groupId: string }
  | { kind: 'group'; group?: Group }
  | { kind: 'settings' }
  | { kind: 'bookmarks'; folders: BookmarkFolder[] };

interface Menu {
  x: number;
  y: number;
  items: MenuItem[];
}

const WHEEL_SWITCH_INTERVAL_MS = 350;
// The group leaving takes this share of the fade-in time, so one setting paces both.
const GROUP_EXIT_SHARE = 0.6;
// Longer than the slowest opening animation, whose end the class must not cut off.
const OPENING_MS = 900;

function useTheme(mode: 'system' | 'light' | 'dark'): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);
}

function useAccentColor(library: LibraryEntry[] | null): void {
  const { wallpaper } = useAppState().settings;
  const libraryEntry = wallpaper.source === 'library' && library ? currentEntry(library, wallpaper.libraryImage) : null;
  useEffect(() => {
    const root = document.documentElement.style;
    if (!wallpaper.pageColorsFollow) {
      root.removeProperty('--accent');
      return;
    }
    let live = true;
    const set = (color: string | null) => {
      if (!live) return;
      if (color) root.setProperty('--accent', color);
      else root.removeProperty('--accent');
    };
    if (wallpaper.source === 'color') set(wallpaper.color);
    else if (wallpaper.source === 'scene') set(SCENE_ACCENTS[wallpaper.scene]);
    else if (wallpaper.source === 'library') {
      if (libraryEntry) {
        void getLibraryImage(libraryEntry)
          .then((blob) => (blob ? averageColor(blob) : null))
          .catch(() => null)
          .then(set);
      }
    } else if (wallpaper.activeImageId) {
      void loadImage(wallpaper.activeImageId)
        .then((blob) => (blob ? averageColor(blob) : null))
        .catch(() => null)
        .then(set);
    }
    return () => {
      live = false;
    };
  }, [wallpaper.pageColorsFollow, wallpaper.source, wallpaper.color, wallpaper.scene, wallpaper.activeImageId, libraryEntry]);
}

function useWallpaperRotation(library: LibraryEntry[] | null): void {
  const { rotateMinutes, lastRotatedAt, imageIds, source, libraryRotateMinutes, libraryRotatedAt } = useAppState().settings.wallpaper;
  useEffect(() => {
    if (source !== 'image') return;
    const check = () => {
      if (isRotationDue(rotateMinutes, lastRotatedAt, imageIds.length, Date.now())) nextWallpaper();
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [rotateMinutes, lastRotatedAt, imageIds.length, source]);

  // The time of the last change is stored, so an interval carries on across restarts:
  // a tab opened after the browser was closed long enough changes the image at once.
  useEffect(() => {
    if (source !== 'library' || !library) return;
    const check = () => {
      if (isRotationDue(libraryRotateMinutes, libraryRotatedAt, library.length, Date.now())) nextLibraryImage(library);
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [libraryRotateMinutes, libraryRotatedAt, library, source]);
}

export function App() {
  const { dashboard, settings, session } = useAppState();
  const { toast, confirm } = useFeedback();
  const open = useOpenShortcut();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useState(() => (settings.sidebar.rememberLastGroup ? session.lastGroupId : null));
  const lastWheel = useRef(0);
  const lastScroll = useRef({ at: 0, top: 0 });
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => document.documentElement.classList.remove('opening'), OPENING_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (takeRestoredFlag()) toast(t('restoreDone'));
  }, [toast]);

  useTheme(settings.theme);
  const library = useLibrary(settings.wallpaper.source === 'library');
  useAccentColor(library);
  useWallpaperRotation(library);
  const [standbyOpen, dismissStandby] = useStandby(settings.standby, dialog !== null);

  const activeGroup = dashboard.groups.find((g) => g.id === groupId) ?? dashboard.groups[0];
  const closeMenu = useCallback(() => setMenu(null), []);

  const showGroup = (id: string) => {
    setGroupId(id);
    setSelecting(false);
    setSelected(new Set());
    main.current?.scrollTo({ top: 0 });
    if (settings.sidebar.rememberLastGroup) {
      update('session', (s) => {
        s.lastGroupId = id;
      });
    }
  };

  /** The current group fades out first, then the new one fades in through its CSS. */
  const selectGroup = (id: string) => {
    const grid = main.current?.querySelector('.grid');
    const duration = settings.grid.fadeMs * GROUP_EXIT_SHARE;
    if (id === activeGroup?.id || !grid || duration === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      showGroup(id);
      return;
    }
    void grid
      .animate({ opacity: [1, 0] }, { duration, easing: 'ease-in', fill: 'forwards' })
      .finished.catch(() => undefined)
      .then(() => showGroup(id));
  };

  const toggleSelected = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const deleteSelected = async () => {
    if (await confirm({ message: t('deleteSelectedConfirm', String(selected.size)) })) {
      deleteShortcuts(selected);
      exitSelection();
    }
  };

  const shortcutMenu = (e: MouseEvent, shortcut: Shortcut) => {
    if (selecting || !activeGroup) return;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('openNew'), onSelect: () => open(shortcut.url, 'new') },
        { label: t('openBackground'), onSelect: () => open(shortcut.url, 'background') },
        { label: t('openPrivate'), onSelect: () => open(shortcut.url, 'private') },
        { label: t('edit'), onSelect: () => setDialog({ kind: 'shortcut', shortcut, groupId: activeGroup.id }) },
        { label: t('selectMultiple'), onSelect: () => { setSelecting(true); setSelected(new Set([shortcut.id])); } },
        {
          label: t('delete'),
          danger: true,
          onSelect: () => {
            void confirm({ message: t('deleteShortcutConfirm', shortcut.title) }).then((ok) => {
              if (ok) deleteShortcuts([shortcut.id]);
            });
          },
        },
      ],
    });
  };

  const groupMenu = (e: MouseEvent, group: Group) => {
    const items: MenuItem[] = [
      { label: t('editGroup'), onSelect: () => setDialog({ kind: 'group', group }) },
      {
        label: t('openAll'),
        onSelect: () => {
          for (const id of group.shortcutIds) {
            const shortcut = dashboard.shortcuts[id];
            if (shortcut) open(shortcut.url, 'background');
          }
        },
      },
    ];
    if (dashboard.groups.length > 1) {
      items.push({
        label: t('delete'),
        danger: true,
        onSelect: () => {
          void confirm({ message: t('deleteGroupConfirm', group.name, String(group.shortcutIds.length)) }).then((ok) => {
            if (ok) deleteGroup(group.id);
          });
        },
      });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const backgroundMenu = (e: MouseEvent) => {
    // Typing fields keep the browser's own menu, for paste and spelling.
    if (!activeGroup || (e.target as Element).closest('input, textarea')) return;
    e.preventDefault();
    const items: MenuItem[] = [
      { label: t('addShortcut'), onSelect: () => setDialog({ kind: 'shortcut', groupId: activeGroup.id }) },
      { label: t('settings'), onSelect: () => setDialog({ kind: 'settings' }) },
    ];
    if (settings.wallpaper.source === 'image' && settings.wallpaper.imageIds.length > 1) {
      items.splice(1, 0, { label: t('nextWallpaper'), onSelect: () => nextWallpaper() });
    }
    if (settings.wallpaper.source === 'library' && library && library.length > 1) {
      items.splice(1, 0, { label: t('nextImage'), onSelect: () => nextLibraryImage(library) });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const wheel = (e: WheelEvent<HTMLElement>) => {
    if (!settings.sidebar.scrollToSwitch || e.deltaY === 0 || !activeGroup) return;
    const element = e.currentTarget;
    const step = e.deltaY > 0 ? 1 : -1;
    const scrolls = element.scrollHeight > element.clientHeight + 1;
    const atEnd = step > 0 ? element.scrollTop + element.clientHeight >= element.scrollHeight - 1 : element.scrollTop <= 0;
    const now = Date.now();
    const tooSoon = now - lastWheel.current < WHEEL_SWITCH_INTERVAL_MS;
    // Chromium scrolls before this runs, so the position alone can't show that this
    // turn is the one that reached the end. A scroll event hasn't caught up with it yet.
    const stillMoving = element.scrollTop !== lastScroll.current.top || now - lastScroll.current.at < WHEEL_SWITCH_INTERVAL_MS;
    // A group taller than the page scrolls to its end first. Moving on then takes a
    // pause and a fresh turn, so the scroll that reached the end doesn't carry past it.
    if (!atEnd || (scrolls && (tooSoon || stillMoving))) {
      lastWheel.current = now;
      return;
    }
    if (tooSoon) return;
    lastWheel.current = now;
    const next = neighbourGroup(dashboard, activeGroup.id, step);
    if (next) selectGroup(next.id);
  };

  if (!activeGroup) return null;

  return (
    <>
      <Wallpaper settings={settings.wallpaper} library={library} />
      <div className={`layout side-${settings.sidebar.side}`}>
        <Sidebar
          activeGroupId={activeGroup.id}
          onSelect={selectGroup}
          onAddGroup={() => setDialog({ kind: 'group' })}
          onGroupMenu={groupMenu}
          onOpenSettings={() => setDialog({ kind: 'settings' })}
        />
        <main
          ref={main}
          className="main"
          onWheel={wheel}
          onScroll={(e) => {
            lastScroll.current = { at: Date.now(), top: e.currentTarget.scrollTop };
          }}
          onContextMenu={backgroundMenu}
        >
          <header className="top">
            {settings.clock.show && <Clock hour24={settings.clock.hour24} />}
            {settings.search.show && <SearchBox />}
          </header>
          <Grid
            key={activeGroup.id}
            group={activeGroup}
            selecting={selecting}
            selected={selected}
            onToggleSelected={toggleSelected}
            onAdd={() => setDialog({ kind: 'shortcut', groupId: activeGroup.id })}
            onShortcutMenu={shortcutMenu}
          />
          {selecting && (
            <div className="selection-bar" role="toolbar" aria-label={t('selectMultiple')}>
              <span>{t('selectedCount', String(selected.size))}</span>
              <button type="button" onClick={exitSelection}>
                {t('cancel')}
              </button>
              <button type="button" className="danger-solid" disabled={selected.size === 0} onClick={() => void deleteSelected()}>
                {t('delete')}
              </button>
            </div>
          )}
        </main>
      </div>

      {standbyOpen && <Standby settings={settings.standby} hour24={settings.clock.hour24} onDismiss={dismissStandby} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {dialog?.kind === 'shortcut' && (
        <Modal title={dialog.shortcut ? t('editShortcut') : t('addShortcut')} onClose={() => setDialog(null)}>
          <ShortcutForm shortcut={dialog.shortcut} groupId={dialog.groupId} onDone={() => setDialog(null)} />
        </Modal>
      )}
      {dialog?.kind === 'group' && <GroupEditor group={dialog.group} onClose={() => setDialog(null)} onCreated={selectGroup} />}
      {dialog?.kind === 'settings' && (
        <SettingsPanel
          onClose={() => setDialog(null)}
          onImportBookmarks={(folders) => {
            if (folders.length === 0) toast(t('bookmarksEmpty'));
            else setDialog({ kind: 'bookmarks', folders });
          }}
        />
      )}
      {dialog?.kind === 'bookmarks' && <BookmarkImport folders={dialog.folders} onClose={() => setDialog(null)} />}
    </>
  );
}
