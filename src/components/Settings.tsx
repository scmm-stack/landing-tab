import { type ChangeEvent, type FormEvent, type ReactNode, useState } from 'react';
import { nextLibraryImage, nextWallpaper, reloadAfterRestore, storingImages } from '../lib/actions';
import { BackupError, backupFileName, createBackup, parseBackup } from '../lib/backup';
import { type BookmarkFolder, exportToBookmarks, foldersFromTree, readBookmarks, requestBookmarkAccess } from '../lib/bookmarks';
import { t } from '../lib/i18n';
import { MAX_WALLPAPER_BYTES, isAllowedImage, listImageIds, loadImage, removeImage, saveImage } from '../lib/images';
import { LAYOUT_PRESETS, LIBRARY_INTERVALS, type OpenTarget, type SceneId, type Settings as SettingsData, type ThemeMode } from '../lib/model';
import { removeSiteAccess, requestSiteAccess } from '../lib/favicon';
import { engineUrlIsValid } from '../lib/normalize';
import { downloadBlob } from '../lib/open';
import { flush, getState, newId, replaceState, update, useAppState } from '../lib/store';
import { remLabel } from '../lib/units';
import { tileFaceSize } from './Grid';
import { useSiteAccess } from './ShortcutEditor';
import { useImageUrl } from './Tile';
import { useLibrary } from './Wallpaper';
import { Choice, Field, Modal, Slider, Toggle, useFeedback } from './ui';

type Tab = 'appearance' | 'shortcuts' | 'sidebar' | 'search' | 'clock' | 'data';

// The width set by --sidebar-width in app.css, which the width setting adds to.
const SIDEBAR_BASE_WIDTH = 190;

const change = (recipe: (s: SettingsData) => void) => update('settings', recipe);

/**
 * Each tab runs from what shows on the page, to how it looks, to what it does.
 * Options that would have no effect are hidden rather than left to do nothing.
 */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

const useOpenTargets = (): { value: OpenTarget; label: string }[] => [
  { value: 'current', label: t('openCurrent') },
  { value: 'new', label: t('openNew') },
  { value: 'background', label: t('openBackground') },
  { value: 'private', label: t('openPrivate') },
];

function AppearanceTab({ s }: { s: SettingsData }) {
  return (
    <>
      <Section title={t('colorsSection')}>
        <Choice<ThemeMode>
          label={t('theme')}
          value={s.theme}
          options={[
            { value: 'system', label: t('themeSystem') },
            { value: 'light', label: t('themeLight') },
            { value: 'dark', label: t('themeDark') },
          ]}
          onChange={(v) => change((d) => void (d.theme = v))}
        />
        <Toggle
          label={t('accentFromWallpaper')}
          hint={t('accentFromWallpaperHint')}
          checked={s.wallpaper.pageColorsFollow}
          onChange={(v) => change((d) => void (d.wallpaper.pageColorsFollow = v))}
        />
      </Section>
      <WallpaperSection s={s} />
    </>
  );
}

function SidebarTab({ s }: { s: SettingsData }) {
  const b = s.sidebar;
  return (
    <>
      <Section title={t('sidebar')}>
        <Choice
          label={t('sidebarSide')}
          value={b.side}
          options={[
            { value: 'left', label: t('sideLeft') },
            { value: 'right', label: t('sideRight') },
          ]}
          onChange={(v) => change((d) => void (d.sidebar.side = v))}
        />
        <Slider label={t('sidebarWidth')} value={b.extraWidth} min={0} max={200} format={(v) => remLabel(SIDEBAR_BASE_WIDTH + v)} onChange={(v) => change((d) => void (d.sidebar.extraWidth = v))} />
        <Toggle label={t('sidebarAutoHide')} checked={b.autoHide} onChange={(v) => change((d) => void (d.sidebar.autoHide = v))} />
        <Toggle label={t('sidebarNarrow')} checked={b.narrow} onChange={(v) => change((d) => void (d.sidebar.narrow = v))} />
      </Section>
      <Section title={t('groups')}>
        <Toggle label={t('scrollToSwitch')} hint={t('scrollToSwitchHint')} checked={b.scrollToSwitch} onChange={(v) => change((d) => void (d.sidebar.scrollToSwitch = v))} />
        <Toggle label={t('rememberLastGroup')} hint={t('rememberLastGroupHint')} checked={b.rememberLastGroup} onChange={(v) => change((d) => void (d.sidebar.rememberLastGroup = v))} />
      </Section>
    </>
  );
}

