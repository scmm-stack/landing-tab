import { type FormEvent, useState } from 'react';
import { t } from '../lib/i18n';
import type { Group } from '../lib/model';
import { newId, update } from '../lib/store';
import { Field, Modal } from './ui';

export function GroupEditor({ group, onClose, onCreated }: { group?: Group; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [symbol, setSymbol] = useState(group?.symbol ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const cleanSymbol = Array.from(symbol.trim()).slice(0, 4).join('');
    if (group) {
      update('dashboard', (d) => {
        const target = d.groups.find((g) => g.id === group.id);
        if (target) {
          target.name = cleanName;
          target.symbol = cleanSymbol;
        }
      });
    } else {
      const id = newId();
      update('dashboard', (d) => {
        d.groups.push({ id, name: cleanName, symbol: cleanSymbol, shortcutIds: [] });
      });
      onCreated(id);
    }
    onClose();
  };

  return (
    <Modal title={group ? t('editGroup') : t('addGroup')} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label={t('fieldName')}>
          <input value={name} required maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('fieldSymbol')} hint={t('fieldSymbolHint')}>
          <input value={symbol} maxLength={8} onChange={(e) => setSymbol(e.target.value)} />
        </Field>
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="primary">
            {t('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
