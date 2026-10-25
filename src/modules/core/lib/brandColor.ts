/**
 * Organisation brand colour → the `--primary` CSS variables.
 *
 * The brand colour is user-chosen (Settings → Brand Color), but its text colour
 * was fixed at near-white. The default brand `#A48AFB` is a light lavender:
 * white on it is ~2.4:1, under WCAG's 4.5:1 for normal text, in both themes.
 * So the foreground is computed: whichever of near-black / near-white has the
 * higher contrast against the chosen colour.
 */

const NEAR_WHITE = '210 40% 98%'; // the theme's original --primary-foreground
const NEAR_BLACK = '222 47% 11%'; // the theme's --foreground (dark slate)
const NEAR_WHITE_LUM = relativeLuminance(248, 250, 252);
const NEAR_BLACK_LUM = relativeLuminance(15, 23, 42);

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an sRGB colour (0–255 channels). */
function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `#RRGGBB` → `"H S% L%"` (the format Tailwind's `hsl(var(--x))` expects). */
export function hexToHsl(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** The readable text colour (as an HSL triple) for text on `hex`. */
export function readableForeground(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const bg = relativeLuminance(...rgb);
  return contrastRatio(bg, NEAR_BLACK_LUM) >= contrastRatio(bg, NEAR_WHITE_LUM) ? NEAR_BLACK : NEAR_WHITE;
}

/** Apply a brand colour: primary, focus ring and a readable primary foreground. Returns false if `hex` is invalid. */
export function applyBrandColor(hex: string, root: HTMLElement = document.documentElement): boolean {
  const hsl = hexToHsl(hex);
  const fg = readableForeground(hex);
  if (!hsl || !fg) return false;
  root.style.setProperty('--primary', hsl);
  root.style.setProperty('--ring', hsl);
  root.style.setProperty('--primary-foreground', fg);
  return true;
}
