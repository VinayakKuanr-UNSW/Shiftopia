import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { FacetedLoadingSpinner } from '@/modules/core/ui/components/FacetedLoadingSpinner';
import { cn } from '@/modules/core/lib/utils';

/**
 * Function-bar primitives: the row under the Global Scope filter.
 *
 *   Zone 1 — views   (List / Card, Group / People / …)  left, on the scope row's left edge
 *   Zone 2 — modes   (DAY · 3D · WEEK · MONTH, TODAY, ‹ date ›)
 *   Zone 3 — actions (icon buttons)                      right, on the scope row's right edge
 *
 * Zones keep their own widths — they are not mirrored — and `justify-between`
 * makes the space zone 1→2 equal to zone 2→3. A missing zone still holds its
 * slot on desktop, so the date picker does not jump left on a page with no
 * views toggle.
 *
 * Before this, five bars each restated the row: two indented it 16px with
 * `px-4` (zone 1 sat inside the scope row's edge), one stacked it with
 * `flex-col gap-3`, and buttons in zone 3 ranged from 32 to 48px.
 */

/*
 * Units. The app's root font size is 75% (index.css), so 1rem is 12px and the
 * Tailwind scale is three-quarters of its nominal size: `h-11` is 33px, not 44,
 * and `text-[11px]` is 9px. The desktop pills below keep the rem classes the Roster
 * Planner was designed in (that look is the reference). Anything that is a
 * physical minimum — a 44px touch target, the 11px type floor, iOS's 16px
 * no-zoom input size — is written in px so it means what it says.
 */
