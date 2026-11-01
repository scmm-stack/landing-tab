import { type CSSProperties, type DragEvent, type MouseEvent, useState } from 'react';
import * as dash from '../lib/dashboard';
import { t } from '../lib/i18n';
import type { Group } from '../lib/model';
import { update, useAppState } from '../lib/store';
import { rem } from '../lib/units';
import { SHORTCUT_DRAG_TYPE } from './Grid';

const GROUP_DRAG_TYPE = 'application/x-landing-tab-group';

interface Props {
  activeGroupId: string;
  onSelect: (id: string) => void;
  onAddGroup: () => void;
  onGroupMenu: (e: MouseEvent, group: Group) => void;
  onOpenSettings: () => void;
}

export function Sidebar({ activeGroupId, onSelect, onAddGroup, onGroupMenu, onOpenSettings }: Props) {
  const { dashboard, settings } = useAppState();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const config = settings.sidebar;

  const className = ['sidebar', `side-${config.side}`, config.narrow && 'narrow', config.autoHide && 'auto-hide', dragOver && 'drag-over'].filter(Boolean).join(' ');
  const style: CSSProperties = { ['--sidebar-extra' as string]: rem(config.extraWidth) };

  const dropOnGroup = (e: DragEvent, group: Group, index: number) => {
    e.preventDefault();
    setDropTarget(null);
    const shortcutId = e.dataTransfer.getData(SHORTCUT_DRAG_TYPE);
    const groupId = e.dataTransfer.getData(GROUP_DRAG_TYPE);
    update('dashboard', (d) => {
      if (shortcutId) dash.moveShortcut(d, shortcutId, group.id, group.shortcutIds.length);
      else if (groupId) dash.moveGroup(d, groupId, index);
    });
  };

  return (
    // Hovering doesn't register during a drag, so a shortcut couldn't reach a hidden sidebar.
    <nav
      className={className}
      style={style}
      aria-label={t('groups')}
      onDragEnter={() => setDragOver(true)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragOver(false)}
      onDrop={() => setDragOver(false)}
      onClick={(e) => {
        // A mouse click shouldn't leave focus here, or a dialog closed with Escape would
        // hand it back as keyboard focus and hold the hidden sidebar open.
        if (config.autoHide && e.detail > 0 && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
    >
      <ul className="group-list">
        {dashboard.groups.map((group, index) => (
          <li key={group.id}>
            <button
              type="button"
              className={[group.id === activeGroupId && 'active', dropTarget === group.id && 'drop-target'].filter(Boolean).join(' ') || undefined}
              aria-current={group.id === activeGroupId ? 'true' : undefined}
              title={group.name}
              draggable
              onClick={() => onSelect(group.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onGroupMenu(e, group);
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(GROUP_DRAG_TYPE, group.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(group.id);
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => dropOnGroup(e, group, index)}
            >
              <span className="group-symbol">{group.symbol || Array.from(group.name)[0]}</span>
              <span className="group-name">{group.name}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" title={t('addGroup')} onClick={onAddGroup}>
            <span className="group-symbol">+</span>
            <span className="group-name">{t('addGroup')}</span>
          </button>
        </li>
      </ul>
      <div className="sidebar-footer">
        <button type="button" title={t('settings')} onClick={onOpenSettings}>
          <span className="group-symbol" aria-hidden="true">
            ⚙
          </span>
          <span className="group-name">{t('settings')}</span>
        </button>
      </div>
    </nav>
  );
}
