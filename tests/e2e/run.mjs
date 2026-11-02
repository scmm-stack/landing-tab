import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHROME, extensionOrigin, firefoxSystem, launch, openExtensionPage } from './browsers.mjs';
import { TEST_SITE, hostsIn, startProxy } from './proxy.mjs';

/**
 * Proves the network claim in real browsers:
 *   node tests/e2e/run.mjs [--idle <seconds>] [--targets firefox,edge]
 *     [--control <reference .xpi> --control-id <add-on id> --control-domain <its domain>]
 *
 * control:  a reference add-on must show traffic, or the harness proves nothing.
 * baseline: the browser alone, to separate out the browser's own traffic.
 * test:     this extension through a full session, then idle.
 */

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const IDLE_SECONDS = Number(option('--idle') ?? 45);
const CONTROL_XPI = option('--control');
const CONTROL_ID = option('--control-id');
const CONTROL_DOMAIN = option('--control-domain');
const SHOTS = resolve('test-results');
mkdirSync(SHOTS, { recursive: true });

const ADDON_ID = 'landing-tab@scmm-stack.dev';
const PROJECT = resolve('.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SOURCE_SELECT = '.settings-panel select:has(option[value="scene"])';

const results = [];
function check(browserName, name, ok, detail = '') {
  results.push({ browserName, name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function clickText(page, text, selector = 'button') {
  const clicked = await page.evaluate(
    (t, s) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t || e.title === t || e.getAttribute('aria-label') === t);
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    selector,
  );
  if (!clicked) throw new Error(`Nothing to click: "${text}"`);
  await sleep(120);
}

/**
 * Firefox's automation refuses to attach files on extension pages, so the file
 * is built inside the page and handed to the input, which fires the real handler.
 */
async function attachFile(page, selector, path, type) {
  const base64 = readFileSync(path).toString('base64');
  await page.waitForSelector(selector);
  await page.$eval(
    selector,
    (input, data, mime, name) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: mime }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    base64,
    type,
    path.split(/[\/]/).pop(),
  );
  await sleep(150);
}

async function setInput(page, selector, value) {
  await page.waitForSelector(selector);
  await page.click(selector, { count: 3 });
  await page.type(selector, value);
}

const tileTitles = (page) => page.evaluate(() => [...document.querySelectorAll('.grid a.tile .tile-label')].map((e) => e.textContent));

async function addShortcut(page, url, name, description = '') {
  await page.click('.add-tile');
  await sleep(150);
  await setInput(page, '.modal input[placeholder="example.com"]', url);
  const [nameInput, descriptionInput] = await Promise.all(
    [1, 2].map(async (index) => (await page.evaluateHandle((i) => document.querySelectorAll('.modal .form input')[i], index)).asElement()),
  );
  await nameInput.type(name);
  if (description) await descriptionInput.type(description);
}

/** Measures one shortcut as drawn, so a layout fault fails even when the data is right. */
const cardLayout = (page, title) =>
  page.evaluate((wanted) => {
    const tile = [...document.querySelectorAll('.grid a.tile')].find((a) => a.querySelector('.tile-label')?.textContent === wanted);
    const box = (selector) => tile.querySelector(selector)?.getBoundingClientRect();
    const [card, face, text] = [tile.getBoundingClientRect(), box('.tile-face'), box('.tile-text')];
    return {
      face: { width: face.width, height: face.height },
      cardHeight: card.height,
      faceAtLeft: Math.abs(face.left - card.left) < 1,
      textBeside: Boolean(text) && text.left >= face.right - 1,
      textFits: Boolean(text) && text.right <= card.right + 1,
      note: tile.querySelector('.tile-note')?.textContent ?? null,
    };
  }, title);

const saveDialog = async (page) => {
  await page.evaluate(() => document.querySelector('.modal .form button[type=submit]').click());
  await sleep(300);
};

/** Failed requests to websites are expected. Everything else on the page is a fault. */
function watchProblems(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/NS_ERROR|ERR_PROXY|ERR_TUNNEL|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  return problems;
}

async function session(kind, browser, origin) {
  const page = await openExtensionPage(kind, browser, `${origin}/newtab.html`);
  const problems = watchProblems(page);

  await page.waitForSelector('.sidebar');
  await sleep(600);
  check(kind, 'new tab page renders', await page.$eval('.grid', (e) => e.isConnected));
  await page.screenshot({ path: join(SHOTS, `${kind}-1-first-run.png`) });

  await addShortcut(page, 'first.example', 'First site');
  await saveDialog(page);
  check(kind, 'shortcut added, https:// completed', (await tileTitles(page)).includes('First site'));
  const href = await page.$eval('.grid a.tile', (a) => a.getAttribute('href'));
  check(kind, 'stored address is correct', href === 'https://first.example/', href);

  const description = 'News, apps and reviews for testing';
  await addShortcut(page, 'second.example', 'Image tile', description);
  await attachFile(page, '.modal input[type=file]', join(PROJECT, 'public/icon/128.png'), 'image/png');
  await sleep(300);
  check(kind, 'image preview shows before saving', Boolean(await page.$('.tile-preview img')));
  await saveDialog(page);
  await sleep(300);
  const imageLoaded = await page.$eval('.grid a.tile img', (img) => img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:')).catch(() => false);
  check(kind, 'uploaded image displays from local storage', imageLoaded);

  const card = await cardLayout(page, 'Image tile');
  check(kind, 'card image is a square filling the card height', card.face.width === card.face.height && card.face.height === card.cardHeight, JSON.stringify(card.face));
  check(kind, 'card image on the left, text beside it inside the card', card.faceAtLeft && card.textBeside && card.textFits);
  check(kind, 'card shows the description', card.note === description, String(card.note));
  check(kind, 'card without a description shows only its name', (await cardLayout(page, 'First site')).note === null);

  // Each gap runs from the bottom of one visible item to the top of the next, starting at the page.
  const topGaps = () =>
    page.evaluate(() => {
      let edge = 0;
      return ['.clock', '.search', '.grid'].flatMap((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        if (!box) return [];
        const gap = box.top - edge;
        edge = box.bottom;
        return [Math.round(gap * 10) / 10];
      });
    });
  const show = async (clock, search) => {
    await page.evaluate(
      async (showClock, showSearch) => {
        const api = globalThis.browser ?? globalThis.chrome;
        const { settings } = await api.storage.local.get('settings');
        await api.storage.local.set({ settings: { ...settings, clock: { ...settings.clock, show: showClock }, search: { ...settings.search, show: showSearch } } });
      },
      clock,
      search,
    );
    await sleep(300);
  };
  const expected = (await topGaps())[0];
  for (const [label, clock, search] of [['clock and search', true, true], ['search only', false, true], ['clock only', true, false], ['neither', false, false]]) {
    await show(clock, search);
    const gaps = await topGaps();
    const count = 1 + Number(clock) + Number(search);
    check(kind, `spacing is equal and the same size with ${label}`, gaps.length === count && gaps.every((gap) => Math.abs(gap - expected) < 1), gaps.join(' '));
  }
  await show(true, true);

  await clickText(page, 'Add group', 'button');
  await setInput(page, '.modal input[required]', 'Work');
  await saveDialog(page);
  check(kind, 'new group opens', (await page.$eval('.sidebar button.active .group-name', (e) => e.textContent)) === 'Work');
  await clickText(page, 'Home', '.sidebar button');
  await sleep(700);
  await motionFlow(kind, page);

  await clickText(page, 'Settings', '.sidebar button');
  await clickText(page, 'Shortcuts', '[role=tab]');
  const styleSelect = '.settings-panel select:has(option[value="icon"])';
  const sliderShows = (name) => page.evaluate((label) => [...document.querySelectorAll('.settings-panel .slider')].find((s) => s.textContent.includes(label)).querySelector('output').textContent, name);
  const drawnRem = (selector) => page.$eval(selector, (e) => `${e.getBoundingClientRect().height / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`);
  check(kind, 'tile size slider reports the size a card is drawn at', (await sliderShows('Shortcut size')) === (await drawnRem('.grid a.tile .tile-face')), `${await sliderShows('Shortcut size')}`);
  check(kind, 'layout sliders use rem', (await sliderShows('Space between rows')).endsWith('rem'), await sliderShows('Space between rows'));
  await page.select(styleSelect, 'icon');
  await sleep(150);
  check(kind, 'icon style can be chosen, hiding descriptions', !(await page.$('.grid.cards')) && !(await page.$('.tile-note')));
  check(kind, 'tile size slider reports the size an icon is drawn at', (await sliderShows('Shortcut size')) === (await drawnRem('.grid a.tile .tile-face')), `${await sliderShows('Shortcut size')}`);
  await page.select(styleSelect, 'card');
  await sleep(150);
  check(kind, 'card style can be chosen again', Boolean(await page.$('.grid.cards .tile-note')));

  const presets = await page.$$eval('.settings-panel .segmented button', (buttons) => buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent));
  check(kind, 'the current layout preset is marked', presets.join() === 'Balanced', presets.join());
  const hidesLabels = async () => Boolean(await page.evaluateHandle(() => [...document.querySelectorAll('.settings-panel .toggle')].find((l) => l.textContent.includes('Show names'))).then((h) => h.asElement()));
  check(kind, 'an option with no effect on cards is hidden', !(await hidesLabels()));

  await clickText(page, 'Groups and sidebar', '[role=tab]');
  const sidebarSlider = await sliderShows('Sidebar width');
  const sidebarRem = `${(await page.$eval('.sidebar', (e) => e.getBoundingClientRect().width)) / 16}rem`;
  check(kind, 'sidebar width slider reports the real width', Math.abs(parseFloat(sidebarSlider) - parseFloat(sidebarRem)) < 0.01, `${sidebarSlider} ${sidebarRem}`);

  const headings = {};
  for (const tab of ['Appearance', 'Shortcuts', 'Groups and sidebar', 'Search', 'Clock and standby', 'Data and privacy']) {
    await clickText(page, tab, '[role=tab]');
    headings[tab] = await page.$$eval('.settings-panel h3', (list) => list.map((h) => h.textContent));
  }
  check(kind, 'every settings tab is divided into sections', Object.values(headings).every((list) => list.length >= 2), JSON.stringify(Object.values(headings).map((l) => l.length)));
  const panelStaysPut = await page.$eval('.settings', (e) => e.getBoundingClientRect().height);
  await clickText(page, 'Groups and sidebar', '[role=tab]');
  check(kind, 'the settings window keeps its size between tabs', (await page.$eval('.settings', (e) => e.getBoundingClientRect().height)) === panelStaysPut);

  await clickText(page, 'Search', '[role=tab]');
  const inputs = await page.$$('.settings-panel form input');
  await inputs[0].type('Mine');
  await inputs[1].type('https://mine.example/find?q=%s');
  await page.evaluate(() => document.querySelector('.settings-panel form button[type=submit]').click());
  await sleep(150);
  check(kind, 'custom search engine added', await page.evaluate(() => [...document.querySelectorAll('.engine-list span')].some((e) => e.textContent === 'Mine')));

  await clickText(page, 'Appearance', '[role=tab]');
  await page.select(SOURCE_SELECT, 'image');
  await sleep(150);
  await attachFile(page, '.settings-panel input[type=file]', join(PROJECT, 'public/icon/128.png'), 'image/png');
  await sleep(500);
  check(kind, 'local wallpaper in library', (await page.$$('.thumb')).length === 1);
  await page.select(SOURCE_SELECT, 'scene');
  await sleep(150);

  await clickText(page, 'Data and privacy', '[role=tab]');
  await page.screenshot({ path: join(SHOTS, `${kind}-2-settings.png`) });
  await page.keyboard.press('Escape');
  await sleep(150);
  check(kind, 'Escape closes settings after switching tabs', !(await page.$('.modal')));

  await page.evaluate(() => document.querySelector('.search input').focus());
  await clickText(page, 'Browser default', '.search-engine');
  await clickText(page, 'DuckDuckGo', '.dropdown button');
  await page.screenshot({ path: join(SHOTS, `${kind}-3-dashboard.png`) });

  await page.evaluate(() => location.reload()).catch(() => {});
  await sleep(800);
  await page.waitForSelector('.sidebar');
  await sleep(500);
  check(kind, 'data survives a page reload', (await tileTitles(page)).length === 2);
  check(kind, 'image survives a page reload', await page.$eval('.grid a.tile img', (img) => img.complete && img.naturalWidth > 0).catch(() => false));

  await page.evaluate(() => (globalThis.browser ?? globalThis.chrome).storage.local.set({ todos: [{ id: 'old', text: 'From before' }] }));
  await page.evaluate(() => location.reload()).catch(() => {});
  await sleep(150);
  await page.waitForSelector('.sidebar .group-name');
  const opening = await runningAnimations(page);
  check(kind, 'opening a tab animates the page in', ['fade-in', 'slide-in', 'rise-in'].every((name) => opening.includes(name)), [...new Set(opening)].join(' '));
  await sleep(1800);
  check(kind, 'after opening, everything is visible and settled', (await allVisible(page)) && !(await page.evaluate(() => document.documentElement.classList.contains('opening'))));

  check(kind, 'tasks saved by an older version are cleared', !(await page.evaluate(async () => 'todos' in (await (globalThis.browser ?? globalThis.chrome).storage.local.get()))));
  check(kind, 'no To-do entry in the sidebar', !(await page.evaluate(() => document.querySelector('.sidebar').textContent.includes('To-do'))));

  const dump = await page.evaluate(async () => {
    const all = await (globalThis.browser ?? globalThis.chrome).storage.local.get();
    return JSON.stringify(all);
  });
  check(kind, 'storage holds no base64 images', !/iVBORw0KGgo/.test(dump), `${dump.length} bytes`);
  check(kind, 'no account or tracking ID stored', !/token|clientId|secret|email/i.test(dump));

  // Restore replaces everything, so run it last and check the real result.
  const parsed = JSON.parse(dump);
  const backup = {
    format: 'landing-tab-backup',
    version: 1,
    state: {
      ...parsed,
      dashboard: {
        groups: [{ id: 'r', name: 'Restored', symbol: '', shortcutIds: ['x', 'y', 'constructor'] }],
        shortcuts: { x: { title: 'Kept', url: 'https://kept.example' }, y: { title: 'Bad', url: 'javascript:alert(1)' } },
      },
    },
    images: [],
  };
  const file = join(mkdtempSync(join(tmpdir(), 'landing-tab-backup-')), 'backup.json');
  writeFileSync(file, JSON.stringify(backup));
  await clickText(page, 'Settings', '.sidebar button');
  await clickText(page, 'Data and privacy', '[role=tab]');
  await attachFile(page, '.settings-panel input[type=file]', file, 'application/json');
  await sleep(400);
  await clickText(page, 'Restore', '.modal button');
  await sleep(500);
  await page.keyboard.press('Escape');
  await sleep(200);
  check(kind, 'backup restores, unsafe shortcut removed', JSON.stringify(await tileTitles(page)) === '["Kept"]');

  check(kind, 'no script, CSP or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
  return page;
}

async function searchFlow(kind, page, proxy, baseline) {
  const fromExtension = (entries) => hostsIn(entries).filter((h) => !baseline.includes(h));
  const before = proxy.log.length;
  // Firefox's automation refuses this on extension pages, and doesn't need it.
  if (kind !== 'firefox') await page.bringToFront();
  await page.waitForSelector('.search input');
  await page.click('.search input');
  await page.type('.search input', 'private query');
  await sleep(1000);
  check(kind, 'typing a search sends nothing', fromExtension(proxy.log.slice(before)).length === 0);
  await page.keyboard.press('Enter');
  await sleep(1500);
  const hosts = fromExtension(proxy.log.slice(before));
  check(kind, 'a submitted search goes only to the chosen engine', hosts.join() === 'duckduckgo.com', hosts.join());
}

/** Popup logic needs a real toolbar click to see the page, so this covers loading only. */
async function popupFlow(kind, browser, origin) {
  const page = await openExtensionPage(kind, browser, `${origin}/popup.html`);
  await page.waitForSelector('.popup-message');
  check(kind, 'popup page loads, refuses a non-web page', true);
  return page;
}

/** Restarts the browser on the same profile, and reports whether the dashboard came back. */
async function restartFlow(kind, dir) {
  const proxy = await startProxy();
  const profileDir = mkdtempSync(join(tmpdir(), 'landing-tab-restart-'));
  const extraPrefs = kind === 'firefox' ? { 'extensions.webextensions.keepStorageOnUninstall': true, 'extensions.webextensions.keepUuidOnUninstall': true } : {};
  const open = async () => {
    const session = await launch(kind, proxy.port, { addonId: ADDON_ID, profileDir, extraPrefs });
    await sleep(1500);
    const id = await session.browser.installExtension(dir);
    const page = await openExtensionPage(kind, session.browser, `${extensionOrigin(kind, id)}/newtab.html`);
    await page.waitForSelector('.sidebar');
    await sleep(500);
    return { ...session, page };
  };
  try {
    const first = await open();
    await first.page.click('.add-tile');
    await sleep(150);
    await setInput(first.page, '.modal input[placeholder="example.com"]', 'keep.example');
    await saveDialog(first.page);
    await attachWallpaper(first.page);
    await first.close();
    await sleep(1500);

    const second = await open();
    const shortcuts = await tileTitles(second.page);
    const hasImage = await second.page.evaluate(async () => {
      const api = globalThis.browser ?? globalThis.chrome;
      const { settings } = await api.storage.local.get('settings');
      return settings?.wallpaper?.imageIds?.length === 1 && Boolean(document.querySelector('.wallpaper img')?.naturalWidth);
    });
    check(kind, 'shortcuts survive a browser restart', shortcuts.length === 1, kind === 'firefox' ? 'with keepStorageOnUninstall' : '');
    check(kind, 'images survive a browser restart', hasImage);
    await second.close();
  } finally {
    await proxy.close();
  }
}

async function attachWallpaper(page) {
  await clickText(page, 'Settings', '.sidebar button');
  await clickText(page, 'Appearance', '[role=tab]');
  await page.select(SOURCE_SELECT, 'image');
  await sleep(150);
  await attachFile(page, '.settings-panel input[type=file]', join(PROJECT, 'public/icon/128.png'), 'image/png');
  await sleep(500);
  await page.keyboard.press('Escape');
  await sleep(400);
}

const openAddForm = async (page, address = '') => {
  await page.click('.add-tile');
  await sleep(150);
  if (address) await setInput(page, '.modal input[placeholder="example.com"]', address);
};

const closeForm = async (page) => {
  await page.keyboard.press('Escape');
  await sleep(200);
};

const patchGrid = async (page, patch) => {
  await page.evaluate(async (changes) => {
    const api = globalThis.browser ?? globalThis.chrome;
    const { settings } = await api.storage.local.get('settings');
    await api.storage.local.set({ settings: { ...settings, grid: { ...settings.grid, ...changes } } });
  }, patch);
  await sleep(300);
};

const activeGroupName = (page) => page.$eval('.sidebar button.active .group-name', (e) => e.textContent);
const runningAnimations = (page) => page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter(Boolean));
const allVisible = (page) => page.evaluate(() => [...document.querySelectorAll('.cell, .clock, .search-wrap, .sidebar')].every((e) => getComputedStyle(e).opacity === '1'));
const shineOn = (page, selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s), '::after').animationName, selector);

