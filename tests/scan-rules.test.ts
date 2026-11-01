import { describe, expect, it } from 'vitest';
import { FONT_IN_PIXELS } from '../scripts/scan-rules.mjs';

describe('FONT_IN_PIXELS', () => {
  it.each(['a{font-size:14px}', 'a{font:14px/1.4 Arial}', 'a{font-size:.5px}', 'a{font-size:clamp(12px,2vw,20px)}', 'a{color:red;font-size: 14px}'])('catches %s', (css) => {
    expect(FONT_IN_PIXELS.test(css)).toBe(true);
  });

  it.each(['a{font-size:.875rem}', 'a{font:.875rem/1.45 var(--font)}', 'a{font:inherit;padding:8px}', 'a{font-family:Arial;width:10px}'])('allows %s', (css) => {
    expect(FONT_IN_PIXELS.test(css)).toBe(false);
  });
});
