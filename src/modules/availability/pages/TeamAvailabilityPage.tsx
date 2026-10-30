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
import { AlertTriangle, BarChart3, FileClock, Filter, Grid3x3, Info, RefreshCcw } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { todayISO } from '@/modules/core/lib/date.utils';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
// Aliased: `page` here is the pager's page number.
import { page as pageTokens, surface } from '@/modules/core/ui/layout/pageTokens';
import { Button } from '@/modules/core/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
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
import { RosterPaginationFooter } from '@/modules/rosters/ui/components/RosterPaginationFooter';
import GridFunctionBar, {
    CELL_MODES,
    type ViewKey,
    type SortOptionKey,
} from '../ui/team/GridFunctionBar';


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
                        <span className="text-[11px] font-black uppercase tracking-wider leading-none">
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


const TeamAvailabilityPage: React.FC = () => {
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    useAuth();
    useTheme();
    useToast();
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
    const [pageSize, setPageSize] = React.useState<number>(15);

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

    const totalPages = React.useMemo(() => {
        if (!sortedMembers.length) return 1;
        if (pageSize === 0) return 1;
        return Math.max(1, Math.ceil(sortedMembers.length / pageSize));
    }, [sortedMembers.length, pageSize]);

    const pagedMembers = React.useMemo(() => {
        if (!data) return [];
        if (pageSize === 0) return sortedMembers;
        const start = (page - 1) * pageSize;
        return sortedMembers.slice(start, start + pageSize);
    }, [data, sortedMembers, page, pageSize]);

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

    const activeCellMode = CELL_MODES.find((m) => m.key === cellMode);

    // Every assigned shift in production is a draft, so an hours figure that
    // does not say so states a workload nobody has committed to as fact.
    const draftHours = React.useMemo(() => {
        let total = 0;
        for (const member of sortedMembers) {
            total += hours.byProfile.get(member.profileId)?.draftHours ?? 0;
        }
        return total;
    }, [sortedMembers, hours]);

    const isPagedView = view === 'grid';

    return (
        <PageLayout>
            <GoldStandardHeader
                title="Grid"
                Icon={Grid3x3}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                isLoading={isLoading}
                functionBar={
                    <GridFunctionBar
                        view={view}
                        onViewChange={setView}
                        selectedDate={anchorDate}
                        viewType={viewType}
                        onDateChange={(date) => setAnchorDate(date)}
                        onViewTypeChange={setViewType}
                        cellMode={cellMode}
                        onCellModeChange={setCellMode}
                        sortKey={sortKey}
                        onSortChange={setSortKey}
                        search={search}
                        onSearchChange={setSearch}
                        employmentStatuses={employmentStatuses}
                        onEmploymentStatusesChange={setEmploymentStatuses}
                        onOpenStats={() => setIsStatsOpen(true)}
                        onExport={handleExport}
                        canExport={!!data && sortedMembers.length > 0}
                        onRefresh={refetch}
                        isLoading={isLoading}
                        compactOnMobile
                    />
                }
            />

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2.5">
                <div
                    className={cn(
                        'flex-1 min-h-0 flex flex-col justify-between overflow-hidden',
                        pageTokens.bodyInset,
                        surface.bodyCard,
                    )}
                >
                    {/* Active Filters Tag */}
                    {(search.trim().length > 0 || employmentStatuses.length > 0) && data && (
                        <div className="flex items-center justify-between gap-2.5 px-3.5 py-2 rounded-2xl bg-primary/10 border border-primary/20 text-primary text-[11px] font-semibold mb-3">
                            <span className="flex items-center gap-2">
                                <Filter className="h-3.5 w-3.5 shrink-0" />
                                Filtered: showing {sortedMembers.length} of {data.members.length} members
                                {search.trim() && (
                                    <span className="text-[11px] font-bold text-foreground bg-primary/10 px-2 py-0.5 rounded-lg">
                                        "{search.trim()}"
                                    </span>
                                )}
                                {employmentStatuses.length > 0 && (
                                    <span className="text-[11px] font-bold text-foreground bg-primary/10 px-2 py-0.5 rounded-lg">
                                        {employmentStatuses.join(', ')}
                                    </span>
                                )}
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    setSearch('');
                                    setEmploymentStatuses([]);
                                }}
                                className="text-[11px] uppercase font-black tracking-wider underline hover:text-foreground shrink-0"
                            >
                                Clear Filters
                            </button>
                        </div>
                    )}

                    {/* Draft Shifts Banner */}
                    {draftHours > 0 && cellMode !== 'availability' && (
                        <div className="flex items-center justify-between gap-2.5 px-3.5 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] font-semibold mb-3">
                            <span className="flex items-center gap-2">
                                <FileClock className="h-3.5 w-3.5 shrink-0" />
                                Draft shifts are included in hours and compliance figures
                            </span>
                            <span className="text-[11px] uppercase font-black tracking-wider shrink-0 bg-amber-500/15 px-2 py-0.5 rounded-lg">
                                {draftHours.toFixed(1)} hrs draft
                            </span>
                        </div>
                    )}

                    {isError && (
                        <div
                            role="alert"
                            className="flex items-start justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 mb-3"
                        >
                            <div className="min-w-0">
                                <p className="text-[11px] font-black uppercase tracking-wider text-red-500">
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
                                className="h-8 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider gap-1.5 shrink-0"
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
                        </div>
                    )}

                    {!isLoading && !data && !isError && (
                        <p className="py-12 text-center text-[11px] font-semibold text-muted-foreground">
                            Select an organisation to view team availability.
                        </p>
                    )}
                </div>

                {/* Disconnected Pagination Footer matching People mode exactly */}
                {isPagedView && sortedMembers.length > 0 && (
                    <RosterPaginationFooter
                        currentPage={page}
                        totalPages={totalPages}
                        totalItems={sortedMembers.length}
                        pageSize={pageSize}
                        onPageChange={setPage}
                        onPageSizeChange={(newSize) => {
                            setPageSize(newSize);
                            setPage(1);
                        }}
                        itemLabel="employees"
                    />
                )}
            </div>

            <Dialog open={isStatsOpen} onOpenChange={setIsStatsOpen}>
                <DialogContent className="bg-background/95" size="xl">
                    <DialogHeader className="flex flex-row items-center justify-between border-b border-border/30 pb-4 pr-6">
                        <div>
                            <DialogTitle className="flex items-center gap-2">
                                <BarChart3 className="h-5 w-5 text-primary" />
                                Team Availability Statistics
                            </DialogTitle>
                            <DialogDescription className="mt-0.5">
                                KPI breakdown of required, available, assigned, gap, and undeclared availability hours across selected scope.
                            </DialogDescription>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={refetch}
                            disabled={isLoading}
                            className="h-8 px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider gap-1.5 border-border/40 hover:bg-primary/10 hover:text-primary transition-all shrink-0"
                        >
                            <RefreshCcw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                            Refresh Data
                        </Button>
                    </DialogHeader>

                    <div className="py-4 space-y-4">
                        {summary ? (
                            <TeamCoverageSummary summary={summary} />
                        ) : (
                            <div className="py-8 text-center text-[11px] text-muted-foreground font-semibold">
                                No stats available for current selection.
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </PageLayout>
    );
};

export default TeamAvailabilityPage;
