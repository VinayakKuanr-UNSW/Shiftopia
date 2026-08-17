/**
 * TeamAvailabilityPage — the employer half of the availability pair.
 *
 * Built on five concepts, kept distinct throughout:
 *   REQUIRED · AVAILABLE · ASSIGNED · GAP · UNSET
 *
 * The last one is the reason the page exists. Scheduling policy treats
 * undeclared availability as unavailable, so a person who never told us anything
 * is indistinguishable from one who declined the day — everywhere except here.
 *
 * Date navigation is Day / 3-Day / Week / Month via the shared
 * `UnifiedRosterNavigator`, so the snapping, bounds and range labels match the
 * Roster Planner exactly rather than being a second implementation.
 *
 * @see docs/architecture/team-availability-page-plan.md
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, ArrowUpDown, BarChart3, BatteryLow, CalendarDays, Check, ChevronDown, Clock, Download, FileClock, Filter, Gauge, Grid3x3, Info, PhoneCall, RefreshCcw, Scale, Search, ShieldCheck, Thermometer, X } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { todayISO } from '@/modules/core/lib/date.utils';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { Button } from '@/modules/core/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    UnifiedRosterNavigator,
    computeRange,
    type ViewType,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import { useQuery } from '@tanstack/react-query';
import { useTeamAvailability, type TeamAvailabilityFilters } from '../state/useTeamAvailability';
import { useTeamHours } from '../state/useTeamHours';
import { getTeamFairnessStanding, getTeamRestrictedWorkLimits } from '../api/team-availability.api';
import { TEAM_DAY_STATE_LABELS, type TeamMember } from '../model/team-availability.types';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import TeamCoverageSummary from '../ui/team/TeamCoverageSummary';
import TeamAvailabilityGrid, { type CellMode } from '../ui/team/TeamAvailabilityGrid';
import TeamMobileDayList from '../ui/team/TeamMobileDayList';
import TeamMobileCoverage from '../ui/team/TeamMobileCoverage';
import TeamDayTimeline from '../ui/team/TeamDayTimeline';
import CoverageHeatmap from '../ui/team/CoverageHeatmap';
import NearMissPanel from '../ui/team/NearMissPanel';
import TablePager, { paginate, type PageSize } from '../ui/team/TablePager';

type ViewKey = 'grid' | 'coverage' | 'nearmiss';
type SortOptionKey = 'name' | 'fewest-days' | 'most-days';

const VIEWS: Array<{ key: ViewKey; label: string; Icon: typeof Grid3x3 }> = [
    { key: 'grid', label: 'Team', Icon: Grid3x3 },
    { key: 'coverage', label: 'Coverage', Icon: Thermometer },
    { key: 'nearmiss', label: 'Near misses', Icon: PhoneCall },
];

/**
 * What each cell prints. The rows, filters, sort and pagination are identical
 * across all three — only the cell contents change, which is what lets a
 * manager read somebody's declared availability against their rostered hours
 * without moving to another page. This is the Annual Shift Grid, absorbed.
 */
const CELL_MODES: Array<{
    key: CellMode;
    label: string;
    Icon: typeof Grid3x3;
    /** What the CELLS carry, when the metric itself is not a daily quantity. */
    note?: string;
}> = [
    { key: 'availability', label: 'Availability', Icon: CalendarDays },
    { key: 'hours', label: 'Hours', Icon: Clock },
    { key: 'compliance', label: 'Compliance', Icon: ShieldCheck },
    { key: 'fatigue', label: 'Fatigue', Icon: BatteryLow },
    {
        key: 'utilization',
        label: 'Utilization',
        Icon: Gauge,
        note: 'Utilization is measured against a WEEKLY contract, so the percentage is reported in the week columns. Cells show the daily hours that build it.',
    },
    {
        key: 'fairness',
        label: 'Fairness',
        Icon: Scale,
        note: 'Fairness is a 91-day comparison against the team, so the standing is reported per person in the right-hand column. Cells show what each day contributed — Saturday, Sunday, night or public holiday.',
    },
];