async function wheel(page, deltaY, wait = 650) {
  await page.mouse.move(700, 30);
  await page.mouse.wheel({ deltaY });
  await sleep(wait);
}

/** Two groups, "Home" first and "Work" last, with Home open. */
async function motionFlow(kind, page) {
  await wheel(page, -120);
  check(kind, 'scrolling up from the first group loops to the last', (await activeGroupName(page)) === 'Work');
  await patchGrid(page, { fadeMs: 800 });
  await wheel(page, 120, 640);
  check(kind, 'scrolling down from the last group loops to the first', (await activeGroupName(page)) === 'Home');
  const fade = await page.$$eval('.cell', (cells) => cells.map((c) => getComputedStyle(c)).map((s) => `${s.animationName} ${s.animationDuration} ${s.animationDelay}`));
  check(kind, 'shortcuts fade in at the set speed, all at once', fade.length === 3 && fade.every((f) => f === 'fade-in 0.8s 0s'), [...new Set(fade)].join(', '));
  check(kind, 'a new group is mid-fade', (await runningAnimations(page)).includes('fade-in'));
  await sleep(1000);
  check(kind, 'everything is fully visible afterwards', await allVisible(page));
  await patchGrid(page, { fadeMs: 0 });
  await wheel(page, -120, 100);
  const [instantGroup, instantRunning] = [await activeGroupName(page), await runningAnimations(page)];
  check(kind, 'a fade-in time of 0 switches at once', instantGroup === 'Work' && !instantRunning.includes('fade-in'), `${instantGroup} ${instantRunning.join(' ')}`);
  await patchGrid(page, { fadeMs: 200 });
  await clickText(page, 'Home', '.sidebar button');
  await sleep(600);

  // A group taller than the page has to scroll to its end, then move on, not get stuck.
  await patchGrid(page, { tileSize: 140, displayWidth: 30 });
  const scrollTop = () => page.$eval('.main', (e) => e.scrollTop);
  await wheel(page, 120);
  check(kind, 'a tall group scrolls before it switches', (await activeGroupName(page)) === 'Home' && (await scrollTop()) > 0, `scrolled ${await scrollTop()}px`);
  await wheel(page, 4000, 1100);
  check(kind, 'reaching the end of a tall group does not switch by itself', (await activeGroupName(page)) === 'Home');
  await wheel(page, 120);
  check(kind, 'another turn at the end moves on, from the top', (await activeGroupName(page)) === 'Work' && (await scrollTop()) === 0);
  await patchGrid(page, { tileSize: 64, displayWidth: 72 });
  await clickText(page, 'Home', '.sidebar button');
  await sleep(700);

  await (await page.$('.grid a.tile')).hover();
  await sleep(120);
  check(kind, 'cards shine on hover', (await shineOn(page, '.grid a.tile')) === 'shine-sweep');
  await page.screenshot({ path: join(SHOTS, `${kind}-shine.png`) });
  await patchGrid(page, { tileStyle: 'icon' });
  await (await page.$('.grid a.tile')).hover();
  await sleep(120);
  check(kind, 'icons shine on hover', (await shineOn(page, '.grid a.tile .tile-face')) === 'shine-sweep');
  await patchGrid(page, { tileStyle: 'card', shine: false });
  await (await page.$('.grid a.tile')).hover();
  await sleep(120);
  check(kind, 'shine can be switched off', (await shineOn(page, '.grid a.tile')) === 'none');
  await patchGrid(page, { shine: true });
  await page.mouse.move(700, 30);

  if (kind === 'firefox') return; // Firefox's automation can't emulate this setting.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await wheel(page, -120, 100);
  const [groupNow, stillRunning] = [await activeGroupName(page), await runningAnimations(page)];
  check(kind, 'reduced motion: groups switch at once, with no animation', groupNow === 'Work' && stillRunning.length === 0, `${groupNow} ${stillRunning.join(' ')}`);
  await page.emulateMediaFeatures([]);
  await clickText(page, 'Home', '.sidebar button');
  await sleep(700);
}

