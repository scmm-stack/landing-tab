import { describe, expect, it } from 'vitest';
import { BUILT_IN_ENGINES, type Engine } from '../src/lib/model';
import { addToHistory, buildSearchUrl, matchHistory } from '../src/lib/search';

const engine = (id: string): Engine => {
  const found = BUILT_IN_ENGINES.find((e) => e.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('buildSearchUrl', () => {
  it('encodes the query', () => {
    expect(buildSearchUrl(engine('google'), 'a b&c=d')).toBe('https://www.google.com/search?q=a%20b%26c%3Dd');
  });

  it('adds nothing beyond the engine and the query', () => {
    const url = new URL(buildSearchUrl(engine('duckduckgo'), 'hello'));
    expect([...url.searchParams.keys()]).toEqual(['q']);
  });

  it('cannot be redirected by what is typed', () => {
    expect(buildSearchUrl(engine('bing'), 'https://evil.example/').startsWith('https://www.bing.com/search?q=')).toBe(true);
  });
});

describe('built-in engines', () => {
  it('have no partner or tracking parameters', () => {
    for (const e of BUILT_IN_ENGINES.filter((item) => item.kind === 'url')) {
      expect([...new URL(e.url.replace('%s', 'x')).searchParams.keys()], e.id).toEqual(['q']);
    }
  });
});

describe('history', () => {
  it('moves repeats to the front without duplicating', () => {
    expect(addToHistory(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });

  it('ignores blanks and respects the limit', () => {
    expect(addToHistory(['a'], '   ')).toEqual(['a']);
    expect(addToHistory(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });

  it('matches case-insensitively', () => {
    expect(matchHistory(['Apple', 'banana'], 'APP')).toEqual(['Apple']);
  });
});
