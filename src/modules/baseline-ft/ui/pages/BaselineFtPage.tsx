/**
 * Baseline FT Schedule — the manager's surface.
 *
 * ONE SCREEN, ONE BUTTON. Scope at the top, a window to work in, a table of
 * who works when, and Apply. The previous version had four numbered steps and
 * two buttons — Generate, then Create drafts — because a proposal had to be
 * persisted before it could be applied. With the table recomputing continuously
 * there is nothing to persist in between: what Generate used to show is on
 * screen already, so the step disappeared rather than being hidden.
 *
 * THE WINDOW IS NOT THE CYCLE, AND THE TABLE SAYS SO IN BOTH PLACES. Day /
 * 3-Day / Week / Month choose what Apply writes into. cl 35.1(a) caps a
 * DECLARED CYCLE — four weeks, anchored to a Monday — which has nothing to do
 * with the calendar a manager happens to be looking at. So the header states
 * the enclosing cycle beside the window, and the table's Cycle column always
 * reports against the cycle regardless of zoom. Reporting "required hours" for
 * a three-day window would be arithmetically correct and operationally
 * meaningless.
 *
 * APPLY IS THE ONLY THING THAT WRITES, and it saves the patterns on the way
 * past, so a manager never has to press Save before Apply to get what they can
 * already see.
 */

