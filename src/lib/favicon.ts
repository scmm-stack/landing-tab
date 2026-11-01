import { browser } from 'wxt/browser';
import { MAX_TILE_IMAGE_BYTES, isAllowedImage } from './images';

/**
 * THE ONLY MODULE ALLOWED TO USE THE NETWORK.
 *
 * It runs only while someone is adding a shortcut, and only after they have given
 * site access. It contacts only that site, asking for its home page rather than
 * the full address, sends no cookies and no referrer, and hands back a Blob that
 * the caller stores locally, so a site is never asked twice.
 */

const SITE_ORIGINS = ['http://*/*', 'https://*/*'];
const TIMEOUT_MS = 6000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;

export interface IconCandidate {
  url: string;
  size: number;
}

const REQUEST: RequestInit = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  redirect: 'follow',
  mode: 'cors',
};

const COMPOUND_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'com.au', 'net.au', 'co.nz', 'com.br', 'com.pl', 'net.pl', 'org.pl', 'co.in', 'co.kr', 'com.cn']);

/** Approximates the registrable domain, so www.example.com and cdn.example.com match. */
export function siteOf(hostname: string): string {
  const labels = hostname.toLowerCase().split('.');
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1] ?? '')) return hostname.toLowerCase();
  const lastTwo = labels.slice(-2).join('.');
  return COMPOUND_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export function sameSite(a: string, b: string): boolean {
  try {
    return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname);
  } catch {
    return false;
  }
}

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

/** Biggest same-site icon first. Icons on other sites are skipped, not contacted. */
function rank(candidates: IconCandidate[], pageUrl: string): IconCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      if (seen.has(c.url) || !sameSite(c.url, pageUrl)) return false;
      seen.add(c.url);
      return true;
    })
    .sort((a, b) => b.size - a.size);
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
      icons.push({ url, size: largestSize(link.getAttribute('sizes')) || (touchIcon ? 180 : 32) });
    }
  }
  return { icons, manifestUrl };
}

export function iconsFromManifest(manifest: unknown, manifestUrl: string): IconCandidate[] {
  const list = (manifest as { icons?: unknown } | null)?.icons;
  if (!Array.isArray(list)) return [];
  const icons: IconCandidate[] = [];
  for (const entry of list as { src?: unknown; sizes?: unknown }[]) {
    if (typeof entry?.src !== 'string') continue;
    const url = resolveWebUrl(entry.src, manifestUrl);
    if (url) icons.push({ url, size: largestSize(typeof entry.sizes === 'string' ? entry.sizes : null) });
  }
  return icons;
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > limit || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function getText(url: string, limit: number, signal: AbortSignal): Promise<{ text: string; finalUrl: string } | null> {
  const response = await fetch(url, { ...REQUEST, signal });
  if (!response.ok) return null;
  const bytes = await readCapped(response, limit);
  return bytes ? { text: new TextDecoder().decode(bytes), finalUrl: response.url || url } : null;
}

async function getIcon(url: string, signal: AbortSignal): Promise<Blob | null> {
  const response = await fetch(url, { ...REQUEST, signal });
  if (!response.ok) return null;
  const bytes = await readCapped(response, MAX_TILE_IMAGE_BYTES);
  if (!bytes || bytes.byteLength === 0) return null;
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const blob = new Blob([bytes.slice().buffer], { type: type === 'image/ico' ? 'image/x-icon' : type });
  return isAllowedImage(blob) ? blob : null;
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
export async function findSiteIcon(pageUrl: string): Promise<Blob | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const { signal } = controller;
  try {
    const home = `${new URL(pageUrl).origin}/`;
    const page = await getText(home, MAX_PAGE_BYTES, signal).catch(() => null);
    const finalUrl = page?.finalUrl ?? home;
    const found = page ? iconsFromHtml(page.text, finalUrl) : { icons: [], manifestUrl: null };
    const candidates = [...found.icons];

    if (found.manifestUrl && sameSite(found.manifestUrl, finalUrl)) {
      const manifest = await getText(found.manifestUrl, MAX_MANIFEST_BYTES, signal).catch(() => null);
      if (manifest) {
        try {
          candidates.push(...iconsFromManifest(JSON.parse(manifest.text), manifest.finalUrl));
        } catch {
          // A broken web manifest just means no extra candidates.
        }
      }
    }

    candidates.push({ url: new URL('/favicon.ico', finalUrl).href, size: 1 });

    for (const candidate of rank(candidates, finalUrl).slice(0, 5)) {
      const blob = await getIcon(candidate.url, signal).catch(() => null);
      if (blob) return blob;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
