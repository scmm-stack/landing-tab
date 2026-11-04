import { browser } from 'wxt/browser';
import { imageSize } from './image-size';
import { MAX_TILE_IMAGE_BYTES, isAllowedImage } from './images';
import { readCapped } from './stream';
import { trimMargins } from './trim';

/**
 * ONE OF TWO MODULES ALLOWED TO USE THE NETWORK. The other is library.ts.
 *
 * It runs only while someone is adding a shortcut, and only after they have given
 * site access. It asks for the site's home page rather than the full address, then
 * for icons: the ones that page or its manifest names, which may sit on another
 * domain the site uses, as they do on any visit, and two usual addresses on the
 * site itself. It sends no cookies and no referrer, and hands back a Blob that the
 * caller stores locally, so a site is never asked twice.
 */

const SITE_ORIGINS = ['http://*/*', 'https://*/*'];
const TIMEOUT_MS = 6000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * Where an icon came from, in order of preference. A site's own icons look like
 * its tab icon. Manifest icons are app icons, often drawn on a background square.
 * A guess is a usual address the page didn't name.
 */
export type IconSource = 'icon' | 'touch' | 'manifest' | 'guess';

export interface IconCandidate {
  url: string;
  /** The size the page claims, Infinity for SVG. Downloaded icons are measured instead. */
  size: number;
  source: IconSource;
}

/** Sharp on a 64px tile on a high-resolution screen. */
export const TARGET_SIZE = 128;
const MAX_ICON_REQUESTS = 6;
const SOURCE_ORDER: IconSource[] = ['icon', 'touch', 'manifest', 'guess'];

const REQUEST: RequestInit = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  redirect: 'follow',
  mode: 'cors',
};

function largestSize(sizes: string | null | undefined): number {
  if (!sizes) return 0;
  if (sizes.toLowerCase().includes('any')) return 512;
  const found = Array.from(sizes.matchAll(/(\d+)\s*x\s*\d+/gi), (m) => Number(m[1]));
  return found.length ? Math.max(...found) : 0;
}

function resolveWebUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const isSvg = (url: string, type: string | null) => type?.toLowerCase() === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(url);

/**
 * The order icons are tried in: those that claim to be big enough first, then the
 * rest, each group by source and then by claimed size. Guesses always come last.
 */
export function order(candidates: IconCandidate[]): IconCandidate[] {
  const seen = new Set<string>();
  const unique = candidates.filter((c) => !seen.has(c.url) && seen.add(c.url));
  const rank = (c: IconCandidate) => (c.source === 'guess' ? 2 : c.size >= TARGET_SIZE ? 0 : 1);
  return unique
    .map((c, index) => ({ c, index }))
    .sort(
      (a, b) =>
        rank(a.c) - rank(b.c) ||
        SOURCE_ORDER.indexOf(a.c.source) - SOURCE_ORDER.indexOf(b.c.source) ||
        (a.c.source === 'guess' ? 0 : b.c.size - a.c.size) ||
        a.index - b.index,
    )
    .map(({ c }) => c);
}

export function iconsFromHtml(html: string, pageUrl: string): { icons: IconCandidate[]; manifestUrl: string | null } {
  // Only these tags hold icons. A whole page would also bring its inline styles and
  // handlers, and this extension's security policy logs an error for every one it refuses.
  const tags = html.match(/<(?:link|base)\b[^>]*>/gi)?.join('') ?? '';
  const doc = new DOMParser().parseFromString(tags, 'text/html');
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href');
  const base = resolveWebUrl(baseHref, pageUrl) ?? pageUrl;
  const icons: IconCandidate[] = [];
  let manifestUrl: string | null = null;

  for (const link of Array.from(doc.querySelectorAll('link[rel][href]'))) {
    const rels = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const url = resolveWebUrl(link.getAttribute('href'), base);
    if (!url) continue;
    if (rels.includes('manifest')) manifestUrl ??= url;
    else if (rels.includes('icon') || rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) {
      const touchIcon = rels.some((r) => r.startsWith('apple-touch-icon'));
      const size = isSvg(url, link.getAttribute('type')) ? Infinity : largestSize(link.getAttribute('sizes')) || (touchIcon ? 180 : 32);
      icons.push({ url, size, source: touchIcon ? 'touch' : 'icon' });
    }
  }
  return { icons, manifestUrl };
}