export const toolbar = {
  /** The Roster Planner's row height (h-16) is the reference. */
  row: 'relative w-full min-h-16 py-2 md:h-16 md:py-0 flex flex-wrap md:flex-nowrap items-center justify-center md:justify-between gap-2',
  rowCompact: 'min-h-0 py-0 gap-1.5 md:gap-2',
  /** Only for a bar rendered outside a header card — the row as its own strip. */
  standalone: 'px-4 bg-white/90 dark:bg-slate-950/40 backdrop-blur-2xl border-b border-slate-200 dark:border-white/10 shadow-sm dark:shadow-2xl',
  zone: 'w-full md:w-auto flex-shrink-0 flex items-center',
  /** Zone 3 scrolls sideways on a phone; children keep their tap target. */
  actions: 'w-full md:w-auto flex items-center justify-between md:justify-start gap-1.5 overflow-x-auto scrollbar-none [&>*]:shrink-0 md:overflow-x-visible',
  actionsCompact: 'gap-1 md:gap-1.5',
  /**
   * Zone 1–2 pill (views toggle, DAY·3D·WEEK·MONTH, TODAY). From `md` it is
   * the Roster navigator's pill (h-10, options h-8). On a phone every option
   * is a real 44px thumb target and the pill grows to hold it. Every pill in
   * every bar takes this, so views, modes and the employee range line up.
   */
  control: 'flex shrink-0 items-center bg-slate-100 dark:bg-black/20 border border-slate-300 dark:border-white/5 rounded-xl p-0.5 md:h-10 md:p-1 shadow-sm',
  /** One option inside a `control` pill: 44px on a phone, h-8 from `md`. */
  controlItem: 'h-[44px] md:h-8 min-w-9 px-2.5 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all border-none shadow-none',
  /** A mode (zone 2) that is on: filled. A view (zone 1) that is on is quieter — see `segment`. */
  modeOn: 'bg-primary text-primary-foreground',
  modeOff: 'text-slate-700 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground hover:bg-slate-200/60 dark:hover:bg-muted/30',
  /**
   * A mode option driven by Radix `data-state`. The `dark:` on-colour is
   * needed: `dark:text-muted-foreground` (off) and `data-[state=on]:…` have the
   * same specificity, so in dark mode the off colour won and a selected MONTH
   * read as muted text on the filled pill.
   */
  modeOnByState: 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground dark:data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary',
  /** The ‹ date › stepper beside the mode pill. */
  stepper: 'flex shrink-0 items-center gap-1 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-xl p-0.5 md:h-10 md:px-1.5 shadow-sm dark:shadow-none',
  stepperButton:
    'h-[44px] w-[44px] md:h-8 md:w-8 flex items-center justify-center rounded-lg transition-all text-slate-700 dark:text-muted-foreground hover:text-slate-950 dark:hover:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 disabled:cursor-not-allowed',
  stepperLabel:
    'h-[44px] md:h-8 inline-flex items-center gap-2 whitespace-nowrap px-2.5 text-[11px] font-bold tabular-nums text-slate-800 dark:text-foreground hover:text-slate-950 dark:hover:text-foreground hover:bg-slate-100 dark:hover:bg-muted/50 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  /** A single zone-2 control (period select, date range, date input): the stepper's surface. */
  field: 'inline-flex shrink-0 items-center gap-2 h-[44px] md:h-10 px-3 rounded-xl border bg-white border-slate-300 dark:bg-white/5 dark:border-white/10 text-[11px] font-bold tabular-nums text-foreground shadow-sm dark:shadow-none hover:bg-slate-50 dark:hover:bg-white/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  segmented: 'w-full md:w-auto flex shrink-0 items-center bg-slate-100 dark:bg-black/20 border border-slate-300 dark:border-white/5 rounded-xl p-0.5 md:h-10 md:p-1 shadow-sm',
  segment:
    'flex-1 md:flex-none h-[44px] md:h-8 min-w-9 px-2.5 text-[11px] font-bold uppercase tracking-wider rounded-lg data-[state=on]:bg-white dark:data-[state=on]:bg-white/10 data-[state=on]:text-slate-900 dark:data-[state=on]:text-foreground data-[state=on]:shadow-sm text-slate-700 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground transition-all border-none shadow-none',
  /** Zone 3 search field: 44px, grows to fill the space the zone has. */
  search: 'flex min-w-[12rem] flex-1 md:flex-none md:w-64 items-center gap-2 h-[44px] px-3 rounded-xl border bg-slate-100 border-slate-200 dark:bg-black/20 dark:border-white/5 focus-within:ring-2 focus-within:ring-ring',
  /** 16px on a phone: iOS Safari zooms the page into a focused input under 16px. */
  searchInput: 'w-full min-w-0 h-full bg-transparent border-none p-0 text-[16px] md:text-[11px] font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0',
  /** Zone 3 labelled actions — the label style matches the pills' (11px, bold, uppercase). */
  primaryAction:
    'inline-flex shrink-0 items-center justify-center gap-2 h-[44px] px-4 rounded-xl text-[11px] font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:pointer-events-none',
  secondaryAction:
    'inline-flex shrink-0 items-center justify-center gap-2 h-[44px] px-3.5 rounded-xl text-[11px] font-bold uppercase tracking-wider border bg-white border-slate-300 text-slate-700 hover:bg-slate-100 dark:bg-white/5 dark:border-white/10 dark:text-foreground dark:hover:bg-white/10 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:pointer-events-none',
  /** A secondary action that toggles (Bulk Mode, Edit) while it is on. */
  secondaryActionOn: 'bg-primary/15 border-primary/30 text-primary hover:bg-primary/20 dark:bg-primary/15 dark:border-primary/30 dark:text-primary dark:hover:bg-primary/20',
  /** A real 44px box (WCAG 2.5.5), as the Roster bar's `min-h-[44px]` button always was. */
  iconButton:
    'h-[44px] w-[44px] flex items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  tooltip: 'text-[11px] uppercase font-extrabold tracking-wider bg-slate-900 border border-slate-700 text-white shadow-xl px-2.5 py-1 rounded-md',
} as const;

/* ── Row ─────────────────────────────────────────────────────────────────── */

export interface ToolbarRowProps {
  views?: React.ReactNode;
  modes?: React.ReactNode;
  actions?: React.ReactNode;
  /** Tighten heights and gaps below `md` so the row fits a phone. */
  compactOnMobile?: boolean;
  /**
   * Names the row for assistive tech, as a labelled group. Never role=toolbar:
   * that promises arrow-key movement between the controls, which the row does
   * not implement — each control is its own tab stop.
   */
  ariaLabel?: string;
  className?: string;
}

