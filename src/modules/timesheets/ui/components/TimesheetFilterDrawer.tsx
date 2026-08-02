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
    DrawerDescription,
    DrawerClose,
    DrawerTrigger,
} from '@/modules/core/ui/primitives/drawer';
import {
    Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import type { TimesheetRow } from '../../model/timesheet.types';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ActiveFilters {
    groupTypes: string[]; // 'convention_centre' | 'exhibition_centre' | 'theatre'
    subGroups: string[];  // dynamic — derived from entries + selected groupTypes
    roles: string[];      // derived from entries
}

export const EMPTY_FILTERS: ActiveFilters = {
    groupTypes: [],
    subGroups: [],
    roles: [],
};

export function countActiveFilters(f: ActiveFilters): number {
    return f.groupTypes.length + f.subGroups.length + f.roles.length;
}

/**
 * Pure filter function — shared between mobile and desktop.
 * Applies multi-select categorical filters + free-text search.
 * Status filtering lives outside this function — each page owns a single
 * status-tab control (attendance status vs timesheet status mean different
 * things and shouldn't share one vocabulary).
 */
export function applyTimesheetFilters(
    entries: TimesheetRow[],
    filters: ActiveFilters,
    searchQuery: string,
): TimesheetRow[] {
    return entries.filter(entry => {
        if (filters.groupTypes.length > 0 && !filters.groupTypes.includes(normalizeGroupKey(entry.group))) return false;
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

// Exported so shared Group By logic (core/lib/row-grouping.ts callers) can
// prettify group-type keys consistently with these filter chips.
// Four fixed roster groups (see roster_groups table / memory: "Roster has
// FOUR fixed groups"). 'v' is the canonical enum key (shifts.group_type /
// roster_groups.external_id).
export const GROUP_OPTIONS: { v: string; l: string }[] = [
    { v: 'convention_centre', l: 'Convention' },
    { v: 'exhibition_centre', l: 'Exhibition' },
    { v: 'theatre',           l: 'Theatre' },
    { v: 'the_cutaway',       l: 'The Cutaway' },
];

// entry.group holds EITHER the enum key (group_type, when no roster_subgroup
// join resolves) OR the human display name (roster_groups.name, e.g.
// "Convention Centre" — the common case, since roster_subgroup is usually
// populated). These never compared equal against GROUP_OPTIONS' enum keys,
// so the Group Type filter/Group By silently matched nothing for real data.
// Normalize both forms to the canonical key before any comparison.
const GROUP_ALIASES: Record<string, string> = {
    convention_centre: 'convention_centre',
    'convention centre': 'convention_centre',
    exhibition_centre: 'exhibition_centre',
    'exhibition centre': 'exhibition_centre',
    theatre: 'theatre',
    the_cutaway: 'the_cutaway',
    'the cutaway': 'the_cutaway',
};

export function normalizeGroupKey(raw: string): string {
    return GROUP_ALIASES[raw.trim().toLowerCase()] ?? raw;
}

// ── Chip row ──────────────────────────────────────────────────────────────────

const ChipRow: React.FC<{
    label: string;
    selected: string[];
    options: { v: string; l: string }[];
    onToggle: (v: string) => void;
    empty?: string;
}> = ({ label, selected, options, onToggle, empty }) => (
    <fieldset className="space-y-2 border-none p-0 m-0" role="group" aria-label={`Filter by ${label}`}>
        <legend className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground/75 mb-1.5 p-0">
            {label}
        </legend>
        {options.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60 italic px-0.5" role="status">
                {empty ?? 'None available for this date'}
            </p>
        ) : (
            <div className="flex flex-wrap gap-1.5" role="group">
                {options.map(({ v, l }) => {
                    const active = selected.includes(v);
                    return (
                        <button
                            key={v}
                            type="button"
                            onClick={() => onToggle(v)}
                            aria-pressed={active}
                            aria-label={`Filter by ${label}: ${l}${active ? ', selected' : ''}`}
                            className={cn(
                                'flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-full border text-[11px] font-black transition-all active:scale-95 touch-manipulation',
                                active
                                    ? 'bg-primary/10 border-primary text-primary'
                                    : 'bg-muted/40 border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border/60'
                            )}
                        >
                            {active && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                            <span>{l}</span>
                        </button>
                    );
                })}
            </div>
        )}
    </fieldset>
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
        () => GROUP_OPTIONS.filter(g => entries.some(e => normalizeGroupKey(e.group) === g.v)),
        [entries],
    );

    // Sub-groups are scoped to selected group types (or all if none selected)
    const availableSubGroups = useMemo(() => {
        const source = draftFilters.groupTypes.length > 0
            ? entries.filter(e => draftFilters.groupTypes.includes(normalizeGroupKey(e.group)))
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
                compact ? '' : 'pt-3 mt-1 border-t border-border/40',
            )}>
                <button
                    type="button"
                    onClick={onReset}
                    disabled={!hasAny}
                    aria-label="Reset all selected filters"
                    className="flex-1 h-10 rounded-xl border border-border/50 bg-muted/30 text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98] touch-manipulation"
                >
                    Reset
                </button>
                <button
                    type="button"
                    onClick={() => onApply(draftFilters)}
                    aria-label={`Apply filters${hasAny ? `, ${countActiveFilters(draftFilters)} active` : ''}`}
                    className="flex-[2] h-10 rounded-xl bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-widest shadow-sm hover:opacity-90 transition-all active:scale-[0.98] touch-manipulation"
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
    /** Status filter (folded into drawer on mobile) */
    statusFilter?: string;
    onStatusFilterChange?: (status: string) => void;
    statusCounts?: Record<string, number>;
    /** Status vocabulary — differs per page (timesheet workflow vs attendance). */
    statusOptions?: { id: string; label: string }[];
    statusSectionLabel?: string;
    /** View type selector (folded into drawer on mobile) */
    viewType?: string;
    onViewTypeChange?: (view: string) => void;
}

const DEFAULT_STATUS_OPTIONS = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'auto_approved', label: 'Auto' },
    { id: 'approved', label: 'Approved' },
    { id: 'denied', label: 'Denied' },
    { id: 'no_show', label: 'No-Show' },
];

export const TimesheetFilterDrawer: React.FC<TimesheetFilterDrawerProps> = ({
    entries,
    appliedFilters,
    onApply,
    activeCount,
    statusFilter,
    onStatusFilterChange,
    statusCounts,
    statusOptions = DEFAULT_STATUS_OPTIONS,
    statusSectionLabel = 'Shift Status',
    viewType,
    onViewTypeChange,
}) => {
    const isMobile = useBreakpoint() === 'mobile';
    const [open, setOpen] = useState(false);
    const [draftFilters, setDraftFilters] = useState<ActiveFilters>(EMPTY_FILTERS);

    // Badge = categorical filter count + active status (if not 'all') — status
    // only folds into the badge on mobile, where it has no other home. On
    // desktop, status already has its own tab row, so this popover only ever
    // carries the categorical (Group/Sub-Group/Role) count.
    const badgeCount = activeCount + (isMobile && statusFilter && statusFilter !== 'all' ? 1 : 0);

    // Sync draft state when open
    useEffect(() => {
        if (open) setDraftFilters(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleApply = (f: ActiveFilters) => {
        onApply(f);
        setOpen(false);
    };

    // ── Desktop: compact anchored popover — categorical chips only. View
    // range and status already have their own controls on desktop (the
    // navigator + tab row), so repeating them here would be redundant. ──────
    if (!isMobile) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Filter options${badgeCount > 0 ? `, ${badgeCount} filters active` : ''}`}
                        aria-expanded={open}
                        className={cn(
                            'flex items-center gap-1.5 h-9 px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all shrink-0',
                            open || badgeCount > 0
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/60',
                        )}
                    >
                        <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Filters</span>
                        {badgeCount > 0 && (
                            <span
                                className="h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center leading-none"
                                aria-hidden="true"
                            >
                                {badgeCount}
                            </span>
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-4 bg-popover border-border rounded-2xl shadow-2xl" align="end">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60">
                            Filters
                        </p>
                        {activeCount > 0 && (
                            <button
                                type="button"
                                onClick={() => { onApply(EMPTY_FILTERS); setOpen(false); }}
                                className="text-[10px] font-black uppercase tracking-widest text-destructive hover:text-destructive/80 transition-colors"
                            >
                                Clear all
                            </button>
                        )}
                    </div>
                    <FilterContent
                        draftFilters={draftFilters}
                        setDraftFilters={setDraftFilters}
                        entries={entries}
                        onApply={handleApply}
                        onReset={() => setDraftFilters(EMPTY_FILTERS)}
                        compact
                    />
                </PopoverContent>
            </Popover>
        );
    }

    // ── Mobile: bottom-sheet drawer — folds in View Range + Status too, ────
    // since mobile has no room for separate navigator/tab-row controls.
    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
                <button
                    type="button"
                    aria-label={`Filter options${badgeCount > 0 ? `, ${badgeCount} filters active` : ''}`}
                    aria-expanded={open}
                    className={cn(
                        'relative h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border transition-all active:scale-90 touch-manipulation',
                        open || badgeCount > 0
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'bg-background border-border text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
                    )}
                >
                    <Filter className="h-4 w-4" aria-hidden="true" />
                    {badgeCount > 0 && (
                        <span 
                            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center leading-none pointer-events-none"
                            aria-hidden="true"
                        >
                            {badgeCount}
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
                    <DrawerDescription className="sr-only">Filter timesheet entries by group, role, view duration, or status</DrawerDescription>
                    <DrawerClose asChild>
                        <button 
                            type="button"
                            aria-label="Close filter drawer"
                            className="h-9 w-9 flex items-center justify-center rounded-full bg-muted/50 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </DrawerClose>
                </DrawerHeader>

                {/* Scrollable body */}
                <div className="overflow-y-auto px-5 py-5 flex-1">
                    {/* View Type Selector (folded from header on mobile) */}
                    {viewType && onViewTypeChange && (
                        <fieldset className="mb-5 pb-4 border-b border-border/20 border-none p-0 m-0" role="radiogroup" aria-label="Select view range">
                            <legend className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground/75 mb-2 p-0">
                                View Range
                            </legend>
                            <div className="flex gap-1.5">
                                {[
                                    { id: 'day', label: 'Day' },
                                    { id: '3day', label: '3-Day' },
                                    { id: 'week', label: 'Week' },
                                    { id: 'month', label: 'Month' },
                                ].map(v => {
                                    const isActive = viewType === v.id;
                                    return (
                                        <button
                                            key={v.id}
                                            type="button"
                                            role="radio"
                                            aria-checked={isActive}
                                            aria-label={`${v.label} view`}
                                            onClick={() => onViewTypeChange(v.id)}
                                            className={cn(
                                                'flex-1 h-9 rounded-lg text-[11px] font-black transition-all active:scale-95 touch-manipulation',
                                                isActive
                                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                                    : 'bg-muted/40 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60'
                                            )}
                                        >
                                            {v.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </fieldset>
                    )}

                    {/* Quick Status Filter (folded from status tabs) */}
                    {statusFilter && onStatusFilterChange && statusCounts && (
                        <fieldset className="mb-5 pb-4 border-b border-border/20 border-none p-0 m-0" role="radiogroup" aria-label={`Filter by ${statusSectionLabel.toLowerCase()}`}>
                            <legend className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground/75 mb-2 p-0">
                                {statusSectionLabel}
                            </legend>
                            <div className="flex flex-wrap gap-1.5">
                                {statusOptions.map(tab => {
                                    const isActive = statusFilter === tab.id;
                                    const count = statusCounts[tab.id] ?? 0;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            role="radio"
                                            aria-checked={isActive}
                                            aria-label={`Status filter: ${tab.label}, ${count} shifts`}
                                            onClick={() => onStatusFilterChange(tab.id)}
                                            className={cn(
                                                'flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-full border text-[11px] font-black transition-all active:scale-95 touch-manipulation',
                                                isActive
                                                    ? 'bg-primary/15 border-primary text-primary ring-1 ring-primary/20'
                                                    : 'bg-muted/40 border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border/60'
                                            )}
                                        >
                                            {isActive && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                                            <span>{tab.label}</span>
                                            <span 
                                                className={cn(
                                                    'text-[10px] font-black',
                                                    isActive ? 'text-primary/90' : 'text-muted-foreground/60'
                                                )}
                                                aria-hidden="true"
                                            >
                                                {count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </fieldset>
                    )}

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