/** Turning this off also hands site access back to the browser. */
function WebsiteImages({ enabled }: { enabled: boolean }) {
  const [access, setAccess] = useSiteAccess();
  const toggle = (on: boolean) => {
    if (on) {
      // The permission prompt has to open directly from this click.
      void requestSiteAccess().then((granted) => {
        setAccess(granted);
        change((d) => void (d.grid.websiteImages = granted));
      });
      return;
    }
    setAccess(false);
    change((d) => void (d.grid.websiteImages = false));
    void removeSiteAccess();
  };
  return <Toggle label={t('websiteImages')} hint={t('websiteImagesHint')} checked={enabled && access === true} onChange={toggle} />;
}

function ShortcutsTab({ s }: { s: SettingsData }) {
  const g = s.grid;
  const targets = useOpenTargets();
  const cards = g.tileStyle === 'card';
  const presets = [
    { name: 'compact', label: t('presetCompact') },
    { name: 'balanced', label: t('presetBalanced') },
    { name: 'spacious', label: t('presetSpacious') },
    { name: 'wide', label: t('presetWide') },
  ] as const;
  const isCurrent = (name: keyof typeof LAYOUT_PRESETS) => Object.entries(LAYOUT_PRESETS[name]).every(([key, value]) => g[key as keyof typeof g] === value);

  return (
    <>
      <Section title={t('layout')}>
        <div className="field" role="group" aria-label={t('layoutPreset')}>
          <span className="field-label">{t('layoutPreset')}</span>
          <div className="segmented">
            {presets.map(({ name, label }) => (
              <button key={name} type="button" aria-pressed={isCurrent(name)} onClick={() => change((d) => void Object.assign(d.grid, LAYOUT_PRESETS[name]))}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Choice
          label={t('arrangement')}
          value={g.mode}
          options={[
            { value: 'fixedSize', label: t('arrangementAuto') },
            { value: 'fixedColumns', label: t('arrangementColumns') },
          ]}
          onChange={(v) => change((d) => void (d.grid.mode = v))}
        />
        {g.mode === 'fixedColumns' && <Slider label={cards ? t('maxColumns') : t('columns')} value={g.columns} min={2} max={16} onChange={(v) => change((d) => void (d.grid.columns = v))} />}
        <Slider label={t('tileSize')} value={g.tileSize} min={32} max={140} format={() => remLabel(tileFaceSize(g))} onChange={(v) => change((d) => void (d.grid.tileSize = v))} />
        <Slider label={t('rowGap')} value={g.rowGap} min={0} max={80} format={remLabel} onChange={(v) => change((d) => void (d.grid.rowGap = v))} />
        <Slider label={t('columnGap')} value={g.columnGap} min={0} max={80} format={remLabel} onChange={(v) => change((d) => void (d.grid.columnGap = v))} />
        <Slider label={t('displayWidth')} value={g.displayWidth} min={30} max={100} unit="%" onChange={(v) => change((d) => void (d.grid.displayWidth = v))} />
      </Section>
      <Section title={t('styleSection')}>
        <Choice
          label={t('tileStyle')}
          value={g.tileStyle}
          options={[
            { value: 'card', label: t('tileStyleCard') },
            { value: 'icon', label: t('tileStyleIcon') },
          ]}
          onChange={(v) => change((d) => void (d.grid.tileStyle = v))}
        />
        {!cards && <Toggle label={t('showLabels')} checked={g.showLabels} onChange={(v) => change((d) => void (d.grid.showLabels = v))} />}
        <Slider label={t('shortcutOpacity')} value={g.opacity} min={10} max={100} unit="%" onChange={(v) => change((d) => void (d.grid.opacity = v))} />
        <Toggle label={t('shadow')} checked={g.shadow} onChange={(v) => change((d) => void (d.grid.shadow = v))} />
        <Toggle label={t('shine')} checked={g.shine} onChange={(v) => change((d) => void (d.grid.shine = v))} />
        <Slider label={t('fadeTime')} hint={t('fadeTimeHint')} value={g.fadeMs} min={0} max={1000} step={10} unit="ms" onChange={(v) => change((d) => void (d.grid.fadeMs = v))} />
      </Section>
      <Section title={t('behaviorSection')}>
        <Choice label={t('openShortcutsIn')} value={g.openTarget} options={targets} onChange={(v) => change((d) => void (d.grid.openTarget = v))} />
        <Toggle label={t('showAddButton')} checked={g.showAddButton} onChange={(v) => change((d) => void (d.grid.showAddButton = v))} />
        <WebsiteImages enabled={g.websiteImages} />
      </Section>
    </>
  );
}

function SearchTab({ s }: { s: SettingsData }) {
  const { search } = useAppState();
  const { confirm } = useFeedback();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const targets = useOpenTargets();
  const c = s.search;

  const addEngine = (e: FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanUrl = url.trim();
    if (!cleanName) return;
    if (!engineUrlIsValid(cleanUrl)) {
      setError(t('engineUrlInvalid'));
      return;
    }
    const id = newId();
    update('search', (d) => {
      d.engines.push({ id, name: cleanName, kind: 'url', url: cleanUrl, builtIn: false });
    });
    setName('');
    setUrl('');
    setError('');
  };

  return (
    <>
      <Section title={t('searchBoxSection')}>
        <Toggle label={t('showSearchBox')} checked={c.show} onChange={(v) => change((d) => void (d.search.show = v))} />
        {c.show && (
          <>
            <Slider label={t('searchWidth')} value={c.width} min={240} max={1000} step={10} format={remLabel} onChange={(v) => change((d) => void (d.search.width = v))} />
            <Slider label={t('searchHeight')} value={c.height} min={32} max={72} format={remLabel} onChange={(v) => change((d) => void (d.search.height = v))} />
            <Slider label={t('searchRoundness')} value={c.roundness} min={0} max={36} format={remLabel} onChange={(v) => change((d) => void (d.search.roundness = v))} />
            <Slider label={t('searchOpacity')} value={c.opacity} min={10} max={100} unit="%" onChange={(v) => change((d) => void (d.search.opacity = v))} />
          </>
        )}
      </Section>

      {c.show && (
        <>
          <Section title={t('searchResultsSection')}>
            <Choice label={t('openResultsIn')} value={c.openTarget} options={targets} onChange={(v) => change((d) => void (d.search.openTarget = v))} />
            <Toggle
              label={t('searchHistorySetting')}
              hint={t('searchHistoryHint')}
              checked={c.historyEnabled}
              onChange={(v) => {
                change((d) => void (d.search.historyEnabled = v));
                if (!v) update('search', (d) => void (d.history = []));
              }}
            />
          </Section>

          <Section title={t('searchEngines')} hint={t('searchEnginesHint')}>
            <ul className="engine-list">
              {search.engines.map((engine) => (
                <li key={engine.id}>
                  <span>{engine.kind === 'browser' ? t('engineBrowserDefault') : engine.name}</span>
                  {!engine.builtIn && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void confirm({ message: t('engineDeleteConfirm', engine.name) }).then((ok) => {
                          if (!ok) return;
                          update('search', (d) => {
                            d.engines = d.engines.filter((item) => item.id !== engine.id);
                            if (d.activeEngineId === engine.id) d.activeEngineId = 'browser';
                          });
                        })
                      }
                    >
                      {t('delete')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t('addSearchEngine')}>
            <form className="form" onSubmit={addEngine}>
              <Field label={t('fieldName')}>
                <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('fieldEngineUrl')} hint={t('engineUrlHint')}>
                <input value={url} spellCheck={false} placeholder="https://example.com/search?q=%s" onChange={(e) => setUrl(e.target.value)} />
              </Field>
              {error && <p className="error">{error}</p>}
              <div className="actions">
                <button type="submit" className="primary" disabled={!name.trim() || !url.trim()}>
                  {t('add')}
                </button>
              </div>
            </form>
          </Section>
        </>
      )}
    </>
  );
}

function ClockTab({ s }: { s: SettingsData }) {
  const b = s.standby;
  return (
    <>
      <Section title={t('clockSection')}>
        <Toggle label={t('showClock')} checked={s.clock.show} onChange={(v) => change((d) => void (d.clock.show = v))} />
        <Toggle label={t('hour24')} checked={s.clock.hour24} onChange={(v) => change((d) => void (d.clock.hour24 = v))} />
      </Section>
      <Section title={t('standby')}>
        <Toggle label={t('standbyEnabled')} hint={t('standbyHint')} checked={b.enabled} onChange={(v) => change((d) => void (d.standby.enabled = v))} />
        {b.enabled && (
          <>
            <Slider label={t('standbyDelay')} value={b.inactivitySeconds} min={5} max={600} step={5} unit="s" onChange={(v) => change((d) => void (d.standby.inactivitySeconds = v))} />
            <Toggle label={t('standbyOnNewTab')} checked={b.showOnNewTab} onChange={(v) => change((d) => void (d.standby.showOnNewTab = v))} />
            <Toggle label={t('standbyClock')} checked={b.showClock} onChange={(v) => change((d) => void (d.standby.showClock = v))} />
            <Slider label={t('standbyBlur')} value={b.blur} min={0} max={40} unit="px" onChange={(v) => change((d) => void (d.standby.blur = v))} />
          </>
        )}
      </Section>
    </>
  );
}

function WallpaperThumb({ id, active, onSelect, onRemove }: { id: string; active: boolean; onSelect: () => void; onRemove: () => void }) {
  const url = useImageUrl(id);
  return (
    <li className={active ? 'thumb active' : 'thumb'}>
      <button type="button" aria-pressed={active} aria-label={t('useWallpaper')} onClick={onSelect}>
        {url && <img src={url} alt="" />}
      </button>
      <button type="button" className="remove" aria-label={t('delete')} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

function intervalLabel(minutes: number): string {
  const hours = minutes / 60;
  if (hours === 0) return t('rotateNever');
  if (hours === 1) return t('rotateHour');
  // Polish counts 2, 3, 4, 22, 23 and 24 differently from 5 to 21.
  const few = hours % 10 >= 2 && hours % 10 <= 4 && (hours % 100 < 12 || hours % 100 > 14);
  return t(few ? 'rotateHoursFew' : 'rotateHours', String(hours));
}

function WallpaperSection({ s }: { s: SettingsData }) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const w = s.wallpaper;
  const library = useLibrary(w.source === 'library');

  const addImages = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setBusy(true);
    try {
      for (const file of files) {
        if (!isAllowedImage(file) || file.type === 'image/x-icon') {
          toast(t('imageTypeUnsupported'));
          continue;
        }
        if (file.size > MAX_WALLPAPER_BYTES) {
          toast(t('imageTooLarge', '30 MB'));
          continue;
        }
        const id = newId();
        await storingImages(async () => {
          await saveImage(id, file);
          change((d) => {
            d.wallpaper.imageIds.push(id);
            d.wallpaper.activeImageId = id;
            d.wallpaper.source = 'image';
          });
        });
      }
    } catch {
      toast(t('imageSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const removeWallpaper = async (id: string) => {
    if (!(await confirm({ message: t('wallpaperDeleteConfirm') }))) return;
    change((d) => {
      const ids = d.wallpaper.imageIds.filter((item) => item !== id);
      d.wallpaper.imageIds = ids;
      if (d.wallpaper.activeImageId === id) d.wallpaper.activeImageId = ids[0] ?? null;
      if (ids.length === 0 && d.wallpaper.source === 'image') d.wallpaper.source = 'scene';
    });
    await removeImage(id);
  };

  const download = async () => {
    if (!w.activeImageId) return;
    const blob = await loadImage(w.activeImageId).catch(() => undefined);
    if (blob) downloadBlob(blob, `wallpaper.${blob.type.split('/')[1]?.split('+')[0] ?? 'png'}`);
    else toast(t('imageSaveFailed'));
  };

  return (
    <Section title={t('wallpaperSection')}>
      <Choice
        label={t('wallpaperSource')}
        value={w.source}
        options={[
          { value: 'scene', label: t('wallpaperScene') },
          { value: 'image', label: t('wallpaperImage') },
          { value: 'color', label: t('wallpaperColor') },
          { value: 'library', label: t('wallpaperLibrary') },
        ]}
        onChange={(v) =>
          change((d) => {
            d.wallpaper.source = v;
            // Starts the interval now, rather than from whenever the library was last used.
            if (v === 'library') d.wallpaper.libraryRotatedAt = Date.now();
          })
        }
      />

      {w.source === 'library' && library?.length === 0 && <p className="hint">{t('libraryUnavailable')}</p>}

      {w.source === 'library' && library && library.length > 1 && (
        <>
          <div className="actions start">
            <button type="button" onClick={() => nextLibraryImage(library)}>
              {t('nextImage')}
            </button>
          </div>
          <Choice
            label={t('changeInterval')}
            value={String(w.libraryRotateMinutes)}
            options={LIBRARY_INTERVALS.map((minutes) => ({ value: String(minutes), label: intervalLabel(minutes) }))}
            onChange={(v) =>
              change((d) => {
                d.wallpaper.libraryRotateMinutes = Number(v);
                d.wallpaper.libraryRotatedAt = Date.now();
              })
            }
          />
        </>
      )}

      {w.source === 'scene' && (
        <Choice<SceneId>
          label={t('wallpaperSceneChoice')}
          value={w.scene}
          options={[
            { value: 'aurora', label: t('sceneAurora') },
            { value: 'lanterns', label: t('sceneLanterns') },
          ]}
          onChange={(v) => change((d) => void (d.wallpaper.scene = v))}
        />
      )}

      {w.source === 'color' && (
        <label className="row">
          <span>{t('wallpaperColorChoice')}</span>
          <input type="color" value={w.color} onChange={(e) => change((d) => void (d.wallpaper.color = e.target.value))} />
        </label>
      )}

      {w.source === 'image' && (
        <>
          <ul className="thumbs">
            {w.imageIds.map((id) => (
              <WallpaperThumb
                key={id}
                id={id}
                active={id === w.activeImageId}
                onSelect={() => change((d) => void (d.wallpaper.activeImageId = id))}
                onRemove={() => void removeWallpaper(id)}
              />
            ))}
          </ul>
          <div className="actions start">
            <label className="button">
              {busy ? t('saving') : t('addImages')}
              <input
                type="file"
                className="visually-hidden"
                multiple
                disabled={busy}
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                onChange={(e) => void addImages(e)}
              />
            </label>
            {w.imageIds.length > 1 && (
              <button type="button" onClick={() => nextWallpaper()}>
                {t('nextWallpaper')}
              </button>
            )}
            {w.activeImageId && (
              <button type="button" onClick={() => void download()}>
                {t('downloadWallpaper')}
              </button>
            )}
          </div>
          {w.imageIds.length > 1 && (
            <Choice
              label={t('rotateEvery')}
              value={String(w.rotateMinutes)}
              options={[
                { value: '0', label: t('rotateNever') },
                { value: '30', label: t('rotateMinutes', '30') },
                { value: '60', label: t('rotateHour') },
                { value: '360', label: t('rotateHours', '6') },
                { value: '1440', label: t('rotateDaily') },
              ]}
              onChange={(v) => change((d) => void (d.wallpaper.rotateMinutes = Number(v)))}
            />
          )}
        </>
      )}

      <Slider label={t('wallpaperBlur')} value={w.blur} min={0} max={40} unit="px" onChange={(v) => change((d) => void (d.wallpaper.blur = v))} />
    </Section>
  );
}

function DataTab({ onImportBookmarks }: { onImportBookmarks: (folders: BookmarkFolder[]) => void }) {
  const { toast, confirm } = useFeedback();
  const { dashboard } = useAppState();

  const exportBackup = async () => {
    try {
      await flush();
      const backup = await createBackup(getState(), { load: loadImage });
      downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), backupFileName());
    } catch {
      toast(t('backupFailed'));
    }
  };

  const restore = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { state, images } = parseBackup(await file.text(), newId);
      const shortcutCount = String(Object.keys(state.dashboard.shortcuts).length);
      if (!(await confirm({ message: t('restoreConfirm', shortcutCount), confirmLabel: t('restore') }))) return;
      await storingImages(async () => {
        for (const image of images) await saveImage(image.id, image.blob);
        const kept = new Set(images.map((image) => image.id));
        // Read first, so a window without image storage fails before anything changes.
        const stale = (await listImageIds()).filter((id) => !kept.has(id));
        await replaceState(state);
        await Promise.all(stale.map(removeImage));
      });
      reloadAfterRestore();
    } catch (error) {
      const reason = error instanceof BackupError ? error.message : '';
      toast(reason === 'newer-version' ? t('restoreTooNew') : t('restoreFailed'));
    }
  };

  const startImport = () => {
    const access = requestBookmarkAccess();
    void access
      .then(async (granted) => {
        if (granted) onImportBookmarks(foldersFromTree(await readBookmarks()));
        else toast(t('bookmarkAccessNeeded'));
      })
      .catch(() => toast(t('bookmarksFailed')));
  };

  const startExport = () => {
    const access = requestBookmarkAccess();
    void access
      .then(async (granted) => {
        if (!granted) {
          toast(t('bookmarkAccessNeeded'));
          return;
        }
        toast(t('bookmarksExported', String(await exportToBookmarks(dashboard, t('extName')))));
      })
      .catch(() => toast(t('bookmarksFailed')));
  };

  return (
    <>
      <Section title={t('backup')} hint={t('backupHint')}>
        <div className="actions start">
          <button type="button" onClick={() => void exportBackup()}>
            {t('exportBackup')}
          </button>
          <label className="button">
            {t('restoreBackup')}
            <input type="file" className="visually-hidden" accept="application/json,.json" onChange={(e) => void restore(e)} />
          </label>
        </div>
      </Section>

      <Section title={t('bookmarks')}>
        <div className="actions start">
          <button type="button" onClick={startImport}>
            {t('importBookmarks')}
          </button>
          <button type="button" onClick={startExport}>
            {t('exportBookmarks')}
          </button>
        </div>
      </Section>

      <Section title={t('privacy')}>
        <p>{t('privacyStatement')}</p>
        <p className="hint">{t('privacyFavicon')}</p>
      </Section>
    </>
  );
}

export function SettingsPanel({ onClose, onImportBookmarks }: { onClose: () => void; onImportBookmarks: (folders: BookmarkFolder[]) => void }) {
  const { settings } = useAppState();
  const [tab, setTab] = useState<Tab>('appearance');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'appearance', label: t('tabAppearance') },
    { id: 'shortcuts', label: t('tabShortcuts') },
    { id: 'sidebar', label: t('tabSidebar') },
    { id: 'search', label: t('tabSearch') },
    { id: 'clock', label: t('tabClock') },
    { id: 'data', label: t('tabData') },
  ];

  return (
    <Modal title={t('settings')} onClose={onClose} wide>
      <div className="settings">
        <div className="settings-tabs" role="tablist">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        {/* Keyed by tab, so each one opens at its top. */}
        <div key={tab} className="settings-panel" role="tabpanel">
          {tab === 'appearance' && <AppearanceTab s={settings} />}
          {tab === 'shortcuts' && <ShortcutsTab s={settings} />}
          {tab === 'sidebar' && <SidebarTab s={settings} />}
          {tab === 'search' && <SearchTab s={settings} />}
          {tab === 'clock' && <ClockTab s={settings} />}
          {tab === 'data' && <DataTab onImportBookmarks={onImportBookmarks} />}
        </div>
      </div>
    </Modal>
  );
}
