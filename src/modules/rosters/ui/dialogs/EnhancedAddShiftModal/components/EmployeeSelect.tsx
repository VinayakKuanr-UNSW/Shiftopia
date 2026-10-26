import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { CommandItem, CommandShortcut } from '@/modules/core/ui/primitives/command';
import { cn } from '@/modules/core/lib/utils';
import { Check } from 'lucide-react';
import { TARGET_EMPLOYMENT_TYPE_LABELS } from '@/modules/core/model/employment.types';
import { PICKER_CONTENT_CLASS, PICKER_ROW, PickerPanel, PickerTrigger } from '@/modules/core/ui/components/PickerField';

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

    const typeLabel = targetEmploymentType
        ? TARGET_EMPLOYMENT_TYPE_LABELS[targetEmploymentType as keyof typeof TARGET_EMPLOYMENT_TYPE_LABELS] || targetEmploymentType
        : '';
    const isFiltered = !!targetEmploymentType && excludedCount > 0;

    return (
        <Popover open={isOpen && !isDisabled} onOpenChange={setIsOpen} modal={false}>
            <PopoverTrigger asChild>
                <PickerTrigger
                    id={id}
                    label={label}
                    display={displayText}
                    isEmpty={!selectedEmployee}
                    isOpen={isOpen}
                    disabled={isDisabled}
                    className={className}
                    adornment={
                        <span className="rounded-md bg-indigo-50 dark:bg-white/10 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                            {employees.length} Eligible
                        </span>
                    }
                />
            </PopoverTrigger>

            <PopoverContent className={PICKER_CONTENT_CLASS} sideOffset={10} align="center">
                <PickerPanel
                    heading="Eligible Staff"
                    searchPlaceholder="Search eligible staff by name..."
                    emptyText={isFiltered ? `No ${typeLabel} staff match your search.` : 'No employees found.'}
                    onClose={() => setIsOpen(false)}
                    header={isFiltered && (
                        <div className="border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] px-4 py-2 text-[11px] font-semibold text-slate-500 dark:text-white/50">
                            Showing {typeLabel} only ({excludedCount} excluded)
                        </div>
                    )}
                >
                    <CommandItem
                        value="__leave_unassigned__ open shift bidding"
                        onSelect={() => {
                            onChange(null);
                            setIsOpen(false);
                        }}
                        aria-checked={!value}
                        className={PICKER_ROW}
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={cn(
                                "w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold transition-all shrink-0",
                                !value
                                    ? "bg-white border-white text-indigo-600 dark:text-indigo-600"
                                    : "bg-slate-100 dark:bg-white/10 border-transparent text-slate-500 dark:text-white/60 group-aria-selected:border-white/40"
                            )}>
                                —
                            </div>
                            <div className="min-w-0">
                                <p className="font-semibold text-[13px] sm:text-[14px] truncate">Leave Unassigned</p>
                                <p className="text-[11px] text-slate-500 dark:text-white/50 group-aria-selected:text-white/80 truncate">
                                    Open shift for bidding
                                </p>
                            </div>
                        </div>
                        <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">↵</CommandShortcut>
                    </CommandItem>

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
                                aria-checked={isSelected}
                                className={PICKER_ROW}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={cn(
                                        "w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold transition-all shrink-0",
                                        isSelected
                                            ? "bg-white border-white text-indigo-600 dark:text-indigo-600"
                                            : "bg-slate-100 dark:bg-white/10 border-transparent text-slate-700 dark:text-white/80 group-aria-selected:border-white/40"
                                    )}>
                                        {isSelected ? <Check className="w-4 h-4" strokeWidth={3} /> : initials}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-[13px] sm:text-[14px] truncate">{name}</p>
                                        <p className="text-[11px] text-slate-500 dark:text-white/50 group-aria-selected:text-white/80 truncate font-mono">
                                            {contract}
                                        </p>
                                    </div>
                                </div>
                                <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">↵</CommandShortcut>
                            </CommandItem>
                        );
                    })}
                </PickerPanel>
            </PopoverContent>
        </Popover>
    );
};
