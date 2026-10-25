import React, { useState, useEffect } from 'react';
import { Layers, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
    Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { ToolbarIconButton } from '@/modules/core/ui/components/Toolbar';
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';

/**
 * Generic over the grouping key so a page with its own keys (My Bids groups by
 * sub-department and sub-group name) uses this control instead of copying it.
 */
export interface GroupBySelectorOption<T extends string = RowGroupBy> {
    value: T;
    label: string;
}

interface GroupBySelectorProps<T extends string> {
    value: T;
    onChange: (value: T) => void;
    options: GroupBySelectorOption<T>[];
    className?: string;
    triggerVariant?: 'dropdown' | 'icon';
}

/**
 * Shared "Group By" control
 *
 * Implements the exact Global Scope Filter UI/UX:
 * - Floating glass trigger button with two-tier typography and rotating chevron OR icon trigger
 * - Detached popover with search bar container + floating card list with checkmarks
 * - Key navigation hints footer
 */
export function GroupBySelector<T extends string = RowGroupBy>({
    value,
    onChange,
    options,
    className,
    triggerVariant = 'dropdown',
}: GroupBySelectorProps<T>) {
    const { isDark } = useTheme();
    const [open, setOpen] = useState(false);
    const active = options.find(o => o.value === value);
    const isNone = value === 'none';

    // Handle keyboard escape
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    const trigger = triggerVariant === 'icon' ? (
        <PopoverTrigger asChild>
            <ToolbarIconButton
                icon={<Layers />}
                tooltip={`Group by: ${active ? active.label : 'None'}`}
                // Pressed = a grouping is applied (independent of the popover being open).
                aria-pressed={!isNone}
                variant="indigo"
                isActive={open || !isNone}
                className={className}
            />
        </PopoverTrigger>
    ) : (
        <PopoverTrigger asChild>
            <button
                type="button"
                aria-label={`Group by: ${active ? active.label : 'None'}`}
                aria-expanded={open}
                className={cn(
                    "relative flex items-center justify-between gap-2.5 h-11 md:h-10 px-3 md:px-3.5 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all duration-300",
                    "hover:scale-[1.02] active:scale-[0.98]",
                    open
                        ? "ring-2 ring-primary bg-primary/10 border-primary/40 text-primary shadow-primary/20"
                        : !isNone
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : isDark
                                ? "bg-[#111827]/60 border-white/5 text-white/70 hover:text-white hover:bg-[#111827]/80"
                                : "bg-slate-100 border-slate-200/50 text-muted-foreground hover:text-foreground hover:bg-slate-200",
                    className,
                )}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <Layers className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40 leading-none">
                            Group By
                        </span>
                        <span className="truncate max-w-[120px] text-xs font-semibold">
                            {active ? active.label : 'None'}
                        </span>
                    </div>
                </div>
                <ChevronDown className={cn(
                    "h-3 w-3 opacity-60 shrink-0 transition-transform duration-300",
                    open && "rotate-180"
                )} aria-hidden="true" />
            </button>
        </PopoverTrigger>
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            {trigger}

            <PopoverContent
                className="w-[280px] sm:w-[320px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
                sideOffset={10}
                align="end"
            >
                <Command
                    className="bg-transparent overflow-visible w-full outline-none"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setOpen(false);
                            e.preventDefault();
                        }
                    }}
                >
                    <div className="flex flex-col gap-1.5 w-full">
                        {/* Search Bar Container */}
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                            <CommandInput
                                placeholder="Search grouping..."
                                className="h-14 text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                autoFocus
                            />
                        </div>

                        {/* Results Container */}
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                            <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">
                                    No grouping found.
                                </CommandEmpty>

                                <CommandGroup heading="Group By" className="px-1">
                                    {options.map((opt) => {
                                        const isSelected = opt.value === value;
                                        return (
                                            <CommandItem
                                                key={opt.value}
                                                value={opt.label}
                                                onSelect={() => {
                                                    onChange(opt.value);
                                                    setOpen(false);
                                                }}
                                                className={cn(
                                                    "flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                                                    "aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                                                    isSelected
                                                        ? "bg-primary border-primary text-white group-aria-selected:bg-white group-aria-selected:text-primary group-aria-selected:border-white"
                                                        : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                )}>
                                                    {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                                </div>
                                                <span className="font-semibold text-sm capitalize">{opt.label}</span>
                                                <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            </CommandList>

                            {/* Keyboard footer */}
                            <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50">
                                <div className="flex items-center gap-4">
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↑↓</kbd> Nav
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↵</kbd> Select
                                    </span>
                                </div>
                                <span className="flex items-center gap-1">
                                    <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">esc</kbd> Close
                                </span>
                            </div>
                        </div>
                    </div>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

export default GroupBySelector;