export const ToolbarRow: React.FC<ToolbarRowProps> = ({
  views,
  modes,
  actions,
  compactOnMobile = false,
  ariaLabel,
  className,
}) => (
  <div
    role={ariaLabel ? 'group' : undefined}
    aria-label={ariaLabel}
    className={cn(toolbar.row, compactOnMobile && toolbar.rowCompact, className)}
  >
    {/* An empty zone still holds its slot on desktop but takes no row on a phone. */}
    <div className={cn(toolbar.zone, 'justify-start', !views && 'hidden md:flex')}>{views}</div>
    <div className={cn(toolbar.zone, 'justify-center', !modes && 'hidden md:flex')}>{modes}</div>
    <div className={cn(toolbar.zone, 'justify-end', !actions && 'hidden md:flex')}>
      {actions && (
        <div className={cn(toolbar.actions, compactOnMobile && toolbar.actionsCompact)}>{actions}</div>
      )}
    </div>
  </div>
);

/* ── Zone 1: segmented views toggle ─────────────────────────────────────── */

export interface ToolbarSegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  /** Shown after the label when above 0 (e.g. pending requests). */
  count?: number;
}

export interface ToolbarSegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<ToolbarSegmentedOption<T>>;
  /** Accessible name per option. */
  itemAriaLabel?: (label: string) => string;
  /**
   * Breakpoint from which the text label shows next to the icon. Switches of
   * three options or fewer always show their labels — on a phone the control
   * spans the full width, so there is room, and icon-only tabs are guesswork.
   */
  labelFrom?: 'sm' | '2xl';
  /** Accessible name of the whole switch (e.g. "Settings section"); used by the phone select. */
  label?: string;
  className?: string;
}

export function ToolbarSegmented<T extends string>({
  value,
  onValueChange,
  options,
  itemAriaLabel = (label) => `${label} view`,
  labelFrom = 'sm',
  label = 'View',
  className,
}: ToolbarSegmentedProps<T>) {
  // Four or more icon options cannot carry labels on a phone, and icon-only
  // tabs are guesswork — so below `sm` they become one native select that
  // names the current choice. Wider screens keep the segmented row.
  const asSelectOnPhone = labelFrom === 'sm' && options.length > 3;
  return (
    <>
    {asSelectOnPhone && (
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value as T)}
        className={cn(toolbar.segmented, 'h-[48px] w-full px-4 text-[16px] font-semibold text-foreground sm:hidden')}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}{o.count ? ` (${o.count})` : ''}
          </option>
        ))}
      </select>
    )}
    <div className={cn(toolbar.segmented, asSelectOnPhone && 'hidden sm:flex', className)}>
      <ToggleGroup
        type="single"
        value={value}
        // Radix reports '' when the active item is clicked again; a views
        // toggle always has exactly one view, so that click is ignored.
        onValueChange={(v) => v && onValueChange(v as T)}
        className="flex items-center gap-0.5 w-full md:w-auto"
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o.id}
            value={o.id}
            aria-label={itemAriaLabel(o.label)}
            className={toolbar.segment}
          >
            <div className="flex items-center justify-center gap-2">
              {o.icon}
              <span className={labelFrom === '2xl' ? 'hidden 2xl:inline' : options.length <= 3 ? 'inline' : 'hidden sm:inline'}>{o.label}</span>
              {!!o.count && (
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                  {o.count}
                </span>
              )}
            </div>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
    </>
  );
}

/* ── Zone 3: icon button ─────────────────────────────────────────────────── */

export type ToolbarIconButtonVariant =
  | 'default' | 'primary' | 'blue' | 'purple' | 'indigo' | 'emerald' | 'amber' | 'sky'
  | 'rose' | 'success' | 'warning' | 'danger' | 'ghost';

export interface ToolbarIconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  icon: React.ReactNode;
  /** Also the accessible name — the button has no visible text. */
  tooltip: string;
  isActive?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  variant?: ToolbarIconButtonVariant;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * Corner count, rendered inside the button so it still works as the direct
   * child of a Popover/Dropdown trigger. Hidden when 0 or absent.
   */
  badge?: number;
  /** Badge colour; the button variant's own tone by default. */
  badgeClassName?: string;
}

