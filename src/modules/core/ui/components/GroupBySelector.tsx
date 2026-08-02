import React, { useState } from 'react';
import { Layers, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
    Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';

export interface GroupBySelectorOption {
    value: RowGroupBy;
    label: string;
}

interface GroupBySelectorProps {
    value: RowGroupBy;
    onChange: (value: RowGroupBy) => void;
    options: GroupBySelectorOption[];
    className?: string;
}

/**
 * Shared "Group By" control — same visual language as the Filter button
 * (TimesheetFilterDrawer / TimesheetHeader), used on both My Attendance and
 * Timesheets so the two pages present grouping identically.
 */
export const GroupBySelector: React.FC<GroupBySelectorProps> = ({ value, onChange, options, className }) => {
    const { isDark } = useTheme();
    const [open, setOpen] = useState(false);
    const active = options.find(o => o.value === value);
    const isNone = value === 'none';

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Group by${active ? `: ${active.label}` : ''}`}
                    aria-expanded={open}
                    className={cn(
                        'relative flex items-center gap-1.5 h-11 md:h-9 px-2.5 md:px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all',
                        !isNone
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : isDark
                                ? 'bg-[#111827]/60 border-white/5 text-white/70 hover:text-white hover:bg-[#111827]/80'
                                : 'bg-slate-100 border-slate-200/50 text-muted-foreground hover:text-foreground hover:bg-slate-200',
                        className,
                    )}
                >
                    <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="hidden md:inline">{active ? active.label : 'Group By'}</span>
                    <ChevronDown className="hidden md:block h-3 w-3 opacity-50 shrink-0" aria-hidden="true" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 bg-popover border-border rounded-2xl shadow-2xl" align="end">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 px-2 pt-1 pb-2">
                    Group By
                </p>
                <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Group entries by">
                    {options.map(opt => {
                        const isSelected = opt.value === value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                onClick={() => { onChange(opt.value); setOpen(false); }}
                                className={cn(
                                    'flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-[12px] font-bold transition-all text-left',
                                    isSelected
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-foreground/80 hover:bg-muted/60',
                                )}
                            >
                                <span className={cn(
                                    'flex h-4 w-4 items-center justify-center rounded-full border shrink-0',
                                    isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                                )}>
                                    {isSelected && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                                </span>
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default GroupBySelector;
