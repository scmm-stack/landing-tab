import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { permissions: { request: vi.fn(async () => true) } } }));

import { TARGET_SIZE, canLookUp, findSiteIcon, iconsFromManifest, order } from '../src/lib/favicon';

describe('canLookUp', () => {
  it('skips half-typed words but not real hosts', () => {
    expect(canLookUp('https://exam/')).toBe(false);
    expect(canLookUp('https://example.com/')).toBe(true);
    expect(canLookUp('http://192.168.1.10/')).toBe(true);
  });
});

describe('iconsFromManifest', () => {
  it('resolves relative icons and reads sizes', () => {
    const icons = iconsFromManifest({ icons: [{ src: '/a.png', sizes: '192x192' }, { src: 'b.png', sizes: '48x48 96x96' }] }, 'https://x.example/app/manifest.json');
    expect(icons).toEqual([
      { url: 'https://x.example/a.png', size: 192, source: 'manifest' },
      { url: 'https://x.example/app/b.png', size: 96, source: 'manifest' },
    ]);
  });

  it('skips maskable and monochrome icons, which have wide margins or no colors', () => {
    const icons = iconsFromManifest(
      {
        icons: [
          { src: '/mask.png', sizes: '512x512', purpose: 'maskable' },
          { src: '/mono.png', sizes: '512x512', purpose: 'monochrome' },
          { src: '/both.png', sizes: '256x256', purpose: 'any maskable' },
        ],
      },
      'https://x.example/',
    );
    expect(icons.map((i) => i.url)).toEqual(['https://x.example/both.png']);
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

/** The start of a PNG file of the given size: enough for its size to be read. */
function png(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, size);
  view.setUint32(20, size);
  return bytes;
}

const PNG = png(TARGET_SIZE);
const keep = async (blob: Blob) => blob;
const iconUrls = (calls: { url: string }[]) => calls.map((c) => c.url).slice(1);

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

  it('uses an icon the page names on another domain, as a visit would load it', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="icon" sizes="192x192" href="https://assets-cdn.example/icon.png">', type: 'text/html' },
      'https://assets-cdn.example/icon.png': { body: png(192), type: 'image/png' },
    });
    expect(await findSiteIcon('https://site.example/', keep)).not.toBeNull();
    expect(iconUrls(calls)).toEqual(['https://assets-cdn.example/icon.png']);
  });

  it('reads a manifest the page names on another domain', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="manifest" href="https://assets-cdn.example/app.json">', type: 'text/html' },
      'https://assets-cdn.example/app.json': { body: JSON.stringify({ icons: [{ src: 'big.png', sizes: '512x512' }] }), type: 'application/json' },
      'https://assets-cdn.example/big.png': { body: png(512), type: 'image/png' },
    });
    expect(await findSiteIcon('https://site.example/', keep)).not.toBeNull();
    expect(calls.map((c) => c.url)).toContain('https://assets-cdn.example/big.png');
  });

  it('asks the usual addresses only of the site the home page ended up on', async () => {
    const calls = stubNetwork({
      'https://short.example/': { body: '<html></html>', type: 'text/html', url: 'https://www.landing.example/product' },
      'https://www.landing.example/apple-touch-icon.png': { body: png(180), type: 'image/png' },
    });
    expect(await findSiteIcon('https://short.example/', keep)).not.toBeNull();
    expect(iconUrls(calls)).toEqual(['https://www.landing.example/apple-touch-icon.png']);
  });

  it('tries the touch icon address before /favicon.ico', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<html></html>', type: 'text/html' },
      'https://site.example/favicon.ico': { body: png(32), type: 'image/png' },
    });
    await findSiteIcon('https://site.example/', keep);
    expect(iconUrls(calls)).toEqual(['https://site.example/apple-touch-icon.png', 'https://site.example/favicon.ico']);
  });

  it('judges icons by their real size, not the size the page claims', async () => {
    stubNetwork({
      'https://site.example/': { body: '<link rel="icon" sizes="512x512" href="/claims-big.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">', type: 'text/html' },
      'https://site.example/claims-big.png': { body: png(32), type: 'image/png' },
      'https://site.example/touch.png': { body: png(180), type: 'image/png' },
    });
    const icon = await findSiteIcon('https://site.example/', keep);
    expect(new Uint8Array(await icon!.arrayBuffer())).toEqual(png(180));
  });

  it('stops at the first icon big enough', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="icon" sizes="16x16" href="/s.png"><link rel="apple-touch-icon" sizes="180x180" href="/big.png">', type: 'text/html' },
      'https://site.example/big.png': { body: png(180), type: 'image/png' },
    });
    await findSiteIcon('https://site.example/', keep);
    expect(iconUrls(calls)).toEqual(['https://site.example/big.png']);
  });

  it('keeps the biggest icon when none is big enough', async () => {
    stubNetwork({
      'https://site.example/': { body: '<link rel="icon" sizes="16x16" href="/s.png"><link rel="icon" sizes="64x64" href="/m.png">', type: 'text/html' },
      'https://site.example/s.png': { body: png(16), type: 'image/png' },
      'https://site.example/m.png': { body: png(64), type: 'image/png' },
      'https://site.example/favicon.ico': { body: png(32), type: 'image/png' },
    });
    const icon = await findSiteIcon('https://site.example/', keep);
    expect(new Uint8Array(await icon!.arrayBuffer())).toEqual(png(64));
  });

  it('prefers SVG, which is sharp at any size', async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="apple-touch-icon" sizes="180x180" href="/touch.png"><link rel="icon" href="/logo.svg">', type: 'text/html' },
      'https://site.example/logo.svg': { body: '<svg xmlns="http://www.w3.org/2000/svg"/>', type: 'image/svg+xml' },
    });
    expect((await findSiteIcon('https://site.example/', keep))?.type).toBe('image/svg+xml');
    expect(iconUrls(calls)).toEqual(['https://site.example/logo.svg']);
  });

  it("prefers the site's own icon over a bigger app icon from its manifest", async () => {
    const calls = stubNetwork({
      'https://site.example/': { body: '<link rel="manifest" href="/app.json"><link rel="icon" sizes="192x192" href="/icon.png">', type: 'text/html' },
      'https://site.example/app.json': { body: JSON.stringify({ icons: [{ src: '/app-512.png', sizes: '512x512' }] }), type: 'application/json' },
      'https://site.example/icon.png': { body: png(192), type: 'image/png' },
    });
    await findSiteIcon('https://site.example/', keep);
    expect(iconUrls(calls).filter((u) => u.endsWith('.png'))).toEqual(['https://site.example/icon.png']);
  });

  it('asks for at most six icons', async () => {
    const links = Array.from({ length: 10 }, (_, i) => `<link rel="icon" sizes="16x16" href="/i${i}.png">`).join('');
    const calls = stubNetwork({ 'https://site.example/': { body: links, type: 'text/html' } });
    expect(await findSiteIcon('https://site.example/', keep)).toBeNull();
    expect(iconUrls(calls)).toHaveLength(6);
  });

  it('hands the chosen icon over to be tidied', async () => {
    stubNetwork({
      'https://site.example/': { body: '<link rel="icon" href="/i.png">', type: 'text/html' },
      'https://site.example/i.png': { body: PNG, type: 'image/png' },
    });
    const tidied = new Blob(['tidied'], { type: 'image/png' });
    expect(await findSiteIcon('https://site.example/', async () => tidied)).toBe(tidied);
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

describe('order', () => {
  it('tries big icons first, by source, and the usual addresses last', () => {
    const tried = order([
      { url: 'g1', size: 180, source: 'guess' },
      { url: 'small-icon', size: 32, source: 'icon' },
      { url: 'app', size: 512, source: 'manifest' },
      { url: 'touch', size: 180, source: 'touch' },
      { url: 'icon', size: 192, source: 'icon' },
      { url: 'g2', size: 1, source: 'guess' },
      { url: 'icon', size: 192, source: 'icon' },
    ]).map((c) => c.url);
    expect(tried).toEqual(['icon', 'touch', 'app', 'small-icon', 'g1', 'g2']);
  });
});