export function iconsFromManifest(manifest: unknown, manifestUrl: string): IconCandidate[] {
  const list = (manifest as { icons?: unknown } | null)?.icons;
  if (!Array.isArray(list)) return [];
  const icons: IconCandidate[] = [];
  for (const entry of list as { src?: unknown; sizes?: unknown; purpose?: unknown; type?: unknown }[]) {
    if (typeof entry?.src !== 'string') continue;
    // Maskable icons carry wide margins for phones to crop, and monochrome ones lose their colors.
    const purposes = typeof entry.purpose === 'string' ? entry.purpose.toLowerCase().split(/\s+/) : ['any'];
    if (!purposes.includes('any')) continue;
    const url = resolveWebUrl(entry.src, manifestUrl);
    if (!url) continue;
    const size = isSvg(url, typeof entry.type === 'string' ? entry.type : null) ? Infinity : largestSize(typeof entry.sizes === 'string' ? entry.sizes : null);
    icons.push({ url, size, source: 'manifest' });
  }
  return icons;
}

async function getText(url: string, limit: number, signal: AbortSignal): Promise<{ text: string; finalUrl: string } | null> {
  const response = await fetch(url, { ...REQUEST, signal });
  if (!response.ok) return null;
  const bytes = await readCapped(response, limit);
  return bytes ? { text: new TextDecoder().decode(bytes), finalUrl: response.url || url } : null;
}

/** The icon and its real size, read from the file. Null size means the format didn't say. */
async function getIcon(url: string, signal: AbortSignal): Promise<{ blob: Blob; size: number | null } | null> {
  const response = await fetch(url, { ...REQUEST, signal });
  if (!response.ok) return null;
  const bytes = await readCapped(response, MAX_TILE_IMAGE_BYTES);
  if (!bytes || bytes.byteLength === 0) return null;
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const blob = new Blob([bytes.slice().buffer], { type: type === 'image/ico' ? 'image/x-icon' : type });
  return isAllowedImage(blob) ? { blob, size: imageSize(bytes, blob.type) } : null;
}

/**
 * Must be called directly from a click handler: browsers only show the
 * permission prompt in response to a user action.
 */
export function requestSiteAccess(): Promise<boolean> {
  return browser.permissions.request({ origins: SITE_ORIGINS });
}

export function hasSiteAccess(): Promise<boolean> {
  return browser.permissions.contains({ origins: SITE_ORIGINS });
}

export function removeSiteAccess(): Promise<boolean> {
  return browser.permissions.remove({ origins: SITE_ORIGINS });
}

/** A half-typed word such as "exam" isn't a site, so it isn't worth a DNS lookup. */
export function canLookUp(url: string): boolean {
  return new URL(url).hostname.includes('.');
}

/**
 * Finds an icon for a site. Returns null when it has none, or can't be reached.
 *
 * Only the home page is requested. A page's full address can hold private details
 * or a one-time link, and neither should be sent just to find an icon.
 */
export async function findSiteIcon(pageUrl: string, tidy: (icon: Blob) => Promise<Blob> = trimMargins): Promise<Blob | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const { signal } = controller;
  try {
    const home = `${new URL(pageUrl).origin}/`;
    const page = await getText(home, MAX_PAGE_BYTES, signal).catch(() => null);
    const finalUrl = page?.finalUrl ?? home;
    const found = page ? iconsFromHtml(page.text, finalUrl) : { icons: [], manifestUrl: null };
    const candidates = [...found.icons];

    if (found.manifestUrl) {
      const manifest = await getText(found.manifestUrl, MAX_MANIFEST_BYTES, signal).catch(() => null);
      if (manifest) {
        try {
          candidates.push(...iconsFromManifest(JSON.parse(manifest.text), manifest.finalUrl));
        } catch {
          // A broken web manifest just means no extra candidates.
        }
      }
    }

    // Usual addresses the page didn't name, asked only of the site the home page ended up on.
    candidates.push({ url: new URL('/apple-touch-icon.png', finalUrl).href, size: 180, source: 'guess' });
    candidates.push({ url: new URL('/favicon.ico', finalUrl).href, size: 1, source: 'guess' });

    // The first big enough wins. Failing that, the biggest one found.
    let best: { blob: Blob; size: number } | null = null;
    for (const candidate of order(candidates).slice(0, MAX_ICON_REQUESTS)) {
      const icon = await getIcon(candidate.url, signal).catch(() => null);
      if (!icon) continue;
      // A format that doesn't say its size is taken at its word, but never as big enough.
      const size = icon.size ?? Math.min(candidate.size, TARGET_SIZE - 1);
      if (!best || size > best.size) best = { blob: icon.blob, size };
      if (size >= TARGET_SIZE) break;
    }
    return best ? await tidy(best.blob) : null;
  } finally {
    clearTimeout(timer);
  }
}
