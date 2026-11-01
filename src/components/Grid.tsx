import { type CSSProperties, type DragEvent, type MouseEvent, useState } from 'react';
import * as dash from '../lib/dashboard';
import { t } from '../lib/i18n';
import type { Group, OpenTarget, Settings, Shortcut } from '../lib/model';
import { openUrl } from '../lib/open';
import { update, useAppState } from '../lib/store';
import { rem } from '../lib/units';
import { TileFace } from './Tile';
import { useFeedback } from './ui';

export const SHORTCUT_DRAG_TYPE = 'application/x-landing-tab-shortcut';

// A card's image needs more room than a bare icon to sit beside two lines of text,
// so the one "Tile size" setting and the layout presets work for both styles.
const CARD_FACE_SCALE = 1.5;
const CARD_WIDTH_RATIO = 2.6;

interface Props {
  group: Group;
  selecting: boolean;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onAdd: () => void;
  onShortcutMenu: (e: MouseEvent, shortcut: Shortcut) => void;
}

/** The size a tile's image is really drawn at, which is what the slider should report. */
export const tileFaceSize = (config: Settings['grid']): number =>
  config.tileStyle === 'card' ? Math.round(config.tileSize * CARD_FACE_SCALE) : config.tileSize;

export function useOpenShortcut(): (url: string, target?: OpenTarget) => void {
  const { settings } = useAppState();
  const { toast } = useFeedback();
  return (url, target = settings.grid.openTarget) => {
    void openUrl(url, target).then((result) => {
      if (result === 'private-not-allowed') toast(t('privateNotAllowed'));
      else if (result === 'failed') toast(t('openFailed'));
    });
  };
}

export function Grid({ group, selecting, selected, onToggleSelected, onAdd, onShortcutMenu }: Props) {
  const { dashboard, settings } = useAppState();
  const open = useOpenShortcut();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const config = settings.grid;

  const shortcuts = group.shortcutIds.flatMap((id) => {
    const shortcut = dashboard.shortcuts[id];
    return shortcut ? [shortcut] : [];
  });

  const card = config.tileStyle === 'card';
  const faceSize = tileFaceSize(config);
  const minColumn = card ? Math.round(faceSize * CARD_WIDTH_RATIO) : config.tileSize + 24;

  // Cards hold text, so "columns" is a maximum for them: a card never narrows below
  // its minimum, and the row wraps instead. The 0.01px stops rounding losing a column.
  const fixed = config.mode === 'fixedColumns';
  const equalShare = `calc((100% - ${rem((config.columns - 1) * config.columnGap)}) / ${config.columns} - 0.01px)`;
  const cardColumn = fixed ? `max(${rem(minColumn)}, ${equalShare})` : rem(minColumn);

  const columns =
    fixed && !card
      ? `repeat(${config.columns}, minmax(0, 1fr))`
      : `repeat(auto-fill, minmax(min(${card ? cardColumn : rem(minColumn)}, 100%), 1fr))`;

  const label = (title: string, note = '') =>
    card ? (
      <span className="tile-text">
        <span className="tile-label">{title}</span>
        {note && <span className="tile-note">{note}</span>}
      </span>
    ) : (
      config.showLabels && <span className="tile-label">{title}</span>
    );

  const style: CSSProperties = {
    gridTemplateColumns: columns,
    rowGap: rem(config.rowGap),
    columnGap: rem(config.columnGap),
    width: `${config.displayWidth}%`,
    ['--tile-size' as string]: rem(faceSize),
    ['--tile-opacity' as string]: config.opacity / 100,
    ['--fade' as string]: `${config.fadeMs}ms`,
  };

  const overTile = (e: DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes(SHORTCUT_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1);
  };

  const drop = (e: DragEvent, index: number) => {
    const id = e.dataTransfer.getData(SHORTCUT_DRAG_TYPE);
    setDropIndex(null);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    update('dashboard', (d) => dash.moveShortcut(d, id, group.id, index));
  };

  return (
    <ul
      className={['grid', card && 'cards', config.shadow && 'with-shadow', config.shine && 'shine'].filter(Boolean).join(' ')}
      style={style}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SHORTCUT_DRAG_TYPE)) return;
        e.preventDefault();
        setDropIndex(shortcuts.length);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
      }}
      onDrop={(e) => drop(e, shortcuts.length)}
    >
      {shortcuts.map((shortcut, index) => {
        const isSelected = selected.has(shortcut.id);
        const dropClass = dropIndex === index ? ' drop-before' : dropIndex === index + 1 ? ' drop-after' : '';
        return (
          <li
            key={shortcut.id}
            className={`cell${dropClass}`}
            onDragOver={(e) => overTile(e, index)}
            onDrop={(e) => drop(e, dropIndex ?? index)}
          >
            <a
              className={isSelected ? 'tile selected' : 'tile'}
              href={shortcut.url}
              rel="noreferrer noopener"
              title={shortcut.note || shortcut.title}
              draggable={!selecting}
              aria-pressed={selecting ? isSelected : undefined}
              onDragStart={(e) => {
                e.dataTransfer.setData(SHORTCUT_DRAG_TYPE, shortcut.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDropIndex(null)}
              onClick={(e) => {
                if (selecting) {
                  e.preventDefault();
                  onToggleSelected(shortcut.id);
                  return;
                }
                // Modified clicks stay with the browser, so ctrl-click works as usual.
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                open(shortcut.url);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onShortcutMenu(e, shortcut);
              }}
            >
              <TileFace tile={shortcut.tile} color={shortcut.color} />
              {label(shortcut.title, shortcut.note)}
            </a>
          </li>
        );
      })}
      {config.showAddButton && !selecting && (
        <li className="cell">
          <button type="button" className="tile add-tile" onClick={onAdd}>
            <span className="tile-face">+</span>
            {label(t('addShortcut'))}
          </button>
        </li>
      )}
    </ul>
  );
}
