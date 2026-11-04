# Firefox store listing

Text for the add-on's page on addons.mozilla.org. It isn't part of the extension.

## Submission

- **Distribution:** On this site
- **Platform:** Firefox only, not Firefox for Android. The new tab override, bookmarks and windows features aren't available there
- **Source code:** Yes. Upload the matching `landing-tab-<version>-sources.zip` from the GitHub Release
- **Experimental:** No
- **Requires payment:** No

## Listing

- **Categories:** Tabs, Privacy & Security
- **Support website:** <https://github.com/scmm-stack/landing-tab/issues>
- **License:** MIT License
- **Summary:** A new tab dashboard that keeps everything on your device. No account, no tracking.
- **Privacy policy:** Paste `PRIVACY.md`

**Description:** Use the English description in `docs/edge-store-listing.md`, then add this paragraph:

Firefox doesn't give extensions image storage in private windows, so tiles show letters and wallpapers don't appear there. Opening anything in a private window needs this extension allowed in private windows.

For the Polish listing, use the Polish description there, then add this paragraph:

Firefox nie udostępnia rozszerzeniom miejsca na obrazy w oknach prywatnych, dlatego kafelki pokazują tam litery, a tapety się nie wyświetlają. Otwieranie czegokolwiek w oknie prywatnym wymaga zezwolenia tej wtyczce na działanie w oknach prywatnych.

## Notes for reviewers

The code is bundled with WXT and Vite. To rebuild it from the source archive:

1. Use Linux with Node 24 and npm 11. The release was built on Ubuntu with Node 24.
2. Run `npm ci`, then `npm run setup`, then `npm run build:firefox`.
3. The result is in `.output/firefox-mv3`, and matches the submitted package.

`npm run setup` prints ".git can't be found" outside a git checkout. That's expected and harmless.

To test: open a new tab to see the dashboard. The toolbar button adds the current page as a shortcut. No account is needed. Website images are off until the user allows site access. `src/lib/favicon.ts` and `src/lib/library.ts` are the only modules that use the network. The second one downloads wallpapers from the extension's GitHub repository, and only when the user picks Extension library as the wallpaper.
