/**
 * AutoSchedulerMobileFlow — Auto-Schedule as a full-screen mobile flow.
 *
 * The desktop console is a 320px control rail beside a results canvas. Shrunk to
 * 390px that becomes two unreadable columns (the screenshot that prompted this
 * had "Ready to Optimize" wrapping one word per line), so this is a rebuild, not
 * a reflow.
 *
 * Shape: app bar + phase rail · one scrolling column · one pinned action.
 *
 *   SET UP        window, scope, capacity  → "Compute optimal roster"
 *   OPTIMISING    progress + elapsed/left  → "Stop"
 *   REVIEW        scorecard, staff, gaps   → "Apply N assignments"
 *
 * Three rules drive the layout choices here:
 *   · One primary action per phase, pinned, full width, and it says WHY when it
 *     is disabled — there is no stepper rail on a phone to infer that from.
 *   · No hover. The desktop staff table's role-distribution popover opens on
 *     mouseenter, which is unreachable on touch; here rows expand on tap.
 *   · No table. Eight fixed-width columns (~900px) cannot be squeezed into
 *     390px, so each staff member is a card with the same numbers.
 *
 * Purely presentational — every value and callback comes from useAutoScheduler.
 */

import React, { useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
    AlertTriangle,
    ArrowDown,
    ArrowRight,
    ArrowUp,
    Check,
    CheckCircle2,
    ChevronDown,
    Cpu,
    Download,
    Loader2,
    Users,
    WifiOff,
    X,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { DatePicker } from '@/modules/core/ui/calendar/DatePicker';
import { formatCalendarDate } from '@/modules/core/lib/date.utils';
import { cn } from '@/modules/core/lib/utils';
import { AutoSchedulerInsights } from './AutoSchedulerInsights';
import { sortEmployeeGroups, complianceRateOf, WINDOW_PRESET_LABELS } from './useAutoScheduler';
import type {
    EmployeeGroup,
    PipelinePhase,
    ScopeBreakdown,
    SortField,
    SortDirection,
    WindowPreset,
} from './useAutoScheduler';
import type {
    AutoSchedulerResult,
    CapacityCheck,
    OptimizerHealth,
} from '../types';

interface AutoSchedulerMobileFlowProps {
    health: OptimizerHealth | null;
    phase: PipelinePhase;
    result: AutoSchedulerResult | null;
    isCommitting: boolean;
    isDownloading: boolean;
    elapsedTime: number;
    estimatedTotalSeconds: number;

    startDate: string;
    setStartDate: (v: string) => void;
    endDate: string;
    setEndDate: (v: string) => void;
    validationError: string | null;
    applyWindowPreset: (preset: WindowPreset) => void;
    activeWindowPreset: WindowPreset | null;

    isShiftsLoading: boolean;
    shiftsInScope: number;
    staffCount: number;
    scopeBreakdown: ScopeBreakdown;
    preRunCapacity: CapacityCheck | null;
    canRun: boolean;
    runBlockedReason: string | null;

    employeeGroups: EmployeeGroup[];

    onRun: () => void;
    onCancelRun: () => void;
    onCommit: () => void;
    onClose: () => void;
    onDownloadAudit: () => void;
}

const SORT_LABELS: Record<SortField, string> = {
    name: 'Name',
    utilization: 'Utilisation',
    fatigue: 'Fatigue',
    shifts: 'Shifts',
    compliance: 'Compliance',
    cost: 'Est. cost',
};

const money = (n: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);

/* ═══════════════════════════════════════════════════════════════════════
   PRIMITIVES
   ═══════════════════════════════════════════════════════════════════════ */

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
    title,
    hint,
    children,
}) => (
    <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {title}
            </h3>
            {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
        </div>
        {children}
    </section>
);

/**
 * Status row — the one shape used for every "here is a fact about this run"
 * message, so severity reads from tone alone and nothing needs its own card.
 */
const StatusRow: React.FC<{
    tone: 'ok' | 'warn' | 'error' | 'info';
    icon: React.ElementType;
    title: string;
    body?: React.ReactNode;
}> = ({ tone, icon: Icon, title, body }) => {
    const styles = {
        ok:    'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400',
        warn:  'border-amber-500/25 bg-amber-500/[0.06] text-amber-600 dark:text-amber-400',
        error: 'border-rose-500/25 bg-rose-500/[0.06] text-rose-600 dark:text-rose-400',
        info:  'border-border bg-muted/30 text-foreground',
    }[tone];
    return (
        <div className={cn('flex items-start gap-2.5 rounded-xl border p-3', styles)}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-snug">{title}</p>
                {body && (
                    <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{body}</div>
                )}
            </div>
        </div>
    );
};

/**
 * Step heading — replaces the decorative rail that used to sit in the app bar.
 * "STEP 1 OF 3 / Set your scheduling window" states position AND task; three
 * tiny words under a progress bar stated neither.
 */
const StepHeading: React.FC<{ step: 1 | 2 | 3; title: string; blurb: string }> = ({
    step,
    title,
    blurb,
}) => (
    <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            Step {step} of 3
        </p>
        <h3 className="mt-1 text-[20px] font-bold leading-tight tracking-tight text-foreground">
            {title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
);

/** One end of the scheduling window: a labelled row that opens the shared picker. */
const WindowRow: React.FC<{
    label: string;
    value: Date | undefined;
    onChange: (d: Date) => void;
    invalid?: boolean;
}> = ({ label, value, onChange, invalid }) => (
    <DatePicker
        label={`${label} date`}
        value={value}
        onChange={onChange}
        displayFormat="d MMM yyyy"
        align="start"
    >
        <button
            type="button"
            aria-invalid={invalid}
            aria-describedby={invalid ? 'as-window-error' : undefined}
            // DatePicker only labels its DEFAULT trigger; a custom one takes its
            // accessible name from text content, which concatenates to
            // "Start12 Aug 2026". Name it explicitly.
            aria-label={
                value ? `${label} date: ${format(value, 'd MMM yyyy')}` : `${label} date`
            }
            className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left"
        >
            <span className="w-12 shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {label}
            </span>
            <span
                className={cn(
                    'flex-1 truncate text-[16px] font-semibold',
                    value ? 'text-foreground' : 'text-muted-foreground/60',
                    invalid && 'text-rose-500',
                )}
            >
                {value ? format(value, 'd MMM yyyy') : 'Choose a date'}
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
        </button>
    </DatePicker>
);

/** Row in the "why is nothing eligible" list. */
const ExclusionRow: React.FC<{ count: number; label: string }> = ({ count, label }) => (
    <li className="flex items-baseline gap-2 text-[13px]">
        <span className="min-w-[1.5rem] shrink-0 text-right font-bold tabular-nums text-foreground">
            {count}
        </span>
        <span className="text-muted-foreground">{label}</span>
    </li>
);

/**
 * Capacity preview — fills the dead space under the form with the one thing
 * worth knowing before committing to a run: is there enough labour at all.
 * Both figures come from the same pre-run capacity check the solver uses.
 */
const CapacityPreview: React.FC<{ capacity: CapacityCheck }> = ({ capacity }) => {
    const demandHours = Math.round(capacity.totalDemandMinutes / 60);
    const supplyHours = Math.round(capacity.totalSupplyMinutes / 60);
    const short = capacity.deficitDays.length;
    // Ratio of what is needed to what exists — a headroom bar, NOT a coverage
    // prediction. Nothing can predict coverage before the solver runs.
    const fill = supplyHours > 0 ? Math.min(100, (demandHours / supplyHours) * 100) : 100;

    return (
        <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Staff hours
                </p>
                <p className="text-[12px] tabular-nums text-muted-foreground">
                    {demandHours}h needed · {supplyHours}h available
                </p>
            </div>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={cn('h-full rounded-full', short > 0 ? 'bg-amber-500' : 'bg-emerald-500')}
                    style={{ width: `${fill}%` }}
                />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                {short > 0 ? (
                    <>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                            Short on {short} {short === 1 ? 'day' : 'days'}.
                        </span>{' '}
                        Some shifts will stay open however the roster is arranged — you'll see exactly which.
                    </>
                ) : (
                    'There are enough staff hours to cover every shift in this window.'
                )}
            </p>
        </div>
    );
};

/** Small labelled figure used inside the staff cards. */
const Metric: React.FC<{ label: string; value: string; className?: string }> = ({
    label,
    value,
    className,
}) => (
    <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
            {label}
        </p>
        <p className={cn('mt-0.5 truncate text-[15px] font-bold tabular-nums text-foreground', className)}>
            {value}
        </p>
    </div>
);

/* ═══════════════════════════════════════════════════════════════════════
   STAFF CARD — the mobile form of one table row
   ═══════════════════════════════════════════════════════════════════════ */

const StaffCard: React.FC<{ group: EmployeeGroup }> = ({ group }) => {
    const [expanded, setExpanded] = useState(false);
    const rate = complianceRateOf(group) * 100;
    const initials = group.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    const utilTone =
        group.utilization > 90 ? 'bg-rose-500' : group.utilization > 70 ? 'bg-amber-500' : 'bg-emerald-500';
    const fatigueTone =
        group.avgFatigue > 8 ? 'text-rose-500' : group.avgFatigue > 5 ? 'text-amber-500' : 'text-emerald-500';

    return (
        <div className="rounded-xl border border-border bg-card">
            {/* The whole header is the disclosure control — a 24px chevron is not
                a touch target, and tapping the row is what people try first. */}
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 p-3 text-left"
            >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-[12px] font-bold text-foreground">
                    {initials}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-foreground">{group.name}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                        {group.employmentType}
                        {group.contractedHours > 0 && ` · ${group.contractedHours}h contract`}
                        {` · ${group.proposals.length} shift${group.proposals.length === 1 ? '' : 's'}`}
                    </p>
                </div>
                <ChevronDown
                    className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform',
                        expanded && 'rotate-180',
                    )}
                />
            </button>

            <div className="grid grid-cols-3 gap-3 border-t border-border/60 px-3 py-2.5">
                <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                        Utilisation
                    </p>
                    <p className="mt-0.5 text-[15px] font-bold tabular-nums text-foreground">
                        {group.utilization.toFixed(0)}%
                    </p>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                            className={cn('h-full rounded-full', utilTone)}
                            style={{ width: `${Math.min(group.utilization, 100)}%` }}
                        />
                    </div>
                </div>
                <Metric label="Fatigue" value={group.avgFatigue.toFixed(1)} className={fatigueTone} />
                <Metric label="Est. cost" value={money(group.totalCost)} />
            </div>

            {expanded && (
                <div className="space-y-3 border-t border-border/60 px-3 py-3">
                    <div>
                        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                            Compliance
                        </p>
                        <p className="text-[13px] text-foreground">
                            <span className={cn('font-bold', rate === 100 ? 'text-emerald-500' : rate > 0 ? 'text-amber-500' : 'text-rose-500')}>
                                {rate.toFixed(0)}% clear
                            </span>
                            <span className="text-muted-foreground">
                                {' '}· {group.proposals.filter(p => p.complianceStatus === 'PASS').length} of{' '}
                                {group.proposals.length} assignments passing
                            </span>
                        </p>
                    </div>

                    <div>
                        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                            Shifts by role
                        </p>
                        {group.roleDistribution.length === 0 ? (
                            <p className="text-[13px] text-muted-foreground">No role data.</p>
                        ) : (
                            <ul className="space-y-1">
                                {group.roleDistribution.map(rd => (
                                    <li
                                        key={rd.name}
                                        className="flex items-center justify-between gap-3 text-[13px]"
                                    >
                                        <span className="truncate text-foreground">{rd.name}</span>
                                        <span className="shrink-0 font-bold tabular-nums text-muted-foreground">
                                            {rd.value}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════ */

export const AutoSchedulerMobileFlow: React.FC<AutoSchedulerMobileFlowProps> = ({
    health,
    phase,
    result,
    isCommitting,
    isDownloading,
    elapsedTime,
    estimatedTotalSeconds,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    validationError,
    applyWindowPreset,
    activeWindowPreset,
    isShiftsLoading,
    shiftsInScope,
    staffCount,
    scopeBreakdown,
    preRunCapacity,
    canRun,
    runBlockedReason,
    employeeGroups,
    onRun,
    onCancelRun,
    onCommit,
    onClose,
    onDownloadAudit,
}) => {
    const [sortField, setSortField] = useState<SortField>('utilization');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [showPolicy, setShowPolicy] = useState(false);
    const windowRef = useRef<HTMLDivElement>(null);

    const isReview = phase === 'reviewing' || phase === 'done';
    const sortedGroups = useMemo(
        () => sortEmployeeGroups(employeeGroups, sortField, sortDirection),
        [employeeGroups, sortField, sortDirection],
    );

    const stepIndex = phase === 'idle' ? 0 : phase === 'optimizing' || phase === 'validating' ? 1 : 2;
    const steps = ['Set up', 'Optimising', 'Review'];

    const progressPct = Math.min(
        98,
        estimatedTotalSeconds > 0 ? (elapsedTime / estimatedTotalSeconds) * 100 : 0,
    );

    /* Window as one human phrase — "4 Aug → 31 Aug" answers "what period?" at a
       glance, which two `dd/mm/yyyy` fields never do. */
    const toDate = (iso: string): Date | undefined => {
        if (!iso) return undefined;
        try {
            const d = parseISO(iso);
            return isNaN(d.getTime()) ? undefined : d;
        } catch {
            return undefined;
        }
    };
    const startObj = toDate(startDate);
    const endObj = toDate(endDate);
    const windowLabel =
        startObj && endObj && !validationError
            ? `${format(startObj, 'd MMM')} → ${format(endObj, 'd MMM yyyy')}`
            : null;

    /** Header status in the planner's terms, never the service's. */
    const statusLine = !health
        ? 'Checking availability…'
        : !health.available
        ? 'Unavailable right now'
        : isReview
        ? `${result?.passing ?? 0} assignments ready to review`
        : phase === 'optimizing' || phase === 'validating'
        ? 'Building your roster…'
        : isShiftsLoading
        ? 'Checking this window…'
        : validationError
        ? 'Choose a valid window'
        : shiftsInScope > 0
        ? `Ready · ${shiftsInScope} shift${shiftsInScope === 1 ? '' : 's'} to fill`
        : 'Nothing to schedule in this window';

    const focusWindow = () => {
        windowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        windowRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    };

    const uncovered = result?.uncoveredV8ShiftIds.length ?? 0;
    const degraded =
        !!result &&
        (result.usedFallback ||
            result.optimizerStatus === 'INFEASIBLE' ||
            result.optimizerStatus === 'UNKNOWN' ||
            result.optimizerStatus === 'MODEL_INVALID');

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            {/* ── APP BAR ─────────────────────────────────────────────────────
                Close, title and status only. The step indicator moved into the
                body: as chrome it competed with the close button and read as
                decoration, and neither told anyone what to do next. */}
            <header className="safe-area-top flex-shrink-0 border-b border-border bg-background">
                <div className="flex items-center gap-1 px-2 py-2">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onClose}
                        aria-label="Close Auto-Schedule"
                        className="h-11 w-11 shrink-0 rounded-full p-0 text-muted-foreground"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-[16px] font-bold leading-tight text-foreground">Auto-Schedule</h2>
                        <p className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'h-1.5 w-1.5 shrink-0 rounded-full',
                                    !health ? 'bg-muted-foreground/40'
                                        : !health.available ? 'bg-rose-500'
                                        : shiftsInScope > 0 || isReview ? 'bg-emerald-500'
                                        : 'bg-amber-500',
                                )}
                            />
                            <span className="truncate">{statusLine}</span>
                        </p>
                    </div>
                </div>
            </header>

            {/* ── BODY ────────────────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5">
                {/* ─────────── SET UP ─────────── */}
                {phase === 'idle' && (
                    <>
                        <StepHeading
                            step={1}
                            title="Set your scheduling window"
                            blurb="Choose the period Auto-Schedule should fill."
                        />

                        <div ref={windowRef}>
                            <Section title="Schedule window">
                                {/* Two rows reading start → end, not two generic form
                                    fields. Dates render as "4 Aug 2026": 04/08 vs 31/08
                                    is one glance away from being read as US order. */}
                                <div className="overflow-hidden rounded-xl border border-border bg-card">
                                    <WindowRow
                                        label="Start"
                                        value={startObj}
                                        onChange={d => setStartDate(format(d, 'yyyy-MM-dd'))}
                                        invalid={!!validationError}
                                    />
                                    <div className="h-px bg-border" />
                                    <WindowRow
                                        label="End"
                                        value={endObj}
                                        onChange={d => setEndDate(format(d, 'yyyy-MM-dd'))}
                                        invalid={!!validationError}
                                    />
                                </div>

                                {/* Most runs are a week, a fortnight or a month. Driving
                                    two pickers by hand for that is pure friction. */}
                                <div className="flex flex-wrap gap-2">
                                    {(Object.keys(WINDOW_PRESET_LABELS) as WindowPreset[]).map(p => (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => applyWindowPreset(p)}
                                            aria-pressed={activeWindowPreset === p}
                                            className={cn(
                                                'h-10 rounded-lg border px-3.5 text-[13px] font-medium transition-colors',
                                                activeWindowPreset === p
                                                    ? 'border-primary bg-primary/10 text-primary'
                                                    : 'border-border bg-background text-muted-foreground',
                                            )}
                                        >
                                            {WINDOW_PRESET_LABELS[p]}
                                        </button>
                                    ))}
                                </div>

                                {/* Attached to the fields it describes — the error must be
                                    readable without scrolling away from its cause. */}
                                {validationError && (
                                    <p
                                        id="as-window-error"
                                        role="alert"
                                        className="flex items-start gap-1.5 text-[12px] font-medium text-rose-500"
                                    >
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        {validationError} Windows can span up to 31 days.
                                    </p>
                                )}
                            </Section>
                        </div>

                        {health && !health.available && (
                            <StatusRow
                                tone="error"
                                icon={WifiOff}
                                title="Auto-Schedule is unavailable right now"
                                body="The scheduling service isn't responding. Assign shifts manually, or try again shortly."
                            />
                        )}

                        {isShiftsLoading ? (
                            <Section title="What will be scheduled">
                                {/* Skeleton, not a spinner — the real panel is a known
                                    shape, so hold it and avoid the layout jump. */}
                                <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Checking this window">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="h-[76px] rounded-xl border border-border bg-muted/40" />
                                        <div className="h-[76px] rounded-xl border border-border bg-muted/40" />
                                    </div>
                                    <div className="h-[92px] rounded-xl border border-border bg-muted/40" />
                                </div>
                            </Section>
                        ) : validationError ? null : shiftsInScope === 0 ? (
                            /* The hero state when there is nothing to do: what is
                               missing, WHY (from the real exclusion counts), and the
                               one thing that changes it. */
                            <Section title="What will be scheduled">
                                <div className="rounded-xl border border-border bg-card p-5 text-center">
                                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/40">
                                        <Cpu className="h-5 w-5 text-muted-foreground/50" />
                                    </div>
                                    <p className="text-[16px] font-semibold text-foreground">
                                        Nothing to schedule yet
                                    </p>
                                    <p className="mx-auto mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
                                        {scopeBreakdown.total === 0
                                            ? 'There are no shifts at all in this date range.'
                                            : `All ${scopeBreakdown.total} shift${scopeBreakdown.total === 1 ? '' : 's'} in this range are already handled.`}
                                    </p>

                                    {scopeBreakdown.total > 0 && (
                                        <ul className="mx-auto mt-4 max-w-[280px] space-y-1.5 text-left">
                                            {scopeBreakdown.assigned > 0 && (
                                                <ExclusionRow
                                                    count={scopeBreakdown.assigned}
                                                    label="already assigned"
                                                />
                                            )}
                                            {scopeBreakdown.published > 0 && (
                                                <ExclusionRow
                                                    count={scopeBreakdown.published}
                                                    label="published — out for bidding"
                                                />
                                            )}
                                            {scopeBreakdown.startingSoon > 0 && (
                                                <ExclusionRow
                                                    count={scopeBreakdown.startingSoon}
                                                    label="starting within 4 hours"
                                                />
                                            )}
                                        </ul>
                                    )}

                                    {/* Omitted when the window already IS this month —
                                        the footer's "Adjust dates" is the only move
                                        left, and a button that changes nothing is worse
                                        than no button. */}
                                    {activeWindowPreset !== 'month' && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => applyWindowPreset('month')}
                                            className="mt-5 h-11 rounded-xl px-5 text-[13px] font-semibold"
                                        >
                                            Widen to this month
                                        </Button>
                                    )}
                                </div>
                            </Section>
                        ) : (
                            <Section
                                title="What will be scheduled"
                                hint={windowLabel ?? undefined}
                            >
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-xl border border-border bg-card p-3">
                                        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                                            Shifts to fill
                                        </p>
                                        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                                            {shiftsInScope}
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-border bg-card p-3">
                                        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                                            Staff available
                                        </p>
                                        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                                            {staffCount}
                                        </p>
                                    </div>
                                </div>

                                {/* Capacity preview. Every figure is measured, not
                                    projected: a "94% predicted coverage" before the
                                    solver has run would be a number we invented. */}
                                {preRunCapacity && (
                                    <CapacityPreview capacity={preRunCapacity} />
                                )}

                                {scopeBreakdown.total > shiftsInScope && (
                                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                                        {scopeBreakdown.total - shiftsInScope} other shift
                                        {scopeBreakdown.total - shiftsInScope === 1 ? '' : 's'} in this range
                                        {' '}will be left alone
                                        {[
                                            scopeBreakdown.assigned > 0 && `${scopeBreakdown.assigned} assigned`,
                                            scopeBreakdown.published > 0 && `${scopeBreakdown.published} published`,
                                            scopeBreakdown.startingSoon > 0 && `${scopeBreakdown.startingSoon} starting soon`,
                                        ].filter(Boolean).length > 0
                                            ? ` (${[
                                                  scopeBreakdown.assigned > 0 && `${scopeBreakdown.assigned} assigned`,
                                                  scopeBreakdown.published > 0 && `${scopeBreakdown.published} published`,
                                                  scopeBreakdown.startingSoon > 0 && `${scopeBreakdown.startingSoon} starting soon`,
                                              ].filter(Boolean).join(' · ')}).`
                                            : '.'}
                                    </p>
                                )}
                            </Section>
                        )}

                        {/* Reference, not instruction — collapsed so it stops taking
                            permanent space above the fold. */}
                        <section className="overflow-hidden rounded-xl border border-border bg-card">
                            <button
                                type="button"
                                onClick={() => setShowPolicy(v => !v)}
                                aria-expanded={showPolicy}
                                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        How it decides
                                    </p>
                                    <p className="mt-0.5 truncate text-[13px] text-foreground">
                                        Coverage → Wellbeing → Cost
                                    </p>
                                </div>
                                <ChevronDown
                                    className={cn(
                                        'h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform',
                                        showPolicy && 'rotate-180',
                                    )}
                                />
                            </button>
                            {showPolicy && (
                                <ol className="space-y-3 border-t border-border px-4 py-4">
                                    {[
                                        ['Coverage', 'Fill as many open shifts as possible.'],
                                        ['Wellbeing', 'Spread the load; avoid fatigue and unfair rosters.'],
                                        ['Cost', 'Once the above hold, pick the cheapest option.'],
                                    ].map(([name, blurb], i) => (
                                        <li key={name} className="flex gap-3">
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                                                {i + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-[13px] font-semibold text-foreground">{name}</p>
                                                <p className="text-[12px] leading-relaxed text-muted-foreground">
                                                    {blurb}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                    <li className="border-t border-border pt-3 text-[12px] leading-relaxed text-muted-foreground">
                                        No weights to tune, and an assignment that breaks a rule is never booked —
                                        the shift is left open instead.
                                    </li>
                                </ol>
                            )}
                        </section>
                    </>
                )}

                {/* ─────────── OPTIMISING ─────────── */}
                {(phase === 'optimizing' || phase === 'validating') && (
                    <div className="flex flex-col gap-6">
                        <StepHeading
                            step={2}
                            title="Building your roster"
                            blurb={`Testing every legal combination of ${shiftsInScope} shifts across ${staffCount} staff.`}
                        />

                        <div className="flex justify-center py-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                <Cpu className="h-7 w-7" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div
                                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(progressPct)}
                                aria-label="Optimisation progress"
                            >
                                <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between text-[12px] text-muted-foreground tabular-nums">
                                <span>{elapsedTime}s elapsed</span>
                                <span>
                                    {elapsedTime < estimatedTotalSeconds
                                        ? `about ${estimatedTotalSeconds - elapsedTime}s left`
                                        : 'finishing up…'}
                                </span>
                            </div>
                        </div>

                        <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
                            You can stop at any time — nothing is saved until you apply the result.
                        </p>
                    </div>
                )}

                {/* ─────────── REVIEW ─────────── */}
                {isReview && result && (
                    <>
                        <StepHeading
                            step={3}
                            title="Review before applying"
                            blurb={windowLabel ? `Proposed roster for ${windowLabel}.` : 'Proposed roster.'}
                        />

                        <StatusRow
                            tone={uncovered > 0 ? 'warn' : 'ok'}
                            icon={uncovered > 0 ? AlertTriangle : CheckCircle2}
                            title={
                                uncovered > 0
                                    ? `${result.passing} assignments ready · ${uncovered} shift${uncovered === 1 ? '' : 's'} left open`
                                    : `${result.passing} assignments ready · every shift covered`
                            }
                            body="Nothing is saved until you apply."
                        />

                        {degraded && (
                            <StatusRow
                                tone="error"
                                icon={WifiOff}
                                title={
                                    result.usedFallback
                                        ? 'Built with the fallback engine'
                                        : `Solver returned ${result.optimizerStatus}`
                                }
                                body={
                                    result.usedFallback
                                        ? 'The optimizer was unreachable, so a simpler first-fit engine produced this. Cost, fatigue and fairness will be worse than a full run.'
                                        : 'Coverage may be partial — check the open shifts below before applying.'
                                }
                            />
                        )}

                        <AutoSchedulerInsights result={result} compact />

                        {/* ── Staff ── */}
                        <Section
                            title="Staff"
                            hint={`${employeeGroups.length} assigned`}
                        >
                            <div className="flex items-center gap-2">
                                <Select value={sortField} onValueChange={v => setSortField(v as SortField)}>
                                    <SelectTrigger className="h-11 flex-1 rounded-xl bg-background text-[13px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(SORT_LABELS) as SortField[]).map(f => (
                                            <SelectItem key={f} value={f}>
                                                Sort by {SORT_LABELS[f].toLowerCase()}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'))}
                                    aria-label={
                                        sortDirection === 'asc'
                                            ? 'Sorted ascending, switch to descending'
                                            : 'Sorted descending, switch to ascending'
                                    }
                                    className="h-11 w-11 shrink-0 rounded-xl p-0"
                                >
                                    {sortDirection === 'asc' ? (
                                        <ArrowUp className="h-4 w-4" />
                                    ) : (
                                        <ArrowDown className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>

                            {sortedGroups.length === 0 ? (
                                <StatusRow
                                    tone="info"
                                    icon={Users}
                                    title="Nobody could be assigned"
                                    body="Every candidate was blocked by a rule or already busy. The open shifts below explain which."
                                />
                            ) : (
                                <div className="space-y-2">
                                    {sortedGroups.map(group => (
                                        <StaffCard key={group.id} group={group} />
                                    ))}
                                </div>
                            )}
                        </Section>

                        {/* ── Open shifts ── */}
                        {result.uncoveredAudit && result.uncoveredAudit.length > 0 && (
                            <Section title="Open shifts" hint={`${uncovered} unfilled`}>
                                <div className="space-y-2">
                                    {result.uncoveredAudit.slice(0, 5).map(audit => (
                                        <div
                                            key={audit.shiftId}
                                            className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-3"
                                        >
                                            <div className="flex items-baseline justify-between gap-2">
                                                <p className="text-[14px] font-semibold text-foreground">
                                                    {formatCalendarDate(audit.shiftDate, 'EEE d MMM')}
                                                    <span className="ml-2 font-normal text-muted-foreground">
                                                        {audit.startTime}–{audit.endTime}
                                                    </span>
                                                </p>
                                                {audit.roleName && (
                                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                                        {audit.roleName}
                                                    </span>
                                                )}
                                            </div>
                                            {Object.keys(audit.rejectionSummary).length > 0 ? (
                                                <ul className="mt-2 space-y-0.5">
                                                    {Object.entries(audit.rejectionSummary).map(([reason, count]) => (
                                                        <li key={reason} className="text-[12px] text-muted-foreground">
                                                            {reason.replace(/_/g, ' ').toLowerCase()} — {count} staff
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="mt-2 text-[12px] text-muted-foreground">
                                                    No reason recorded by the solver.
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                    {uncovered > 5 && (
                                        <p className="pt-1 text-[12px] text-muted-foreground">
                                            {uncovered - 5} more — download the audit report for the full list.
                                        </p>
                                    )}
                                </div>
                            </Section>
                        )}

                        <Button
                            type="button"
                            variant="outline"
                            onClick={onDownloadAudit}
                            disabled={isDownloading}
                            className="h-12 w-full gap-2 rounded-xl text-[13px] font-semibold"
                        >
                            {isDownloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                            {isDownloading ? 'Preparing report…' : 'Download audit report'}
                        </Button>
                    </>
                )}
            </div>

            {/* ── ACTION BAR ──────────────────────────────────────────────── */}
            <div className="safe-area-bottom flex-shrink-0 border-t border-border bg-background">
                <div className="space-y-2.5 px-4 py-3">
                    {phase === 'idle' && (
                        /* When there is nothing to run, the primary action is the
                           thing that WOULD change that — not a dead button. */
                        canRun ? (
                            <>
                                <p className="text-center text-[12px] text-muted-foreground">
                                    {shiftsInScope} eligible shift{shiftsInScope === 1 ? '' : 's'}
                                    {windowLabel && ` · ${windowLabel}`}
                                </p>
                                <Button
                                    type="button"
                                    onClick={onRun}
                                    className="h-12 w-full gap-2 rounded-xl text-[14px] font-bold"
                                >
                                    <Cpu className="h-4 w-4" />
                                    Start Auto-Schedule
                                </Button>
                            </>
                        ) : (
                            <>
                                {/* A dead primary with no reason is the worst mobile
                                    failure mode — there is no sidebar to infer it from. */}
                                {runBlockedReason && (
                                    <p className="text-center text-[12px] text-muted-foreground">
                                        {runBlockedReason}
                                    </p>
                                )}
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={focusWindow}
                                    disabled={isShiftsLoading}
                                    className="h-12 w-full rounded-xl text-[14px] font-bold"
                                >
                                    Adjust dates
                                </Button>
                            </>
                        )
                    )}

                    {(phase === 'optimizing' || phase === 'validating') && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onCancelRun}
                            className="h-12 w-full gap-2 rounded-xl border-rose-500/30 text-[14px] font-bold text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                        >
                            <X className="h-4 w-4" />
                            Stop
                        </Button>
                    )}

                    {isReview && (
                        <>
                            <Button
                                type="button"
                                onClick={onCommit}
                                disabled={isCommitting || result?.passing === 0}
                                className="h-12 w-full gap-2 rounded-xl bg-emerald-600 text-[14px] font-bold text-white hover:bg-emerald-500"
                            >
                                {isCommitting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="h-4 w-4" />
                                )}
                                {isCommitting
                                    ? 'Applying…'
                                    : `Apply ${result?.passing ?? 0} assignment${result?.passing === 1 ? '' : 's'}`}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onRun}
                                disabled={isCommitting}
                                className="h-11 w-full rounded-xl text-[13px] font-semibold text-muted-foreground"
                            >
                                Discard and run again
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AutoSchedulerMobileFlow;