const lastTileHasImage = (page) => page.$$eval('.grid a.tile', (tiles) => Boolean(tiles.at(-1)?.querySelector('img')));

/** The prompt is answered for us here, so this covers the whole first-time path. */
async function imageLookupFlow(kind, page, origin, proxy, baseline, dashboardPage) {
  const sentSince = (mark) => proxy.log.slice(mark).filter((e) => !baseline.includes(e.host));
  const problems = watchProblems(page);
  // Reuses a tab: Firefox's automation doesn't reliably report a third new tab.
  await page.evaluate((url) => { location.href = url; }, `${origin}/newtab.html`).catch(() => {});
  await sleep(800);
  await page.waitForSelector('.sidebar');

  let mark = proxy.log.length;
  await openAddForm(page, `http://${TEST_SITE}/private/page?token=secret`);
  await sleep(1200);
  check(kind, 'typing an address sends nothing', sentSince(mark).length === 0);
  await page.keyboard.press('Tab');
  await sleep(1000);
  check(kind, 'without permission, leaving the field sends nothing', sentSince(mark).length === 0);

  // Permission prompts need genuine user input, so this is a real click, not el.click().
  await (await page.waitForSelector('.notice button')).click();
  await sleep(2500);
  const requests = sentSince(mark);
  check(kind, 'image found after allowing once', Boolean(await page.$('.tile-preview img')), requests.map((r) => r.path).join(' '));
  check(kind, 'contacted only that site', hostsIn(requests).join() === TEST_SITE, hostsIn(requests).join());
  check(kind, 'only the home page and icon requested, never the full address', requests.map((r) => r.path).join(' ') === '/ /site-icon.png', requests.map((r) => r.path).join(' '));
  check(kind, 'tracker icon on another site skipped', !requests.some((r) => r.host.includes('other-site')));
  check(kind, 'no cookies or referrer sent', requests.length > 0 && requests.every((r) => !r.headers.cookie && !r.headers.referer));
  await saveDialog(page);
  await sleep(300);
  check(kind, 'found image is saved on the shortcut', await lastTileHasImage(page));

  await openAddForm(page, `http://${TEST_SITE}/`);
  await page.keyboard.press('Tab');
  await sleep(1500);
  check(kind, 'image appears on its own after leaving the field', Boolean(await page.$('.tile-preview img')));
  check(kind, 'no Allow button once permission is given', !(await page.$('.notice')));
  await closeForm(page);
  await closingFlow(kind, page, proxy);

  await openAddForm(page, `http://${TEST_SITE}/straight-to-save`);
  await page.keyboard.press('Enter');
  await sleep(2000);
  check(kind, 'pressing Enter straight away still saves the image', await lastTileHasImage(page));

  await openAddForm(page, `http://${TEST_SITE}/letters`);
  await page.keyboard.press('Tab');
  await sleep(1500);
  await clickText(page, 'Use letters', '.modal button');
  check(kind, 'Use letters replaces a found image', !(await page.$('.tile-preview img')));
  await clickText(page, 'Use image', '.modal button');
  check(kind, 'Use image brings it back', Boolean(await page.$('.tile-preview img')));
  await clickText(page, 'Use letters', '.modal button');
  await saveDialog(page);
  await sleep(300);
  check(kind, 'a letter tile chosen over a found image stays letters', !(await lastTileHasImage(page)));

  mark = proxy.log.length;
  await openAddForm(page, `http://${TEST_SITE}/cancelled`);
  await (await page.evaluateHandle(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel'))).asElement().click();
  await sleep(1000);
  check(kind, 'cancelling contacts nothing', sentSince(mark).length === 0, sentSince(mark).map((r) => r.path).join(' '));

  await openAddForm(page);
  await attachFile(page, '.modal input[type=file]', join(PROJECT, 'public/icon/48.png'), 'image/png');
  await setInput(page, '.modal input[placeholder="example.com"]', `http://${TEST_SITE}/own-image`);
  mark = proxy.log.length;
  await page.keyboard.press('Tab');
  await sleep(1000);
  check(kind, 'an image chosen by hand is kept, with no lookup', sentSince(mark).length === 0 && Boolean(await page.$('.tile-preview img')));
  await closeForm(page);

  mark = proxy.log.length;
  await (await page.$$('.grid a.tile')).at(-1).click({ button: 'right' });
  await sleep(150);
  await clickText(page, 'Edit', '.menu button');
  await page.keyboard.press('Tab');
  await sleep(1000);
  check(kind, 'editing an existing shortcut contacts nothing', sentSince(mark).length === 0, sentSince(mark).map((r) => r.path).join(' '));
  await clickText(page, 'Use image', '.modal button');
  await sleep(1500);
  check(kind, 'Use image fetches a website image for a letter tile', Boolean(await page.$('.tile-preview img')));
  await closeForm(page);

  await clickText(page, 'Settings', '.sidebar button');
  await clickText(page, 'Shortcuts', '[role=tab]');
  const toggle = async () => {
    await (await page.evaluateHandle(() => [...document.querySelectorAll('.settings-panel .toggle')].find((l) => l.textContent.includes('website images')).querySelector('input'))).asElement().click();
    await sleep(500);
  };
  await toggle();
  await page.keyboard.press('Escape');
  await sleep(200);
  mark = proxy.log.length;
  await openAddForm(page, `http://${TEST_SITE}/switched-off`);
  await page.keyboard.press('Tab');
  await sleep(1000);
  check(kind, 'switched off: no lookup and no Allow button', sentSince(mark).length === 0 && !(await page.$('.notice')));
  await closeForm(page);

  // A file dialog closes Firefox's panel, so the form moves to its own window, like this.
  const draft = new URLSearchParams({ url: `http://${TEST_SITE}/from-panel`, title: 'Moved form', note: 'Typed in the panel' });
  await page.evaluate((url) => { location.href = url; }, `${origin}/popup.html?${draft}`).catch(() => {});
  await sleep(800);
  await page.waitForSelector('.popup input[type=file]');
  const kept = await page.$$eval('.popup .form input:not([type=file])', (inputs) => inputs.slice(0, 3).map((i) => i.value));
  check(kind, 'moved form keeps what was typed', kept.join('|') === `http://${TEST_SITE}/from-panel|Moved form|Typed in the panel`, kept.join('|'));
  await checkPanelFits(kind, page, 'letters');
  await attachFile(page, '.popup input[type=file]', join(PROJECT, 'public/icon/48.png'), 'image/png');
  await sleep(300);
  check(kind, 'a local image can be chosen in the moved form', Boolean(await page.$('.tile-preview img')));
  await checkPanelFits(kind, page, 'an image');
  await page.evaluate(() => document.querySelector('.popup button[type=submit]').click());
  await sleep(1000);
  const saved = await dashboardPage.evaluate(async () => {
    const { dashboard } = await (globalThis.browser ?? globalThis.chrome).storage.local.get('dashboard');
    return Object.values(dashboard.shortcuts).find((s) => s.title === 'Moved form');
  });
  check(kind, 'moved form saves the shortcut with that image', saved?.tile.kind === 'image' && saved.note === 'Typed in the panel');
  check(kind, 'image lookups cause no script, CSP or console errors', problems.length === 0, problems.slice(0, 3).join(' | ').slice(0, 300));
}

/** Leaving the form any way but Save contacts nobody, and stops a save still waiting for an image. */
async function closingFlow(kind, page, proxy) {
  const contacted = (mark) => proxy.log.slice(mark).filter((e) => e.host === TEST_SITE).length;
  const pressX = () => page.click('.modal-close');
  const ways = { 'the X': pressX, 'a click outside': () => page.mouse.click(4, 4), Escape: () => page.keyboard.press('Escape') };
  for (const [way, close] of Object.entries(ways)) {
    await openAddForm(page, `http://${TEST_SITE}/closed`);
    const mark = proxy.log.length;
    await close();
    await sleep(800);
    check(kind, `closing the form with ${way} contacts nothing`, !(await page.$('.modal')) && contacted(mark) === 0, `${contacted(mark)} requests`);
  }

  const pressCancel = async () => (await page.evaluateHandle(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel'))).asElement().click();
  proxy.site.pageDelayMs = 1500;
  for (const [way, close] of Object.entries({ Cancel: pressCancel, 'the X': pressX })) {
    const before = (await tileTitles(page)).length;
    await openAddForm(page, `http://${TEST_SITE}/slow`);
    await page.keyboard.press('Enter');
    await sleep(300);
    await close();
    await sleep(3500);
    check(kind, `${way} during the wait for an image stops the save`, (await tileTitles(page)).length === before && !(await page.$('.modal')));
  }
  proxy.site.pageDelayMs = 0;
}

/** Fires what a real drag fires, which automation can't do the same way in both browsers. */
const dragGroup = async (page, from, to) => {
  await page.evaluate(
    (a, b) => {
      const named = (name) => [...document.querySelectorAll('.sidebar button[draggable=true]')].find((e) => e.querySelector('.group-name').textContent === name);
      const dataTransfer = new DataTransfer();
      const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      fire(named(a), 'dragstart');
      fire(named(b), 'dragover');
      fire(named(b), 'drop');
      fire(named(a), 'dragend');
    },
    from,
    to,
  );
  await sleep(200);
};

const groupOrder = (page) => page.$$eval('.sidebar button[draggable=true] .group-name', (names) => names.map((n) => n.textContent).join());

const contextMenuAt = (page, selector) => page.$eval(selector, (e) => !e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));

/** Starts on the single group a restore leaves behind. */
async function arrangingFlow(kind, page) {
  for (const name of ['Second', 'Third']) {
    await clickText(page, 'Add group', 'button');
    await setInput(page, '.modal input[required]', name);
    await saveDialog(page);
  }
  await dragGroup(page, 'Restored', 'Second');
  check(kind, 'a group can be dragged down one place', (await groupOrder(page)) === 'Second,Restored,Third', await groupOrder(page));
  await dragGroup(page, 'Restored', 'Third');
  check(kind, 'a group can be dragged to the last place', (await groupOrder(page)) === 'Second,Third,Restored', await groupOrder(page));
  await dragGroup(page, 'Restored', 'Second');
  check(kind, 'a group can be dragged up to the first place', (await groupOrder(page)) === 'Restored,Second,Third', await groupOrder(page));
  await clickText(page, 'Restored', '.sidebar button');
  await sleep(500);

  check(kind, 'right-clicking the search box keeps the browser menu, with paste', !(await contextMenuAt(page, '.search input')) && !(await page.$('.menu')));
  check(kind, 'right-clicking the page still opens the page menu', (await contextMenuAt(page, '.top')) && Boolean(await page.$('.menu')));
  await page.keyboard.press('Escape');
  await sleep(150);

  await openAddForm(page, 'localhost:3000');
  await saveDialog(page);
  const href = await page.$$eval('.grid a.tile', (tiles) => tiles.at(-1).getAttribute('href'));
  check(kind, 'a local address with a port can be added', href === 'http://localhost:3000/', href);
}

/** The sidebar is hidden by default, and each way of opening it has to let go again. */
async function hiddenSidebarFlow(kind, page) {
  const away = async () => {
    await page.mouse.move(700, 300);
    await sleep(300);
  };
  const hidden = () => page.$eval('.sidebar', (e) => e.getBoundingClientRect().right <= 0);
  await away();
  check(kind, 'the sidebar starts hidden, with nothing left on screen', await hidden());
  await page.mouse.move(3, 300);
  await sleep(300);
  check(kind, 'hovering at the edge shows the sidebar', !(await hidden()));

  await (await page.waitForSelector('.sidebar button[draggable=true]')).click();
  await away();
  check(kind, 'it hides again after a click on a group', await hidden());

  await page.mouse.move(3, 300);
  await sleep(300);
  await (await page.$('.sidebar-footer button')).click();
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(200);
  await away();
  check(kind, 'it hides again after Settings closes with Escape', await hidden());

  // The sidebar comes just before the search box, so Shift+Tab lands on it.
  await page.focus('.search-engine');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await sleep(300);
  check(kind, 'keyboard focus shows it', !(await hidden()));
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(300);

  const dragEvent = (type) => page.$eval('.sidebar', (e, name) => e.dispatchEvent(new DragEvent(name, { bubbles: true, cancelable: true })), type);
  await dragEvent('dragenter');
  await sleep(300);
  check(kind, 'dragging a shortcut to the edge shows it', !(await hidden()));
  await dragEvent('dragleave');
  await sleep(300);
  check(kind, 'it hides again when the drag moves away', await hidden());
}

const putImage = (page, id) =>
  page.evaluate(
    (imageId) =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('landing-tab-images');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const tx = opening.result.transaction('images', 'readwrite');
          tx.objectStore('images').put(new Blob(['x'], { type: 'image/png' }), imageId);
          tx.oncomplete = () => {
            opening.result.close();
            resolve();
          };
        };
      }),
    id,
  );

