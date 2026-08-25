import React, { useState, useEffect, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { 
  Command, 
  CommandEmpty, 
  CommandGroup, 
  CommandInput, 
  CommandItem, 
  CommandList,
  CommandShortcut 
} from '@/modules/core/ui/primitives/command';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

export interface MultiCommandOption {
    id: string;
    name: string;
    subtitle?: string;
    badge?: string;
    description?: string;
    icon?: React.ReactNode;
}

interface MultiCommandSelectorProps {
    label: string;
    placeholder?: string;
    selected: string[];
    onToggle: (id: string) => void;
    onToggleAll?: () => void;
    options: MultiCommandOption[];
    disabled?: boolean;
    icon?: React.ReactNode;
    className?: string;
}

export const MultiCommandSelector: React.FC<MultiCommandSelectorProps> = ({
    label,
    placeholder = 'Select options...',
    selected,
    onToggle,
    onToggleAll,
    options,
    disabled = false,
    icon,
    className,
}) => {
    const { isDark } = useTheme();
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const selectedCount = selected.length;
    const allSelected = options.length > 0 && selectedCount === options.length;

    // Reset search query when popover closes
    useEffect(() => {
        if (!open) {
            setSearchQuery('');
        }
    }, [open]);

    // Filter options while strictly preserving the provided sorting order (e.g. L7 -> L0)
    const filteredOptions = useMemo(() => {
        if (!searchQuery.trim()) return options;
        const q = searchQuery.toLowerCase();
        return options.filter(option =>
            option.name.toLowerCase().includes(q) ||
            (option.subtitle && option.subtitle.toLowerCase().includes(q)) ||
            (option.badge && option.badge.toLowerCase().includes(q)) ||
            (option.description && option.description.toLowerCase().includes(q))
        );
    }, [options, searchQuery]);

    const displayText = useMemo(() => {
        if (selectedCount === 0) return placeholder;
        if (allSelected && options.length > 1) return `All ${label} (${options.length})`;
        if (selectedCount === 1) {
            const item = options.find(o => o.id === selected[0]);
            return item?.name || `1 ${label} selected`;
        }
        return `${selectedCount} ${label} selected`;
    }, [selected, options, label, selectedCount, allSelected, placeholder]);

    // Keyboard Escape listener
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

    return (
        <div className={cn("flex flex-col gap-1.5 w-full", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        role="combobox"
                        aria-expanded={open}
                        aria-label={`Select ${label}`}
                        disabled={disabled}
                        className={cn(
                            "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300",
                            "border justify-between w-full h-14",
                            "hover:scale-[1.01] active:scale-[0.99] relative z-30",
                            open ? "ring-2 ring-primary bg-primary/5 shadow-primary/20 border-primary/40" : "",
                            disabled
                                ? "bg-muted/10 border-border/30 text-muted-foreground cursor-not-allowed opacity-40 grayscale"
                                : isDark
                                    ? "bg-[#1c2333] text-white/90 hover:bg-[#252d40] border-white/10 shadow-lg shadow-black/10"
                                    : "bg-white text-slate-800 hover:bg-indigo-50/50 border-slate-200/80 shadow-xs"
                        )}
                    >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            {icon && (
                                <div className={cn(
                                    "p-2 rounded-lg transition-colors shrink-0",
                                    open ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground group-hover:text-primary"
                                )}>
                                    {icon}
                                </div>
                            )}
                            <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40 leading-none">
                                        {label}
                                    </span>
                                    {selectedCount > 0 && (
                                        <span className="px-1.5 py-0.2 rounded-md bg-primary/10 text-primary text-[9px] font-black leading-tight">
                                            {selectedCount}
                                        </span>
                                    )}
                                </div>
                                <span className={cn(
                                    "truncate max-w-[220px] sm:max-w-[320px] text-xs sm:text-sm font-semibold",
                                    selectedCount === 0 && "text-muted-foreground font-medium"
                                )}>
                                    {displayText}
                                </span>
                            </div>
                        </div>
                        <ChevronDown className={cn(
                            "w-4 h-4 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform duration-300",
                            open && "rotate-180 text-primary"
                        )} />
                    </button>
                </PopoverTrigger>

                <PopoverContent 
                    side="bottom"
                    sideOffset={8}
                    align="start"
                    avoidCollisions={false}
                    className="w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[420px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
                >
                    <Command 
                        shouldFilter={false}
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
                                    placeholder={`Search ${label.toLowerCase()}...`}
                                    value={searchQuery}
                                    onValueChange={setSearchQuery}
                                    className="h-12 text-sm md:h-14 md:text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                    autoFocus
                                />
                            </div>

                            {/* Results Container */}
                            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                                <CommandList className="max-h-[220px] p-1.5 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40 overflow-x-hidden">
                                    {filteredOptions.length === 0 && (
                                        <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">
                                            No {label.toLowerCase()} found.
                                        </CommandEmpty>
                                    )}
                                    <CommandGroup heading={label} className="px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                                        {/* Select All Option */}
                                        {options.length > 1 && onToggleAll && !searchQuery.trim() && (
                                            <CommandItem
                                                onSelect={onToggleAll}
                                                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                            >
                                                <div className={cn(
                                                    "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                                                    allSelected 
                                                        ? "bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:border-white group-aria-selected:text-primary" 
                                                        : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                )}>
                                                    {allSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                                </div>
                                                <span className="font-semibold text-xs sm:text-sm flex-1">
                                                    {allSelected ? 'Deselect All' : 'Select All'}
                                                </span>
                                                <CommandShortcut className="group-aria-selected:text-white/60">⌘A</CommandShortcut>
                                            </CommandItem>
                                        )}

                                        {/* Option Items */}
                                        {filteredOptions.map((option) => {
                                            const isSelected = selected.includes(option.id);
                                            return (
                                                <CommandItem
                                                    key={option.id}
                                                    value={option.id}
                                                    onSelect={() => onToggle(option.id)}
                                                    className={cn(
                                                        "flex items-center gap-3 px-3.5 py-2.5 rounded-xl mb-1 cursor-pointer transition-all",
                                                        "aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                                    )}
                                                >
                                                    {/* Checkbox indicator */}
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                                                        isSelected 
                                                            ? "bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:border-white group-aria-selected:text-primary" 
                                                            : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                    )}>
                                                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                                    </div>

                                                    {option.icon && (
                                                        <div className="text-muted-foreground group-aria-selected:text-white shrink-0">
                                                            {option.icon}
                                                        </div>
                                                    )}

                                                    <div className="flex flex-col flex-1 min-w-0 text-left">
                                                        <span className="font-semibold text-xs sm:text-sm truncate">
                                                            {option.name}
                                                        </span>
                                                        {(option.subtitle || option.description) && (
                                                            <span className="text-[10px] text-muted-foreground group-aria-selected:text-white/70 truncate">
                                                                {option.subtitle || option.description}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {option.badge && (
                                                        <span className="px-1.5 py-0.5 rounded bg-muted/60 group-aria-selected:bg-white/20 text-[10px] font-bold shrink-0">
                                                            {option.badge}
                                                        </span>
                                                    )}

                                                    <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                </CommandList>

                                {/* Keyboard Navigation Footer */}
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
        </div>
    );
};

export default MultiCommandSelector;
