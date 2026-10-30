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
import { X, Filter, Check, ChevronDown } from 'lucide-react';
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
// Five fixed roster groups (roster_groups table; Office added 2026-10-04 for
// full-time shifts). 'v' is the canonical enum key (shifts.group_type /
// roster_groups.external_id).
export const GROUP_OPTIONS: { v: string; l: string }[] = [
    { v: 'convention_centre', l: 'Convention' },
    { v: 'exhibition_centre', l: 'Exhibition' },
    { v: 'theatre',           l: 'Theatre' },
    { v: 'the_cutaway',       l: 'The Cutaway' },
    { v: 'office',            l: 'Office' },
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
    office: 'office',
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
        <legend className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/75 mb-1.5 p-0">
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
    triggerVariant?: 'dropdown' | 'icon' | 'default';
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
    triggerVariant = 'default',
}) => {
    const isMobile = useBreakpoint() === 'mobile';
    const [open, setOpen] = useState(false);
    const [draftFilters, setDraftFilters] = useState<ActiveFilters>(EMPTY_FILTERS);

    // Badge = categorical filter count + active status (if not 'all')
    const isStatusActive = Boolean(statusFilter && statusFilter !== 'all');
    const badgeCount = activeCount + (isStatusActive ? 1 : 0);

    const availableGroups = useMemo(() => {
        const filtered = GROUP_OPTIONS.filter(g => entries.some(e => normalizeGroupKey(e.group) === g.v));
        return filtered.length > 0 ? filtered : GROUP_OPTIONS;
    }, [entries]);

    const availableSubGroups = useMemo(() => {
        const source = appliedFilters.groupTypes.length > 0
            ? entries.filter(e => appliedFilters.groupTypes.includes(normalizeGroupKey(e.group)))
            : entries;
        return [...new Set(source.map(e => e.subGroup).filter(Boolean))].sort() as string[];
    }, [entries, appliedFilters.groupTypes]);

    const availableRoles = useMemo(
        () => [...new Set(entries.map(e => e.role).filter(Boolean))].sort() as string[],
        [entries],
    );

    // Sync draft state when open
    useEffect(() => {
        if (open) setDraftFilters(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleApply = (f: ActiveFilters) => {
        onApply(f);
        setOpen(false);
    };

    // ── Desktop: Global Scope UI floating popover with detached search + options cards ──
    if (!isMobile) {
        const desktopTrigger = triggerVariant === 'icon' ? (
            <PopoverTrigger asChild>
                <ToolbarIconButton
                    icon={<Filter />}
                    tooltip={badgeCount > 0 ? `Filters (${badgeCount} active)` : 'Filters'}
                    aria-pressed={undefined}
                    variant="amber"
                    isActive={open || badgeCount > 0}
                    badge={badgeCount}
                    badgeClassName="bg-orange-500 text-white"
                />
            </PopoverTrigger>
        ) : triggerVariant === 'dropdown' ? (
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Filter options${badgeCount > 0 ? `, ${badgeCount} filters active` : ''}`}
                    aria-expanded={open}
                    className={cn(
                        "relative flex items-center justify-between gap-2.5 h-11 md:h-10 px-3 md:px-3.5 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all duration-300",
                        "hover:scale-[1.02] active:scale-[0.98]",
                        open || badgeCount > 0
                            ? "ring-2 ring-amber-500/30 bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400 shadow-sm"
                            : "bg-slate-100 dark:bg-[#111827]/60 border-slate-200/50 dark:border-white/5 text-muted-foreground hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#111827]/80",
                    )}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <Filter className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                        <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40 leading-none">
                                Filters
                            </span>
                            <span className="truncate max-w-[120px] text-[11px] font-semibold">
                                {badgeCount > 0 ? `${badgeCount} Active` : 'All'}
                            </span>
                        </div>
                    </div>
                    <ChevronDown className={cn(
                        "h-3 w-3 opacity-60 shrink-0 transition-transform duration-300",
                        open && "rotate-180"
                    )} aria-hidden="true" />
                </button>
            </PopoverTrigger>
        ) : (
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Filter options${badgeCount > 0 ? `, ${badgeCount} filters active` : ''}`}
                    aria-expanded={open}
                    className={cn(
                        'flex items-center gap-1.5 h-9 px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all shrink-0',
                        open || badgeCount > 0
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
                            : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/60',
                    )}
                >
                    <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Filters</span>
                    {badgeCount > 0 && (
                        <span
                            className="h-4 w-4 rounded-full bg-amber-500 text-white text-[11px] font-black flex items-center justify-center leading-none"
                            aria-hidden="true"
                        >
                            {badgeCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
        );

        return (
            <Popover open={open} onOpenChange={setOpen}>
                {desktopTrigger}
                <PopoverContent
                    className="w-[340px] sm:w-[380px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
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
                            {/* 1. Search Bar Container */}
                            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                                <CommandInput
                                    placeholder="Search filters (status, group, role)..."
                                    className="h-14 text-[14px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                    autoFocus
                                />
                            </div>

                            {/* 2. Results Container */}
                            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                                <CommandList className="max-h-[55vh] p-1.5 scrollbar-none overflow-x-hidden">
                                    <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-[13px]">
                                        No filters found.
                                    </CommandEmpty>

                                    {/* Status Section */}
                                    {statusOptions && statusOptions.length > 0 && (
                                        <CommandGroup heading={statusSectionLabel || "Status"} className="px-1">
                                            {statusOptions.map((opt) => {
                                                const isSelected = (statusFilter ?? 'all') === opt.id;
                                                const count = statusCounts?.[opt.id];
                                                return (
                                                    <CommandItem
                                                        key={`status-${opt.id}`}
                                                        value={`status ${opt.label}`}
                                                        onSelect={() => {
                                                            onStatusFilterChange?.(opt.id);
                                                        }}
                                                        className="flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                                    >
                                                        <div className={cn(
                                                            "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                                                            isSelected
                                                                ? "bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary group-aria-selected:border-white"
                                                                : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                        )}>
                                                            {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                                        </div>
                                                        <div className="flex items-center justify-between flex-1 min-w-0">
                                                            <span className="font-semibold text-[13px] capitalize truncate">{opt.label}</span>
                                                            {typeof count === 'number' && (
                                                                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-muted group-aria-selected:bg-white/20 text-muted-foreground group-aria-selected:text-white ml-2 shrink-0">
                                                                    {count}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    )}

                                    {/* Group Type Section */}
                                    <CommandGroup heading="Group Type" className="px-1">
                                        {availableGroups.map((opt) => {
                                            const isSelected = appliedFilters.groupTypes.includes(opt.v);
                                            return (
                                                <CommandItem
                                                    key={`group-${opt.v}`}
                                                    value={`group ${opt.l}`}
                                                    onSelect={() => {
                                                        const next = toggleItem(appliedFilters.groupTypes, opt.v);
                                                        onApply({ ...appliedFilters, groupTypes: next });
                                                    }}
                                                    className="flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                                >
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                                                        isSelected
                                                            ? "bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary group-aria-selected:border-white"
                                                            : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                    )}>
                                                        {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                                    </div>
                                                    <span className="font-semibold text-[13px] capitalize truncate">{opt.l}</span>
                                                    <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>

                                    {/* Sub-Group Section */}
                                    {availableSubGroups.length > 0 && (
                                        <CommandGroup heading="Sub-Group" className="px-1">
                                            {availableSubGroups.map((sg) => {
                                                const isSelected = appliedFilters.subGroups.includes(sg);
                                                return (
                                                    <CommandItem
                                                        key={`subgroup-${sg}`}
                                                        value={`subgroup ${sg}`}
                                                        onSelect={() => {
                                                            const next = toggleItem(appliedFilters.subGroups, sg);
                                                            onApply({ ...appliedFilters, subGroups: next });
                                                        }}
                                                        className="flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                                    >
                                                        <div className={cn(
                                                            "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                                                            isSelected
                                                                ? "bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary group-aria-selected:border-white"
                                                                : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                        )}>
                                                            {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                                        </div>
                                                        <span className="font-semibold text-[13px] truncate">{sg}</span>
                                                        <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    )}

                                    {/* Role Section */}
                                    {availableRoles.length > 0 && (
                                        <CommandGroup heading="Role" className="px-1">
                                            {availableRoles.map((r) => {
                                                const isSelected = appliedFilters.roles.includes(r);
                                                return (
                                                    <CommandItem
                                                        key={`role-${r}`}
                                                        value={`role ${r}`}
                                                        onSelect={() => {
                                                            const next = toggleItem(appliedFilters.roles, r);
                                                            onApply({ ...appliedFilters, roles: next });
                                                        }}
                                                        className="flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                                    >
                                                        <div className={cn(
                                                            "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                                                            isSelected
                                                                ? "bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary group-aria-selected:border-white"
                                                                : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                        )}>
                                                            {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                                        </div>
                                                        <span className="font-semibold text-[13px] truncate">{r}</span>
                                                        <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    )}
                                </CommandList>

                                {/* Keyboard & Action footer */}
                                <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50">
                                    <div className="flex items-center gap-4">
                                        <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↑↓</kbd> Nav</span>
                                        <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↵</kbd> Select</span>
                                    </div>
                                    {badgeCount > 0 ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onApply(EMPTY_FILTERS);
                                                if (onStatusFilterChange) onStatusFilterChange('all');
                                            }}
                                            className="text-[11px] font-black uppercase tracking-wider text-amber-500 hover:text-amber-600 transition-colors cursor-pointer"
                                        >
                                            Clear all ({badgeCount})
                                        </button>
                                    ) : (
                                        <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">esc</kbd> Close</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Command>
                </PopoverContent>
            </Popover>
        );
    }

    // ── Mobile: bottom-sheet drawer — folds in the Status tabs, which have no
    // room of their own on a phone.
    //
    // View Range used to live here too, on the same reasoning. It does not
    // belong: it is what the page is showing, not a filter on it, and it
    // changes far more often than anything else in this sheet — putting it
    // behind a funnel icon, a scroll and an Apply made the commonest action on
    // the screen the most expensive one. It is now `MobileViewRangeToggle`,
    // sitting beside the date navigator in the function bar. Do not re-add it
    // here: two controls for one piece of state is how they drift apart.
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
                            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[11px] font-black flex items-center justify-center leading-none pointer-events-none"
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
                    <DrawerTitle>
                        Filters
                    </DrawerTitle>
                    <DrawerDescription className="sr-only">Filter timesheet entries by group, role, or status</DrawerDescription>
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
                    {/* Quick Status Filter (folded from status tabs) */}
                    {statusFilter && onStatusFilterChange && statusCounts && (
                        <fieldset className="mb-5 pb-4 border-b border-border/20 border-none p-0 m-0" role="radiogroup" aria-label={`Filter by ${statusSectionLabel.toLowerCase()}`}>
                            <legend className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/75 mb-2 p-0">
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
                                                    'text-[11px] font-black',
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