const storedImages = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('landing-tab-images');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const request = opening.result.transaction('images').objectStore('images').getAllKeys();
          request.onsuccess = () => {
            opening.result.close();
            resolve(request.result);
          };
        };
      }),
  );

/** One tab stands in for a restore or save in progress, while another tab opens. */
async function imageCleanupFlow(kind, dir) {
  const proxy = await startProxy();
  const { browser, close } = await launch(kind, proxy.port, { addonId: ADDON_ID });
  try {
    await sleep(1500);
    const id = await browser.installExtension(dir);
    const url = `${extensionOrigin(kind, id)}/newtab.html`;
    const saving = await openExtensionPage(kind, browser, url);
    await saving.waitForSelector('.sidebar');
    await sleep(500);
    // The page opens these itself, because Firefox's automation doesn't always report a second tab.
    // They stay open, since cleanup queued in a closed tab would never run.
    const openTab = async () => {
      await saving.evaluate((address) => (globalThis.browser ?? globalThis.chrome).tabs.create({ url: address, active: false }), url);
      await sleep(1300);
    };

    await putImage(saving, 'unused');
    await openTab();
    check(kind, 'opening a tab clears an image nothing uses', !(await storedImages(saving)).includes('unused'));

    await saving.evaluate(() => {
      const held = new Promise((resolve) => {
        globalThis.finishSaving = resolve;
      });
      void navigator.locks.request('landing-tab-images', () => held);
    });
    await putImage(saving, 'arriving');
    await openTab();
    check(kind, 'a tab opening during a restore leaves its images alone', (await storedImages(saving)).includes('arriving'));
    await saving.evaluate(async () => {
      const api = globalThis.browser ?? globalThis.chrome;
      const { dashboard } = await api.storage.local.get('dashboard');
      dashboard.groups[0].shortcutIds.push('kept');
      dashboard.shortcuts.kept = { id: 'kept', title: 'Kept', url: 'https://kept.example/', note: '', color: '#ffffff', tile: { kind: 'image', imageId: 'arriving', scale: 100 } };
      await api.storage.local.set({ dashboard });
      globalThis.finishSaving();
    });
    await sleep(800);
    check(kind, 'those images are still there once the restore finishes', (await storedImages(saving)).includes('arriving'));
  } finally {
    await close();
    await proxy.close();
  }
}

