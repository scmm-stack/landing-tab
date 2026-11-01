import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { permissions: { request: vi.fn(async () => true) } } }));

import { canLookUp, findSiteIcon, iconsFromManifest, sameSite, siteOf } from '../src/lib/favicon';

describe('canLookUp', () => {
  it('skips half-typed words but not real hosts', () => {
    expect(canLookUp('https://exam/')).toBe(false);
    expect(canLookUp('https://example.com/')).toBe(true);
    expect(canLookUp('http://192.168.1.10/')).toBe(true);
  });
});

describe('siteOf', () => {
  it.each([
    ['www.example.com', 'example.com'],
    ['cdn.assets.example.com', 'example.com'],
    ['example.com', 'example.com'],
    ['www.example.co.uk', 'example.co.uk'],
    ['shop.example.com.pl', 'example.com.pl'],
    ['localhost', 'localhost'],
    ['192.168.1.10', '192.168.1.10'],
  ])('%s is %s', (host, site) => {
    expect(siteOf(host)).toBe(site);
  });
});

describe('sameSite', () => {
  it('matches subdomains of the same site', () => {
    expect(sameSite('https://www.example.com/', 'https://static.example.com/i.png')).toBe(true);
  });

  it('refuses other sites', () => {
    expect(sameSite('https://example.com/', 'https://tracker.net/i.png')).toBe(false);
    expect(sameSite('https://example.com/', 'https://example.com.evil.net/i.png')).toBe(false);
  });

  it('keeps different owners of a shared suffix apart', () => {
    expect(sameSite('https://one.co.uk/', 'https://two.co.uk/')).toBe(false);
  });

  it('refuses unparsable addresses', () => {
    expect(sameSite('nonsense', 'https://example.com/')).toBe(false);
  });
});

describe('iconsFromManifest', () => {
  it('resolves relative icons and reads sizes', () => {
    const icons = iconsFromManifest({ icons: [{ src: '/a.png', sizes: '192x192' }, { src: 'b.png', sizes: '48x48 96x96' }] }, 'https://x.example/app/manifest.json');
    expect(icons).toEqual([
      { url: 'https://x.example/a.png', size: 192 },
      { url: 'https://x.example/app/b.png', size: 96 },
    ]);
  });

  it('ignores non-web and malformed entries', () => {
    expect(iconsFromManifest({ icons: [{ src: 'javascript:x' }, { nope: 1 }, null] }, 'https://x.example/')).toEqual([]);
    expect(iconsFromManifest(null, 'https://x.example/')).toEqual([]);
  });
});

interface Stub {
  body: BodyInit;
  type: string;
  status?: number;
  url?: string;
}

function stubNetwork(routes: Record<string, Stub>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
    calls.push({ url: input, init });
    const route = routes[input];
    if (!route) return new Response('missing', { status: 404 });
    const response = new Response(route.body, { status: route.status ?? 200, headers: { 'content-type': route.type } });
    if (route.url) Object.defineProperty(response, 'url', { value: route.url });
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  // DOMParser is only used for the HTML page; these tests supply a minimal stand-in.
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString(html: string) {
        const links = Array.from(html.matchAll(/<link ([^>]*)>/g), (match) => {
          const attrs = Object.fromEntries(Array.from((match[1] ?? '').matchAll(/([a-z]+)="([^"]*)"/g), (a) => [a[1], a[2]]));
          return { getAttribute: (name: string) => attrs[name] ?? null };
        });
        return { querySelector: () => null, querySelectorAll: () => links };
      }
    },
  );
  return calls;
}

const PNG = new Uint8Array([137, 80, 78, 71]);

describe('findSiteIcon', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends no cookies and no referrer on any request', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="icon" href="/i.png">', type: 'text/html' },
      'https://site.example/i.png': { body: PNG, type: 'image/png' },
    });
    await findSiteIcon('https://site.example/');
    expect(calls.length).toBeGreaterThan(0);
    for (const { init } of calls) {
      expect(init.credentials).toBe('omit');
      expect(init.referrerPolicy).toBe('no-referrer');
    }
  });

  it('asks for the home page, never the full address', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="icon" href="/i.png">', type: 'text/html' },
      'https://site.example/i.png': { body: PNG, type: 'image/png' },
    });
    await findSiteIcon('https://user:pass@site.example/private/page?token=secret#part');
    expect(calls.map((c) => c.url)).toEqual(['https://site.example/', 'https://site.example/i.png']);
  });

  it('parses only link and base tags, never the page itself', async () => {
    stubNetwork({
      'https://site.example/': { body: '<style>a{}</style><script>x()</script><base href="/"><link rel="icon" href="/i.png"><body style="margin:0" onload="x()">', type: 'text/html' },
      'https://site.example/i.png': { body: PNG, type: 'image/png' },
    });
    const parsed: string[] = [];
    const Stubbed = globalThis.DOMParser;
    vi.stubGlobal(
      'DOMParser',
      class extends Stubbed {
        override parseFromString(html: string, type: DOMParserSupportedType) {
          parsed.push(html);
          return super.parseFromString(html, type);
        }
      },
    );
    expect(await findSiteIcon('https://site.example/')).not.toBeNull();
    expect(parsed).toEqual(['<base href="/"><link rel="icon" href="/i.png">']);
  });

  it('never contacts an icon host on another site', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="icon" href="https://tracker.net/pixel.png">', type: 'text/html' },
      'https://site.example/favicon.ico': { body: PNG, type: 'image/png' },
    });
    const icon = await findSiteIcon('https://site.example/');
    expect(icon).not.toBeNull();
    expect(calls.some((c) => c.url.includes('tracker.net'))).toBe(false);
  });

  it('prefers the largest icon', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="icon" sizes="16x16" href="/s.png"><link rel="apple-touch-icon" sizes="180x180" href="/big.png">', type: 'text/html' },
      'https://site.example/big.png': { body: PNG, type: 'image/png' },
    });
    await findSiteIcon('https://site.example/');
    expect(calls.map((c) => c.url)).toEqual(['https://site.example/', 'https://site.example/big.png']);
  });

  it('falls back to /favicon.ico', async () => {
    stubNetwork({
      'https://site.example/': { body: '<html></html>', type: 'text/html' },
      'https://site.example/favicon.ico': { body: PNG, type: 'image/x-icon' },
    });
    expect((await findSiteIcon('https://site.example/'))?.type).toBe('image/x-icon');
  });

  it('refuses anything that is not an image', async () => {
    stubNetwork({
      'https://site.example/': { body: '<link rel="icon" href="/fake.png">', type: 'text/html' },
      'https://site.example/fake.png': { body: '<script>alert(1)</script>', type: 'text/html' },
    });
    expect(await findSiteIcon('https://site.example/')).toBeNull();
  });

  it('refuses oversized icons', async () => {
    stubNetwork({
      'https://site.example/': { body: '<link rel="icon" href="/huge.png">', type: 'text/html' },
      'https://site.example/huge.png': { body: new Uint8Array(3 * 1024 * 1024), type: 'image/png' },
    });
    expect(await findSiteIcon('https://site.example/')).toBeNull();
  });

  it('returns null rather than throwing when the site is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    expect(await findSiteIcon('https://down.example/')).toBeNull();
  });
});
