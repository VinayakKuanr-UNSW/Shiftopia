/**
 * Which job the employee is declaring availability for.
 *
 * ONE AT A TIME, deliberately. A multi-select would have to mean "apply this
 * declaration to all of these jobs at once", and that is precisely the
 * conflation this whole workstream removes: the same person can be Full-Time in
 * Security (where availability is contract-based and declaring is refused) and
 * Casual in Set-up (where silence means unavailable). There is no single answer
 * that is correct for both.
 *
 * Not built on `GlobalScopeFilter` even though it supports `multiSelect={false}`:
 * that component derives its options from the Type X permission tree and writes
 * through to the shared personal scope. Both are wrong here — see
 * `useAvailabilityScope`.
 */

import React from 'react';
import { Briefcase, Check, ChevronDown, Lock } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import type { AvailabilityScope } from '../../api/contract-basis.api';

interface AvailabilityScopePickerProps {
    scopes: AvailabilityScope[];
    selected: AvailabilityScope | null;
    onSelect: (subDepartmentId: string | null) => void;
    /** Exactly one job — rendered as a label, because a one-option picker reads as broken. */
    isSingleScope: boolean;
    isDark: boolean;
}

/** "Event Delivery · Set-up", or just the sub-department when unnamed. */
function scopeLabel(scope: AvailabilityScope): string {
    return scope.departmentName
        ? `${scope.departmentName} · ${scope.subDepartmentName}`
        : scope.subDepartmentName;
}

export const AvailabilityScopePicker: React.FC<AvailabilityScopePickerProps> = ({
    scopes,
    selected,
    onSelect,
    isSingleScope,
    isDark,
}) => {
    if (scopes.length === 0) return null;

    const surface = isDark ? 'bg-[#111827]/60' : 'bg-white shadow-sm';

    if (isSingleScope && selected) {
        return (
            <div
                className={cn(
                    'flex items-center gap-2 flex-shrink-0 h-9 lg:h-11 px-3 lg:px-4 rounded-xl',
                    surface,
                )}
            >
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.14em] text-foreground truncate">
                    {scopeLabel(selected)}
                </span>
            </div>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className={cn(
                        'flex items-center gap-2 flex-shrink-0 h-9 lg:h-11 px-3 lg:px-4 rounded-xl transition-all',
                        surface,
                    )}
                    // Named rather than described: a screen reader reaching this
                    // control needs to know it switches JOBS, not departments.
                    aria-label={`Declaring availability for ${selected ? scopeLabel(selected) : 'no job selected'}. Change job.`}
                >
                    <Briefcase className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.14em] text-foreground truncate max-w-[150px] lg:max-w-[240px]">
                        {selected ? scopeLabel(selected) : 'Select a job'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" className="w-[280px]">
                {scopes.map((scope) => {
                    const isSelected = scope.subDepartmentId === selected?.subDepartmentId;
                    return (
                        <DropdownMenuItem
                            key={scope.subDepartmentId ?? 'unscoped'}
                            onSelect={() => onSelect(scope.subDepartmentId)}
                            className="flex items-start gap-2.5 py-2.5 cursor-pointer"
                        >
                            <span className="w-4 flex-shrink-0 pt-0.5">
                                {isSelected && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-[13px] font-semibold text-foreground truncate">
                                    {scope.subDepartmentName}
                                </span>
                                <span className="block text-[11px] text-muted-foreground truncate">
                                    {scope.departmentName ?? 'Department'}
                                    {scope.employmentStatus ? ` · ${scope.employmentStatus}` : ''}
                                </span>
                            </span>
                            {/* A Full-Time job is still LISTED — the page has a
                                card explaining why there is nothing to declare —
                                but it is marked so the reason is visible before
                                the click rather than after it. */}
                            {!scope.canDeclare && (
                                <span
                                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex-shrink-0 pt-0.5"
                                    title="Availability is contract based for this job — manage it through Leave."
                                >
                                    <Lock className="h-3 w-3" />
                                    Contract
                                </span>
                            )}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default AvailabilityScopePicker;
