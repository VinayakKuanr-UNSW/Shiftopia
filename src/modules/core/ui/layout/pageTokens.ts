/**
 * Page-structure tokens.
 *
 * Every workspace page is the same stack — header card, body, optional
 * footer — inside one gutter. Before these existed each page chose its own
 * gutter and its own header→body gap, so the same header card sat ~16px above
 * its body on Rosters, ~24px on the GoldStandardHeader pages and ~35px on
 * Templates.
 *
 * PageLayout is the intended consumer. A page that has not moved onto it yet
 * may borrow these strings, but must not restate the values.
 */

export const page = {
  /** Fills <main> and stacks the regions; nothing scrolls at this level. */
  root: 'h-full flex flex-col overflow-hidden',

  /**
   * Outer gutter. On phones the bottom also clears the floating nav (the
   * variable lives in index.css) — without it the last row sits underneath
   * the nav and cannot be reached.
   */
  gutter: 'p-4 pb-[calc(var(--mobile-bottom-nav-clearance,90px)+0.75rem)] md:pb-4 lg:p-6',

  /** The one gap between header, body and footer — 16px at every width. */
  gap: 'gap-4',

  /**
   * Space between a body card's edge and its content, where the card pads its
   * own content. Pages ran from `p-4 lg:p-6` to `p-6 lg:p-10`; this is the
   * header card's inset, so content lines up under the title.
   */
  bodyInset: 'p-4 lg:p-6',
} as const;

export const surface = {
  /**
   * Glass card behind the page header. Rosters, Templates and
   * GoldStandardHeader each hand-wrote this; the `dark:` pairs render the
   * same as the old `isDark` branches without a theme subscription.
   */
  headerCard:
    'rounded-[32px] p-4 lg:p-6 border relative overflow-hidden transition-all bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50 dark:bg-[#1c2333]/40 dark:border-white/5 dark:shadow-2xl dark:shadow-black/20 dark:backdrop-blur-xl',

  /**
   * Glass card behind a page body. Fourteen pages wrote this as an `isDark`
   * branch; Rosters, Leave, Insights, Compliance and Settings each drifted
   * (opacity, radius 24/28, border tokens).
   *
   * Dark mode has NO backdrop filter, as the common card never had one — and
   * `backdrop-filter-none`, not `backdrop-blur-none`: the latter is blur(0),
   * which still makes the card the containing block for `position: fixed`
   * children (a FAB or toolbar inside it would pin to the card, not the screen).
   */
  bodyCard:
    'rounded-[32px] border transition-all bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50 dark:bg-[#1c2333]/40 dark:border-white/5 dark:shadow-2xl dark:shadow-black/20 dark:backdrop-filter-none',

  /**
   * The bar a page footer sits in — 56px, full width of the body above it.
   * The Roster metrics footer is the reference; the attendance scorecard, the
   * roster filter bar and pagination each restated it with small drifts.
   */
  footerBar:
    'h-14 w-full flex items-center justify-between gap-2 px-2.5 sm:px-3 rounded-2xl border shadow-sm backdrop-blur-md bg-white/95 border-slate-300 dark:bg-[#1c2333]/85 dark:border-white/5',
} as const;
