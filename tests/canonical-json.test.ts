import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: {} }));

import { canonicalJson } from '../src/lib/store';

describe('canonicalJson', () => {
  it('ignores key order, at every depth', () => {
    const written = { b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } };
    const chromiumEcho = { a: { c: 3, d: [{ y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(written)).toBe(canonicalJson(chromiumEcho));
  });

  it('still sees real differences', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});
