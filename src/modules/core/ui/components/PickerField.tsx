/**
 * The one dropdown shape the Add Shift form uses (2026-10-25).
 *
 * Trigger: a field card — uppercase label on top, the value under it, chevron
 * on the right. Panel: the global scope selector's design — a search card, a
 * results card with a tick per row and ↵ hints, and the ↑↓ / ↵ / esc footer.
 *
 * SingleSelect, MultiSelect, EmployeeSelect and TemplateDaySelect each carried
 * their own copy of this markup, and the day picker had drifted to a third look.
 * They now compose these parts, so a change here reaches every dropdown in the
 * form.
 */
import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandList,
} from '@/modules/core/ui/primitives/command';

/** The trigger's surface and label, for cards that are not dropdowns (toggles, read-only values). */
export const FIELD_CARD =
    'flex items-center justify-between gap-3 px-4 py-2.5 min-h-14 w-full rounded-xl border border-border ' +
    'bg-white dark:bg-[#1c2333] shadow-lg shadow-black/5';
export const FIELD_LABEL =
    'text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none';

/** Text / time / number inputs and textareas beside the pickers: same surface, height and focus ring. */
export const FIELD_INPUT =
    'rounded-xl border-border bg-white dark:bg-[#1c2333] shadow-lg shadow-black/5 text-[13px] text-foreground ' +
    'focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-0';

export const PICKER_ROW =
    'flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all ' +
    'aria-selected:bg-indigo-600 aria-selected:text-white group ' +
    'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50';

interface PickerTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    required?: boolean;
    /** What the field holds, or the placeholder when `isEmpty`. */
    display: React.ReactNode;
    isEmpty?: boolean;
    isOpen: boolean;
    /** Shown before the chevron, e.g. an "N Eligible" badge. */
    adornment?: React.ReactNode;
}

export const PickerTrigger = React.forwardRef<HTMLButtonElement, PickerTriggerProps>(
    ({ label, required, display, isEmpty, isOpen, adornment, disabled, className, ...rest }, ref) => (
        <button
            ref={ref}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-required={required}
            className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-300',
                'border justify-between w-full h-14 border-border',
                'hover:scale-[1.01] active:scale-[0.99] relative z-20',
                isOpen && 'ring-2 ring-indigo-500 bg-indigo-500/5 shadow-indigo-500/20 border-indigo-400/80',
                disabled
                    ? 'bg-indigo-50/20 dark:bg-white/[0.02] text-slate-400 dark:text-white/40 cursor-not-allowed opacity-50'
                    : 'bg-white dark:bg-[#1c2333] text-slate-700 dark:text-white/80 hover:bg-indigo-50/50 dark:hover:bg-[#252d40] cursor-pointer shadow-lg shadow-black/5',
                className,
            )}
            {...rest}
        >
            <div className="flex flex-col items-start gap-0.5 min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                    {label}
                    {required && <span className="ml-1 text-rose-500 font-bold" aria-hidden="true">*</span>}
                </span>
                <span className={cn(
                    'truncate max-w-full text-[11px] sm:text-[13px] font-semibold',
                    isEmpty ? 'text-slate-500 dark:text-slate-400 font-normal' : 'text-slate-900 dark:text-slate-100',
                )}>
                    {display}
                </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {adornment}
                <ChevronDown
                    aria-hidden="true"
                    className={cn('w-3.5 h-3.5 text-slate-400 dark:text-white/40 transition-transform duration-200', isOpen && 'rotate-180')}
                />
            </div>
        </button>
    ),
);
PickerTrigger.displayName = 'PickerTrigger';

/** Round for one-of, square for any-of — the scope selector's convention. */
export const PickerTick: React.FC<{ on: boolean; shape?: 'circle' | 'square' }> = ({ on, shape = 'circle' }) => (
    <div
        aria-hidden="true"
        className={cn(
            'w-5 h-5 border flex items-center justify-center transition-all shrink-0',
            shape === 'circle' ? 'rounded-full' : 'rounded-md',
            on ? 'bg-white border-white text-indigo-600' : 'border-muted-foreground/30 group-aria-selected:border-white/40',
        )}
    >
        {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
    </div>
);

const KBD = 'px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans';

interface PickerPanelProps {
    heading: string;
    searchPlaceholder: string;
    emptyText: string;
    onClose: () => void;
    /** Footer verb for ↵ — "Select" for one-of, "Toggle" for any-of. */
    selectVerb?: string;
    /** Rows above the group, e.g. a summary line. */
    header?: React.ReactNode;
    children: React.ReactNode;
}

export const PickerPanel: React.FC<PickerPanelProps> = ({
    heading, searchPlaceholder, emptyText, onClose, selectVerb = 'Select', header, children,
}) => (
    <Command
        className="bg-transparent overflow-visible w-full outline-none"
        onKeyDown={(e) => {
            if (e.key === 'Escape') {
                onClose();
                e.preventDefault();
            }
        }}
    >
        <div className="flex flex-col gap-1.5 w-full">
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                <CommandInput
                    placeholder={searchPlaceholder}
                    className="h-14 text-[14px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                    autoFocus
                />
            </div>

            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                {header}
                <CommandList className="max-h-[300px] p-1.5 scrollbar-none overflow-x-hidden">
                    <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-[13px]">
                        {emptyText}
                    </CommandEmpty>
                    <CommandGroup heading={heading} className="px-1">
                        {children}
                    </CommandGroup>
                </CommandList>

                <div
                    aria-hidden="true"
                    className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-indigo-500/5 dark:border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] text-indigo-500/50 dark:text-muted-foreground/50"
                >
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><kbd className={KBD}>↑↓</kbd> NAV</span>
                        <span className="flex items-center gap-1"><kbd className={KBD}>↵</kbd> {selectVerb.toUpperCase()}</span>
                    </div>
                    <span className="flex items-center gap-1"><kbd className={KBD}>ESC</kbd> CLOSE</span>
                </div>
            </div>
        </div>
    </Command>
);

/**
 * Panel positioning shared by every picker: as wide as its trigger, and above
 * both the desktop drawer and the mobile bottom sheet (which sits at z-[200]).
 */
export const PICKER_CONTENT_CLASS =
    'w-[var(--radix-popover-trigger-width)] min-w-[18rem] border-none shadow-none p-0 bg-transparent overflow-visible z-[250] pointer-events-auto outline-none';
