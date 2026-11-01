import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

export const FIREFOX = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Firefox keeps a stable internal address for an add-on only if it's set up front.
export const FIREFOX_UUID = '7f3a1c52-90de-4b7e-8a21-5c6f0d9e1b34';

/** Launches in a throwaway profile, hidden, routing everything through the proxy. */
export async function launch(kind, proxyPort, { addonId, uuid = FIREFOX_UUID, prepareProfile, extraPrefs = {}, profileDir } = {}) {
  const profile = profileDir ?? mkdtempSync(join(tmpdir(), 'landing-tab-e2e-'));
  prepareProfile?.(profile);
  const options = { headless: true, userDataDir: profile, protocolTimeout: 120_000 };

  const browser =
    kind === 'firefox'
      ? await puppeteer.launch({
          ...options,
          browser: 'firefox',
          executablePath: FIREFOX,
          // firefox.exe is a launcher on Windows. These keep a separate instance attached,
          // even with the person's own Firefox already open.
          args: ['--wait-for-browser', '--new-instance'],
          env: { ...process.env, MOZ_NO_REMOTE: '1', MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
          extraPrefsFirefox: {
            'network.proxy.type': 1,
            'network.proxy.http': '127.0.0.1',
            'network.proxy.http_port': proxyPort,
            'network.proxy.ssl': '127.0.0.1',
            'network.proxy.ssl_port': proxyPort,
            'network.proxy.no_proxies_on': '',
            'network.proxy.allow_hijacking_localhost': true,
            'network.trr.mode': 5,
            'extensions.webextOptionalPermissionPrompts': false,
            'extensions.webextensions.uuids': addonId ? JSON.stringify({ [addonId]: uuid }) : '{}',
            ...extraPrefs,
          },
        })
      : await puppeteer.launch({
          ...options,
          browser: 'chrome',
          executablePath: kind === 'edge' ? EDGE : CHROME,
          enableExtensions: true,
          pipe: true,
          args: [`--proxy-server=127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>', '--no-first-run'],
        });

  return {
    browser,
    close: async () => {
      await browser.close().catch(() => {});
      if (!profileDir) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

/** Runs code with browser-level access, for what no web page or extension can do. */
export async function firefoxSystem(browser, expression) {
  const { contexts } = (await browser.connection.send('browsingContext.getTree', { 'moz:scope': 'chrome' })).result;
  const reply = await browser.connection.send('script.evaluate', { expression, target: { context: contexts[0].context }, awaitPromise: true });
  return reply.result?.result?.value;
}

/**
 * Firefox's automation protocol refuses to navigate content tabs to extension
 * pages, so the tab is opened from the browser's own window, as the UI would.
 * The new page keeps reporting about:blank, so it's found by being new.
 */
async function openFirefoxTab(browser, url) {
  const connection = browser.connection;
  const { contexts } = (await connection.send('browsingContext.getTree', { 'moz:scope': 'chrome' })).result;
  const before = new Set(await browser.pages());
  await connection.send('script.evaluate', {
    expression: `(() => {
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      win.gBrowser.selectedTab = win.gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    })()`,
    target: { context: contexts[0].context },
    awaitPromise: false,
  });
  for (let i = 0; i < 100; i++) {
    const opened = (await browser.pages()).find((page) => !before.has(page));
    if (opened) return opened;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Tab did not open: ${url}`);
}

export async function openExtensionPage(kind, browser, url) {
  if (kind === 'firefox') return openFirefoxTab(browser, url);
  const page = await browser.newPage();
  await page.goto(url);
  return page;
}

export const extensionOrigin = (kind, extensionId, uuid = FIREFOX_UUID) =>
  kind === 'firefox' ? `moz-extension://${uuid}` : `chrome-extension://${extensionId}`;
