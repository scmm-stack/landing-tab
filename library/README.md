# Wallpaper library

Every installed copy of Landing Tab lists this folder on `main` and offers the images in it under **Wallpaper type > Extension library**. The extension doesn't name any image, so adding, replacing or removing one here reaches users within a day, without a new release.

## Adding an image

- JPEG or WebP, about 3840 pixels wide, under 8 MB. Smaller is better, since every user downloads it.
- A file name of letters, digits, `-`, `_` or `.`, such as `misty-valley.jpg`. Images are shown in name order.
- Strip location and camera data before committing. For example: `convert original.jpg -resize 3840x -strip -interlace JPEG -quality 82 library/misty-valley.jpg`.

Files that don't match these rules are skipped. `tests/library.test.ts` checks this folder, so a file that would be skipped fails CI.

Don't move or rename this folder. Installed copies read it by path.