// Spelled out per colour, not interpolated: Tailwind only emits classes it can
// find as literal strings in the source.
const VARIANTS: Record<ToolbarIconButtonVariant, { on: string; off: string }> = {
  default: {
    on: 'bg-slate-200 dark:bg-white/20 text-slate-900 dark:text-white font-bold shadow-sm',
    off: 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10',
  },
  /** Neutral at rest, the theme's primary when active (Grid's member filter). */
  primary: {
    on: 'bg-primary/20 text-primary font-bold border border-primary/30 shadow-sm',
    off: 'text-slate-600 dark:text-slate-300 hover:text-foreground hover:bg-slate-100 dark:hover:bg-white/10',
  },
  blue: {
    on: 'bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold border border-blue-500/30',
    off: 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/20',
  },
  purple: {
    on: 'bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold border border-purple-500/30',
    off: 'text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/20',
  },
  indigo: {
    on: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-500/30',
    off: 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/20',
  },
  emerald: {
    on: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-500/30',
    off: 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/20',
  },
  success: {
    on: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-500/30',
    off: 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/20',
  },
  amber: {
    on: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/30',
    off: 'text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/20',
  },
  warning: {
    on: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/30',
    off: 'text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/20',
  },
  sky: {
    on: 'bg-sky-500/20 text-sky-700 dark:text-sky-300 font-bold border border-sky-500/30',
    off: 'text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20',
  },
  rose: {
    on: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold border border-rose-500/30',
    off: 'text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20',
  },
  danger: {
    on: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold border border-rose-500/30',
    off: 'text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20',
  },
  ghost: {
    on: 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10',
    off: 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10',
  },
};

/**
 * The one icon button for zone 3. Forwards its ref and extra props, so it can
 * be the child of a `PopoverTrigger asChild` / `DropdownMenuTrigger asChild`
 * and still keep its tooltip, size and focus ring.
 *
 * aria-disabled, not `disabled`: a natively disabled button leaves the tab
 * order and (in most browsers) gets no pointer events, so its tooltip — the
 * only place that says WHY it is off ("select a department first", view-only)
 * — could never be reached by keyboard. The click is swallowed instead.
 */
export const ToolbarIconButton = React.forwardRef<HTMLButtonElement, ToolbarIconButtonProps>(
  (
    {
      icon,
      tooltip,
      onClick,
      isActive,
      isLoading,
      disabled,
      variant = 'default',
      className,
      tooltipSide = 'bottom',
      badge,
      badgeClassName = 'bg-primary text-primary-foreground',
      type = 'button',
      ...rest
    },
    ref,
  ) => {
    const inert = disabled || isLoading;
    const tones = VARIANTS[variant] ?? VARIANTS.default;
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={ref}
              type={type}
              aria-label={tooltip}
              aria-pressed={isActive}
              {...rest}
              // The event is forwarded: a trigger parent (Popover/Dropdown)
              // merges its own handler into onClick and reads defaultPrevented.
              onClick={(e) => {
                if (inert) { e.preventDefault(); return; }
                onClick?.(e);
              }}
              aria-disabled={inert || undefined}
              className={cn(
                toolbar.iconButton,
                badge ? 'relative' : undefined,
                isActive ? tones.on : tones.off,
                disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent text-slate-400 dark:text-slate-600',
                className,
              )}
            >
              {isLoading ? (
                <FacetedLoadingSpinner size="sm" />
              ) : React.isValidElement(icon) ? (
                React.cloneElement(icon as React.ReactElement<{ className?: string; 'aria-hidden'?: string }>, {
                  'aria-hidden': 'true',
                  className: cn('h-5 w-5', (icon as React.ReactElement<{ className?: string }>).props?.className),
                })
              ) : (
                icon
              )}
              {badge ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full text-[11px] font-bold leading-none shadow-sm pointer-events-none',
                    badgeClassName,
                  )}
                >
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} className={toolbar.tooltip}>
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);
ToolbarIconButton.displayName = 'ToolbarIconButton';