import React from 'react';
import { AlertTriangle, CalendarRange, CheckCircle2, Loader2, Save, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { format } from 'date-fns';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageState } from '@/modules/core/ui/components/PageState';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { getSydneyNow } from '@/modules/core/lib/date.utils';
import {
    UnifiedRosterNavigator, computeRange, type ViewType,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import { cycleBoundsFor } from '@/modules/compliance/ordinary-hours-cycle';

import {
    useApplyBaseline, useBaselinePatternRows, useBaselineWorld, useFtProfile,
    useRosterableSubDepartments, useRosterCoverage, useSaveBaselinePatterns,
} from '../../hooks/useBaselineFt';
import { computeProposal } from '../../api/baselineFt.commands';
import { resolveRosterTarget } from '../../api/rosterTarget';
import {
    copyPatternShape, cycleVerdict, deriveRow, rowsToPattern, seedRow, type PatternRow,
} from '../../domain/patternRow';
import type { BaselinePattern } from '../../domain/types';
import { BaselineSummary, fmtHours } from '../components/BaselineLedger';
import {
    BaselinePatternTable, type EmployeePatternModel,
} from '../components/BaselinePatternTable';
import { FindingList } from '../components/FindingList';

/** A row's shape, for comparing a draft against what is stored. */
function signature(r: PatternRow): string {
    return [
        r.employeeId, r.weekInCycle, [...r.days].sort((a, b) => a - b).join(''),
        r.startTime, r.endTime, r.unpaidBreakMinutes, r.roleId,
    ].join('|');
}

function toHhmm(minutes: number): string {
    const w = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`;
}

function toMinutes(hhmm: string): number {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

const BaselineFtPage: React.FC = () => {
    const { user } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { toast } = useToast();

    // Resolved ONCE per page load and passed into every computation, so a
    // proposal is reproducible and does not depend on when it happened to run.
    // Sydney, because every roster date in this system is Sydney.
    const referenceDate = React.useMemo(() => format(getSydneyNow(), 'yyyy-MM-dd'), []);
    const generatedAt = React.useMemo(() => new Date().toISOString(), []);

    // ── The window ───────────────────────────────────────────────────────────
    const [anchorDate, setAnchorDate] = React.useState<Date>(() => getSydneyNow());
    const [viewType, setViewType] = React.useState<ViewType>('week');
    const range = React.useMemo(() => computeRange(anchorDate, viewType), [anchorDate, viewType]);
    const periodStart = format(range.start, 'yyyy-MM-dd');
    const periodEnd = format(range.end, 'yyyy-MM-dd');

    // ── Scope ────────────────────────────────────────────────────────────────
    //
    // The scope header owns org / department / sub-department, so this page
    // carries no second, rival picker. The selection is read as a SET, never as
    // `[0]`: reading the first entry of a scope array is a known defect class
    // here — thirteen-plus pages silently show one organisation's data to
    // someone who can see several — and this feature writes shifts, so a wrong
    // guess creates real rosters. More than one selected is reported, never
    // resolved.
    const selectedSubdeptIds = scope.subdept_ids ?? [];
    const subDepartmentId = selectedSubdeptIds.length === 1 ? selectedSubdeptIds[0] : null;
    const tooManySubDepts = selectedSubdeptIds.length > 1;

    const subDepts = useRosterableSubDepartments(selectedSubdeptIds);
    const savedRows = useBaselinePatternRows(subDepartmentId);
    const world = useBaselineWorld(subDepartmentId, periodStart, periodEnd);
    const ftProfile = useFtProfile(subDepartmentId);
    const coverage = useRosterCoverage(subDepartmentId, periodStart, periodEnd);
    const savePatterns = useSaveBaselinePatterns();
    const apply = useApplyBaseline();

    const selectedSubDept = subDepts.data?.find(s => s.id === subDepartmentId) ?? null;

    const [draft, setDraft] = React.useState<PatternRow[] | null>(null);
    const [confirmOpen, setConfirmOpen] = React.useState(false);

    // ── Seeding ──────────────────────────────────────────────────────────────
    //
    // Every eligible employee arrives with a row: their saved pattern, or one
    // derived from their own contract. That is what removes the empty state —
    // there is no picker that can be empty and no button that can dead-end,
    // because the table is the pattern.
    React.useEffect(() => {
        if (!savedRows.data || !world.data || !subDepartmentId) return;

        const byEmployee = new Map<string, PatternRow[]>();
        for (const r of savedRows.data) {
            const bucket = byEmployee.get(r.employeeId);
            if (bucket) bucket.push(r); else byEmployee.set(r.employeeId, [r]);
        }

        const rowsFor = (e: (typeof world.data.employees)[number]): PatternRow[] => {
            const existing = byEmployee.get(e.facts.employeeId);
            if (existing && existing.length > 0) return existing;
            return [seedRow({
                rowId: `seed:${e.facts.employeeId}`,
                employeeId: e.facts.employeeId,
                userContractId: e.facts.userContractId,
                roleId: e.facts.roleId,
                weeklyHours: e.facts.contractedWeeklyHours ?? ftProfile.data?.weeklyHours ?? 38,
            })];
        };

        setDraft(prev => {
            if (prev === null) return world.data!.employees.flatMap(rowsFor);

            // Edits in progress are never clobbered: the world refetches every
            // time the date window moves, and re-seeding then would discard
            // whatever the manager had just typed. But somebody whose contract
            // starts inside a later window appears only on that refetch, so
            // rows are ADDED for anyone not yet represented rather than the
            // whole draft being left alone.
            const represented = new Set(prev.map(r => r.employeeId));
            const additions = world.data!.employees
                .filter(e => !represented.has(e.facts.employeeId))
                .flatMap(rowsFor);

            // Same reference when there is nothing to add — a new array here
            // would re-run every downstream memo on every window change.
            return additions.length === 0 ? prev : [...prev, ...additions];
        });
    }, [savedRows.data, world.data, subDepartmentId, ftProfile.data?.weeklyHours]);

    // Changing team discards the draft — it belongs to the old team.
    React.useEffect(() => { setDraft(null); }, [subDepartmentId]);

    const rows = draft ?? [];

    // ── The proposal, recomputed on every edit ───────────────────────────────
    const patternsByEmployee = React.useMemo(() => {
        const out = new Map<string, BaselinePattern>();
        if (!world.data || !subDepartmentId) return out;
        for (const e of world.data.employees) {
            out.set(e.facts.employeeId, rowsToPattern(
                e.facts.employeeId, e.facts.userContractId, subDepartmentId, rows,
            ));
        }
        return out;
    }, [rows, world.data, subDepartmentId]);

    const proposal = React.useMemo(() => {
        if (!world.data || !selectedSubDept) return null;
        return computeProposal({
            world: world.data,
            patternsByEmployee,
            organizationId: selectedSubDept.organizationId,
            departmentId: selectedSubDept.departmentId,
            subDepartmentId: selectedSubDept.id,
            periodStart, periodEnd, referenceDate, generatedAt,
        });
    }, [world.data, patternsByEmployee, selectedSubDept, periodStart, periodEnd,
        referenceDate, generatedAt]);

    // ── Dirty tracking ───────────────────────────────────────────────────────
    const savedSignatures = React.useMemo(
        () => new Set((savedRows.data ?? []).map(signature)),
        [savedRows.data],
    );
    const savedByEmployee = React.useMemo(() => {
        const m = new Map<string, number>();
        for (const r of savedRows.data ?? []) m.set(r.employeeId, (m.get(r.employeeId) ?? 0) + 1);
        return m;
    }, [savedRows.data]);

    const dirtyEmployeeIds = React.useMemo(() => {
        const out = new Set<string>();
        const draftCounts = new Map<string, number>();
        for (const r of rows) {
            draftCounts.set(r.employeeId, (draftCounts.get(r.employeeId) ?? 0) + 1);
            if (!savedSignatures.has(signature(r))) out.add(r.employeeId);
        }
        // A line REMOVED leaves no signature to miss, so counts are compared too.
        for (const [employeeId, saved] of savedByEmployee) {
            if ((draftCounts.get(employeeId) ?? 0) !== saved) out.add(employeeId);
        }
        return out;
    }, [rows, savedSignatures, savedByEmployee]);

    // ── The table's view model ───────────────────────────────────────────────
    const ledgerById = React.useMemo(
        () => new Map((proposal?.ledgers ?? []).map(l => [l.employeeId, l])),
        [proposal],
    );

    const employees: EmployeePatternModel[] = React.useMemo(() => {
        if (!world.data) return [];
        return [...world.data.employees]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(e => {
                const mine = rows.filter(r => r.employeeId === e.facts.employeeId);
                return {
                    employeeId: e.facts.employeeId,
                    name: e.name,
                    roleName: e.roleName,
                    contractedWeeklyHours:
                        e.facts.contractedWeeklyHours ?? ftProfile.data?.weeklyHours ?? 38,
                    cycleWeeks: e.facts.cycleWeeks,
                    rows: mine,
                    verdict: cycleVerdict(mine, e.facts),
                    ledger: ledgerById.get(e.facts.employeeId) ?? null,
                    hasUnsavedEdits: dirtyEmployeeIds.has(e.facts.employeeId),
                };
            });
    }, [world.data, rows, ledgerById, dirtyEmployeeIds, ftProfile.data?.weeklyHours]);

    // ── Row editing ──────────────────────────────────────────────────────────
    const changeRow = React.useCallback((rowId: string, patch: Partial<PatternRow>) => {
        setDraft(prev => (prev ?? []).map(r => (r.rowId === rowId ? { ...r, ...patch } : r)));
    }, []);

    const addRow = React.useCallback((employeeId: string) => {
        setDraft(prev => {
            const list = prev ?? [];
            const template = list.find(r => r.employeeId === employeeId);
            if (!template) return list;
            return [...list, {
                ...template,
                rowId: `new:${employeeId}:${list.length}:${Date.now()}`,
                // No days: an added line has to be given its own, or it would
                // silently duplicate the first and breach the one-line-per-day
                // unique index at save time.
                days: [],
                slotIdByDay: {},
            }];
        });
    }, []);

    /**
     * Copy one employee's weekly shape onto another.
     *
     * The rule that matters — identity never travels with the shape — lives in
     * `copyPatternShape` so it can be tested without rendering a table.
     */
    const copyPattern = React.useCallback((sourceEmployeeId: string, targetEmployeeId: string) => {
        setDraft(prev => copyPatternShape(
            prev ?? [],
            sourceEmployeeId,
            targetEmployeeId,
            i => `copy:${targetEmployeeId}:${i}:${Date.now()}`,
        ));
    }, []);

    const removeRow = React.useCallback((rowId: string) => {
        setDraft(prev => (prev ?? []).filter(r => r.rowId !== rowId));
    }, []);

    /**
     * Spread the contract evenly over every day this person has selected.
     *
     * The inverse of typing a finish time: instead of choosing an end and
     * reading the variance, choose the days and let the arithmetic choose the
     * end. This is what the old designer dialog did for a whole team; it now
     * applies to one person, from inside the row it affects.
     */
    const fitToContract = React.useCallback((employeeId: string) => {
        const employee = world.data?.employees.find(e => e.facts.employeeId === employeeId);
        if (!employee) return;
        const weeklyMinutes = Math.round(
            (employee.facts.contractedWeeklyHours ?? ftProfile.data?.weeklyHours ?? 38) * 60);

        setDraft(prev => {
            const list = prev ?? [];
            const mine = list.filter(r => r.employeeId === employeeId);
            const totalDays = mine.reduce((n, r) => n + r.days.length, 0);
            if (totalDays === 0) return list;

            const perDay = Math.round(weeklyMinutes / totalDays);
            return list.map(r => (r.employeeId === employeeId
                ? { ...r, endTime: toHhmm(toMinutes(r.startTime) + perDay + r.unpaidBreakMinutes) }
                : r));
        });
    }, [world.data, ftProfile.data?.weeklyHours]);

    // ── The enclosing cycle, for the header ──────────────────────────────────
    const cycleLabel = React.useMemo(() => {
        const anchors = (world.data?.employees ?? []).map(
            e => `${e.facts.cycleAnchor}|${e.facts.cycleWeeks}`);
        const distinct = [...new Set(anchors)];
        if (distinct.length !== 1) return null;
        const first = world.data!.employees[0].facts;
        const b = cycleBoundsFor(periodStart, first.cycleAnchor, first.cycleWeeks);
        return `Cycle ${b.start} – ${b.endInclusive}`;
    }, [world.data, periodStart]);

    // ── Pre-flight: can Apply actually write into these dates? ───────────────
    //
    // `resolveRosterTarget` refuses a missing, published or locked roster, and
    // it is right to. But learning that one candidate at a time AFTER pressing
    // the button is the worst moment for it, and free date navigation makes
    // landing on an uncovered window routine. So the answer is computed against
    // the dates actually being proposed — not the whole window, which would
    // report days nothing was going to be written on anyway.
    const preflight = React.useMemo(() => {
        if (!proposal || !coverage.data) return null;
        const dates = new Set(proposal.ledgers.flatMap(l => l.proposed.map(c => c.shiftDate)));
        let noRoster = 0;
        let locked = 0;
        for (const d of dates) {
            if (coverage.data.writable.has(d)) continue;
            if (coverage.data.lockedOut.has(d)) locked++; else noRoster++;
        }
        return { total: dates.size, noRoster, locked, writable: dates.size - noRoster - locked };
    }, [proposal, coverage.data]);

    // ── Saving and applying ──────────────────────────────────────────────────
    const blockedCount = proposal?.totals.blockedEmployees ?? 0;
    const proposedCount = proposal?.totals.proposedShiftCount ?? 0;
    const dirtyCount = dirtyEmployeeIds.size;
    const busy = savePatterns.isPending || apply.isPending;

    const persistPatterns = React.useCallback(async () => {
        if (!selectedSubDept || !user?.id || !world.data) return false;
        const res = await savePatterns.mutateAsync({
            organizationId: selectedSubDept.organizationId,
            departmentId: selectedSubDept.departmentId,
            subDepartmentId: selectedSubDept.id,
            rows,
            employeeIds: world.data.employees.map(e => e.facts.employeeId),
            actorId: user.id,
        });
        const blocking = res.findings.find(f => f.severity === 'BLOCKING');
        if (blocking) {
            toast({ variant: 'destructive', title: 'Could not save', description: blocking.plain });
            return false;
        }
        return true;
    }, [selectedSubDept, user?.id, world.data, rows, savePatterns, toast]);

    const handleSave = async () => {
        if (await persistPatterns()) {
            // Re-seed from what was actually stored, so ids and grouping match.
            setDraft(null);
            toast({
                title: 'Patterns saved',
                description: `${dirtyCount} employee${dirtyCount === 1 ? '' : 's'} updated.`,
            });
        }
    };

    const handleApply = async () => {
        setConfirmOpen(false);
        if (!proposal || !world.data || !user?.id) return;

        // Save first. The proposal on screen was computed from the draft, so
        // applying without persisting would create shifts from a pattern the
        // database has never seen — and `source_slot_id` would point at nothing.
        if (dirtyCount > 0 && !(await persistPatterns())) return;

        const { rows: fresh } = await (async () => {
            const r = await savedRows.refetch();
            return { rows: r.data ?? rows };
        })();

        const patternRows = fresh.flatMap(r => {
            const d = deriveRow(r);
            return r.days.map(day => ({
                id: r.slotIdByDay[day] ?? `${r.rowId}:${day}`,
                employee_id: r.employeeId, iso_day_of_week: day,
                start_time: r.startTime, end_time: r.endTime,
                unpaid_break_minutes: r.unpaidBreakMinutes,
                paid_break_minutes: d.paidBreakMinutes, net_minutes: d.netMinutes,
                role_id: r.roleId,
            }));
        });

        try {
            const res = await apply.mutateAsync({
                proposal: { ...proposal, generatedAt: new Date().toISOString() },
                world: world.data,
                patternRows,
                actorId: user.id,
                resolveTarget: resolveRosterTarget,
            });
            setDraft(null);
            toast({
                title: res.skipped.length === 0
                    ? `${res.created} draft shift${res.created === 1 ? '' : 's'} created`
                    : `${res.created} created, ${res.skipped.length} skipped`,
                description: res.skipped.length === 0
                    ? 'Nothing has been published.'
                    : res.skipped[0].reason,
            });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Could not apply the baseline',
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const runFindings = proposal?.runFindings.filter(f => f.severity !== 'INFO') ?? [];
    const { isDark } = useTheme();

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            <GoldStandardHeader
                title="Baseline FT Schedule"
                Icon={CalendarRange}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                singleSelectLevels={['subdept']}
                functionBar={
                    <div className="flex flex-wrap items-center gap-3">
                        <UnifiedRosterNavigator
                            date={anchorDate}
                            viewType={viewType}
                            onChange={setAnchorDate}
                            onViewTypeChange={setViewType}
                            variant="full"
                            showToday
                        />
                        {cycleLabel && (
                            <span className={cn(text.caption, 'font-mono')}>{cycleLabel}</span>
                        )}
                    </div>
                }
            />

            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6 flex flex-col">
                <div
                    className={cn(
                        'h-full rounded-[32px] overflow-hidden border flex flex-col',
                        isDark
                            ? 'border-white/5 bg-[#1c2333]/40 shadow-2xl shadow-black/20'
                            : 'border-white bg-white/70 shadow-xl shadow-slate-200/50 backdrop-blur-md',
                    )}
                >
                    {/* Scrollable Inner Content Area */}
                    <div className="flex-1 overflow-y-auto p-5 sm:p-7 lg:p-8 space-y-6 custom-scrollbar">
                        {tooManySubDepts && (
                            <PageState
                                state="empty" scope="section"
                                title={`${selectedSubdeptIds.length} sub-departments selected`}
                                description="Baseline writes into one team's rosters at a time. Narrow the scope above to choose which."
                            />
                        )}

                        {!subDepartmentId && !tooManySubDepts && (
                            <PageState
                                state="empty" scope="section"
                                title="Choose a team"
                                description="Pick a sub-department in the header to see its full-time employees and their working patterns."
                            />
                        )}

                        {subDepartmentId && world.isError && (
                            <PageState
                                state="error" scope="section"
                                title="Could not load this team"
                                onRetry={() => void world.refetch()}
                            />
                        )}

                        {subDepartmentId && world.isLoading && !world.data && (
                            <PageState state="loading" scope="section" title="Reading the roster" />
                        )}

                        {proposal && employees.length === 0 && (
                            <PageState
                                state="empty" scope="section"
                                title="No full-time employees to schedule"
                                description="No wholly full-time contracts are active for this team in this period."
                            />
                        )}

                        {proposal && employees.length > 0 && (
                            <>
                                {/* 1. Schedule Overview */}
                                <BaselineSummary proposal={proposal} dirtyCount={dirtyCount} />

                                {/* 2. Employee Scheduling Workspace */}
                                <section aria-label="Team Scheduling Canvas" className="w-full">
                                    <BaselinePatternTable
                                        employees={employees}
                                        onChangeRow={changeRow}
                                        onAddRow={addRow}
                                        onRemoveRow={removeRow}
                                        onFitToContract={fitToContract}
                                        onCopyPattern={copyPattern}
                                        disabled={busy}
                                    />
                                </section>
                            </>
                        )}

                        {ftProfile.data?.weeklyHoursVaries && (
                            <p className={text.caption}>
                                Full-time contracts on this team do not all specify the same weekly hours.
                                Each row is measured against its own contract.
                            </p>
                        )}
                    </div>

                    {/* Pinned 1-Row Footer Bar — Always at the bottom regardless of scroll */}
                    {proposal && employees.length > 0 && (
                        <footer
                            role="region"
                            aria-label="Roster publishing actions"
                            className="shrink-0 z-20 border-t border-slate-200/80 dark:border-border/60 bg-white/95 dark:bg-card/95 px-6 py-3.5 backdrop-blur-md flex items-center justify-between gap-4 w-full"
                        >
                            {/* Left: Shifts Drafted status */}
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="font-bold text-sm text-foreground truncate">
                                    {proposedCount} Shifts Drafted
                                </span>
                                {blockedCount > 0 && (
                                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                                        • {blockedCount} {blockedCount === 1 ? 'Issue' : 'Issues'}
                                    </span>
                                )}
                            </div>

                            {/* Right: <alert icon> <save icon> <publish icon> per ARIA and WCAG */}
                            <div className="flex items-center gap-2 sm:gap-3">
                                {/* 1. Period Notice Alert Icon */}
                                {runFindings.length > 0 && (
                                    <TooltipProvider delayDuration={150}>
                                        <Popover>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <PopoverTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            aria-label={`View period notices (${runFindings.length} warning${runFindings.length === 1 ? '' : 's'})`}
                                                            className="h-9 px-3 rounded-lg border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-xs font-medium gap-1.5 focus-visible:ring-2 focus-visible:ring-amber-500 shadow-xs cursor-pointer"
                                                        >
                                                            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                                                            <span className="hidden sm:inline">Notice</span>
                                                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-200 dark:bg-amber-500/30 text-amber-900 dark:text-amber-200 text-[10px] font-bold">
                                                                {runFindings.length}
                                                            </span>
                                                        </Button>
                                                    </PopoverTrigger>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-xs text-xs p-2.5 shadow-md">
                                                    <p className="font-semibold">{runFindings[0]?.plain}</p>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5">Click to view all notices & rule citations</p>
                                                </TooltipContent>
                                            </Tooltip>
                                            <PopoverContent side="top" align="end" className="w-96 p-4 shadow-xl border border-slate-200 dark:border-border/60 bg-white dark:bg-card">
                                                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                                                    About this period
                                                </h4>
                                                <FindingList findings={runFindings} showCalculation />
                                            </PopoverContent>
                                        </Popover>
                                    </TooltipProvider>
                                )}

                                {/* 2. Save Pattern Icon / Button */}
                                <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={dirtyCount === 0 || busy}
                                                onClick={() => void handleSave()}
                                                aria-label={dirtyCount > 0 ? `Save ${dirtyCount} modified pattern${dirtyCount === 1 ? '' : 's'}` : 'All patterns saved'}
                                                className={cn(
                                                    'h-9 px-3 rounded-lg border-slate-200 dark:border-border/60 bg-white dark:bg-card text-xs font-medium gap-1.5',
                                                    'hover:bg-slate-50 dark:hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-blue-500 shadow-xs cursor-pointer',
                                                    dirtyCount > 0 && 'border-amber-400 text-amber-800 dark:text-amber-300',
                                                )}
                                            >
                                                {savePatterns.isPending ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                ) : (
                                                    <Save className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                                )}
                                                <span className="hidden sm:inline">Save patterns</span>
                                                {dirtyCount > 0 && (
                                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                                                        {dirtyCount}
                                                    </span>
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs p-2">
                                            {dirtyCount > 0 ? `Save ${dirtyCount} unsaved pattern modification(s)` : 'No unsaved pattern modifications'}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                {/* 3. Apply / Publish Icon / Button */}
                                <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                size="sm"
                                                disabled={proposedCount === 0 || busy}
                                                onClick={() => setConfirmOpen(true)}
                                                aria-label={`Apply ${proposedCount} draft shift${proposedCount === 1 ? '' : 's'} to live rosters`}
                                                className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer"
                                            >
                                                {apply.isPending ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                ) : (
                                                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                                                )}
                                                <span>Apply to rosters</span>
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs p-2">
                                            Publish {proposedCount} drafted shift{proposedCount === 1 ? '' : 's'} to live rosters
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        </footer>
                    )}
                </div>
            </div>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Create these shifts as drafts?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2">
                                <p>
                                    {proposedCount} shift{proposedCount === 1 ? '' : 's'} will be
                                    created between {format(range.start, 'd MMM')} and{' '}
                                    {format(range.end, 'd MMM yyyy')}, and assigned to their
                                    employees.
                                </p>
                                {dirtyCount > 0 && (
                                    <p>
                                        {dirtyCount} changed pattern{dirtyCount === 1 ? '' : 's'} will
                                        be saved first.
                                    </p>
                                )}
                                {preflight && (preflight.noRoster > 0 || preflight.locked > 0) && (
                                    <p>
                                        {preflight.writable} of {preflight.total} day
                                        {preflight.total === 1 ? '' : 's'} can be written to. The
                                        rest have no draft roster, or fall on one that is already
                                        published, and will be skipped.
                                    </p>
                                )}
                                <p>
                                    No existing shift will be changed or deleted, and nothing will be
                                    published.
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className={touch.targetY}>Cancel</AlertDialogCancel>
                        <AlertDialogAction className={touch.targetY} onClick={() => void handleApply()}>
                            Create drafts
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default BaselineFtPage;
