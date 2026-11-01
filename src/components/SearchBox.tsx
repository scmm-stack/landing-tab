import { type CSSProperties, type FormEvent, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { openUrl, searchWithBrowser } from '../lib/open';
import { addToHistory, buildSearchUrl, matchHistory } from '../lib/search';
import { update, useAppState } from '../lib/store';
import { rem } from '../lib/units';
import { useFeedback } from './ui';

export function SearchBox() {
  const { search, settings } = useAppState();
  const { toast } = useFeedback();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [enginesOpen, setEnginesOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const config = settings.search;
  const engine = search.engines.find((e) => e.id === search.activeEngineId) ?? search.engines[0];
  const suggestions = useMemo(
    () => (config.historyEnabled && focused ? matchHistory(search.history, query) : []),
    [config.historyEnabled, focused, search.history, query],
  );

  const run = async (text: string) => {
    const clean = text.trim();
    if (!clean || !engine) return;
    if (config.historyEnabled) {
      update('search', (s) => {
        s.history = addToHistory(s.history, clean);
      });
    }
    const result = await (engine.kind === 'browser' ? searchWithBrowser(clean, config.openTarget) : openUrl(buildSearchUrl(engine, clean), config.openTarget));
    if (result === 'private-not-allowed') toast(t('privateNotAllowed'));
    else if (result === 'failed') toast(t('openFailed'));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(suggestions[cursor] ?? query);
  };

  const style: CSSProperties = {
    width: `min(${rem(config.width)}, 100%)`,
    height: rem(config.height),
    borderRadius: rem(config.roundness),
    backgroundColor: `color-mix(in srgb, var(--panel) ${config.opacity}%, transparent)`,
  };

  return (
    <div className="search-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setEnginesOpen(false)}>
      <form className="search" style={style} onSubmit={submit} role="search">
        <button
          type="button"
          className="search-engine"
          aria-haspopup="listbox"
          aria-expanded={enginesOpen}
          onClick={() => setEnginesOpen((v) => !v)}
        >
          {engine?.kind === 'browser' ? t('engineBrowserDefault') : engine?.name}
        </button>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length) {
              e.preventDefault();
              setCursor((c) => (c + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp' && suggestions.length) {
              e.preventDefault();
              setCursor((c) => (c <= 0 ? suggestions.length - 1 : c - 1));
            }
          }}
        />
      </form>

      {enginesOpen && (
        <ul className="dropdown" role="listbox" aria-label={t('searchEngines')}>
          {search.engines.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                role="option"
                aria-selected={e.id === search.activeEngineId}
                onClick={() => {
                  update('search', (s) => {
                    s.activeEngineId = e.id;
                  });
                  setEnginesOpen(false);
                  inputRef.current?.focus();
                }}
              >
                {e.kind === 'browser' ? t('engineBrowserDefault') : e.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && !enginesOpen && (
        <ul className="dropdown" aria-label={t('searchHistory')}>
          {suggestions.map((item, index) => (
            <li key={item}>
              {/* mousedown fires before the input's blur would hide this list. */}
              <button
                type="button"
                className={index === cursor ? 'active' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(item);
                  void run(item);
                }}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