/** Identifies each open new tab page, and changes when that page reloads. */
async function pageLoads(kind, browser) {
  if (kind === 'firefox') {
    const ids = await firefoxSystem(
      browser,
      `[...Services.wm.getMostRecentWindow('navigator:browser').gBrowser.browsers]
        .filter((b) => b.currentURI.spec.endsWith('/newtab.html'))
        .map((b) => b.browsingContext.currentWindowGlobal.innerWindowId)
        .join()`,
    );
    return ids.split(',');
  }
  const pages = (await browser.pages()).filter((p) => p.url().endsWith('/newtab.html'));
  return Promise.all(pages.map((p) => p.evaluate(() => (globalThis.loadId ??= crypto.randomUUID()))));
}

/** The shortcut's image is missing at first, so the open pages remember it as missing. */
async function restoreReloadFlow(kind, dir) {
  const proxy = await startProxy();
  const { browser, close } = await launch(kind, proxy.port, { addonId: ADDON_ID });
  try {
    await sleep(1500);
    const id = await browser.installExtension(dir);
    const url = `${extensionOrigin(kind, id)}/newtab.html`;
    const page = await openExtensionPage(kind, browser, url);
    await page.waitForSelector('.sidebar');
    await sleep(500);
    const dashboard = {
      groups: [{ id: 'r', name: 'Restored', symbol: '', shortcutIds: ['pic'] }],
      shortcuts: { pic: { id: 'pic', title: 'Picture', url: 'https://picture.example/', note: '', color: '#ffffff', tile: { kind: 'image', imageId: 'restored-image', scale: 100 } } },
    };
    await page.evaluate(async (data, address) => {
      const api = globalThis.browser ?? globalThis.chrome;
      await api.storage.local.set({ dashboard: data });
      await api.tabs.create({ url: address, active: false });
    }, dashboard, url);
    await sleep(1500);
    check(kind, 'before a restore, the image is missing', !(await page.$('.grid a.tile img')));
    const before = await pageLoads(kind, browser);

    const backup = { format: 'landing-tab-backup', version: 1, state: { dashboard }, images: [{ id: 'restored-image', type: 'image/png', data: readFileSync(join(PROJECT, 'public/icon/48.png')).toString('base64') }] };
    const file = join(mkdtempSync(join(tmpdir(), 'landing-tab-backup-')), 'backup.json');
    writeFileSync(file, JSON.stringify(backup));
    await clickText(page, 'Settings', '.sidebar button');
    await clickText(page, 'Data and privacy', '[role=tab]');
    await attachFile(page, '.settings-panel input[type=file]', file, 'application/json');
    await sleep(400);
    await clickText(page, 'Restore', '.modal button');
    await sleep(1500);
    await page.waitForSelector('.sidebar');
    await sleep(300);

    check(kind, 'after a restore, images show without opening a new tab', await page.$eval('.grid a.tile img', (img) => img.complete && img.naturalWidth > 0).catch(() => false));
    check(kind, 'the reloaded page confirms the restore', await page.$eval('.toast', (e) => e.textContent.toLowerCase().includes('restored')).catch(() => false));
    check(kind, 'the settings window is closed afterwards', !(await page.$('.modal')));
    const after = await pageLoads(kind, browser);
    check(kind, 'every open new tab page reloads', before.length === 2 && after.length === 2 && !after.some((load) => before.includes(load)), `${before.length} and ${after.length} pages`);
    await page.evaluate(() => location.reload()).catch(() => {});
    await sleep(800);
    await page.waitForSelector('.sidebar');
    check(kind, 'the confirmation shows only once', !(await page.$('.toast')));
  } finally {
    await close();
    await proxy.close();
  }
}

