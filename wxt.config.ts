import { defineConfig } from 'wxt';

/**
 * Connections are allowed only because favicon lookup needs them. Everything
 * else is closed. src/lib/favicon.ts is the single module allowed to use the
 * network, enforced by eslint.config.mjs and scripts/scan-build.mjs.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  'connect-src http: https:',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  // Mozilla's reviewers rebuild from the source archive, and need .npmrc to do it the same way.
  zip: { includeSources: ['.npmrc'] },
  // The default preload polyfill contains a fetch call, which nothing here needs.
  vite: () => ({ build: { modulePreload: { polyfill: false } } }),
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'search'],
    optional_permissions: ['bookmarks'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    content_security_policy: { extension_pages: CONTENT_SECURITY_POLICY },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: '__MSG_extName__',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    ...(browser === 'firefox'
      ? {
          chrome_settings_overrides: { homepage: 'newtab.html' },
          browser_specific_settings: {
            gecko: {
              id: 'landing-tab@scmm-stack.dev',
              strict_min_version: '142.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
