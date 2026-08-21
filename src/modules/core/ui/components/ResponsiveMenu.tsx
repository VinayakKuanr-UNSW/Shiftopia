import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { text, touch } from '@/modules/core/ui/typography';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/modules/core/ui/primitives/drawer';

/**
 * One control, two presentations: a dropdown on desktop, a bottom sheet on a
 * phone.
 *
 * Every page had been solving this separately — a Popover that spilled off a
 * 390px viewport here, a bespoke Drawer there, a Command palette with an
 * autofocused search box on a device that answers focus with a keyboard.
 * `ResponsiveMenu` is the one place the choice is made, so a page declares
 * *what* the control does and never *how* it opens.
 *
 * Accessibility, in one place rather than eleven:
 *  - the trigger is a real button carrying `aria-haspopup`, `aria-expanded`
 *    and an accessible name that includes the current value, so "Sort, by
 *    start time" is spoken without opening anything;
 *  - the surface is a dialog on mobile and a labelled group on desktop, both
 *    named by `title`, so a screen reader announces what just opened;
 *  - the trigger meets the 44px target floor on touch.
 */

export interface ResponsiveMenuProps {
  /** Short control name — "Sort", "Filter", "Group By". Also labels the sheet. */
  title: string;
  /**
   * Current selection. Deliberately NOT painted on the trigger: three controls
   * each carrying a two-line label made the bar shout its own settings back at
   * you and left no room for anything else. It still goes into the accessible
   * name, so a screen-reader user hears "Sort, Date, earliest first" and is not
   * worse off than a sighted one — and since that name starts with the visible
   * word, voice control still matches it (WCAG 2.5.3 Label in Name).
   */
  value?: string;
  /** Whether the control is currently doing something — drives the highlight. */
  active?: boolean;
  /** Leading glyph. Decorative — the accessible name comes from `title`/`value`. */
  icon?: React.ReactNode;
  /** Count of active selections; renders as a badge and marks the control on. */
  activeCount?: number;
  /** Sheet/dropdown body. Receives `close` so an option can dismiss the menu. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** One line of context for screen readers describing what the menu controls. */
  description?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
}

export const ResponsiveMenu: React.FC<ResponsiveMenuProps> = ({
  title,
  value,
  icon,
  active,
  activeCount = 0,
  children,
  description,
  align = 'start',
  className,
  contentClassName,
  disabled,
}) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const isActive = active ?? activeCount > 0;

  const body = typeof children === 'function' ? children(close) : children;

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup={isMobile ? 'dialog' : 'menu'}
      aria-expanded={open}
      aria-label={value ? `${title}: ${value}` : title}
      className={cn(
        touch.targetY,
        'group flex w-full items-center justify-center gap-2 rounded-xl border px-3 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        open || isActive
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border bg-background/60 text-foreground hover:bg-muted/50',
        className,
      )}
    >
      {icon && (
        <span className="shrink-0 opacity-80" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="truncate text-xs font-semibold uppercase tracking-wide" aria-hidden="true">
        {title}
      </span>
      {activeCount > 0 && (
        <span
          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-none text-primary-foreground tabular-nums"
          aria-hidden="true"
        >
          {activeCount}
        </span>
      )}
      <ChevronDown
        className={cn('h-3.5 w-3.5 shrink-0 opacity-50 transition-transform', open && 'rotate-180')}
        aria-hidden="true"
      />
    </button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        {/* vaul's DrawerTrigger clones its child; rendering the button directly
            keeps one element rather than nesting two interactive nodes. */}
        {React.cloneElement(trigger, { onClick: () => setOpen(true) })}
        {/* Same bottom-sheet language as the Global Scope filter: grab handle,
            icon-led title, 2.5rem radius, blurred background. */}
        <DrawerContent className="flex max-h-[85dvh] flex-col rounded-t-[2.5rem] border-t-0 bg-background/95 p-0 backdrop-blur-2xl">
          <div className="mx-auto my-4 h-1.5 w-12 shrink-0 rounded-full bg-muted/60" aria-hidden="true" />
          <DrawerHeader className="shrink-0 px-6 pb-4 pt-0 text-left">
            <DrawerTitle className="flex items-center gap-3 text-2xl font-black">
              {icon && (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
                  {icon}
                </span>
              )}
              {title}
            </DrawerTitle>
            <DrawerDescription className="mt-1 text-sm font-medium text-muted-foreground">
              {description ?? `Choose a ${title.toLowerCase()} option.`}
            </DrawerDescription>
          </DrawerHeader>
          <div className={cn('flex-1 overflow-y-auto px-6 pb-10', contentClassName)}>
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* Detached card, matching the Global Scope dropdown: transparent shell,
          one floating rounded-2xl surface, keyboard hints along the bottom. */}
      <PopoverContent
        align={align}
        sideOffset={10}
        aria-label={title}
        className="w-auto min-w-[240px] border-none bg-transparent p-0 shadow-none outline-none"
      >
        <div
          className={cn(
            'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] dark:border-white/10 dark:bg-[#1a2333]',
            'animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200',
            contentClassName,
          )}
        >
          <div className="p-1.5">{body}</div>
          <div className="flex items-center gap-4 border-t border-primary/5 bg-indigo-50/50 p-3 text-[10px] font-bold uppercase tracking-[0.16em] text-primary/60 dark:border-white/5 dark:bg-muted/20 dark:text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-primary/10 bg-white/80 px-1 py-0.5 dark:border-border/40 dark:bg-background/50">↑↓</kbd>
              Nav
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-primary/10 bg-white/80 px-1 py-0.5 dark:border-border/40 dark:bg-background/50">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-primary/10 bg-white/80 px-1 py-0.5 dark:border-border/40 dark:bg-background/50">esc</kbd>
              Close
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/**
 * A single choice inside a `ResponsiveMenu`.
 *
 * Rendered as a `menuitemradio` so the set reads as "one of N selected"
 * rather than as a pile of unrelated buttons, and sized for a thumb.
 */
export const ResponsiveMenuOption: React.FC<{
  label: string;
  selected: boolean;
  onSelect: () => void;
  hint?: string;
}> = ({ label, selected, onSelect, hint }) => (
  <button
    type="button"
    role="menuitemradio"
    aria-checked={selected}
    onClick={onSelect}
    className={cn(
      touch.targetY,
      'group mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted/60',
    )}
  >
    {/* Decorative — the state is already carried by aria-checked. */}
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
        selected ? 'border-white bg-white text-primary' : 'border-muted-foreground/30',
      )}
      aria-hidden="true"
    >
      {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold">{label}</span>
      {hint && (
        <span className={cn('block truncate text-xs', selected ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {hint}
        </span>
      )}
    </span>
  </button>
);

/** Section heading inside a menu body. */
export const ResponsiveMenuGroup: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div role="group" aria-label={label} className="px-1 py-1">
    <p className={cn(text.overline, 'px-2 pb-1.5')}>{label}</p>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
);

export default ResponsiveMenu;
