/**
 * useAutoScheduler — all Auto-Schedule run state, in one place.
 *
 * Extracted from AutoSchedulerModal so the desktop console and the mobile flow
 * are two RENDER layers over one behaviour. Nothing here decides layout; nothing
 * in a layer decides what a run does. A second copy of "which shifts are in
 * scope" or "when may we commit" is how the two surfaces would drift apart.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addWeeks, endOfMonth, format, startOfMonth } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/modules/core/hooks/use-toast';
import { getSydneyToday } from '@/modules/core/lib/date.utils';
import { endOfWeekAU, startOfWeekAU } from '@/modules/core/lib/date/week';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { useShiftsByDateRange, type ShiftFilters } from '@/modules/rosters/state/useRosterShifts';
import {
    autoSchedulerController,
    AutoSchedulerInputTooLargeError,
} from '@/modules/scheduling';
import { BLOCKER_LABELS } from '@/modules/scheduling/audit/auditor';
import type {
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerHealth,
    ShiftMeta,
    EmployeeMeta,
} from '@/modules/scheduling';

export type PipelinePhase = 'idle' | 'optimizing' | 'validating' | 'reviewing' | 'done';

/** Named windows people actually schedule, so nobody drives two pickers by hand. */
export type WindowPreset = 'week' | 'fortnight' | 'month';

export const WINDOW_PRESET_LABELS: Record<WindowPreset, string> = {
    week: 'This week',
    fortnight: '2 weeks',
    month: 'This month',
};

/**
 * Why the shifts in the window are or aren't in scope.
 *
 * "0 eligible shifts" on its own is a dead end — the planner cannot tell a
 * quiet week from a window where everything is already published. Counts are
 * mutually exclusive and computed in this order, so they sum to `total`.
 */
export interface ScopeBreakdown {
    /** Live shifts in the window (cancelled/deleted are not counted at all). */
    total: number;
    eligible: number;
    assigned: number;
    published: number;
    startingSoon: number;
}

export type SortField = 'name' | 'utilization' | 'shifts' | 'compliance' | 'cost' | 'fatigue';
export type SortDirection = 'asc' | 'desc';

export interface EmployeeGroup {
    id: string;
    name: string;
    proposals: ValidatedProposal[];
    roleDistribution: Array<{ name: string; value: number }>;
    totalCost: number;
    avgFatigue: number;
    utilization: number;
    employmentType: string;
    contractedHours: number;
    assignedRoles: string[];
}

interface UseAutoSchedulerOptions {
    open: boolean;
    onClose: () => void;
    onComplete: () => void;
    shifts: ShiftMeta[];
    employees: EmployeeMeta[];
    organizationId?: string;
    queryFilters?: ShiftFilters;
}

/**
 * The date range a preset means, as `yyyy-MM-dd` strings.
 *
 * Whole ISO weeks / calendar months rather than "today + N days": a roster week
 * is Mon-Sun, and a window starting mid-week reads as arbitrary. Past days
 * inside the window are harmless — they fall out of scope as already started.
 */
export function windowPresetRange(preset: WindowPreset, today: Date): { start: string; end: string } {
    const iso = (d: Date) => format(d, 'yyyy-MM-dd');
    switch (preset) {
        case 'week':
            return { start: iso(startOfWeekAU(today)), end: iso(endOfWeekAU(today)) };
        case 'fortnight':
            return { start: iso(startOfWeekAU(today)), end: iso(endOfWeekAU(addWeeks(today, 1))) };
        case 'month':
            return { start: iso(startOfMonth(today)), end: iso(endOfMonth(today)) };
    }
}

/** Minimal shift shape the scope summary needs. */
interface ScopeCandidate {
    shift_date: string;
    start_time: string;
    assigned_employee_id?: string | null;
    is_cancelled?: boolean | null;
    deleted_at?: string | null;
    is_draft?: boolean | null;
}

/**
 * Split the window's shifts into eligible + the reason each other one is out.
 *
 * Mirrors the `filteredShifts` predicate exactly, and is derived from the same
 * rows, so the two can never disagree about what "eligible" means. Categories
 * are mutually exclusive and sum to `total`.
 */
export function summariseScope(shifts: readonly ScopeCandidate[]): ScopeBreakdown {
    return shifts.reduce<ScopeBreakdown>((acc, s) => {
        // Cancelled/deleted shifts are not shifts anyone is counting.
        if (s.is_cancelled || s.deleted_at) return acc;
        acc.total += 1;
        if (s.assigned_employee_id) acc.assigned += 1;
        else if (!(s.is_draft ?? true)) acc.published += 1;
        else if (computeShiftUrgency(s.shift_date, s.start_time) === 'emergent') acc.startingSoon += 1;
        else acc.eligible += 1;
        return acc;
    }, { total: 0, eligible: 0, assigned: 0, published: 0, startingSoon: 0 });
}

