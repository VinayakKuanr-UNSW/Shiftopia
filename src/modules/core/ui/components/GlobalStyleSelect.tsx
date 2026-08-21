import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Lock } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
} from '@/modules/core/ui/primitives/command';

export interface GlobalStyleSelectOption {
    id: string;
    name: string;
    description?: string;
    icon?: React.ReactNode;
    disabled?: boolean;
}

export interface GlobalStyleSelectProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: GlobalStyleSelectOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    icon?: React.ReactNode;
    disabled?: boolean;
    locked?: boolean;
    className?: string;
    popoverWidth?: string;
    showSearch?: boolean;
    compact?: boolean;
}

/**
 * GlobalStyleSelect
 *
 * Universal dropdown select component that shares the exact premium UI/UX
 * design language of the GlobalScopeFilter:
 * - Floating glass card trigger with two-tier typography and rotating chevron
 * - Detached popover with glassmorphic command search bar
 * - Rounded floating result card with checkmarks and keyboard navigation footer
 */
export const GlobalStyleSelect: React.FC<GlobalStyleSelectProps> = ({
    label,
    value,
    onChange,
    options,
    placeholder = 'Select option',
    searchPlaceholder,
    icon,
    disabled = false,
    locked = false,
    className,
    popoverWidth,
    showSearch = true,
    compact = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const isDisabled = locked || disabled;

    const selectedOption = useMemo(() => {
        return options.find(opt => opt.id === value);
    }, [options, value]);

    const displayText = selectedOption?.name || placeholder;

    // Handle keyboard escape
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button
                    className={cn(
                        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300",
                        "border-0 min-w-[140px] sm:min-w-[180px] justify-between w-full",
                        compact ? "h-11 py-2" : "h-14",
                        "hover:scale-[1.02] active:scale-[0.98] relative z-50",
                        isOpen ? "ring-2 ring-primary bg-primary/5 shadow-primary/20" : "",
                        isDisabled
                            ? "bg-indigo-50/20 dark:bg-white/[0.02] text-slate-400 dark:text-white/40 cursor-not-allowed opacity-50"
                            : "bg-white dark:bg-[#1c2333] text-slate-700 dark:text-white/80 hover:bg-indigo-50/50 dark:hover:bg-[#252d40] cursor-pointer shadow-lg shadow-black/5",
                        className
                    )}
                    disabled={isDisabled}
                    type="button"
                    aria-label={`${label}: ${displayText}`}
                    aria-expanded={isOpen}
                >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {icon && (
                            <div className="text-primary/70 shrink-0 flex items-center justify-center">
                                {icon}
                            </div>
                        )}
                        <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                                {label}
                            </span>
                            <span className="truncate max-w-[180px] sm:max-w-[240px] text-xs sm:text-sm font-semibold">
                                {displayText}
                            </span>
                        </div>
                    </div>
                    {locked ? (
                        <Lock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400/60 flex-shrink-0" />
                    ) : (
                        <ChevronDown className={cn(
                            "w-3.5 h-3.5 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform duration-300",
                            isOpen && "rotate-180"
                        )} />
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent
                className={cn(
                    "w-[var(--radix-popover-trigger-width)] min-w-[240px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none",
                    popoverWidth
                )}
                sideOffset={10}
                align="center"
            >
                <Command
                    className="bg-transparent overflow-visible w-full outline-none"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setIsOpen(false);
                            e.preventDefault();
                        }
                    }}
                >
                    <div className="flex flex-col gap-1.5 w-full">
                        {/* Search Bar Container */}
                        {showSearch && (
                            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                                <CommandInput
                                    placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                                    className="h-14 text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                    autoFocus
                                />
                            </div>
                        )}

                        {/* Results Container */}
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                            <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">
                                    No {label.toLowerCase()} found.
                                </CommandEmpty>

                                <CommandGroup heading={label} className="px-1">
                                    {options.map((opt) => {
                                        const isSelected = opt.id === value;
                                        return (
                                            <CommandItem
                                                key={opt.id}
                                                disabled={opt.disabled}
                                                onSelect={() => {
                                                    onChange(opt.id);
                                                    setIsOpen(false);
                                                }}
                                                className={cn(
                                                    "flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                                                    "aria-selected:bg-primary aria-selected:text-primary-foreground group",
                                                    opt.disabled && "opacity-40 cursor-not-allowed"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-5 h-5 rounded-md border flex items-center justify-center transition-all flex-shrink-0",
                                                    isSelected
                                                        ? "bg-white border-white text-primary"
                                                        : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                )}>
                                                    {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                                </div>
                                                <div className="flex flex-col min-w-0 flex-1">
                                                    <span className="font-semibold text-sm sm:text-base leading-snug">
                                                        {opt.name}
                                                    </span>
                                                    {opt.description && (
                                                        <span className="text-[11px] text-muted-foreground group-aria-selected:text-primary-foreground/70 line-clamp-1">
                                                            {opt.description}
                                                        </span>
                                                    )}
                                                </div>
                                                <CommandShortcut className="group-aria-selected:text-white/60 flex-shrink-0">
                                                    ↵
                                                </CommandShortcut>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            </CommandList>

                            {/* Keyboard navigation helper footer */}
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
};

export default GlobalStyleSelect;
