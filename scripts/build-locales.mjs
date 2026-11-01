import { mkdirSync, writeFileSync } from 'node:fs';
import { MESSAGES } from './i18n-source.mjs';

const LOCALES = ['en', 'pl'];

for (const [index, locale] of LOCALES.entries()) {
  const out = {};
  for (const entry of MESSAGES) out[entry[0]] = { message: entry[index + 1] };
  const dir = new URL(`../public/_locales/${locale}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('messages.json', dir), `${JSON.stringify(out, null, 2)}\n`);
}
console.log(`Wrote ${MESSAGES.length} messages for ${LOCALES.join(', ')}`);
