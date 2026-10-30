import { describe, expect, it } from 'vitest';
import { applyBrandColor, contrastRatio, readableForeground } from '../brandColor';

// WCAG relative luminance, written out independently of the module under test.
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const NEAR_WHITE = '#f8fafc';
const NEAR_BLACK = '#0f172a';

describe('brand colour foreground', () => {
  it('the default lavender gets dark text — white on it fails WCAG AA', () => {
    expect(contrastRatio(lum('#A48AFB'), lum(NEAR_WHITE))).toBeLessThan(4.5); // the old bug
    expect(readableForeground('#A48AFB')).toBe('222 47% 11%');
    expect(contrastRatio(lum('#A48AFB'), lum(NEAR_BLACK))).toBeGreaterThanOrEqual(4.5);
  });

  it('a dark brand colour keeps light text', () => {
    expect(readableForeground('#4338CA')).toBe('210 40% 98%');
    expect(contrastRatio(lum('#4338CA'), lum(NEAR_WHITE))).toBeGreaterThanOrEqual(4.5);
  });

  it('applies primary, ring and foreground together, and rejects bad input', () => {
    const el = document.createElement('div');
    expect(applyBrandColor('#A48AFB', el)).toBe(true);
    expect(el.style.getPropertyValue('--primary')).toBe('254 93% 76%');
    expect(el.style.getPropertyValue('--ring')).toBe('254 93% 76%');
    expect(el.style.getPropertyValue('--primary-foreground')).toBe('222 47% 11%');
    expect(applyBrandColor('not-a-colour', el)).toBe(false);
  });
});
