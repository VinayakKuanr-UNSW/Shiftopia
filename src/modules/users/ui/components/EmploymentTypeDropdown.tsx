import React, { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

export interface EmploymentTypeOption {
    id: string;
    label: string;
    description?: string;
}

/** `public.employment_status`, verbatim — EBA cl 12.1. */
export const STANDARD_EMPLOYMENT_TYPES: EmploymentTypeOption[] = [
    { id: 'Full-Time', label: 'Full-Time', description: '38h/wk standard' },
    { id: 'Part-Time', label: 'Part-Time', description: '20h+ /wk' },
    { id: 'Casual', label: 'Casual', description: 'Hourly / No min' },
    { id: 'Flexible Part-Time', label: 'Flexible PT', description: '624–1976h/yr' },
];

export interface EmploymentTypeDropdownProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    placeholder?: string;
    options?: EmploymentTypeOption[];
    className?: string;
    widthClassName?: string;
    emptyLabel?: string;
    ariaLabel?: string;
}

/**
 * Global Scope styled Employment Type Dropdown.
 * Matches the exact UI styling, pixel-perfect trigger width, and light/dark theme system.
 */
export const EmploymentTypeDropdown: React.FC<EmploymentTypeDropdownProps> = ({
    value,
    onChange,
    disabled = false,
    placeholder = 'Select type…',
    options = STANDARD_EMPLOYMENT_TYPES,
    className,
    widthClassName = 'w-48',
    emptyLabel = 'Select type…',
    ariaLabel = 'Employment type'
}) => {
    const { isDark } = useTheme();
    const [open, setOpen] = useState(false);

    // Escape listener
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    const selectedOption = options.find(opt => opt.id === value);
    const displayLabel = selectedOption ? selectedOption.label : '';

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={ariaLabel}
                    disabled={disabled}
                    className={cn(
                        "h-10 px-3.5 rounded-xl border text-xs font-semibold transition-all flex items-center justify-between shrink-0 select-none",
                        widthClassName,
                        open 
                            ? "ring-2 ring-primary bg-primary/5 shadow-primary/20 border-primary/50" 
                            : isDark
                                ? "bg-[#1c2333] text-white/90 hover:bg-[#252d40] border-white/10 shadow-sm"
                                : "bg-white text-slate-800 hover:bg-slate-50 border-slate-200/90 shadow-xs",
                        disabled && "opacity-40 cursor-not-allowed grayscale pointer-events-none",
                        className
                    )}
                >
                    <span className={cn(
                        "truncate text-left font-medium",
                        displayLabel ? "text-foreground font-semibold" : "text-muted-foreground"
                    )}>
                        {displayLabel || placeholder}
                    </span>
                    <ChevronDown className={cn(
                        "w-4 h-4 text-muted-foreground ml-2 shrink-0 transition-transform duration-200",
                        open && "rotate-180 text-primary"
                    )} />
                </button>
            </PopoverTrigger>

            <PopoverContent 
                side="bottom"
                align="start"
                sideOffset={6}
                avoidCollisions={false}
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                className="w-[var(--radix-popover-trigger-width)] p-0 rounded-2xl bg-white dark:bg-[#1a2333] border border-slate-200 dark:border-white/10 text-foreground shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden z-50 outline-none"
            >
                {/* Header */}
                <div className="px-3 pt-2.5 pb-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/70 border-b border-border/40 text-left">
                    Employment Type
                </div>

                <div 
                    className="p-1 flex flex-col gap-0.5 max-h-56 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40 touch-pan-y pointer-events-auto"
                    onWheel={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                >
                    {/* Empty / Reset option */}
                    <button
                        type="button"
                        onClick={() => {
                            onChange('');
                            setOpen(false);
                        }}
                        className={cn(
                            "w-full px-2.5 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 transition-all cursor-pointer group",
                            !value 
                                ? "bg-primary/10 text-primary font-bold" 
                                : "text-muted-foreground hover:bg-muted/50 dark:hover:bg-white/5 hover:text-foreground"
                        )}
                    >
                        <div className={cn(
                            "w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0",
                            !value 
                                ? "bg-primary border-primary text-primary-foreground" 
                                : "border-muted-foreground/30 dark:border-white/30"
                        )}>
                            {!value && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className="truncate flex-1 text-xs">{emptyLabel}</span>
                        <span className="text-[9px] text-muted-foreground/40 group-hover:text-muted-foreground font-mono">↵</span>
                    </button>

                    {/* Options list */}
                    {options.map((opt) => {
                        const isSelected = opt.id === value;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                    onChange(opt.id);
                                    setOpen(false);
                                }}
                                className={cn(
                                    "w-full px-2.5 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 transition-all cursor-pointer group",
                                    isSelected 
                                        ? "bg-primary/10 text-primary font-bold dark:text-primary-foreground dark:bg-primary/20" 
                                        : "text-foreground hover:bg-muted/60 dark:hover:bg-white/10"
                                )}
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0",
                                    isSelected 
                                        ? "bg-primary border-primary text-primary-foreground" 
                                        : "border-muted-foreground/30 dark:border-white/30"
                                )}>
                                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className="truncate font-semibold text-xs">{opt.label}</span>
                                    {opt.description && (
                                        <span className="text-[9px] text-muted-foreground truncate">{opt.description}</span>
                                    )}
                                </div>
                                <span className="text-[9px] text-muted-foreground/40 group-hover:text-muted-foreground font-mono">↵</span>
                            </button>
                        );
                    })}
                </div>

                {/* Keyboard Navigation Footer */}
                <div className="p-2 bg-indigo-50/50 dark:bg-muted/20 border-t border-border/40 flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-muted-foreground/60 select-none">
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 rounded border border-border bg-background">↑↓</kbd> Nav
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 rounded border border-border bg-background">↵</kbd> Select
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 rounded border border-border bg-background">esc</kbd> Close
                    </span>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default EmploymentTypeDropdown;
