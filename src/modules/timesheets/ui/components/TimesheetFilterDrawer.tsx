/**
 * TimesheetFilterDrawer
 *
 * Shared filter engine for the Timesheets module.
 *
 * Exports:
 *   - ActiveFilters          interface for multi-select filter state
 *   - EMPTY_FILTERS          zero-state constant
 *   - countActiveFilters     badge count helper
 *   - applyTimesheetFilters  pure filtering function (used by both mobile + desktop)
 *   - FilterContent          shared chip-grid UI (rendered inside drawer or popover)
 *   - TimesheetFilterDrawer  mobile: Vaul bottom-sheet wrapper with trigger button
 */

import React, { useState, useMemo, useEffect } from 'react';
import { X, Filter, Check } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerClose,
    DrawerTrigger,
} from '@/modules/core/ui/primitives/drawer';
import type { TimesheetRow } from '../../model/timesheet.types';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ActiveFilters {
    statuses: string[];   // 'draft' | 'submitted' | 'approved' | 'rejected' | 'no_show'
    groupTypes: string[]; // 'convention_centre' | 'exhibition_centre' | 'theatre'
    subGroups: string[];  // dynamic — derived from entries + selected groupTypes
    roles: string[];      // derived from entries
}

export const EMPTY_FILTERS: ActiveFilters = {
    statuses: [],
    groupTypes: [],
    subGroups: [],
    roles: [],
};

export function countActiveFilters(f: ActiveFilters): number {
    return f.statuses.length + f.groupTypes.length + f.subGroups.length + f.roles.length;
}

/**
 * Pure filter function — shared between mobile and desktop.
 * Applies multi-select categorical filters + free-text search.
 */
export function applyTimesheetFilters(
    entries: TimesheetRow[],
    filters: ActiveFilters,
    searchQuery: string,
): TimesheetRow[] {
    return entries.filter(entry => {
        // Status / no-show
        if (filters.statuses.length > 0) {
            const ts = (entry.timesheetStatus || '').toLowerCase();
            const att = entry.attendanceStatus || '';
            const ok = filters.statuses.some(s =>
                s === 'no_show' ? att === 'no_show' : ts === s
            );
            if (!ok) return false;
        }
        if (filters.groupTypes.length > 0 && !filters.groupTypes.includes(entry.group)) return false;
        if (filters.subGroups.length > 0 && !filters.subGroups.includes(entry.subGroup)) return false;
        if (filters.roles.length > 0 && !filters.roles.includes(entry.role)) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return (
                entry.employee.toLowerCase().includes(q) ||
                entry.employeeId.toLowerCase().includes(q) ||
                entry.role.toLowerCase().includes(q) ||
                entry.department.toLowerCase().includes(q) ||
                entry.subGroup.toLowerCase().includes(q) ||
                entry.liveStatus.toLowerCase().includes(q)
            );
        }
        return true;
    });
}

// ── Static option config ──────────────────────────────────────────────────────

const STATUS_OPTIONS: { v: string; l: string }[] = [
    { v: 'draft',     l: 'Draft' },
    { v: 'submitted', l: 'Submitted' },
    { v: 'approved',  l: 'Approved' },
    { v: 'rejected',  l: 'Rejected' },
    { v: 'no_show',   l: 'No-Show' },
];

const GROUP_OPTIONS: { v: string; l: string }[] = [
    { v: 'convention_centre', l: 'Convention' },
    { v: 'exhibition_centre', l: 'Exhibition' },
    { v: 'theatre',           l: 'Theatre' },
];

// ── Chip row ──────────────────────────────────────────────────────────────────

const ChipRow: React.FC<{
    label: string;
    selected: string[];
    options: { v: string; l: string }[];
    onToggle: (v: string) => void;
    empty?: string;
}> = ({ label, selected, options, onToggle, empty }) => (
    <div className="space-y-2">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/50">
            {label}
        </p>
        {options.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/40 italic px-0.5">
                {empty ?? 'None available for this date'}
            </p>
        ) : (
            <div className="flex flex-wrap gap-1.5">
                {options.map(({ v, l }) => {
                    const active = selected.includes(v);
                    return (
                        <button
                            key={v}
                            onClick={() => onToggle(v)}
                            className={cn(
                                'flex items-center gap-1.5 h-7 px-3 rounded-full border text-[11px] font-black transition-all active:scale-95',
                                active
                                    ? 'bg-primary/10 border-primary text-primary'
                                    : 'bg-muted/40 border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border/60'
                            )}
                        >
                            {active && <Check className="h-2.5 w-2.5 shrink-0" />}
                            {l}
                        </button>
                    );
                })}
            </div>
        )}
    </div>
);

// ── Shared filter content ─────────────────────────────────────────────────────

interface FilterContentProps {
    draftFilters: ActiveFilters;
    setDraftFilters: React.Dispatch<React.SetStateAction<ActiveFilters>>;
    /** Raw (unfiltered) entries — used to derive available options dynamically. */
    entries: TimesheetRow[];
    onApply: (f: ActiveFilters) => void;
    onReset: () => void;
    /** compact=true: tighter gap, used inside popovers */
    compact?: boolean;
}

function toggleItem(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
}