/** Tells where a search went from the browser's side, because a page can't see its tabs' addresses. */
async function privateTabs(kind, browser, page) {
  if (kind === 'firefox') {
    return firefoxSystem(
      browser,
      `(() => {
        const { PrivateBrowsingUtils } = ChromeUtils.importESModule('resource://gre/modules/PrivateBrowsingUtils.sys.mjs');
        const open = [...Services.wm.getEnumerator('navigator:browser')].filter((w) => PrivateBrowsingUtils.isWindowPrivate(w));
        return open.flatMap((w) => w.gBrowser.browsers.map((b) => b.currentURI.spec)).join(' ');
      })()`,
    );
  }
  // The normal window is checked separately, so the search can only be in the private tab.
  const urls = browser.targets().filter((t) => t.type() === 'page').map((t) => t.url());
  const incognito = await page.evaluate(async () => (await chrome.windows.getAll({ populate: true })).filter((w) => w.incognito).map((w) => w.tabs.length));
  return incognito.join() === '1' ? urls.join(' ') : '';
}

async function privateSearchFlow(kind, dir) {
  const proxy = await startProxy();
  const { browser, close } = await launch(kind, proxy.port, { addonId: ADDON_ID });
  const windows = (page) =>
    page.evaluate(async () => {
      const api = globalThis.browser ?? globalThis.chrome;
      return (await api.windows.getAll({ populate: true })).map((w) => `${w.incognito ? 'private' : 'normal'}:${w.tabs.length}`).sort().join();
    });
  try {
    await sleep(1500);
    const id = await browser.installExtension(dir);
    const origin = extensionOrigin(kind, id);
    const open = async () => {
      const page = await openExtensionPage(kind, browser, `${origin}/newtab.html`);
      await page.waitForSelector('.sidebar');
      await sleep(500);
      await page.evaluate(async () => {
        const api = globalThis.browser ?? globalThis.chrome;
        const { settings, search } = await api.storage.local.get(['settings', 'search']);
        await api.storage.local.set({
          settings: { ...settings, search: { ...settings.search, openTarget: 'private' } },
          search: { ...search, activeEngineId: 'browser' },
        });
      });
      await sleep(400);
      return page;
    };
    const search = async (page) => {
      await page.click('.search input');
      await page.type('.search input', 'hidden query');
      await page.keyboard.press('Enter');
      await sleep(2500);
    };

    let page = await open();
    const untouched = await windows(page);
    await search(page);
    check(kind, 'without private access, the search says what to do', await page.$eval('.toast', (e) => e.textContent.includes('private windows')).catch(() => false));
    check(kind, 'without private access, the search runs nowhere', (await windows(page)) === untouched, await windows(page));

    if (kind === 'firefox') {
      await firefoxSystem(
        browser,
        `(async () => {
          const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
          const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
          await ExtensionPermissions.add(${JSON.stringify(ADDON_ID)}, { permissions: ['internal:privateBrowsingAllowed'], origins: [] });
          await (await AddonManager.getAddonByID(${JSON.stringify(ADDON_ID)})).reload();
        })()`,
      );
    } else {
      const manager = await browser.newPage();
      await manager.goto(`${kind}://extensions`);
      await sleep(800);
      // The change reloads the extension, and Chrome disables an unpacked one that
      // reloads outside developer mode. Edge doesn't, but it does no harm there.
      await manager.evaluate(async (extensionId) => {
        await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
        await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, incognitoAccess: true });
      }, id);
    }
    await sleep(1500);

    page = await open();
    const problems = watchProblems(page);
    const normal = (await windows(page)).split(',').find((w) => w.startsWith('normal'));
    await search(page);
    const opened = (await windows(page)).split(',');
    check(kind, 'a private search leaves normal windows alone', opened.includes(normal), opened.join());
    check(kind, 'a private search opens one private window', opened.includes('private:1'), opened.join());
    const tabs = await privateTabs(kind, browser, page);
    check(kind, 'the private window is the one that searched', /[?&]q=hidden(\+|%20)query/.test(tabs), tabs.slice(0, 120));
    check(kind, 'private search causes no script or console errors', problems.length === 0, problems.slice(0, 2).join(' | ').slice(0, 200));
  } finally {
    await close();
    await proxy.close();
  }
}