const SortDropdown: React.FC<{
    sortKey: SortOptionKey;
    onSortChange: (key: SortOptionKey) => void;
}> = ({ sortKey, onSortChange }) => {
    const [open, setOpen] = React.useState(false);

    const SORT_OPTIONS: Array<{ id: SortOptionKey; label: string }> = [
        { id: 'name', label: 'Name (A–Z)' },
        { id: 'fewest-days', label: 'Fewest Days' },
        { id: 'most-days', label: 'Most Days' },
    ];

    const currentOption = SORT_OPTIONS.find((o) => o.id === sortKey) ?? SORT_OPTIONS[0];

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 min-h-[44px] md:min-h-0 md:py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-slate-100 dark:bg-muted/30 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-white/10 hover:bg-slate-200/60 dark:hover:bg-white/10 shrink-0"
                >
                    <ArrowUpDown className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                    <span>Sort: {currentOption.label}</span>
                    <ChevronDown className="w-3 h-3 opacity-60 ml-0.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-52 p-0 rounded-2xl border border-primary/20 shadow-2xl overflow-hidden bg-popover/95 backdrop-blur-xl animate-in fade-in-50 zoom-in-95 duration-100"
            >
                <Command className="bg-transparent">
                    <CommandList className="p-1 max-h-[260px] overflow-y-auto">
                        <CommandGroup heading="Sort By" className="px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                            {SORT_OPTIONS.map((opt) => {
                                const isSelected = sortKey === opt.id;
                                return (
                                    <CommandItem
                                        key={opt.id}
                                        onSelect={() => {
                                            onSortChange(opt.id);
                                            setOpen(false);
                                        }}
                                        className="flex items-center justify-between px-3 py-2 rounded-xl mb-0.5 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div
                                                className={cn(
                                                    'w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all shrink-0',
                                                    isSelected
                                                        ? 'bg-white border-white text-primary'
                                                        : 'border-muted-foreground/40 group-aria-selected:border-white/40',
                                                )}
                                            >
                                                {isSelected && (
                                                    <Check className="w-2.5 h-2.5" strokeWidth={3} />
                                                )}
                                            </div>
                                            <span className="font-bold text-xs text-foreground group-aria-selected:text-primary-foreground">
                                                {opt.label}
                                            </span>
                                        </div>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

/**
 * Which day the phone is showing, when the chosen range covers several.
 *
 * A tablist rather than a row of buttons: these select among sibling panels
 * showing the same thing for different days, which is exactly the tab pattern,
 * and it gives arrow-key movement for free. Horizontal scroll here is a
 * one-dimensional control, not content, so SC 1.4.10 is satisfied by the panel
 * below reflowing — not by cramming a month of chips into 320px.
 */
const MobileDayStrip: React.FC<{
    dates: ReadonlyArray<string>;
    selected: string;
    onSelect: (date: string) => void;
    today: string;
}> = ({ dates, selected, onSelect, today }) => {
    const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

    const move = (from: string, delta: number) => {
        const i = dates.indexOf(from);
        const next = dates[Math.min(dates.length - 1, Math.max(0, i + delta))];
        if (next && next !== from) {
            onSelect(next);
            refs.current[next]?.focus();
        }
    };

    return (
        <div
            role="tablist"
            aria-label="Select a day"
            className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1 shrink-0"
        >
            {dates.map((d) => {
                const isSelected = d === selected;
                const parsed = parseISO(d);
                return (
                    <button
                        key={d}
                        ref={(el) => {
                            refs.current[d] = el;
                        }}
                        role="tab"
                        type="button"
                        aria-selected={isSelected}
                        aria-controls="team-mobile-panel"
                        tabIndex={isSelected ? 0 : -1}
                        onClick={() => onSelect(d)}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowRight') { e.preventDefault(); move(d, 1); }
                            if (e.key === 'ArrowLeft') { e.preventDefault(); move(d, -1); }
                            if (e.key === 'Home') { e.preventDefault(); onSelect(dates[0]); refs.current[dates[0]]?.focus(); }
                            if (e.key === 'End') { e.preventDefault(); const l = dates[dates.length - 1]; onSelect(l); refs.current[l]?.focus(); }
                        }}
                        // 2.5.5 — 44x44 minimum on every chip.
                        className={cn(
                            'flex flex-col items-center justify-center shrink-0 min-w-[46px] min-h-[46px] px-2 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            isSelected
                                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                : 'bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/60',
                        )}
                    >
                        <span className="text-[10px] font-black uppercase tracking-wider leading-none">
                            {format(parsed, 'EEE')}
                        </span>
                        <span className="text-[13px] font-black tabular-nums leading-none mt-1">
                            {format(parsed, 'd')}
                        </span>
                        <span className="sr-only">
                            {format(parsed, 'EEEE d MMMM yyyy')}
                            {d === today ? ', today' : ''}
                        </span>
                        {d === today && (
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'w-1 h-1 rounded-full mt-0.5',
                                    isSelected ? 'bg-primary-foreground' : 'bg-primary',
                                )}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
};

const SkeletonRows: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
    <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="h-8 rounded-xl bg-muted/30 animate-pulse" />
        ))}
    </div>
);

const EmploymentFilterPopover: React.FC<{
    employmentStatuses: string[];
    setEmploymentStatuses: React.Dispatch<React.SetStateAction<string[]>>;
    isDark: boolean;
}> = ({ employmentStatuses, setEmploymentStatuses, isDark }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const activeCount = employmentStatuses.length;

    const toggleStatus = (status: string) => {
        setEmploymentStatuses((prev) =>
            prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
        );
    };

    const options = [
        { id: 'Casual', name: 'Casual' },
        { id: 'Part-Time', name: 'Part-Time' },
        { id: 'Full-Time', name: 'Full-Time' },
    ];

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'flex items-center gap-2 px-3 min-h-[44px] md:min-h-0 md:py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0',
                        activeCount > 0
                            ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-2 ring-primary/30'
                            : isDark
                              ? 'bg-[#111827]/60 text-muted-foreground border border-white/5 hover:bg-white/10 hover:text-foreground'
                              : 'bg-slate-100 text-slate-600 border border-slate-200/80 hover:bg-slate-200/60 hover:text-slate-900',
                    )}
                >
                    <Filter className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                        {activeCount === 0 ? 'Employment' : `Employment (${activeCount})`}
                    </span>
                    <ChevronDown className={cn('w-3 h-3 opacity-60 transition-transform', isOpen && 'rotate-180')} />
                </button>
            </PopoverTrigger>

            <PopoverContent
                className="w-72 border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
                sideOffset={8}
                align="start"
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
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                            <CommandInput
                                placeholder="Search Employment..."
                                className="h-12 text-sm border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none shadow-none w-full bg-transparent font-medium"
                                autoFocus
                            />
                        </div>

                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                            <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                                <CommandEmpty className="py-6 text-center text-muted-foreground font-medium text-xs">
                                    No options found.
                                </CommandEmpty>

                                <CommandGroup heading="Employment" className="px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                                    {options.map((opt) => {
                                        const isSelected = employmentStatuses.includes(opt.id);

                                        return (
                                            <CommandItem
                                                key={opt.id}
                                                onSelect={() => toggleStatus(opt.id)}
                                                className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className={cn(
                                                            'w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0',
                                                            isSelected
                                                                ? 'bg-white border-white text-primary'
                                                                : 'border-muted-foreground/40 group-aria-selected:border-white/40',
                                                        )}
                                                    >
                                                        {isSelected && (
                                                            <Check className="w-3 h-3" strokeWidth={3} />
                                                        )}
                                                    </div>
                                                    <span className="font-semibold text-xs text-foreground group-aria-selected:text-primary-foreground">
                                                        {opt.name}
                                                    </span>
                                                </div>
                                                <CommandShortcut className="group-aria-selected:text-white/60">
                                                    ↵
                                                </CommandShortcut>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            </CommandList>

                            <div className="p-2.5 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.18em] text-primary/60 dark:text-muted-foreground/60">
                                <div className="flex items-center gap-2.5">
                                    <span className="flex items-center gap-1">
                                        <span className="px-1 py-0.5 rounded bg-background/60 border border-border/40 text-[8px]">
                                            ↑↓
                                        </span>{' '}
                                        NAV
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <span className="px-1 py-0.5 rounded bg-background/60 border border-border/40 text-[8px]">
                                            ↵
                                        </span>{' '}
                                        SELECT
                                    </span>
                                </div>
                                <span className="flex items-center gap-1">
                                    <span className="px-1 py-0.5 rounded bg-background/60 border border-border/40 text-[8px]">
                                        ESC
                                    </span>{' '}
                                    CLOSE
                                </span>
                            </div>
                        </div>
                    </div>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

const TeamAvailabilityPage: React.FC = () => {
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { user } = useAuth();
    const { isDark } = useTheme();
    const { toast } = useToast();
    const isMobile = useIsMobile();

    const [anchorDate, setAnchorDate] = React.useState<Date>(() => new Date());
    const [viewType, setViewType] = React.useState<ViewType>('week');
    const range = React.useMemo(() => computeRange(anchorDate, viewType), [anchorDate, viewType]);
    const { start: startDate, end: endDate } = range;

    const [view, setView] = React.useState<ViewKey>('grid');
    const [search, setSearch] = React.useState('');
    const [sortKey, setSortKey] = React.useState<SortOptionKey>('name');
    const [employmentStatuses, setEmploymentStatuses] = React.useState<string[]>([]);
    const [isStatsOpen, setIsStatsOpen] = React.useState(false);

    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState<PageSize>(25);

    const filters = React.useMemo<TeamAvailabilityFilters>(
        () => ({ search, employmentStatuses }),
        [search, employmentStatuses],
    );

    const [cellMode, setCellMode] = React.useState<CellMode>('availability');

    const { data, nearMisses, isLoading, isError, error, shiftsTruncated, refetch } =
        useTeamAvailability(scope, startDate, endDate, filters);

    const EMPTY_MEMBERS: TeamMember[] = React.useMemo(() => [], []);
    const hoursMembers = data?.members ?? EMPTY_MEMBERS;

    // Reads a WIDER range than the page shows — a rolling window ending in the
    // first visible week reaches three ISO weeks behind it. See useTeamHours.
    const {
        hours,
        complianceByProfile,
        fatigueByProfile,
        fairnessContribution,
        weekColumns,
        shiftsTruncated: hoursTruncated,
    } = useTeamHours(scope, startDate, endDate, hoursMembers);

    React.useEffect(() => {
        setPage(1);
    }, [search, employmentStatuses, viewType, anchorDate, scope, sortKey]);

    const today = todayISO();

    // Which day the phone shows. The desktop grid spans the whole range at
    // once; a phone cannot, so it picks one day out of it — today when today is
    // in range, otherwise the first day.
    const [mobileDate, setMobileDate] = React.useState<string | null>(null);
    const mobileDates = data?.dates ?? [];
    const selectedMobileDate =
        mobileDate && mobileDates.includes(mobileDate)
            ? mobileDate
            : mobileDates.includes(today)
              ? today
              : (mobileDates[0] ?? today);

    const sortedMembers = React.useMemo(() => {
        if (!data) return [];
        const copy = [...data.members];

        return copy.sort((a, b) => {
            if (sortKey === 'name') {
                return a.fullName.localeCompare(b.fullName);
            }
            if (sortKey === 'fewest-days' || sortKey === 'most-days') {
                const aDateMap = data.cells.get(a.profileId);
                const bDateMap = data.cells.get(b.profileId);
                let aAvail = 0;
                let bAvail = 0;
                for (const d of data.dates) {
                    if (aDateMap?.get(d)?.state === 'available') aAvail++;
                    if (bDateMap?.get(d)?.state === 'available') bAvail++;
                }
                return sortKey === 'fewest-days' ? aAvail - bAvail : bAvail - aAvail;
            }
            return 0;
        });
    }, [data, sortKey, today]);

    const pagedMembers = React.useMemo(
        () => (data ? paginate(sortedMembers, page, pageSize) : []),
        [data, sortedMembers, page, pageSize],
    );

    // A badge, not a filter — read only for the rows actually on screen.
    const pagedIds = React.useMemo(() => pagedMembers.map((m) => m.profileId), [pagedMembers]);
    const { data: restrictedWorkLimits } = useQuery({
        queryKey: ['team-work-limits', pagedIds] as const,
        queryFn: () => getTeamRestrictedWorkLimits(pagedIds),
        enabled: pagedIds.length > 0,
        staleTime: 5 * 60_000,
    });

    // The ledger is recomputed by cron over a fixed 91-day window, so it does
    // NOT move with the dates on screen — only fetched when it is being shown.
    const { data: fairnessStanding } = useQuery({
        queryKey: ['team-fairness-standing', scope?.org_ids?.join(','), pagedIds] as const,
        queryFn: () => getTeamFairnessStanding(scope!, pagedIds),
        enabled: cellMode === 'fairness' && pagedIds.length > 0 && !!scope,
        staleTime: 10 * 60_000,
    });

    const handleExport = React.useCallback(() => {
        if (!data) return;
        // The table view the accessibility runs oblige, and the only place the
        // three cell modes are readable at once.
        const header = [
            'Member',
            'Role',
            'Employment',
            'Contract basis',
            'Weekly hours basis',
            'Total hours',
            'Draft hours',
            'Compliance',
            'Worst finding',
            ...weekColumns.map((w) => `${w.label} total${w.isPartial ? ' (full week)' : ''}`),
            ...data.dates,
            ...data.dates.map((d) => `${d} hours`),
        ];
        const lines = [header.join(',')];

        for (const member of sortedMembers) {
            const byDate = data.cells.get(member.profileId);
            const empHours = hours.byProfile.get(member.profileId);
            const empComp = complianceByProfile.get(member.profileId);
            const row = [
                member.fullName,
                member.roleName ?? '',
                member.employmentStatus ?? '',
                member.contractType ?? '',
                member.contractedWeeklyHours ?? '',
                empHours ? parseFloat(empHours.totalHours.toFixed(2)) : 0,
                empHours ? parseFloat(empHours.draftHours.toFixed(2)) : 0,
                empComp?.overallV8Severity ?? '',
                empComp?.worstDesc ?? '',
                ...weekColumns.map((w) =>
                    parseFloat((empHours?.byWeek[w.key] ?? 0).toFixed(2)),
                ),
                ...data.dates.map((d) => {
                    const cell = byDate?.get(d);
                    return cell ? TEAM_DAY_STATE_LABELS[cell.state] : '';
                }),
                ...data.dates.map((d) => {
                    const shifts = empHours?.byDate[d] ?? [];
                    if (shifts.length === 0) return '';
                    return parseFloat(
                        shifts.reduce((sum, s) => sum + s.netHours, 0).toFixed(2),
                    );
                }),
            ];
            lines.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
        }

        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `team-availability-${format(startDate, 'yyyy-MM-dd')}-to-${format(endDate, 'yyyy-MM-dd')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [data, sortedMembers, startDate, endDate, weekColumns, hours, complianceByProfile]);

    const summary = data?.summary;

    const navigator = (
        <UnifiedRosterNavigator
            date={anchorDate}
            viewType={viewType}
            onChange={(next) => setAnchorDate(next)}
            onViewTypeChange={setViewType}
            showToday={false}
            showPicker
            variant="full"
        />
    );

    const employmentFilterDropdown = (
        <EmploymentFilterPopover
            employmentStatuses={employmentStatuses}
            setEmploymentStatuses={setEmploymentStatuses}
            isDark={isDark}
        />
    );

    const sortDropdown = (
        <SortDropdown sortKey={sortKey} onSortChange={setSortKey} />
    );

    const isDayView = (data?.dates.length ?? 0) === 1;
    const activeCellMode = CELL_MODES.find((m) => m.key === cellMode);

    // Sits with the data-shaping controls, not with the view tabs above: it
    // changes what a cell SAYS, not which panel you are in. Hidden in Day view,
    // which renders the timeline — that already shows real shift times, so
    // forcing hours into it buys nothing.
    const cellModeToggle = (
        <div
            className={cn(
                'flex items-center gap-1 p-1 rounded-2xl border transition-all shrink-0',
                isDark ? 'bg-[#111827]/80 border-white/5' : 'bg-slate-100/90 border-slate-200/80',
            )}
            role="group"
            aria-label="What each cell shows"
        >
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70 pl-2 pr-0.5 hidden lg:inline">
                Cells
            </span>
            {CELL_MODES.map(({ key, label, Icon }) => (
                <button
                    key={key}
                    type="button"
                    aria-pressed={cellMode === key}
                    onClick={() => setCellMode(key)}
                    className={cn(
                        'flex items-center gap-1.5 h-11 md:h-8 px-3 md:px-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        cellMode === key
                            ? isDark
                                ? 'bg-[#1c2333] text-white shadow-md shadow-black/20 ring-1 ring-white/10'
                                : 'bg-white text-slate-900 shadow-md shadow-slate-200/50 ring-1 ring-slate-200'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                    )}
                >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden md:inline">{label}</span>
                </button>
            ))}
        </div>
    );

    // Every assigned shift in production is a draft, so an hours figure that
    // does not say so states a workload nobody has committed to as fact.
    const draftHours = React.useMemo(() => {
        let total = 0;
        for (const member of sortedMembers) {
            total += hours.byProfile.get(member.profileId)?.draftHours ?? 0;
        }
        return total;
    }, [sortedMembers, hours]);

    const draftChip = draftHours > 0 && cellMode !== 'availability' && (
        <span
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[10px] font-black uppercase tracking-wider shrink-0"
            title="Draft shifts are included in every hours and compliance figure on this page"
        >
            <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
            Drafts included
        </span>
    );

    const viewTabs = (
        <div
            className={cn(
                'flex items-center gap-1 p-1 rounded-2xl border transition-all shrink-0',
                isDark ? 'bg-[#111827]/80 border-white/5' : 'bg-slate-100/90 border-slate-200/80',
            )}
            role="tablist"
            aria-label="Team availability view"
        >
            {VIEWS.map(({ key, label, Icon }) => (
                <button
                    key={key}
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    className={cn(
                        'flex items-center gap-1.5 h-11 md:h-8 px-3 md:px-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        view === key
                            ? isDark
                                ? 'bg-[#1c2333] text-white shadow-md shadow-black/20 ring-1 ring-white/10'
                                : 'bg-white text-slate-900 shadow-md shadow-slate-200/50 ring-1 ring-slate-200'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                    )}
                >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden md:inline">{label}</span>
                </button>
            ))}
        </div>
    );

    const isPagedView = view === 'grid';

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            <GoldStandardHeader
                title="Availability Manager"
                Icon={CalendarDays}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                isLoading={isLoading}
                viewMode="table"
                onViewModeChange={() => undefined}
                hideViewModeToggle
                functionBarChildren={
                    <div
                        role="toolbar"
                        aria-label="Availability manager view and filter controls"
                        className="flex flex-col gap-2 w-full text-foreground"
                    >
                        {/* Row 1: Mode Toggle · Granularity & Date Navigator · Action Buttons */}
                        <div className="flex flex-wrap items-center justify-between gap-2.5 w-full">
                            <div className="flex flex-wrap items-center gap-2">
                                {viewTabs}
                                <div className="h-6 w-px bg-border/20 shrink-0 hidden sm:block" aria-hidden="true" />
                                {navigator}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0" role="group" aria-label="Page actions">
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => setIsStatsOpen(true)}
                                    title="Analytics Stats"
                                    aria-label="Analytics Stats"
                                    className="h-11 w-11 md:h-9 md:w-9 rounded-xl shadow-xs hover:bg-primary/10 hover:text-primary transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
                                </Button>
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={handleExport}
                                    disabled={!data}
                                    title="Export CSV"
                                    aria-label="Export CSV"
                                    className="h-11 w-11 md:h-9 md:w-9 rounded-xl shadow-xs hover:bg-primary/10 hover:text-primary transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    <Download className="h-4 w-4 text-foreground" aria-hidden="true" />
                                </Button>
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={refetch}
                                    disabled={isLoading}
                                    title="Refresh data"
                                    aria-label="Refresh data"
                                    className="h-11 w-11 md:h-9 md:w-9 rounded-xl shadow-xs hover:bg-primary/10 hover:text-primary transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    <RefreshCcw className={cn("h-4 w-4 text-foreground", isLoading && "animate-spin")} aria-hidden="true" />
                                </Button>
                            </div>
                        </div>

                        {/* Row 2: Integrated Filter, Sort & Search Group */}
                        <div className="flex flex-wrap items-center justify-between gap-2.5 w-full pt-1.5 border-t border-border/10">
                            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                                {/* Accessible Search Input */}
                                <div role="search" className="flex-1 max-w-sm min-w-[200px]">
                                    <label htmlFor="team-member-search" className="sr-only">
                                        Search team members
                                    </label>
                                    <div className={cn(
                                        "flex items-center gap-2 h-11 md:h-9 px-3 rounded-xl border transition-all focus-within:ring-2 focus-within:ring-primary focus-within:border-primary/50",
                                        isDark ? "bg-[#111827]/80 border-white/10" : "bg-slate-100/90 border-slate-200"
                                    )}>
                                        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                                        <input
                                            id="team-member-search"
                                            type="search"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Search team member..."
                                            aria-label="Search team member by name or role"
                                            className="bg-transparent border-none text-xs font-semibold placeholder:text-muted-foreground/70 outline-none w-full text-foreground"
                                        />
                                        {search && (
                                            <button
                                                type="button"
                                                onClick={() => setSearch('')}
                                                aria-label="Clear search"
                                                className="flex items-center justify-center h-11 w-11 md:h-6 md:w-6 -mr-2 md:mr-0 shrink-0 text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                            >
                                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {employmentFilterDropdown}
                                {sortDropdown}
                                {view === 'grid' && (isMobile || !isDayView) && cellModeToggle}
                                {draftChip}
                            </div>

                            {/* Active Members Results Counter Badge */}
                            {data && (
                                <div
                                    className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted/30 border border-border/20 text-[11px] font-bold text-muted-foreground shrink-0 select-none"
                                    aria-live="polite"
                                    aria-atomic="true"
                                >
                                    <span className="text-foreground font-black tabular-nums">{sortedMembers.length}</span>
                                    <span>of</span>
                                    <span className="tabular-nums">{data.members.length}</span>
                                    <span>members</span>
                                </div>
                            )}
                        </div>
                    </div>
                }
            />

            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6 flex flex-col">
                <div
                    className={cn(
                        'h-full flex-1 min-h-0 flex flex-col justify-between overflow-hidden transition-all',
                        isDark
                            ? 'bg-transparent'
                            : 'bg-white/50 backdrop-blur-xs',
                    )}
                >
                    {isError && (
                        <div
                            role="alert"
                            className="flex items-start justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 mb-3"
                        >
                            <div className="min-w-0">
                                <p className="text-xs font-black uppercase tracking-wider text-red-500">
                                    Could not load team availability
                                </p>
                                <p className="text-[11px] text-muted-foreground mt-1">
                                    {error?.message ?? 'Unknown error'}
                                </p>
                            </div>
                            {/* An error with no way out is a dead end — the only other
                                retry lives inside the analytics dialog. */}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={refetch}
                                disabled={isLoading}
                                className="h-8 px-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider gap-1.5 shrink-0"
                            >
                                <RefreshCcw
                                    className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')}
                                    aria-hidden="true"
                                />
                                Retry
                            </Button>
                        </div>
                    )}

                    {/* Utilization and fairness are not daily quantities. Rather
                        than quietly rendering something that looks like one,
                        the mode says where its number actually lives. */}
                    {view === 'grid' && activeCellMode?.note && (
                        <div className="flex items-start gap-2.5 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-2.5 mb-3">
                            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                            <p className="text-[11px] font-semibold text-muted-foreground">
                                {activeCellMode.note}
                            </p>
                        </div>
                    )}

                    {/* Truncated shift data reads LOW and PASSING — the one
                        failure mode that looks like good news. Never silent. */}
                    {(shiftsTruncated || hoursTruncated) && (
                        <div
                            role="alert"
                            className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 mb-3"
                        >
                            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                            <p className="text-[11px] font-semibold text-foreground">
                                Too many shifts in this range to read them all — hours and
                                compliance below are computed from a partial set and will
                                understate. Narrow the date range or the scope.
                            </p>
                        </div>
                    )}

                    {/* The Grid invented a row for these people from the shift's
                        own profile join. Rows here come from active contracts,
                        so the alternative to saying this is saying nothing. */}
                    {hours.orphanShiftCount > 0 && view === 'grid' && (
                        <div className="flex items-start gap-2.5 rounded-2xl border border-border/40 bg-muted/30 px-4 py-2.5 mb-3">
                            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                            <p className="text-[11px] font-semibold text-muted-foreground">
                                <span className="text-foreground">{hours.orphanShiftCount}</span>{' '}
                                shift{hours.orphanShiftCount === 1 ? ' is' : 's are'} assigned to{' '}
                                <span className="text-foreground">{hours.orphanProfileIds.size}</span>{' '}
                                {hours.orphanProfileIds.size === 1 ? 'person' : 'people'} with no
                                active contract in this scope, so they have no row here and their
                                hours are not counted.
                            </p>
                        </div>
                    )}

                    {isLoading && (
                        <>
                            <SkeletonRows />
                            <p className="sr-only" role="status">
                                Loading team availability
                            </p>
                        </>
                    )}

                    {/* ── Phone composition ──
                        Not a shrunken grid: a people × days matrix needs
                        two-dimensional scrolling at 320px, which SC 1.4.10
                        forbids, and shrinking the cells to fit breaks 1.4.4
                        instead. One day, members down the page. */}
                    {!isLoading && data && isMobile && (
                        <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-hidden">
                            {data.dates.length > 1 && (
                                <MobileDayStrip
                                    dates={data.dates}
                                    selected={selectedMobileDate}
                                    onSelect={setMobileDate}
                                    today={today}
                                />
                            )}

                            <div
                                id="team-mobile-panel"
                                role="tabpanel"
                                aria-label={`${format(parseISO(selectedMobileDate), 'EEEE d MMMM yyyy')}`}
                                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-2"
                            >
                                {view === 'grid' && (
                                    <TeamMobileDayList
                                        members={pagedMembers}
                                        date={selectedMobileDate}
                                        cells={data.cells}
                                        cellMode={cellMode}
                                        hoursByProfile={hours.byProfile}
                                        complianceByProfile={complianceByProfile}
                                        restrictedWorkLimits={restrictedWorkLimits}
                                        fatigueByProfile={fatigueByProfile}
                                        fairnessContribution={fairnessContribution}
                                        fairnessStanding={fairnessStanding}
                                    />
                                )}
                                {view === 'coverage' && (
                                    <TeamMobileCoverage buckets={data.buckets} date={selectedMobileDate} />
                                )}
                                {view === 'nearmiss' && <NearMissPanel nearMisses={nearMisses} />}
                            </div>

                            {isPagedView && sortedMembers.length > 0 && (
                                <div className="shrink-0 pt-2 border-t border-border/20">
                                    <TablePager
                                        page={page}
                                        pageSize={pageSize}
                                        totalItems={sortedMembers.length}
                                        onPageChange={setPage}
                                        onPageSizeChange={(size) => {
                                            setPageSize(size);
                                            setPage(1);
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {!isLoading && data && !isMobile && (
                        <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
                            <div className="flex-1 min-h-0 overflow-auto">
                                {view === 'grid' &&
                                    (data.dates.length === 1 ? (
                                        <TeamDayTimeline
                                            members={pagedMembers}
                                            date={data.dates[0]}
                                            cells={data.cells}
                                        />
                                    ) : (
                                        <TeamAvailabilityGrid
                                            members={pagedMembers}
                                            dates={data.dates}
                                            cells={data.cells}
                                            density={data.dates.length <= 7 ? 'comfortable' : 'compact'}
                                            cellMode={cellMode}
                                            weekColumns={weekColumns}
                                            hoursByProfile={hours.byProfile}
                                            complianceByProfile={complianceByProfile}
                                            restrictedWorkLimits={restrictedWorkLimits}
                                            fatigueByProfile={fatigueByProfile}
                                            fairnessContribution={fairnessContribution}
                                            fairnessStanding={fairnessStanding}
                                        />
                                    ))}

                                {view === 'coverage' && (
                                    <CoverageHeatmap buckets={data.buckets} dates={data.dates} />
                                )}
                                {view === 'nearmiss' && <NearMissPanel nearMisses={nearMisses} />}
                            </div>

                            {isPagedView && sortedMembers.length > 0 && (
                                <div className="shrink-0 pt-2 border-t border-border/20 bg-background/90 backdrop-blur-md z-30">
                                    <TablePager
                                        page={page}
                                        pageSize={pageSize}
                                        totalItems={sortedMembers.length}
                                        onPageChange={setPage}
                                        onPageSizeChange={(size) => {
                                            setPageSize(size);
                                            setPage(1);
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {!isLoading && !data && !isError && (
                        <p className="py-12 text-center text-xs font-semibold text-muted-foreground">
                            Select an organisation to view team availability.
                        </p>
                    )}
                </div>
            </div>

            <Dialog open={isStatsOpen} onOpenChange={setIsStatsOpen}>
                <DialogContent className="max-w-4xl rounded-3xl p-6 bg-background/95 backdrop-blur-xl border border-border/40 shadow-2xl">
                    <DialogHeader className="flex flex-row items-center justify-between border-b border-border/30 pb-4 pr-6">
                        <div>
                            <DialogTitle className="text-xl font-black tracking-tight text-foreground flex items-center gap-2">
                                <BarChart3 className="h-5 w-5 text-primary" />
                                Team Availability Statistics
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground mt-0.5 font-medium">
                                KPI breakdown of required, available, assigned, gap, and undeclared availability hours across selected scope.
                            </DialogDescription>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={refetch}
                            disabled={isLoading}
                            className="h-8 px-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider gap-1.5 border-border/40 hover:bg-primary/10 hover:text-primary transition-all shrink-0"
                        >
                            <RefreshCcw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                            Refresh Data
                        </Button>
                    </DialogHeader>

                    <div className="py-4 space-y-4">
                        {summary ? (
                            <TeamCoverageSummary summary={summary} />
                        ) : (
                            <div className="py-8 text-center text-xs text-muted-foreground font-semibold">
                                No stats available for current selection.
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default TeamAvailabilityPage;
