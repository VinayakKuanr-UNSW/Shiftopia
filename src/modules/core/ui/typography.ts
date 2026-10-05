/**
 * Typography scale.
 *
 * One place that decides how text looks, so a card, a drawer and a nav item
 * stop each inventing their own size. Before this existed the personal-roster
 * surface alone carried 45 hand-written `text-[9px]` / `text-[10px]` /
 * `text-[11px]` literals, most of them `font-black uppercase` and several
 * further faded with `/30`–`/40` opacity — unreadable on a phone and below the
 * WCAG 1.4.3 contrast floor once diluted.
 *
 * Rules encoded here:
 *
 *  1. **Nothing below 11px.** 11px is reserved for uppercase overlines, which
 *     are short, bold and letter-spaced. Anything a person actually reads is
 *     12px or more.
 *  2. **No opacity on muted text.** `text-muted-foreground` is already the
 *     designed low-emphasis colour and it passes 4.5:1 against both themes.
 *     `text-muted-foreground/40` does not, and it is not a design decision —
 *     it is contrast being thrown away. Use `subtle` when something must
 *     recede.
 *  3. **Weight carries hierarchy, not size alone.** `font-black` (900) at
 *     10px turns letterforms into blobs; the scale tops out at `font-bold`
 *     except for the display style.
 *  4. **Numbers are tabular.** Times, counts and durations must not reflow
 *     as they tick.
 *
 * Usage:
 *
 *   import { text, touch } from '@/modules/core/ui/typography';
 *
 *   <h2 className={text.title}>Shift Offers</h2>
 *   <p className={text.overline}>My Inbox</p>
 *   <button className={cn(text.label, touch.target)}>Accept</button>
 */

export const text = {
  /** Page or hero card heading. The only 900 weight in the system. */
  display: 'text-2xl font-black tracking-tight',

  /** Dialog, drawer and section titles. */
  title: 'text-lg font-bold tracking-tight',

  /** Sub-section heading inside a card or panel. */
  heading: 'text-base font-semibold tracking-tight',

  /** Default reading size for content. */
  body: 'text-sm font-medium',

  /** Content that is present but secondary — never opacity-faded. */
  bodyMuted: 'text-sm font-medium text-muted-foreground',

  /** Field labels, chips, and the text inside buttons. */
  label: 'text-xs font-semibold tracking-wide',

  /**
   * Uppercase overline / eyebrow. The floor of the scale at 11px — legible
   * only because it is bold, spaced and never more than a few words.
   */
  overline: 'text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground',

  /** Same as `overline` but inheriting colour, for coloured contexts. */
  overlineBare: 'text-[11px] font-bold uppercase tracking-[0.12em]',

  /** Supporting sentence under a heading. */
  caption: 'text-xs font-medium text-muted-foreground',

  /** The one legitimate recessive style — for genuinely tertiary text. */
  subtle: 'text-xs font-medium text-muted-foreground/70',

  /** Clock times, counts, durations. Tabular so ticking digits do not jump. */
  metric: 'text-sm font-semibold tabular-nums',

  /** Monospaced numeric, for countdowns and time ranges. */
  metricMono: 'text-sm font-semibold font-mono tabular-nums',
} as const;

/**
 * Interactive sizing.
 *
 * WCAG 2.5.5 (AAA) asks for 44×44 CSS px; WCAG 2.5.8 (AA, 2.2) sets 24×24 as
 * the floor. Touch surfaces here target 44 — the bottom nav, the offers FAB and
 * the roster navigator all sat between 32 and 40 before, which is a miss on a
 * phone regardless of which level you hold it to.
 */
export const touch = {
  /** Minimum tappable box. Apply to any control a thumb has to hit. */
  target: 'min-h-11 min-w-11',
  /** For controls in a horizontal bar where only height is constrained. */
  targetY: 'min-h-11',
} as const;

export type TextStyle = keyof typeof text;