export const FilterContent: React.FC<FilterContentProps> = ({
    draftFilters,
    setDraftFilters,
    entries,
    onApply,
    onReset,
    compact = false,
}) => {
    // Only show groups that actually appear in this day's data
    const availableGroups = useMemo(
        () => GROUP_OPTIONS.filter(g => entries.some(e => e.group === g.v)),
        [entries],
    );

    // Sub-groups are scoped to selected group types (or all if none selected)
    const availableSubGroups = useMemo(() => {
        const source = draftFilters.groupTypes.length > 0
            ? entries.filter(e => draftFilters.groupTypes.includes(e.group))
            : entries;
        return [...new Set(source.map(e => e.subGroup).filter(Boolean))].sort() as string[];
    }, [entries, draftFilters.groupTypes]);

    // Roles from all entries for this day
    const availableRoles = useMemo(
        () => [...new Set(entries.map(e => e.role).filter(Boolean))].sort() as string[],
        [entries],
    );

    // When available sub-groups shrink (group type changed), drop now-invalid selections
    const subGroupsKey = availableSubGroups.join('\0');
    useEffect(() => {
        const valid = draftFilters.subGroups.filter(s => availableSubGroups.includes(s));
        if (valid.length !== draftFilters.subGroups.length) {
            setDraftFilters(f => ({ ...f, subGroups: valid }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subGroupsKey]);

    const hasAny = countActiveFilters(draftFilters) > 0;

    return (
        <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-5')}>
            <ChipRow
                label="Status"
                selected={draftFilters.statuses}
                options={STATUS_OPTIONS}
                onToggle={v => setDraftFilters(f => ({ ...f, statuses: toggleItem(f.statuses, v) }))}
            />

            <ChipRow
                label="Group Type"
                selected={draftFilters.groupTypes}
                options={availableGroups}
                empty="No group data for this date"
                onToggle={v => setDraftFilters(f => ({ ...f, groupTypes: toggleItem(f.groupTypes, v) }))}
            />

            <ChipRow
                label="Sub-Group"
                selected={draftFilters.subGroups}
                options={availableSubGroups.map(s => ({ v: s, l: s }))}
                empty={
                    draftFilters.groupTypes.length > 0
                        ? 'No sub-groups for selected groups'
                        : 'Select a group type first'
                }
                onToggle={v => setDraftFilters(f => ({ ...f, subGroups: toggleItem(f.subGroups, v) }))}
            />

            <ChipRow
                label="Role"
                selected={draftFilters.roles}
                options={availableRoles.map(r => ({ v: r, l: r }))}
                empty="No roles for this date"
                onToggle={v => setDraftFilters(f => ({ ...f, roles: toggleItem(f.roles, v) }))}
            />

            {/* Apply / Reset */}
            <div className={cn(
                'flex gap-2',
                compact ? '' : 'pt-2 mt-1 border-t border-border/40',
            )}>
                <button
                    onClick={onReset}
                    disabled={!hasAny}
                    className="flex-1 h-9 rounded-xl border border-border/50 bg-muted/30 text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                    Reset
                </button>
                <button
                    onClick={() => onApply(draftFilters)}
                    className="flex-[2] h-9 rounded-xl bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-widest shadow-sm hover:opacity-90 transition-all active:scale-[0.98]"
                >
                    Apply{hasAny ? ` · ${countActiveFilters(draftFilters)}` : ''}
                </button>
            </div>
        </div>
    );
};

// ── Mobile bottom drawer ──────────────────────────────────────────────────────

interface TimesheetFilterDrawerProps {
    /** Raw (unfiltered) entries for deriving available options. */
    entries: TimesheetRow[];
    appliedFilters: ActiveFilters;
    onApply: (f: ActiveFilters) => void;
    activeCount: number;
}

export const TimesheetFilterDrawer: React.FC<TimesheetFilterDrawerProps> = ({
    entries,
    appliedFilters,
    onApply,
    activeCount,
}) => {
    const [open, setOpen] = useState(false);
    const [draftFilters, setDraftFilters] = useState<ActiveFilters>(EMPTY_FILTERS);

    // Sync draft state when drawer opens
    useEffect(() => {
        if (open) setDraftFilters(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleApply = (f: ActiveFilters) => {
        onApply(f);
        setOpen(false);
    };

    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
                <button
                    className={cn(
                        'relative h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border transition-all active:scale-90',
                        open || activeCount > 0
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'bg-background border-border text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
                    )}
                >
                    <Filter className="h-4 w-4" />
                    {activeCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center leading-none pointer-events-none">
                            {activeCount}
                        </span>
                    )}
                </button>
            </DrawerTrigger>

            <DrawerContent className="max-h-[88dvh] bg-background border-border flex flex-col">
                {/* Header row: title + close */}
                <DrawerHeader className="flex flex-row items-center justify-between px-5 pb-0 shrink-0">
                    <DrawerTitle className="text-[15px] font-black tracking-tight text-foreground">
                        Filters
                    </DrawerTitle>
                    <DrawerClose asChild>
                        <button className="h-8 w-8 flex items-center justify-center rounded-full bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
                            <X className="h-4 w-4" />
                        </button>
                    </DrawerClose>
                </DrawerHeader>

                {/* Scrollable body */}
                <div className="overflow-y-auto px-5 py-5 flex-1">
                    <FilterContent
                        draftFilters={draftFilters}
                        setDraftFilters={setDraftFilters}
                        entries={entries}
                        onApply={handleApply}
                        onReset={() => setDraftFilters(EMPTY_FILTERS)}
                    />
                </div>
            </DrawerContent>
        </Drawer>
    );
};