/** Browsers cap a toolbar panel at about 600px, and past that it needs a scrollbar. */
async function checkPanelFits(kind, page, showing) {
  const height = await page.$eval('.popup', (e) => Math.ceil(e.getBoundingClientRect().height));
  check(kind, `panel fits without scrolling, showing ${showing}`, height <= 600, `${height}px`);
}

/**
 * Automation can't answer Chromium's permission prompt, so a throwaway copy of the
 * build gets site access at install. Everything after the prompt is the same code.
 */
async function grantedFlow(kind, dir) {
  const copy = mkdtempSync(join(tmpdir(), 'landing-tab-granted-'));
  cpSync(dir, copy, { recursive: true });
  const manifestPath = join(copy, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const proxy = await startProxy();
  const { browser, close } = await launch(kind, proxy.port);
  try {
    await sleep(1500);
    const id = await browser.installExtension(copy);
    const origin = extensionOrigin(kind, id);
    const manager = await browser.newPage();
    await manager.goto(`${kind}://extensions`);
    await sleep(800);
    await manager.evaluate(async (extensionId) => {
      await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
      await chrome.developerPrivate.reload(extensionId, { failQuietly: true });
    }, id);
    await sleep(1500);

    const page = await openExtensionPage(kind, browser, `${origin}/newtab.html`);
    const problems = watchProblems(page);
    await page.waitForSelector('.sidebar');
    await sleep(500);
    await openAddForm(page, `http://${TEST_SITE}/`);
    await page.keyboard.press('Tab');
    await sleep(1500);
    check(kind, 'image appears on its own after leaving the field', Boolean(await page.$('.tile-preview img')));
    await closeForm(page);
    await closingFlow(kind, page, proxy);

    // Only a real toolbar click reveals the page, so the popup is told the address.
    const popup = await browser.newPage();
    await popup.evaluateOnNewDocument((url) => {
      chrome.tabs.query = async () => [{ url, title: 'Test page' }];
    }, `http://${TEST_SITE}/private/page?token=secret`);
    const mark = proxy.log.length;
    await popup.goto(`${origin}/popup.html`);
    await popup.waitForSelector('.popup .tile-preview');
    await sleep(1500);
    const requests = proxy.log.slice(mark).filter((e) => e.host === TEST_SITE);
    check(kind, 'popup fetches the image on its own', Boolean(await popup.$('.popup .tile-preview img')), requests.map((r) => r.path).join(' '));
    check(kind, 'popup never sends the page address', requests.length > 0 && requests.every((r) => !/private|token|secret/.test(r.path)));
    await checkPanelFits(kind, popup, 'an image');
    await attachFile(popup, '.popup input[type=file]', join(PROJECT, 'public/icon/48.png'), 'image/png');
    await sleep(300);
    check(kind, 'a local image can be chosen in the popup', Boolean(await popup.$('.tile-preview img')));
    await clickText(popup, 'Use letters', '.popup button');
    await checkPanelFits(kind, popup, 'letters');

    check(kind, 'image lookups cause no script, CSP or console errors', problems.length === 0, problems.slice(0, 3).join(' | ').slice(0, 300));
    const { runtimeErrors = [], manifestErrors = [] } = await manager.evaluate((extensionId) => chrome.developerPrivate.getExtensionInfo(extensionId), id);
    const listed = [...manifestErrors, ...runtimeErrors].map((e) => e.message.slice(0, 120));
    check(kind, 'the Errors list on the extensions page is empty', listed.length === 0, listed.slice(0, 2).join(' | '));
  } finally {
    await close();
    await proxy.close();
  }
}

async function runExtension(kind, baseline) {
  console.log(`\n=== ${kind}: this extension`);
  const proxy = await startProxy();
  const dir = resolve('.output', kind === 'firefox' ? 'firefox-mv3' : kind === 'edge' ? 'edge-mv3' : 'chrome-mv3');
  const { browser, close } = await launch(kind, proxy.port, { addonId: ADDON_ID });
  try {
    await sleep(3000);
    const startupHosts = hostsIn(proxy.log);
    const id = await browser.installExtension(dir);
    const origin = extensionOrigin(kind, id);
    const page = await session(kind, browser, origin);
    await arrangingFlow(kind, page);
    await hiddenSidebarFlow(kind, page);
    const secondTab = await popupFlow(kind, browser, origin);
    if (kind === 'firefox') await imageLookupFlow(kind, secondTab, origin, proxy, baseline, page);
    else await grantedFlow(kind, dir);
    const mark = proxy.log.length;
    console.log(`  idling ${IDLE_SECONDS}s…`);
    await sleep(IDLE_SECONDS * 1000);
    const idle = proxy.log.slice(mark);
    await searchFlow(kind, page, proxy, baseline);
    return { hosts: hostsIn(proxy.log), startupHosts, idleHosts: hostsIn(idle), log: proxy.log };
  } finally {
    await close();
    await proxy.close();
  }
}

/**
 * The browser with an extension containing no code: a blank new tab and nothing
 * else, taken through similar actions. Anything seen here comes from the browser.
 */
function createInertExtension() {
  const dir = mkdtempSync(join(tmpdir(), 'landing-tab-inert-'));
  writeFileSync(join(dir, 'newtab.html'), '<!doctype html><title>x</title><input id="i">');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'inert',
      version: '1.0',
      chrome_url_overrides: { newtab: 'newtab.html' },
      browser_specific_settings: { gecko: { id: ADDON_ID } },
    }),
  );
  return dir;
}

