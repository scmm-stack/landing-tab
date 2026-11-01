import { useMemo, useState } from 'react';
import { saveShortcut } from '../lib/actions';
import type { BookmarkFolder, PickableBookmark } from '../lib/bookmarks';
import { t } from '../lib/i18n';
import { lettersFor, pickColor } from '../lib/model';
import { newId, useAppState } from '../lib/store';
import { Field, Modal, useFeedback } from './ui';

const IMPORT_LIMIT = 300;

/** Imported bookmarks become letter tiles. Nothing is looked up, so no URL leaves the device. */
export function BookmarkImport({ folders, onClose }: { folders: BookmarkFolder[]; onClose: () => void }) {
  const { dashboard } = useAppState();
  const { toast } = useFeedback();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useState(dashboard.groups[0]?.id ?? '');

  const byId = useMemo(() => {
    const map = new Map<string, PickableBookmark>();
    for (const folder of folders) for (const item of folder.items) map.set(item.id, item);
    return map;
  }, [folders]);

  const toggle = (ids: string[], on: boolean) => {
    setChosen((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const submit = () => {
    if (chosen.size > IMPORT_LIMIT) {
      toast(t('bookmarkLimit', String(IMPORT_LIMIT)));
      return;
    }
    for (const id of chosen) {
      const bookmark = byId.get(id);
      if (!bookmark) continue;
      saveShortcut(
        {
          id: newId(),
          title: bookmark.title,
          url: bookmark.url,
          note: '',
          tile: { kind: 'letter', text: lettersFor(bookmark.title) },
          color: pickColor(bookmark.title),
        },
        groupId,
      );
    }
    toast(t('bookmarksImported', String(chosen.size)));
    onClose();
  };

  return (
    <Modal title={t('importBookmarks')} onClose={onClose} wide>
      <Field label={t('fieldGroup')}>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {dashboard.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.symbol} {g.name}
            </option>
          ))}
        </select>
      </Field>
      {folders.length === 0 && <p className="empty">{t('bookmarksEmpty')}</p>}
      <div className="bookmark-folders">
        {folders.map((folder) => {
          const ids = folder.items.map((item) => item.id);
          const allOn = ids.every((id) => chosen.has(id));
          return (
            <fieldset key={folder.id}>
              <legend>
                <label>
                  <input type="checkbox" checked={allOn} onChange={(e) => toggle(ids, e.target.checked)} /> {folder.title}
                </label>
              </legend>
              {folder.items.map((item) => (
                <label key={item.id} className="bookmark" title={item.url}>
                  <input type="checkbox" checked={chosen.has(item.id)} onChange={(e) => toggle([item.id], e.target.checked)} /> {item.title}
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
      <div className="actions">
        <button type="button" onClick={onClose}>
          {t('cancel')}
        </button>
        <button type="button" className="primary" disabled={chosen.size === 0} onClick={submit}>
          {t('importCount', String(chosen.size))}
        </button>
      </div>
    </Modal>
  );
}
