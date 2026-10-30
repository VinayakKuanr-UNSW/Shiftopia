/**
 * The one overlay anatomy, shared by Dialog, AlertDialog, Sheet, Drawer and
 * Popover. Root font is 75%, so sizes are px: title 17px, description 13px.
 *
 * - One scrim for every modal surface. It blurs: here blur *means* something
 *   (the page behind is dismissed), unlike on cards.
 * - One modal elevation step (shadow-xl); popovers sit one step lower (shadow-lg).
 * - Widths come from `dialogSizes`, never a per-dialog `max-w-[NNNpx]`.
 * - z-index stays per primitive: AlertDialog (200) must stack above a Dialog it
 *   was opened from, and Drawer (100) above the page chrome.
 */
export const overlayTokens = {
  scrim: 'bg-black/50 backdrop-blur-sm',
  surface: 'border border-border/60 bg-background text-foreground shadow-xl',
  dialogRadius: 'rounded-2xl',
  drawerRadius: 'rounded-t-3xl',
  popover: 'rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg',
  pad: 'p-6',
  header: 'flex flex-col gap-1.5 text-left',
  title: 'text-[17px] font-semibold leading-tight tracking-tight text-foreground',
  description: 'text-[13px] leading-relaxed text-muted-foreground',
  footer: 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
  /** 44×44 close target (WCAG 2.5.5); the glyph stays 18px. */
  close:
    'inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none',
} as const;

export const dialogSizes = {
  sm: 'sm:max-w-[400px]',
  md: 'sm:max-w-[480px]',
  lg: 'sm:max-w-[640px]',
  xl: 'sm:max-w-[880px]',
  '2xl': 'sm:max-w-[1040px]',
  /** Workspace-sized tools (AutoScheduler): up to 1400px, never past 95vw. */
  full: 'sm:max-w-[min(1400px,95vw)]',
} as const;

export type DialogSize = keyof typeof dialogSizes;