/** Pass-rate for one staff member's proposals, 0-1. Shared by both sort paths. */
export function complianceRateOf(group: Pick<EmployeeGroup, 'proposals'>): number {
    if (group.proposals.length === 0) return 0;
    const passing = group.proposals.filter(p => p.complianceStatus === 'PASS').length;
    return passing / group.proposals.length;
}

/** Pure sort so the desktop table and the mobile list order identically. */
export function sortEmployeeGroups(
    groups: EmployeeGroup[],
    field: SortField,
    direction: SortDirection,
): EmployeeGroup[] {
    const valueOf = (g: EmployeeGroup): string | number => {
        switch (field) {
            case 'utilization': return g.utilization;
            case 'shifts':      return g.proposals.length;
            case 'compliance':  return complianceRateOf(g);
            case 'cost':        return g.totalCost;
            case 'fatigue':     return g.avgFatigue;
            case 'name':
            default:            return g.name;
        }
    };
    return [...groups].sort((a, b) => {
        const valA = valueOf(a);
        const valB = valueOf(b);
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

export function useAutoScheduler({
    open,
    onClose,
    onComplete,
    shifts: initialShifts,
    employees,
    organizationId,
    queryFilters,
}: UseAutoSchedulerOptions) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [health, setHealth] = useState<OptimizerHealth | null>(null);
    const [phase, setPhase] = useState<PipelinePhase>('idle');
    const [result, setResult] = useState<AutoSchedulerResult | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);

    const runAbortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Timer for "Estimated Time Left"
    useEffect(() => {
        if (phase === 'optimizing') {
            setElapsedTime(0);
            timerRef.current = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [phase]);

    // Date Range Selection
    const defaultStart = useMemo(() => initialShifts.length > 0 ? [...initialShifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date))[0].shift_date : '', [initialShifts]);
    const defaultEnd = useMemo(() => initialShifts.length > 0 ? [...initialShifts].sort((a, b) => b.shift_date.localeCompare(a.shift_date))[0].shift_date : '', [initialShifts]);

    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultEnd);

    const validationError = useMemo(() => {
        if (!startDate || !endDate) {
            return "Please select both start and end dates.";
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return "Invalid date format.";
        }
        if (start > end) {
            return "Start date cannot be after end date.";
        }
        const diffTime = end.getTime() - start.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // inclusive
        if (diffDays > 31) {
            return "Date range cannot exceed 31 days.";
        }
        return null;
    }, [startDate, endDate]);

    const { data: rawShifts = [], isFetching: isShiftsLoading } = useShiftsByDateRange(
        organizationId || null,
        validationError ? null : (startDate || null),
        validationError ? null : (endDate || null),
        queryFilters
    );

    const filteredShifts = useMemo(() => {
        if (!startDate || !endDate || validationError) return [];
        // Scope: DRAFT + unassigned only. Published shifts are in the bidding/
        // offer pipeline; emergent shifts (TTS ≤ 4h, includes already-started)
        // belong to the emergency-assignment flow. The controller re-checks
        // the time window at run time in case a shift crosses into it.
        return rawShifts
            .filter((s) =>
                !s.assigned_employee_id && !s.is_cancelled && !s.deleted_at
                && (s.is_draft ?? true)
                && computeShiftUrgency(s.shift_date, s.start_time) !== 'emergent')
            .map((s) => ({
                id: s.id,
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                role_id: (s as any).role_id ?? null,
                roleName: (s as any).role_name || (s as any).roles?.name || '',
                unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
                // cl 39.2 measures the split-shift spread "excluding meal AND
                // rest breaks", so HC-9 and dailySpreadRule both read this.
                // Already in SHIFT_SELECT; this projection was the only gap.
                paid_break_minutes: s.paid_break_minutes ?? 0,
                // EVERY field the solver and V8 read must be projected here.
                // These are optional on ShiftMeta, so omitting one is not a type
                // error — it silently disables the rule that consumes it. That is
                // exactly how the employment target went missing: HC-5c
                // (`if shift.target_employment_type:` in model_builder.py) and
                // V8_EMPLOYMENT_TARGET (`if (!target) continue`) are both guarded
                // on presence, so an unhydrated target let the solver place FT/PT
                // staff on Casual shifts, scored the roster 100% compliant, and
                // then had the whole atomic commit rejected by
                // trg_shift_employment_target_2_enforce. Fetched by SHIFT_SELECT
                // already — this projection was the only thing dropping them.
                target_employment_type: s.target_employment_type ?? null,
                target_requires_flexible: s.target_requires_flexible ?? false,
                // Lowers the min-engagement floor 3h → 2h for training shifts.
                is_training: s.is_training ?? false,
                // Feeds the solver's skill/level matching.
                level: (s as any).remuneration_level ?? undefined,
            } as ShiftMeta));
    }, [rawShifts, startDate, endDate, validationError]);

    const scopeBreakdown = useMemo<ScopeBreakdown>(() => {
        if (!startDate || !endDate || validationError) {
            return { total: 0, eligible: 0, assigned: 0, published: 0, startingSoon: 0 };
        }
        return summariseScope(rawShifts);
    }, [rawShifts, startDate, endDate, validationError]);

    const applyWindowPreset = useCallback((preset: WindowPreset) => {
        const { start, end } = windowPresetRange(preset, getSydneyToday());
        setStartDate(start);
        setEndDate(end);
    }, []);

    /** Which preset, if any, the current window exactly matches. */
    const activeWindowPreset = useMemo<WindowPreset | null>(() => {
        if (!startDate || !endDate) return null;
        const today = getSydneyToday();
        return (Object.keys(WINDOW_PRESET_LABELS) as WindowPreset[]).find(p => {
            const { start, end } = windowPresetRange(p, today);
            return start === startDate && end === endDate;
        }) ?? null;
    }, [startDate, endDate]);

    const estimatedTotalSeconds = useMemo(() => {
        // Must stay in sync with dynamicBudget in auto-scheduler.controller.ts.
        // Largest bucket gets extra headroom for big monthly rosters; this
        // composes with the solver's front-loaded per-tier time allocation.
        const rawPairs = filteredShifts.length * employees.length;
        if (rawPairs > 30000) return 120;
        if (rawPairs > 10000) return 60;
        return 30;
    }, [filteredShifts.length, employees.length]);

    const preRunCapacity = useMemo(() => {
        if (filteredShifts.length === 0 || employees.length === 0) return null;
        return autoSchedulerController.capacityCheck(filteredShifts, employees);
    }, [filteredShifts, employees]);

    useEffect(() => {
        if (!open) return;
        setHealth(null);
        autoSchedulerController.checkHealth().then(setHealth);
    }, [open]);

    /** Every gate on the run, named — so a disabled button can say WHY. */
    const runBlockedReason = useMemo(() => {
        if (health && !health.available) return 'The optimizer service is offline.';
        if (validationError) return validationError;
        if (isShiftsLoading) return 'Loading shifts in this window…';
        if (filteredShifts.length === 0) return 'No shifts to fill in this window.';
        return null;
    }, [health, validationError, isShiftsLoading, filteredShifts.length]);

    const canRun = !!health?.available && !runBlockedReason;

    const handleRun = useCallback(async () => {
        if (filteredShifts.length === 0) return;
        runAbortRef.current?.abort();
        const ac = new AbortController();
        runAbortRef.current = ac;

        setResult(null);
        setPhase('optimizing');

        try {
            const schedResult = await autoSchedulerController.run({
                shifts: filteredShifts,
                employees,
                organizationId,
                signal: ac.signal,
                timeLimitSeconds: estimatedTotalSeconds,
                // Single-mode: no cost/fatigue/fairness sliders. The solver runs a
                // fixed lexicographic policy (coverage » guardrails » cost). We
                // also request Pareto "what-if" alternatives for the explorer.
                computeAlternatives: true,
            });
            if (ac.signal.aborted) return;
            setPhase('reviewing');
            setResult(schedResult);
        } catch (err: any) {
            if (ac.signal.aborted || err?.name === 'AbortError') {
                console.debug('[AutoScheduler] Run aborted by user');
                return;
            }
            setPhase('idle');
            toast({
                title: err instanceof AutoSchedulerInputTooLargeError ? 'Too much to optimize' : 'Optimization Failed',
                description: err?.message ?? 'Unexpected error',
                variant: 'destructive',
            });
        } finally {
            if (runAbortRef.current === ac) runAbortRef.current = null;
        }
    }, [filteredShifts, employees, toast, organizationId, estimatedTotalSeconds]);

    const handleCancel = useCallback(() => {
        if (runAbortRef.current) {
            runAbortRef.current.abort();
            runAbortRef.current = null;
        }
        setPhase('idle');
        setResult(null);
        toast({
            title: 'Operation Cancelled',
            description: 'The optimization process was stopped.',
        });
    }, [toast]);

    const handleClose = useCallback(() => {
        runAbortRef.current?.abort();
        runAbortRef.current = null;
        setResult(null);
        setPhase('idle');
        onClose();
    }, [onClose]);

    const handleCommit = useCallback(async () => {
        if (!result) return;
        setIsCommitting(true);

        try {
            const commitResult = await autoSchedulerController.commit(result);
            if (commitResult.success || commitResult.totalCommitted > 0) {
                setPhase('done');
                toast({
                    title: 'Shifts Assigned',
                    description: `Successfully assigned ${commitResult.totalCommitted} shift(s).`,
                });
                queryClient.invalidateQueries({ queryKey: [shiftKeys.all[0]] });
                onComplete();
                handleClose();
            } else {
                toast({
                    title: 'Commit Failed',
                    // Prefer the database's own reason. "Check compliance results"
                    // is only right when nothing more specific came back — when a
                    // trigger rejected the write, that generic text sends the
                    // reader to the layer that passed.
                    description: commitResult.message
                        ?? 'No shifts were committed. Check compliance results.',
                    variant: 'destructive',
                });
            }
        } catch (err: any) {
            toast({ title: 'Error', description: err?.message ?? 'Failed to commit', variant: 'destructive' });
        } finally {
            setIsCommitting(false);
        }
    }, [result, queryClient, toast, onComplete, handleClose]);

    const handleDownloadAudit = useCallback(() => {
        // Generate for ANY completed run — a clean 100%-compliant roster deserves
        // an audit report too. (Old guard required `uncoveredAudit`, which is only
        // computed when shifts are uncovered, so the button silently did nothing
        // on a perfect run.)
        if (!result) return;
        setIsDownloading(true);

        try {
            const csvEscape = (v: string | number) => {
                const s = String(v ?? '');
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            };
            const money = (n: number) =>
                new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
            const row = (...cells: (string | number)[]) => cells.map(csvEscape).join(',');

            /** HH:MM — the seconds in `05:30:00-16:30:00` are always zero and
             *  cost a third of the column's width on every row. */
            const hhmm = (t: string) => (t ?? '').slice(0, 5);
            const pluralShifts = (n: number) => `${n} shift${n === 1 ? '' : 's'}`;

            const audit = result.uncoveredAudit ?? [];
            const totalUncovered = result.uncoveredV8ShiftIds.length;
            const audited = audit.length;
            const compliancePct = result.totalProposals > 0
                ? Math.round((result.passing / result.totalProposals) * 100)
                : 100;

            // Read every audited shift ONCE and pre-aggregate. The old report
            // emitted shift×employee rows verbatim — 14 uncovered shifts against
            // 103 staff is 1,442 near-identical lines, and the one fact a reader
            // actually needs (how many people could work this at all, and what
            // single change would unlock more) appeared nowhere.
            const blockerStaff = new Map<string, Set<string>>();   // blocker → staff
            const staffBlockers = new Map<string, Set<string>>();  // staff → blockers
            const staffNames = new Map<string, string>();
            const eligibleStaff = new Map<string, Set<string>>();  // staff → shiftIds they PASS
            for (const a of audit) {
                for (const d of a.employeeDetails) {
                    staffNames.set(d.employeeId, d.employeeName);
                    if (d.status === 'PASS' && d.violations.length === 0) {
                        if (!eligibleStaff.has(d.employeeId)) eligibleStaff.set(d.employeeId, new Set());
                        eligibleStaff.get(d.employeeId)!.add(a.shiftId);
                        continue;
                    }
                    for (const v of new Set(d.violations.map(x => x.type))) {
                        if (!blockerStaff.has(v)) blockerStaff.set(v, new Set());
                        blockerStaff.get(v)!.add(d.employeeId);
                        if (!staffBlockers.has(d.employeeId)) staffBlockers.set(d.employeeId, new Set());
                        staffBlockers.get(d.employeeId)!.add(v);
                    }
                }
            }
            // CAPACITY_CONFLICT is NOT an eligibility failure — it means the
            // person cleared every rule and was simply already rostered at that
            // hour. Folding it in with role/availability breaches would make the
            // report state "no one was eligible" for a roster whose own banner
            // reads "all 5 eligible employees were already committed". They are
            // opposite diagnoses: one needs different people, the other needs
            // more of the same people.
            const committedStaff = new Set<string>();
            for (const [empId, set] of staffBlockers) {
                if (set.size === 1 && set.has('CAPACITY_CONFLICT')) committedStaff.add(empId);
            }
            /** Anyone who could lawfully work an open shift — free or already busy. */
            const capableCount = eligibleStaff.size + committedStaff.size;

            // The actionable number: staff held back by exactly ONE thing.
            // Someone blocked by both availability AND role is not unlocked by
            // fixing either, so counting them under both overstates every lever.
            const soleBlockerCount = (blocker: string) => {
                let n = 0;
                for (const [empId, set] of staffBlockers) {
                    if (set.size === 1 && set.has(blocker) && !eligibleStaff.has(empId)) n++;
                }
                return n;
            };

            const lines: string[] = [
                'AUTO-SCHEDULE AUDIT REPORT',
                row('Generated', new Date().toLocaleString()),
                row('Window', `${startDate} to ${endDate}`),
                row('Optimizer status', result.optimizerStatus),
                '',
            ];

            // ── Headline — the finding, before any table. A reader who stops
            //    after one line should still leave with the right conclusion. ──
            lines.push('--- HEADLINE ---');
            if (totalUncovered === 0) {
                lines.push(row('Result', `Every shift filled — ${pluralShifts(result.passing)} booked, all compliant.`));
            } else {
                lines.push(row('Result',
                    `${pluralShifts(totalUncovered)} could not be filled compliantly and were left open.`));
                lines.push(row('Why',
                    capableCount === 0
                        ? `No one of ${staffNames.size} staff was eligible for these shifts. This is an ELIGIBILITY problem — more hours from the current team cannot fix it.`
                        : `Only ${capableCount} of ${staffNames.size} staff can lawfully work these shifts, and ${committedStaff.size > 0 ? `${committedStaff.size} of them were already rostered at that hour` : 'they were already rostered at that hour'}. This is a CAPACITY problem — the eligible pool is too small.`));
                lines.push(row('Read next', 'BLOCKERS — it ranks each obstacle by how many staff it alone is holding back.'));
            }
            lines.push('');

            // ── Scorecard — the new single-source-of-truth metrics (matches the
            //    on-screen pillars: Coverage / Wellbeing / Fairness / Compliance /
            //    Labour cost), NOT the old Passing/Failing-proposal framing. ──
            const p = result.pillars;
            if (p) {
                lines.push('--- SCORECARD ---');
                lines.push(row('Metric', 'Score', 'Detail'));
                lines.push(row('Coverage', `${p.coverage.score}%`, `${p.coverage.covered}/${p.coverage.total} shifts filled`));
                const overStaff = p.fatigue.over_cap_staff ?? 0;
                const overWorstH = Math.round((p.fatigue.over_cap_worst_minutes ?? 0) / 60);
                lines.push(row('Wellbeing', `${p.fatigue.score}/100`,
                    overStaff > 0 && overWorstH > 0
                        ? `${p.fatigue.critical} over-tired · ${overStaff} staff up to ${overWorstH}h over their hours cap`
                        : p.fatigue.critical > 0 ? `${p.fatigue.critical} over-tired`
                            : p.fatigue.amber > 0 ? `${p.fatigue.amber} near limit` : 'all well-rested'));
                lines.push(row('Fairness', `${p.fairness.score}/100`, `${p.fairness.employees_used} staff · ${Math.round(p.fairness.spread_minutes / 60)}h spread`));
                lines.push(row('Compliance', `${compliancePct}%`, `${result.passing}/${result.totalProposals} assignments passing`));
                lines.push(row('Labour cost', money(p.cost.total), `${money(p.cost.avg_per_shift)}/shift avg`));
                lines.push('');
            }

            lines.push('--- SUMMARY ---');
            lines.push(row('Compliant assignments booked', result.passing));
            lines.push(row('Uncovered shifts', totalUncovered));
            lines.push(row('Compliance policy', '100% by construction — non-compliant assignments are never booked; they are left uncovered.'));
            lines.push('');

            // ── Hours over cap. Deliberately its own section rather than a line
            //    in the scorecard: "Compliance 100%" and "staff 74h over their
            //    cap" are both true at once, and a reader who does not see them
            //    side by side will reasonably assume the first rules out the
            //    second. The solver's cap is soft and ranks BELOW coverage, so
            //    this is the expected outcome of a thin eligible pool, not a
            //    rule failure — say that plainly rather than let it look like a
            //    contradiction. ──
            const fat = result.pillars?.fatigue;
            if (fat && (fat.over_cap_staff ?? 0) > 0) {
                const worstH = Math.round((fat.over_cap_worst_minutes ?? 0) / 60);
                const totalH = Math.round((fat.over_cap_total_minutes ?? 0) / 60);
                lines.push('--- HOURS OVER CAP ---');
                lines.push(row('Staff over their hours cap', fat.over_cap_staff ?? 0));
                lines.push(row('Worst individual overrun', `${worstH}h`));
                lines.push(row('Total overrun across the roster', `${totalH}h`));
                lines.push(row('Why this is not a compliance failure',
                    "The hours cap is a soft limit that ranks BELOW coverage: the solver will roster past someone's maximum when that is the only way to staff a shift. Hard legal limits (12h/day, spread, rest gaps) were not breached."));
                lines.push(row('What it means',
                    'The eligible pool is too small for the demand, so the people who ARE eligible absorb the overrun. Widening the pool (see BLOCKERS) is what brings these hours down.'));
                lines.push('');
            }

            if (totalUncovered > 0) {
                // ── Blockers — ranked, with the lever that clears each one.
                //    This replaces the raw `TYPE: count` string, which required
                //    the reader to know the solver's reason codes AND to notice
                //    that the counts overlap. ──
                lines.push('--- BLOCKERS (why staff could not take the open shifts) ---');
                lines.push(row('Note', 'Staff affected counts anyone hit by the blocker; "Blocked ONLY by this" counts those it alone is stopping — that is the number a fix actually unlocks.'));
                lines.push(row('Blocker', 'Staff affected', 'Blocked ONLY by this', 'What would unlock them'));
                const ranked = [...blockerStaff.entries()]
                    .map(([type, staff]) => ({ type, affected: staff.size, sole: soleBlockerCount(type) }))
                    .sort((a, b) => b.sole - a.sole || b.affected - a.affected);
                for (const b of ranked) {
                    const meta = BLOCKER_LABELS[b.type];
                    lines.push(row(meta?.label ?? b.type, b.affected, b.sole, meta?.fix ?? ''));
                }
                lines.push('');

                // ── Eligible pool — who COULD have worked these shifts. When
                //    this is empty the shortfall is an eligibility problem; when
                //    it is not, it is a capacity problem, and the distinction
                //    decides what the manager does next. ──
                lines.push('--- ELIGIBLE STAFF FOR THE OPEN SHIFTS ---');
                lines.push(row('Cleared every rule and free', eligibleStaff.size));
                lines.push(row('Cleared every rule but already on a shift', committedStaff.size));
                lines.push(row('Eligible pool', capableCount, `of ${staffNames.size} staff considered`));
                if (capableCount === 0) {
                    lines.push(row('Diagnosis', 'ELIGIBILITY — no one on the roster can lawfully work these shifts. Adding hours or headcount from the current team will not help; see BLOCKERS.'));
                } else {
                    lines.push(row('Diagnosis', 'CAPACITY — the eligible pool is real but too small to cover every shift at once. Widening the pool (see BLOCKERS) is what adds coverage.'));
                    lines.push(row('Employee', 'Status', 'Open shifts they could work'));
                    for (const [empId, shiftIds] of [...eligibleStaff.entries()]
                        .sort((a, b) => b[1].size - a[1].size)) {
                        lines.push(row(staffNames.get(empId) ?? empId, 'Free', shiftIds.size));
                    }
                    for (const empId of [...committedStaff]
                        .sort((a, b) => (staffNames.get(a) ?? a).localeCompare(staffNames.get(b) ?? b))) {
                        lines.push(row(staffNames.get(empId) ?? empId, 'Already rostered', 0));
                    }
                }
                lines.push('');

                // ── One row per open shift, in date order (the audit array
                //    arrives in solver order, which reads as random). ──
                lines.push('--- OPEN SHIFTS ---');
                if (audited < totalUncovered) {
                    lines.push(row('Note', `${audited} of ${totalUncovered} detailed — the rest were capped for report size.`));
                }
                lines.push(row('Date', 'Time', 'Role', 'Eligible staff', 'Main blocker', 'Staff hit'));
                const byDate = [...audit].sort((a, b) =>
                    a.shiftDate.localeCompare(b.shiftDate) || a.startTime.localeCompare(b.startTime));
                for (const a of byDate) {
                    const top = Object.entries(a.rejectionSummary).sort((x, y) => y[1] - x[1])[0];
                    const eligibleHere = [...eligibleStaff.values()].filter(s => s.has(a.shiftId)).length;
                    lines.push(row(
                        a.shiftDate,
                        `${hhmm(a.startTime)}-${hhmm(a.endTime)}`,
                        a.roleName ?? '',
                        eligibleHere,
                        top ? (BLOCKER_LABELS[top[0]]?.label ?? top[0]) : 'No reasons recorded',
                        top ? top[1] : 0,
                    ));
                }
                lines.push('');

                // ── Per-employee detail, COLLAPSED. Staff hit by the same
                //    blockers on every open shift (the overwhelming majority)
                //    become one row instead of one row per shift. ──
                lines.push('--- STAFF DETAIL FOR THE OPEN SHIFTS ---');
                lines.push(row('Employee', 'Open shifts blocked', 'Blockers'));
                const blockedOn = new Map<string, number>();
                for (const a of audit) {
                    for (const d of a.employeeDetails) {
                        if (d.status === 'PASS' && d.violations.length === 0) continue;
                        blockedOn.set(d.employeeId, (blockedOn.get(d.employeeId) ?? 0) + 1);
                    }
                }
                const detailRows = [...staffBlockers.entries()]
                    .map(([empId, set]) => ({
                        name: staffNames.get(empId) ?? empId,
                        count: blockedOn.get(empId) ?? 0,
                        blockers: [...set].map(t => BLOCKER_LABELS[t]?.label ?? t).sort().join(' + '),
                        sole: set.size === 1,
                    }))
                    // One-blocker staff first: they are the shortlist worth acting on.
                    .sort((a, b) => Number(b.sole) - Number(a.sole)
                        || a.blockers.localeCompare(b.blockers)
                        || a.name.localeCompare(b.name));
                for (const d of detailRows) {
                    lines.push(row(d.name, `${d.count} of ${audited}`, d.blockers));
                }
                lines.push('');
            }

            if (result.capacityCheck) {
                const cc = result.capacityCheck;
                lines.push('--- RAW HEADCOUNT CHECK ---');
                // This check multiplies EVERY employee by a daily cap. It knows
                // nothing about availability, role, or employment target, so on
                // this roster it reported "SUFFICIENT" with 865,200 supply
                // minutes while 14 shifts went unfilled — the reader was left to
                // reconcile that on their own. Say what it measures, up front.
                lines.push(row('What this measures', 'Total contracted hours vs total shift hours ONLY. It ignores availability, role and employment type, so it can read SUFFICIENT while shifts still go unfilled — BLOCKERS above is the real constraint.'));
                lines.push(row('Status', cc.sufficient ? 'SUFFICIENT (on raw hours alone)' : 'INSUFFICIENT'));
                lines.push(row('Total demand (hours)', Math.round(cc.totalDemandMinutes / 60)));
                lines.push(row('Total contracted supply (hours)', Math.round(cc.totalSupplyMinutes / 60)));
                // Per-day rows only add signal on days that actually fall short;
                // 14 identical "0 deficit / YES" rows are pure scroll.
                const shortDays = cc.perDay.filter(d => !d.sufficient);
                if (shortDays.length > 0) {
                    lines.push(row('Date', 'Shifts', 'Demand (h)', 'Supply (h)', 'Deficit (h)'));
                    for (const day of shortDays) {
                        lines.push(row(day.date, day.shiftCount, Math.round(day.demandMinutes / 60),
                            Math.round(day.supplyMinutes / 60), Math.round(day.deficitMinutes / 60)));
                    }
                } else {
                    lines.push(row('Days short on raw hours', 'None'));
                }
                lines.push('');
            }

            // ── Booked roster — per-person totals first, then the detail. The
            //    flat list alone never showed that 5 people absorbed everything. ──
            lines.push('--- BOOKED — PER EMPLOYEE ---');
            lines.push(row('Employee', 'Shifts', 'Est. cost'));
            const perEmployee = new Map<string, { name: string; shifts: number; cost: number }>();
            for (const pr of result.proposals) {
                const e = perEmployee.get(pr.employeeId)
                    ?? { name: pr.employeeName, shifts: 0, cost: 0 };
                e.shifts += 1;
                e.cost += pr.optimizerCost ?? 0;
                perEmployee.set(pr.employeeId, e);
            }
            for (const e of [...perEmployee.values()].sort((a, b) => b.shifts - a.shifts || a.name.localeCompare(b.name))) {
                lines.push(row(e.name, e.shifts, money(e.cost)));
            }
            lines.push('');

            lines.push('--- BOOKED ASSIGNMENTS ---');
            lines.push(row('Date', 'Time', 'Employee', 'Role', 'Est. cost'));
            const sortedProposals = [...result.proposals].sort((a, b) =>
                a.shiftDate.localeCompare(b.shiftDate)
                || a.startTime.localeCompare(b.startTime)
                || a.employeeName.localeCompare(b.employeeName));
            for (const pr of sortedProposals) {
                // The Compliance column is gone: every booked row is compliant by
                // the hard gate, so a column reading PASS 70 times running carried
                // no information. The policy is stated once in SUMMARY.
                lines.push(row(pr.shiftDate, `${hhmm(pr.startTime)}-${hhmm(pr.endTime)}`,
                    pr.employeeName, pr.roleName ?? '', money(pr.optimizerCost ?? 0)));
            }

            const blob = new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `Auto-Schedule_Audit_${startDate || new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to generate report', err);
        } finally {
            setIsDownloading(false);
        }
    }, [result, startDate, endDate]);

    const { totals, employeeGroups } = useMemo(() => {
        if (!result) return { totals: { cost: 0, fatigue: 0, p95Fatigue: 0, fairness: 0 }, employeeGroups: [] as EmployeeGroup[] };

        const map = new Map<string, { name: string; proposals: ValidatedProposal[] }>();
        let totalCost = 0;

        for (const p of result.proposals) {
            if (!map.has(p.employeeId)) map.set(p.employeeId, { name: p.employeeName, proposals: [] });
            map.get(p.employeeId)!.proposals.push(p);
            totalCost += p.optimizerCost || 0;
        }

        const groups: EmployeeGroup[] = Array.from(map.entries()).map(([id, { name, proposals }]) => {
            const emp = employees.find(e => e.id === id);
            const roleDist: Record<string, number> = {};
            proposals.forEach(p => {
                const role = p.roleName || 'Unassigned';
                roleDist[role] = (roleDist[role] ?? 0) + 1;
            });

            const sortedDist = Object.entries(roleDist)
                .map(([distName, value]) => ({ name: distName, value }))
                .sort((a, b) => a.name.localeCompare(b.name));

            // Fix 2: use LAST proposal's utilization — the scorer accumulates it
            // cumulatively as shifts are added, so proposals[0] reflects only the
            // first shift. The final entry reflects all shifts assigned to this employee.
            const utilization = proposals.at(-1)?.utilization ?? 0;

            // Fix 3: use LAST proposal's fatigueScore per employee (final cumulative
            // value), then the caller averages across employees — not across assignments.
            const finalFatigue = proposals.at(-1)?.fatigueScore ?? 0;

            return {
                id,
                name,
                proposals,
                roleDistribution: sortedDist,
                totalCost: proposals.reduce((acc, p) => acc + (p.optimizerCost || 0), 0),
                avgFatigue: finalFatigue,
                utilization,
                employmentType: emp?.contract_type || 'Casual',
                contractedHours: emp?.contracted_weekly_hours || 0,
                assignedRoles: Array.from(new Set(proposals.map(p => p.roleName).filter(Boolean))) as string[],
            };
        });

        const aggregateFairness = groups.length > 0
            ? groups.reduce((acc, g) => acc + g.utilization, 0) / groups.length
            : 0;

        // Fix 3: average fatigue across employees (each employee's final cumulative
        // fatigue score), not across individual assignments.
        const avgFatiguePerEmployee = groups.length > 0
            ? groups.reduce((acc, g) => acc + g.avgFatigue, 0) / groups.length
            : 0;

        // p95 fatigue across employees for additional signal
        const sortedFatigue = [...groups].map(g => g.avgFatigue).sort((a, b) => a - b);
        const p95FatigueIdx = Math.floor(sortedFatigue.length * 0.95);
        const p95Fatigue = sortedFatigue.length > 0 ? (sortedFatigue[Math.min(p95FatigueIdx, sortedFatigue.length - 1)] ?? 0) : 0;

        return {
            totals: {
                cost: totalCost,
                fatigue: avgFatiguePerEmployee,
                p95Fatigue,
                fairness: aggregateFairness
            },
            employeeGroups: groups
        };
    }, [result, employees]);

    return {
        // Service + run state
        health,
        phase,
        result,
        isCommitting,
        isDownloading,
        elapsedTime,
        estimatedTotalSeconds,

        // Window
        startDate,
        setStartDate,
        endDate,
        setEndDate,
        validationError,
        applyWindowPreset,
        activeWindowPreset,

        // Scope
        isShiftsLoading,
        filteredShifts,
        scopeBreakdown,
        preRunCapacity,
        canRun,
        runBlockedReason,

        // Derived results
        totals,
        employeeGroups,

        // Actions
        handleRun,
        handleCancel,
        handleCommit,
        handleClose,
        handleDownloadAudit,
    };
}
