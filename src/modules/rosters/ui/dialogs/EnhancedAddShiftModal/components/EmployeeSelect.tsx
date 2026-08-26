import React, { useState, useEffect, useMemo } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import { cn } from '@/modules/core/lib/utils';
import { Check, ChevronDown } from 'lucide-react';
import { TARGET_EMPLOYMENT_TYPE_LABELS } from '@/modules/core/model/employment.types';

export interface EmployeeSelectProps {
    label?: string;
    employees: Array<any>;
    value: string | null | undefined;
    onChange: (value: string | null) => void;
    targetEmploymentType?: string;
    excludedCount?: number;
    disabled?: boolean;
    className?: string;
    id?: string;
}

export const EmployeeSelect: React.FC<EmployeeSelectProps> = ({
    label = 'Assign Employee',
    employees,
    value,
    onChange,
    targetEmploymentType,
    excludedCount = 0,
    disabled,
    className,
    id,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const isDisabled = disabled;

    const displayNameOf = (e: any) =>
        e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Employee';

    const initialsOf = (e: any) =>
        `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '??';

    const selectedEmployee = useMemo(() => {
        if (!value) return null;
        return employees.find((e) => e.id === value) || null;
    }, [employees, value]);

    const displayText = useMemo(() => {
        if (!selectedEmployee) return 'Leave Unassigned (Open for Bidding)';
        return displayNameOf(selectedEmployee);
    }, [selectedEmployee]);

    // Close on Escape key
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
        <Popover open={isOpen && !isDisabled} onOpenChange={setIsOpen} modal={false}>
            <PopoverTrigger asChild>
                <button
                    id={id}
                    className={cn(
                        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300",
                        "border justify-between w-full h-14 border-border",
                        "hover:scale-[1.01] active:scale-[0.99] relative z-20",
                        isOpen ? "ring-2 ring-indigo-500 bg-indigo-500/5 shadow-indigo-500/20 border-indigo-400/80" : "",
                        isDisabled
                            ? "bg-indigo-50/20 dark:bg-white/[0.02] text-slate-400 dark:text-white/40 cursor-not-allowed opacity-50"
                            : "bg-white dark:bg-[#1c2333] text-slate-700 dark:text-white/80 hover:bg-indigo-50/50 dark:hover:bg-[#252d40] cursor-pointer shadow-lg shadow-black/5",
                        className
                    )}
                    disabled={isDisabled}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                >
                    <div className="flex flex-col items-start gap-0.5 min-w-0">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                            {label}
                        </span>
                        <span className={cn(
                            "truncate text-xs sm:text-sm font-semibold",
                            selectedEmployee
                                ? "text-slate-900 dark:text-slate-100"
                                : "text-slate-500 dark:text-slate-400 font-medium"
                        )}>
                            {displayText}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <span className="rounded-md bg-indigo-50 dark:bg-white/10 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                            {employees.length} Eligible
                        </span>
                        <ChevronDown className={cn(
                            "w-3.5 h-3.5 text-slate-400 dark:text-white/40 transition-transform duration-200",
                            isOpen && "rotate-180"
                        )} />
                    </div>
                </button>
            </PopoverTrigger>

            <PopoverContent 
                className="w-[var(--radix-popover-trigger-width)] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
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
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                            <CommandInput 
                                placeholder="Search eligible staff by name..." 
                                className="h-14 text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                autoFocus
                            />
                        </div>

                        {/* Results Container */}
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                            {targetEmploymentType && excludedCount > 0 && (
                                <div className="border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] px-4 py-2 text-xs font-semibold text-slate-500 dark:text-white/50">
                                    Showing {TARGET_EMPLOYMENT_TYPE_LABELS[targetEmploymentType] || targetEmploymentType} only ({excludedCount} excluded)
                                </div>
                            )}

                            <CommandList className="max-h-[300px] p-1.5 scrollbar-none overflow-x-hidden">
                                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">
                                    {targetEmploymentType && excludedCount > 0
                                        ? `No ${TARGET_EMPLOYMENT_TYPE_LABELS[targetEmploymentType] || targetEmploymentType} staff match your search.`
                                        : 'No employees found.'}
                                </CommandEmpty>
                                
                                <CommandGroup heading="Eligible Staff" className="px-1">
                                    {/* Unassign Option */}
                                    <CommandItem
                                        value="__leave_unassigned__ open shift bidding"
                                        onSelect={() => {
                                            onChange(null);
                                            setIsOpen(false);
                                        }}
                                        className={cn(
                                            "flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                                            "aria-selected:bg-indigo-600 aria-selected:text-white group"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={cn(
                                                "w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold transition-all shrink-0",
                                                !value 
                                                    ? "bg-white border-white text-indigo-600 dark:text-indigo-600" 
                                                    : "bg-slate-100 dark:bg-white/10 border-transparent text-slate-500 dark:text-white/60 group-aria-selected:border-white/40"
                                            )}>
                                                —
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-semibold text-sm sm:text-base truncate">
                                                    Leave Unassigned
                                                </p>
                                                <p className="text-xs text-slate-500 dark:text-white/50 group-aria-selected:text-white/80 truncate">
                                                    Open shift for bidding
                                                </p>
                                            </div>
                                        </div>
                                        <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                    </CommandItem>

                                    {/* Employee List */}
                                    {employees.map((emp) => {
                                        const isSelected = value === emp.id;
                                        const name = displayNameOf(emp);
                                        const initials = initialsOf(emp);
                                        const contract = emp.employment_status || emp.contract_type || 'Casual';

                                        return (
                                            <CommandItem
                                                key={emp.id}
                                                value={`${name} ${emp.id} ${contract}`.toLowerCase()}
                                                onSelect={() => {
                                                    onChange(emp.id);
                                                    setIsOpen(false);
                                                }}
                                                className={cn(
                                                    "flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                                                    "aria-selected:bg-indigo-600 aria-selected:text-white group"
                                                )}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    {/* Initials circle */}
                                                    <div className={cn(
                                                        "w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold transition-all shrink-0",
                                                        isSelected 
                                                            ? "bg-white border-white text-indigo-600 dark:text-indigo-600" 
                                                            : "bg-slate-100 dark:bg-white/10 border-transparent text-slate-700 dark:text-white/80 group-aria-selected:border-white/40"
                                                    )}>
                                                        {isSelected ? <Check className="w-4 h-4" strokeWidth={3} /> : initials}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-sm sm:text-base truncate">
                                                            {name}
                                                        </p>
                                                        <p className="text-xs text-slate-500 dark:text-white/50 group-aria-selected:text-white/80 truncate font-mono">
                                                            {contract}
                                                        </p>
                                                    </div>
                                                </div>
                                                <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            </CommandList>
                            
                            {/* Navigation Guides Footer */}
                            <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-indigo-500/5 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-indigo-500/50 dark:text-muted-foreground/50">
                                <div className="flex items-center gap-4">
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">↑↓</kbd> NAV
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">↵</kbd> SELECT
                                    </span>
                                </div>
                                <span className="flex items-center gap-1">
                                    <kbd className="px-1 py-0.5 rounded border border-indigo-500/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-indigo-500/70 dark:text-inherit font-sans">ESC</kbd> CLOSE
                                </span>
                            </div>
                        </div>
                    </div>
                </Command>
            </PopoverContent>
        </Popover>
    );
};
