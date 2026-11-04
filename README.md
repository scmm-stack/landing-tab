# Landing Tab

A new tab dashboard for Firefox, Edge and Chrome that keeps everything on your device. There is no account, no sync, no analytics and no server.

## Features

- Shortcut groups with a sidebar, wheel scrolling that loops through them, drag to reorder, and multi-select delete
- Cards with an image, name and description, or plain icons
- Image or letter tiles, with layouts, sizes, colors and open-in options
- Search box with built-in and custom engines, plus optional local history. Results can open in a private window. In Firefox that always needs this extension allowed in private windows, on the browser's extensions page. In Edge and Chrome it's needed only with **Browser default** as the engine
- Smooth opening animation, shortcuts that fade in together at an adjustable speed, and an optional shine on hover. All motion stops if your system asks for reduced motion
- Clock and full-screen standby page
- Wallpapers: your own images with timed rotation, solid colors and animated scenes
- Toolbar button to add the current page. A file dialog would close the panel in Firefox, so **Choose a file** moves the form to a small window there
- Bookmark import and export
- Backup and restore through a JSON file you keep
- Firefox private windows work, but extensions can't reach image storage there, so tiles show letters and wallpapers don't appear
- English and Polish

## What leaves your device

Only these, each started by you:

| Action | What is contacted |
| --- | --- |
| Opening a shortcut or submitting a search | That website or search engine, as with any link |
| Adding a shortcut | That website's home page and the icon files it names, which may be on another domain the site uses, once, with no cookies and no referrer |
| Choosing **Extension library** as the wallpaper | GitHub, for the list of library images at most once a day and each image once, with no cookies and no referrer |

Website images need your permission once, and **Settings > Shortcuts > Fetch website images automatically** turns them off and hands the permission back. A lookup starts when you leave the address field or open the toolbar button, and it never sends the page's path or query. You can always set an image from a file instead.

Typing, editing an existing shortcut, importing bookmarks and leaving a tab open send nothing.

The content security policy has to allow web connections for image lookup, so the browser alone does not enforce this. It is enforced by a lint rule, a scan of the built extension, and a browser test that records all traffic.

## Install for local testing

Build first, on Linux with Node 24 and npm 11. Releases are built on Ubuntu:

```
npm ci
npm run setup
npm run build
```

The results are in `.output`. To build only the Firefox version, use `npm run build:firefox`, which writes to `.output/firefox-mv3`.

**Edge or Chrome** stays installed across restarts:

1. Open `edge://extensions` or `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `.output/edge-mv3` or `.output/chrome-mv3`.

**Firefox** loads as a temporary add-on, which is removed when Firefox closes:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and choose `.output/firefox-mv3/manifest.json`.

To keep your data between Firefox sessions, set `extensions.webextensions.keepStorageOnUninstall` and `extensions.webextensions.keepUuidOnUninstall` to `true` in `about:config`, then load the add-on again after each restart.

Back up from **Settings > Your data**. Nothing is stored anywhere else, so that file is your only copy.

## Development

| Command | What it does |
| --- | --- |
| `npm run verify` | Types, lint, unit tests, all builds, the build scan, and Mozilla's add-on linter |
| `npm run test:browsers` | Real-browser test with a traffic-recording proxy |
| `npm run build:firefox` | Build one target (also `build:chrome`, `build:edge`) |
| `npm run zip` | Build store packages in `.output` (also `zip:firefox`, `zip:chrome`, `zip:edge`) |

`npm install` scripts are disabled in `.npmrc`, so run `npm run setup` after installing. It also turns on the commit message check.

The browser test uses your installed browsers in throwaway profiles and never touches your own. Its proxy refuses all traffic, apart from one made-up test site it serves itself.

### Releasing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org). A hook checks them locally, and CI checks pull requests.

Every push to `main` runs `npm run verify`, then semantic-release picks the next version from the commits: `fix:` is a patch, and `feat:` is a minor version. Until 1.0, `feat!:` or a `BREAKING CHANGE:` footer is a minor version too, set by a rule in `release.config.mjs`. Other types make no release. A release creates the tag and a GitHub Release with the packages attached. The version lives in the tag, so `version` in `package.json` isn't updated in the repo.

Publishing to a store is a separate step. To send a release to Edge, run **Actions > Publish to Edge** with its tag. Tick **dry run** to check the credentials only. It needs these secrets in a GitHub environment named `edge-store`:

| Secret | Where it comes from |
| --- | --- |
| `EDGE_PRODUCT_ID` | The extension's overview page in Partner Center |
| `EDGE_CLIENT_ID` | Partner Center, **Publish API** |
| `EDGE_API_KEY` | Partner Center, **Publish API**. It has an expiry date, so renew it there |

The first Edge upload has to be done by hand in Partner Center, because the API can only update an extension that already exists. `docs/edge-store-listing.md` has the text for the form. The store listing itself, including the description, can only be changed there too.

### Rules

- `src/lib/favicon.ts` and `src/lib/library.ts` are the only modules allowed to use the network.
- New permissions, CSP changes, or unexpected addresses fail `npm run scan`.
- Anything read from storage or a backup goes through `src/lib/normalize.ts`.
- There is no background script.
- Sizes use `rem`, or `%` when they depend on their container. `px` is only for hairlines, shadows, blur and motion, so the layout follows the browser's text size.
- To change text, edit `scripts/i18n-source.mjs`, then run `node scripts/build-locales.mjs`.

An optional, untracked `.forbidden-terms` file lists extra words the scan must reject, one per line.

## License

[MIT](LICENSE)
