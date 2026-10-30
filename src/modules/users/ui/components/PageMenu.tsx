/**
 * The Users page's dropdowns, in the global scope selector's design
 * (2026-10-17): a white / #1a2333 card with the soft drop shadow, roomy rounded
 * rows that turn primary when highlighted, round ticks for one-of choices, the
 * ↵ hint on each row and the ↑↓ / ↵ / esc footer. The several-of picker
 * (Columns) is in ColumnsPicker, built on the same Command list as the scope
 * selector itself.
 *
 * Built on Radix menus, so they keep what a menu button owes a keyboard and a
 * screen reader: role menu / menuitem / menuitemradio, arrow keys, Enter,
 * Escape, and focus back on the button that opened it.
 */
import React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

/** The scope selector's results card. */
export const DESIGN_CARD =
    'bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden';

const ROW =
    'group flex items-center gap-3 px-4 py-3 rounded-xl mb-1 last:mb-0 cursor-pointer select-none outline-none transition-all ' +
    'font-semibold text-sm sm:text-base text-foreground ' +
    'data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

const SHORTCUT = 'ml-auto pl-3 text-xs tracking-widest text-muted-foreground group-data-[highlighted]:text-white/60';
const ICON = 'shrink-0 text-muted-foreground group-data-[highlighted]:text-white [&_svg]:h-4 [&_svg]:w-4';

const KBD = 'px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit';

/** The ↑↓ Nav · ↵ Select · esc Close footer every picker in the design carries. */
export const KeyHints: React.FC<{ select?: string }> = ({ select = 'Select' }) => (
    <div
        aria-hidden="true"
        className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between gap-4 text-[9px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50"
    >
        <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><kbd className={KBD}>↑↓</kbd> Nav</span>
            <span className="flex items-center gap-1"><kbd className={KBD}>↵</kbd> {select}</span>
        </div>
        <span className="flex items-center gap-1"><kbd className={KBD}>esc</kbd> Close</span>
    </div>
);

export const PageMenu = Menu.Root;
export const PageMenuTrigger = Menu.Trigger;
export const PageMenuRadioGroup = Menu.RadioGroup;

interface PageMenuContentProps extends React.ComponentPropsWithoutRef<typeof Menu.Content> {
    /** The small heading over the rows, as the scope selector's list has. */
    heading?: string;
}

export const PageMenuContent = React.forwardRef<React.ElementRef<typeof Menu.Content>, PageMenuContentProps>(
    ({ heading, children, className, sideOffset = 10, collisionPadding = 16, ...props }, ref) => (
        <Menu.Portal>
            <Menu.Content
                ref={ref}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={cn(
                    DESIGN_CARD,
                    'z-50 min-w-[17.5rem] text-foreground',
                    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2',
                    'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
                    className,
                )}
                {...props}
            >
                <div className="max-h-[50vh] overflow-y-auto overflow-x-hidden p-1.5">
                    <div className="p-1">
                        {heading && <Menu.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{heading}</Menu.Label>}
                        {children}
                    </div>
                </div>
                <KeyHints />
            </Menu.Content>
        </Menu.Portal>
    ),
);
PageMenuContent.displayName = 'PageMenuContent';

interface PageMenuItemProps extends React.ComponentPropsWithoutRef<typeof Menu.Item> {
    icon?: React.ReactNode;
    /** A destructive action: red, and red when highlighted. */
    danger?: boolean;
}

export const PageMenuItem = React.forwardRef<React.ElementRef<typeof Menu.Item>, PageMenuItemProps>(
    ({ icon, danger = false, children, className, ...props }, ref) => (
        <Menu.Item
            ref={ref}
            className={cn(
                ROW,
                danger && 'text-red-600 dark:text-red-400 data-[highlighted]:bg-destructive data-[highlighted]:text-destructive-foreground',
                className,
            )}
            {...props}
        >
            {icon && <span className={cn(ICON, danger && 'text-current')} aria-hidden="true">{icon}</span>}
            <span>{children}</span>
            <span className={SHORTCUT} aria-hidden="true">↵</span>
        </Menu.Item>
    ),
);
PageMenuItem.displayName = 'PageMenuItem';

interface PageMenuRadioItemProps extends React.ComponentPropsWithoutRef<typeof Menu.RadioItem> {
    /** Whether this is the current choice (draws the filled circle, as CommandSelector does). */
    checked: boolean;
}

/** A one-of choice: the round tick of the design's single-select lists. */
export const PageMenuRadioItem = React.forwardRef<React.ElementRef<typeof Menu.RadioItem>, PageMenuRadioItemProps>(
    ({ checked, children, className, ...props }, ref) => (
        <Menu.RadioItem ref={ref} className={cn(ROW, className)} {...props}>
            <span
                aria-hidden="true"
                className={cn(
                    'w-5 h-5 rounded-full border flex items-center justify-center transition-all shrink-0',
                    checked
                        ? 'bg-primary border-primary text-primary-foreground group-data-[highlighted]:bg-white group-data-[highlighted]:border-white group-data-[highlighted]:text-primary'
                        : 'border-muted-foreground/30 group-data-[highlighted]:border-white/40',
                )}
            >
                {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
            </span>
            <span>{children}</span>
            <span className={SHORTCUT} aria-hidden="true">↵</span>
        </Menu.RadioItem>
    ),
);
PageMenuRadioItem.displayName = 'PageMenuRadioItem';

export const PageMenuSeparator: React.FC = () => <Menu.Separator className="my-1 h-px bg-slate-200 dark:bg-white/10" />;

export const PageMenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Menu.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{children}</Menu.Label>
);
