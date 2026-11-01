import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mozilla's reviewers rebuild the extension from the source archive, so a release
 * must not go out with one they can't build from. This reads the finished archive,
 * because the WXT setting that controls it can quietly leave nearly everything out.
 */

const OUTPUT = process.argv[2] ?? '.output';
const REQUIRED = [
  '.npmrc',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'wxt.config.ts',
  'scripts/build-locales.mjs',
  'src/entrypoints/newtab/main.tsx',
  'src/entrypoints/popup/main.tsx',
  'public/_locales/en/messages.json',
];

const archives = readdirSync(OUTPUT).filter((name) => name.endsWith('-sources.zip'));
if (archives.length === 0) {
  console.error(`No source archive found in ${OUTPUT}`);
  process.exit(1);
}

let failed = false;
for (const archive of archives) {
  const listed = new Set(execFileSync('unzip', ['-Z1', join(OUTPUT, archive)], { encoding: 'utf8' }).split(/\r?\n/));
  const missing = REQUIRED.filter((file) => !listed.has(file));
  if (missing.length > 0) {
    failed = true;
    console.error(`${archive} is missing: ${missing.join(', ')}`);
  } else {
    console.log(`${archive}: complete`);
  }
}
if (failed) process.exit(1);
