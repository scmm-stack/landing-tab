import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { FONT_IN_PIXELS } from './scan-rules.mjs';

/**
 * Inspects what actually ships. Source rules can be bypassed by a dependency or
 * a build step, so this reads the finished extensions and fails on anything
 * that could send data somewhere or that changes the permissions.
 */

const ROOT = new URL('../.output/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TARGETS = ['firefox-mv3', 'chrome-mv3', 'edge-mv3'];

const EXPECTED_PERMISSIONS = ['activeTab', 'search', 'storage', 'unlimitedStorage'];
const EXPECTED_OPTIONAL = ['bookmarks'];
const EXPECTED_OPTIONAL_HOSTS = ['http://*/*', 'https://*/*'];
const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src http: https:; object-src 'none'; base-uri 'none'; form-action 'none'";

const FORBIDDEN = [
  [/sendBeacon/, 'navigator.sendBeacon'],
  [/new\s+WebSocket/, 'WebSocket'],
  [/new\s+EventSource/, 'EventSource'],
  [/new\s+XMLHttpRequest/, 'XMLHttpRequest'],
  [/\beval\(/, 'eval'],
  [/new\s+Function\(/, 'new Function'],
  [/setUninstallURL/, 'uninstall page'],
  [/google-analytics|googletagmanager|gtag\(|mixpanel|amplitude|hotjar|sentry|segment\.io|posthog|plausible/i, 'analytics or tracking'],
  [/importScripts/, 'remote script loading'],
];

// Extra words that must never ship, kept in a local untracked file, one per line.
const TERMS_FILE = new URL('../.forbidden-terms', import.meta.url);
if (existsSync(TERMS_FILE)) {
  for (const term of readFileSync(TERMS_FILE, 'utf8').split(/\r?\n/).filter(Boolean)) {
    FORBIDDEN.push([new RegExp(term, 'i'), `forbidden term "${term}"`]);
  }
}

// Addresses allowed to appear in shipped code. Anything else fails the build.
const ALLOWED_URLS = [
  'https://duckduckgo.com/',
  'https://www.google.com/search',
  'https://www.bing.com/search',
  'https://search.brave.com/search',
  'https://www.startpage.com/do/search',
  'https://example.com/search',
  'http://www.w3.org/', // XML namespaces used by React DOM, never requested
  'https://react.dev/', // React's production error messages, never requested
];

// Not addresses: permission patterns, and the https:// prefix added to a typed domain.
const ALLOWED_PATTERNS = [/^https?:\/\/\*\/\*$/, /^https:\/\/\$\{[\w$]+\}$/];

const ALLOWED_FETCH_FILES = /^chunks\/|^newtab|^popup/;
const EXPECTED_FETCH_CALLS = 2;

const failures = [];
const fail = (target, message) => failures.push(`[${target}] ${message}`);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const sameSet = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function checkManifest(target, dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) fail(target, 'manifest is not MV3');
  if (!sameSet(manifest.permissions, EXPECTED_PERMISSIONS)) fail(target, `permissions changed: ${manifest.permissions}`);
  if (!sameSet(manifest.optional_permissions, EXPECTED_OPTIONAL)) fail(target, `optional permissions changed: ${manifest.optional_permissions}`);
  if (!sameSet(manifest.optional_host_permissions, EXPECTED_OPTIONAL_HOSTS)) fail(target, `optional hosts changed: ${manifest.optional_host_permissions}`);
  if (manifest.host_permissions?.length) fail(target, `always-on host permissions: ${manifest.host_permissions}`);
  if (manifest.content_security_policy?.extension_pages !== EXPECTED_CSP) fail(target, `CSP changed: ${manifest.content_security_policy?.extension_pages}`);
  for (const key of ['background', 'content_scripts', 'web_accessible_resources', 'externally_connectable', 'update_url']) {
    if (manifest[key]) fail(target, `manifest must not contain ${key}`);
  }
  if (manifest.chrome_url_overrides?.newtab !== 'newtab.html') fail(target, 'new tab override missing');
  if (target.startsWith('firefox')) {
    const required = manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required;
    if (!sameSet(required, ['none'])) fail(target, 'Firefox data collection declaration must be "none"');
  }
}

function checkFiles(target, dir) {
  let fetchCalls = 0;
  for (const path of walk(dir)) {
    const name = relative(dir, path).replaceAll('\\', '/');
    const extension = extname(path);
    if (extension === '.map') fail(target, `source map shipped: ${name}`);
    if (!['.js', '.html', '.css', '.json'].includes(extension)) continue;
    const text = readFileSync(path, 'utf8');

    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(text)) fail(target, `${label} found in ${name}`);
    }

    for (const match of text.matchAll(/\b(?:https?|wss?|ftp):\/\/[^\s"'`\\)<>]+/gi)) {
      const known = ALLOWED_URLS.some((allowed) => match[0].startsWith(allowed)) || ALLOWED_PATTERNS.some((p) => p.test(match[0]));
      if (!known) fail(target, `unexpected address in ${name}: ${match[0]}`);
    }

    if (extension === '.css' && /url\(\s*["']?(?:https?:)?\/\//i.test(text)) fail(target, `remote CSS resource in ${name}`);
    if (extension === '.css' && /@import/i.test(text)) fail(target, `CSS @import in ${name}`);
    if (extension === '.css' && FONT_IN_PIXELS.test(text)) fail(target, `font size in px in ${name}, which ignores the browser's text size`);
    if (extension === '.html' && /<(?:script|link|img)[^>]+(?:src|href)=["'](?:https?:)?\/\//i.test(text)) fail(target, `remote resource in ${name}`);

    if (extension === '.js') {
      const calls = text.match(/(?<![\w$.])fetch\(/g)?.length ?? 0;
      if (calls > 0 && !ALLOWED_FETCH_FILES.test(name)) fail(target, `fetch in unexpected file ${name}`);
      fetchCalls += calls;
    }
  }
  return fetchCalls;
}

for (const target of TARGETS) {
  const dir = join(ROOT, target);
  if (!existsSync(dir)) {
    fail(target, `missing build at ${dir}`);
    continue;
  }
  checkManifest(target, dir);
  const fetchCalls = checkFiles(target, dir);
  if (fetchCalls !== EXPECTED_FETCH_CALLS) fail(target, `expected ${EXPECTED_FETCH_CALLS} fetch calls, found ${fetchCalls}`);
  console.log(`${target}: scanned, ${fetchCalls} fetch calls`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('\nScan passed.');