async function runBaseline(kind) {
  console.log(`
=== ${kind}: baseline, extension with no code`);
  const proxy = await startProxy();
  const { browser, close } = await launch(kind, proxy.port, { addonId: ADDON_ID });
  try {
    await sleep(3000);
    const id = await browser.installExtension(createInertExtension());
    const page = await openExtensionPage(kind, browser, `${extensionOrigin(kind, id)}/newtab.html`);
    await page.waitForSelector('#i');
    await page.click('#i');
    await page.type('#i', 'some typing');
    await sleep((IDLE_SECONDS + 20) * 1000);
    return hostsIn(proxy.log);
  } finally {
    await close();
    await proxy.close();
  }
}

async function runControl(xpi) {
  console.log('\n=== firefox: control, reference add-on');
  const proxy = await startProxy();
  const addonId = CONTROL_ID;
  const dir = mkdtempSync(join(tmpdir(), 'landing-tab-control-'));
  const copy = join(dir, 'reference.xpi');
  copyFileSync(xpi, copy);
  const { browser, close } = await launch('firefox', proxy.port, { addonId });
  try {
    await sleep(2000);
    await browser.installExtension(copy);
    await openExtensionPage('firefox', browser, `${extensionOrigin('firefox', addonId)}/asset/html/newtab.html`);
    await sleep((IDLE_SECONDS + 10) * 1000);
    return { hosts: hostsIn(proxy.log), log: proxy.log };
  } finally {
    await close();
    await proxy.close();
  }
}

const isReferenceHost = (host) => Boolean(CONTROL_DOMAIN) && (host === CONTROL_DOMAIN || host.endsWith(`.${CONTROL_DOMAIN}`));

let controlPassed = null;
if (CONTROL_XPI) {
  const control = await runControl(CONTROL_XPI);
  const hits = control.hosts.filter(isReferenceHost);
  console.log('  reference add-on contacted:', hits.join(', ') || '(nothing)');
  controlPassed = hits.length > 0;
  check('firefox', 'CONTROL: harness detects reference add-on traffic', controlPassed, hits.join(', '));
}

const targets = option('--targets')?.split(',') ?? ['firefox', 'edge', ...(existsSync(CHROME) ? ['chrome'] : [])];
for (const kind of targets) {
  const baseline = await runBaseline(kind);
  console.log(`  browser's own hosts: ${baseline.length}`);
  console.log(`    ${baseline.join(', ')}`);
  const run = await runExtension(kind, baseline);

  const dir = resolve('.output', kind === 'firefox' ? 'firefox-mv3' : kind === 'edge' ? 'edge-mv3' : 'chrome-mv3');
  await restartFlow(kind, dir);
  await imageCleanupFlow(kind, dir);
  await restoreReloadFlow(kind, dir);
  await privateSearchFlow(kind, dir);

  const allowed = new Set([...baseline, TEST_SITE, 'duckduckgo.com']);
  const extra = run.hosts.filter((h) => !allowed.has(h));
  console.log(`  hosts beyond the browser's own: ${extra.join(', ') || '(none)'}`);
  check(kind, 'no traffic beyond the browser baseline', extra.length === 0, extra.join(', '));
  check(kind, 'no contact with the reference service', !run.hosts.some(isReferenceHost));
  check(kind, 'nothing while idle except browser baseline', run.idleHosts.every((h) => baseline.includes(h)), run.idleHosts.filter((h) => !baseline.includes(h)).join(', '));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED [${f.browserName}] ${f.name} ${f.detail}`);
writeFileSync(join(SHOTS, 'report.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
