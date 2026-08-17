/**
 * ShiftFormDrawerContent — Wizard bento grid
 *
 * Deterministic 2-column × 3-row card grid (no overlap, equal-height pairs):
 *   Row 1 ─ Step 1 Role & Context      │ Step 2 Requirements & Notes
 *   Row 2 ─ Step 3 Timings             │ Step 4 Assignment
 *   Row 3 ─ Step 5 Compliance (full width)
 *
 * One step is "active" (editable) at a time; unlocked steps are dimmed but
 * clickable, future steps are locked. Back / progress / Next navigation sits
 * directly beneath the cards.
 *
 * Aesthetic: precision "blueprint" control panel — hairline borders, a faint
 * engineering grid texture, per-step accent colour, monospace numerics, and a
 * single staggered entrance. Theme-aware via semantic tokens (light + dark).
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import {
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from '@/modules/core/ui/primitives/form';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { cn } from '@/modules/core/lib/utils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from '@/modules/core/ui/primitives/command';
import {
    Clock,
    AlertCircle,
    AlertTriangle,
    Lock as LockIcon,
    Shield,
    CalendarCheck,
    GraduationCap,
    Coffee,
    Utensils,
    Info,
    UserCircle,
    Loader2,
    CheckCircle2,
    X,
    Briefcase,
    StickyNote,
    Plus,
    Check,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Button } from '@/modules/core/ui/primitives/button';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import { MultiSelect } from './MultiSelect';
import type { ShiftFormDrawerContentProps } from '../types';
import { formatHours, calculateShiftLength } from '../utils';
import {
    TARGET_EMPLOYMENT_TYPES,
    TARGET_EMPLOYMENT_TYPE_LABELS,
    contractMatchesTarget,
} from '@/modules/core/model/employment.types';

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */

const GROUP_LABEL: Record<string, string> = {
    convention_centre: 'Convention Centre',
    exhibition_centre: 'Exhibition Centre',
    theatre: 'Theatre',
    the_cutaway: 'The Cutaway',
};

type Accent = 'amber' | 'cyan' | 'emerald' | 'indigo' | 'slate';
type CardState = 'active' | 'enabled' | 'locked';

/** Per-accent static class strings (kept literal so Tailwind's JIT keeps them). */
const ACCENT = {
    amber: {
        rgb: '245,158,11',
        chip: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
        bar: 'from-amber-400 to-amber-600',
        activeBorder:
            'border-amber-500/60 shadow-sm',
        badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
    },
    cyan: {
        rgb: '6,182,212',
        chip: 'bg-cyan-500',
        text: 'text-cyan-600 dark:text-cyan-400',
        bar: 'from-cyan-400 to-cyan-600',
        activeBorder:
            'border-cyan-500/60 shadow-sm',
        badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
    },
    emerald: {
        rgb: '16,185,129',
        chip: 'bg-emerald-500',
        text: 'text-emerald-600 dark:text-emerald-400',
        bar: 'from-emerald-400 to-emerald-600',
        activeBorder:
            'border-emerald-500/60 shadow-sm',
        badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    },
    indigo: {
        rgb: '99,102,241',
        chip: 'bg-indigo-500',
        text: 'text-indigo-600 dark:text-indigo-400',
        bar: 'from-indigo-400 to-indigo-600',
        activeBorder:
            'border-indigo-500/60 shadow-sm',
        badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
    },
    slate: {
        rgb: '148,163,184',
        chip: 'bg-slate-500',
        text: 'text-slate-600 dark:text-slate-400',
        bar: 'from-slate-400 to-slate-600',
        activeBorder:
            'border-slate-500/60 shadow-sm',
        badge: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/25',
    },
} as const;

/* ═══════════════════════════════════════════════════════════════════════
   PRIMITIVES
   ═══════════════════════════════════════════════════════════════════════ */

/** Card wrapper — equal-height, never collapses, clickable when enabled. */
const Card = ({
    children,
    className,
    accent,
    state,
    index = 0,
    onClick,
}: {
    children: React.ReactNode;
    className?: string;
    accent: Accent;
    state: CardState;
    index?: number;
    onClick?: () => void;
}) => {
    const a = ACCENT[accent];
    return (
        <div
            onClick={state === 'enabled' ? onClick : undefined}
            // One step renders at a time now, so the old per-card stagger delay
            // (index * 70ms) would just blank the panel before later steps fade in.
            style={{ animationDelay: '0ms' }}
            className={cn(
                'group/card relative flex min-h-[284px] flex-col overflow-hidden rounded-[20px] border bg-card dark:bg-[#111419]',
                'animate-in fade-in slide-in-from-bottom-3 duration-500 fill-mode-both',
                'transition-[transform,box-shadow,border-color,opacity] duration-300',
                state === 'active' && cn(a.activeBorder, '-translate-y-0.5'),
                state === 'enabled' &&
                    'cursor-pointer border-border/40 opacity-[0.55] hover:opacity-90 hover:border-border/70 hover:-translate-y-0.5',
                state === 'locked' &&
                    'pointer-events-none border-border/25 opacity-40',
                className,
            )}
        >
            {/* Engineering grid texture (dark only, contained) */}
            <div
                className="pointer-events-none absolute inset-0 hidden opacity-[0.5] dark:block"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                    maskImage:
                        'radial-gradient(120% 120% at 100% 0%, #000 0%, transparent 70%)',
                }}
            />
            {/* Accent corner glow — active only */}
            {state === 'active' && (
                <div
                    className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
                    style={{
                        background: `radial-gradient(circle, rgba(${a.rgb},0.16), transparent 70%)`,
                    }}
                />
            )}
            {/* Top accent rule — active only */}
            {state === 'active' && (
                <div
                    className={cn(
                        'absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r',
                        a.bar,
                    )}
                />
            )}
            <div className="relative z-10 flex h-full flex-col p-5">{children}</div>
        </div>
    );
};

/** Compact card header — icon chip · step meta · status badge. */
const CardHeader = ({
    icon: Icon,
    step,
    title,
    subtitle,
    accent,
    state,
    completed,
    badge,
    headingRef,
}: {
    icon: React.ElementType;
    step: number;
    title: string;
    subtitle: string;
    accent: Accent;
    state: CardState;
    completed?: boolean;
    badge?: React.ReactNode;
    /** Focus lands here when the wizard advances — see `stepHeadingRef`. */
    headingRef?: React.Ref<HTMLHeadingElement>;
}) => {
    const a = ACCENT[accent];
    return (
        <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
                <div
                    className={cn(
                        'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-md transition-colors',
                        state === 'active' ? a.chip : 'bg-muted dark:bg-zinc-800',
                    )}
                >
                    <Icon
                        className={cn(
                            'h-5 w-5',
                            state === 'active'
                                ? 'text-white'
                                : 'text-muted-foreground/70',
                        )}
                    />
                    {completed && state !== 'active' && (
                        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-card dark:ring-[#111419]">
                            <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                        </span>
                    )}
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span
                            className={cn(
                                'font-mono text-[10px] font-bold uppercase tracking-[0.22em]',
                                state === 'active'
                                    ? a.text
                                    : 'text-muted-foreground/50',
                            )}
                        >
                            Step {step}
                        </span>
                    </div>
                    <h3
                        ref={headingRef}
                        tabIndex={headingRef ? -1 : undefined}
                        className="truncate text-[15px] font-bold leading-tight tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                    >
                        {title}
                    </h3>
                    <p className="truncate text-[11px] font-medium text-muted-foreground/70">
                        {subtitle}
                    </p>
                </div>
            </div>
            {badge && <div className="shrink-0 pt-0.5">{badge}</div>}
        </div>
    );
};

/** Status pill shown top-right of a card header. */
const StatusBadge = ({
    children,
    tone = 'muted',
    accent,
}: {
    children: React.ReactNode;
    tone?: 'accent' | 'muted' | 'danger';
    accent?: Accent;
}) => {
    const cls =
        tone === 'danger'
            ? 'bg-rose-500/10 text-rose-500 border-rose-500/25'
            : tone === 'accent' && accent
            ? ACCENT[accent].badge
            : 'bg-muted/60 text-muted-foreground/70 border-border/50';
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] whitespace-nowrap',
                cls,
            )}
        >
            {children}
        </span>
    );
};

/** Tiny field label */
const FieldLabel = ({
    children,
    required,
}: {
    children: React.ReactNode;
    required?: boolean;
}) => (
    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/80">
        {children}
        {required && <span className="ml-0.5 text-amber-500">*</span>}
    </p>
);

/** Duration stat chip */
const StatChip = ({
    label,
    value,
    colorClass,
}: {
    label: string;
    value: string;
    colorClass: string;
}) => {
    const empty = value === '—' || value === '0.00h' || value === '0m';
    return (
        <div
            className={cn(
                'flex-1 rounded-xl border px-3 py-2.5',
                empty
                    ? 'border-border/30 bg-muted/30 dark:bg-zinc-900/40'
                    : 'border-border/50 bg-muted/60 dark:bg-zinc-800/70',
            )}
        >
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                {label}
            </p>
            <p className={cn('font-mono text-lg font-black leading-none', colorClass)}>
                {value}
            </p>
        </div>
    );
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export const ShiftFormDrawerContent: React.FC<ShiftFormDrawerContentProps> = ({
    form,
    isReadOnly,
    isPast,
    isStarted,
    isPublished,
    isTemplateMode,
    editMode,
    existingShift,
    roles,
    employees,
    skills,
    licenses,
    events,
    rosters,
    isLoadingShifts,
    resolvedContext,
    selectedRosterId,
    shiftLength,
    netLength,
    hardValidation,
    minShiftHours,
    shape,
    shapeBlockers,
    compliancePanel,
    onUnpublish,
    canUnpublish,
    isGroupLocked,
    isSubGroupLocked,
    isRoleLocked,
    isEmployeeLocked,
}) => {
    const [poolOpen, setPoolOpen] = useState(false);
    const [poolQuery, setPoolQuery] = useState('');
    const [wizardStep, setWizardStep] = useState(1);

    /* ── Watched fields ── */
    const watchShiftDate    = form.watch('shift_date');
    const watchGroup        = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');
    const watchUnpaidBreak  = form.watch('unpaid_break_minutes');
    const watchPaidBreak    = form.watch('paid_break_minutes');
    const watchIsTraining   = form.watch('is_training');
    const watchStart        = form.watch('start_time');
    const watchEnd          = form.watch('end_time');
    const watchV8RoleId     = form.watch('role_id');
    const watchEmployeeId   = form.watch('assigned_employee_id');
    const watchTargetType   = form.watch('target_employment_type');
    const watchTargetFlex   = form.watch('target_requires_flexible');

    /* ── Wizard steps ──
     * Three steps, not five. Two of the old five gated nothing at all
     * (`isStep2Valid = true`, `isStep4Valid = true`) and the fifth had no Next,
     * so three of them were pagination charging a click each. Requirements now
     * shares a step with Role, and Compliance shares one with Assignment — the
     * cards still render separately, they just no longer sit behind their own
     * Next button.
     *
     * `STEP` is the single source of which step a card belongs to; nothing in
     * this file compares `wizardStep` to a bare number. */
    const STEP = { role: 1, requirements: 1, timings: 2, assignment: 3, compliance: 3 } as const;

    /* `shape` / `shapeBlockers` arrive as props from the orchestrator — this
     * file is a render layer and must not decide whether a shift is legal.
     * Timings previously checked only that start/end were FILLED IN, so a 13h
     * shift with no meal break advanced cleanly and the break requirement was a
     * dismissible nudge. Shape breaches are blocking, so they gate the step. */
    const isRoleStepValid = !!watchGroup && !!watchSubGroupName && !!watchV8RoleId;
    // `shape.status === 'INCOMPLETE'` covers both a missing and a half-typed
    // time, which raw truthiness on the field does not.
    const isTimingsStepValid = shape.status !== 'INCOMPLETE'
        && (isTemplateMode || !!watchShiftDate)
        && !shape.blocking;

    const isStepValid = (step: number): boolean =>
        step === STEP.role ? isRoleStepValid
        : step === STEP.timings ? isTimingsStepValid
        : true;   // Assignment + Compliance are optional — an open shift is valid

    // Highest step the user is allowed to reach.
    const maxUnlockedStep = useMemo(() => {
        if (!isRoleStepValid) return STEP.role;
        if (!isTimingsStepValid) return STEP.timings;
        return STEP.assignment;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRoleStepValid, isTimingsStepValid]);

    const cardState = (step: number): CardState =>
        wizardStep === step ? 'active' : step <= maxUnlockedStep ? 'enabled' : 'locked';

    const goToStep = (step: number) => {
        if (step <= maxUnlockedStep) setWizardStep(step);
    };

    /* ── Focus management on step change ──
       Changing step swaps the whole card body while focus stays on the Next
       button, so a screen-reader user hears nothing about the new step and a
       keyboard user tabs onward from a control whose context silently changed.
       Move focus to the new step's heading instead. Skipped on first render so
       opening the modal does not steal focus from the focus trap's own target. */
    const stepHeadingRef = useRef<HTMLHeadingElement>(null);
    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) { didMountRef.current = true; return; }
        stepHeadingRef.current?.focus();
    }, [wizardStep]);

    /* ── Auto-run compliance as soon as an employee is chosen ──
       Previously gated on `wizardStep === STEP.compliance`, which meant a manager picked a
       person, advanced a step, and only then learned they were ineligible. The
       verdict depends on the employee and the schedule, not on which step is on
       screen, so it runs the moment both are known.

       The panel/hook never self-run by design — this drives it so a changed
       input cannot leave a stale verdict on screen. Runs only for an assigned,
       editable shift, once the employee's shift history has loaded, and only
       when the panel is idle or stale (never mid-run/results — the status guard
       plus the hook's internal runningRef prevent any re-run loop). */
    const panelStatus = compliancePanel.status;
    useEffect(() => {
        if (isReadOnly || isTemplateMode) return;
        if (!watchEmployeeId) return;      // unassigned → compliance not required
        if (!isTimingsStepValid) return;   // no lawful schedule to evaluate yet
        if (isLoadingShifts) return;       // wait for existing-shift history to load
        if (panelStatus === 'idle' || panelStatus === 'stale') {
            compliancePanel.run();
        }
        // compliancePanel.run is intentionally omitted: it is recreated each render,
        // so listing it would fire this effect on every render. The status guard
        // above makes the current-closure run() safe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchEmployeeId, isReadOnly, isTemplateMode, isLoadingShifts, panelStatus, isTimingsStepValid]);

    /* ── Break requirements ──
     * Owned by `@/modules/compliance/shape` (see `shape` above). The local
     * `reqUnpaid = >10h ? 60 : >5h ? 30 : 0` ladder that used to live here was a
     * fifth copy of a rule the engine also held, and it drove a dismissible
     * "Apply" nudge rather than a gate. */

    /* ── Available Groups from Roster ── */
    const availableGroups = useMemo(() => {
        const roster = rosters.find(r => r.id === (selectedRosterId || resolvedContext.rosterId));
        return roster?.groups || [];
    }, [rosters, selectedRosterId, resolvedContext.rosterId]);

    const activeGroup = useMemo(() => {
        if (!watchGroup) return null;
        return availableGroups.find(g =>
            g.external_id === watchGroup ||
            g.name.toLowerCase().replace(/\s+/g, '_') === watchGroup
        );
    }, [availableGroups, watchGroup]);

    const availableSubGroupsList = useMemo(() => {
        return activeGroup?.subGroups || [];
    }, [activeGroup]);

    /* ── Formatted locked date ── */
    const dateDisplay = useMemo(() => {
        if (watchShiftDate) return format(watchShiftDate, 'EEE, d MMM yyyy');
        if (resolvedContext.date) {
            try { return format(new Date(resolvedContext.date + 'T00:00:00'), 'EEE, d MMM yyyy'); }
            catch { return resolvedContext.date; }
        }
        return 'Select date';
    }, [watchShiftDate, resolvedContext.date]);

    /* ── Employee pool filtering ── */
    const searchedEmployees = useMemo(() => {
        const q = poolQuery.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter(e => {
            const name = e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
            return name.toLowerCase().includes(q);
        });
    }, [employees, poolQuery]);

    /* ── Employment-target filter (HARD) ──
       The target is a requirement, not a preference: a mismatched assignment is
       rejected by the V8 rule, by the solver, and ultimately by
       trg_shift_employment_target_2_enforce. Showing an unassignable person here
       would only produce a save that fails, so they are excluded outright.

       `employment_status` is the in-scope contract's raw status, so a person who
       is Casual here but Part-Time elsewhere is judged on the contract that
       applies to THIS sub-department. */
    const filteredEmployees = useMemo(() => {
        if (!watchTargetType) return searchedEmployees;
        return searchedEmployees.filter(e =>
            contractMatchesTarget(
                e.employment_status ?? e.contract_type,
                watchTargetType,
                watchTargetType === 'PT' && !!watchTargetFlex,
            ),
        );
    }, [searchedEmployees, watchTargetType, watchTargetFlex]);

    const excludedByTargetCount = searchedEmployees.length - filteredEmployees.length;

    const displayNameOf = (e: any) =>
        e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Employee';

    const initialsOf = (e: any) =>
        `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '??';

    /* ── Shared input class ── */
    const inputCls =
        'h-11 bg-background border-border/60 rounded-lg text-sm font-medium text-foreground focus:ring-amber-500/30 focus:border-amber-500/40 focus-visible:ring-amber-500/30';

    /* ── Read-only banner config ── */
    const readOnlyBanner = isPublished
        ? { kind: 'published' as const, title: 'Published — Read Only', body: 'Unpublish to edit.' }
        : isStarted
        ? { kind: 'locked' as const, title: 'In Progress — Read Only', body: 'Shift has started.' }
        : isPast
        ? { kind: 'locked' as const, title: 'Past — Read Only', body: 'Cannot edit past shifts.' }
        : null;

    const blockers = compliancePanel.result?.summary?.blockers ?? 0;

    /** The stepper rail. Length is the step count — no separate constant to drift. */
    const STEP_META = [
        { n: STEP.role,       label: 'Role & Details', accent: 'amber' as Accent },
        { n: STEP.timings,    label: 'Timings',        accent: 'cyan' as Accent },
        { n: STEP.assignment, label: 'Assignment',     accent: watchEmployeeId ? ('emerald' as Accent) : ('slate' as Accent) },
    ];
    const TOTAL_STEPS = STEP_META.length;

    const nextDisabled = wizardStep >= TOTAL_STEPS || !isStepValid(wizardStep);

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-card dark:bg-[#0a0c10]">

            {/* ── COMPACT HEADER ─────────────────────────────────── */}
            <div className="z-20 flex flex-shrink-0 items-center justify-between border-b border-border/50 bg-card/90 px-5 py-3 backdrop-blur-xl dark:bg-[#0c0e14]/90">
                <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                        <CalendarCheck className="h-3.5 w-3.5" />
                    </div>
                    <div>
                        <h2 className="mb-0.5 text-[10px] font-black uppercase leading-none tracking-[0.18em] text-foreground/90">
                            {editMode ? 'Update Shift' : 'New Shift'}
                        </h2>
                        <p className="font-mono text-[11px] leading-none text-muted-foreground/80">
                            {editMode && existingShift?.id
                                ? `#${existingShift.id.slice(0, 8).toUpperCase()}`
                                : dateDisplay}
                        </p>
                    </div>
                </div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                    {STEP_META[wizardStep - 1].label}
                </span>
            </div>

            {readOnlyBanner && (
                <div className="flex-shrink-0 border-b border-border/40 px-5 py-2">
                    <div className={cn(
                        'flex items-center gap-2 rounded-lg border p-2 text-[11px] font-bold uppercase tracking-widest',
                        readOnlyBanner.kind === 'published'
                            ? 'border-purple-500/20 bg-purple-500/5 text-purple-400'
                            : 'border-slate-500/20 bg-slate-500/5 text-slate-400',
                    )}>
                        <LockIcon className="h-3 w-3 shrink-0" />
                        <span>{readOnlyBanner.title}</span>
                        <span className="font-medium normal-case tracking-normal opacity-70">— {readOnlyBanner.body}</span>
                        {readOnlyBanner.kind === 'published' && canUnpublish && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={onUnpublish}
                                className="ml-auto h-6 border border-purple-500/20 bg-purple-500/10 px-2 text-[10px] font-black uppercase tracking-widest text-purple-400 hover:bg-purple-500/20"
                            >
                                Unpublish
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* ── WIZARD BODY: left vertical stepper + one active step ───────── */}
            <div className="flex min-h-0 flex-1 overflow-hidden">

                {/* Left vertical stepper rail (desktop) */}
                <nav
                    aria-label="Shift form steps"
                    className="hidden w-[190px] shrink-0 flex-col border-r border-border/40 bg-muted/15 px-4 py-5 dark:bg-[#0c0e14]/40 sm:flex"
                >
                    {STEP_META.map(({ n, label, accent }, i) => {
                        const reached = n <= maxUnlockedStep;
                        const isCurrent = wizardStep === n;
                        const done = n < wizardStep && reached;
                        return (
                            <button
                                key={n}
                                type="button"
                                disabled={!reached}
                                onClick={() => goToStep(n)}
                                aria-current={isCurrent ? 'step' : undefined}
                                className={cn('group flex gap-3 text-left outline-none', !reached && 'cursor-not-allowed')}
                            >
                                <div className="flex flex-col items-center">
                                    <span
                                        className={cn(
                                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black transition-all duration-300',
                                            isCurrent
                                                ? cn(ACCENT[accent].chip, 'text-white shadow-md')
                                                : done
                                                ? 'bg-emerald-500/15 text-emerald-500'
                                                : reached
                                                ? 'bg-muted text-muted-foreground group-hover:bg-muted/70'
                                                : 'bg-muted/40 text-muted-foreground/40',
                                        )}
                                    >
                                        {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
                                    </span>
                                    {i < STEP_META.length - 1 && (
                                        <span
                                            className={cn(
                                                'my-1 min-h-[22px] w-px flex-1 transition-colors',
                                                n < wizardStep ? 'bg-emerald-500/40' : 'bg-border/60',
                                            )}
                                        />
                                    )}
                                </div>
                                <span
                                    className={cn(
                                        'mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-[0.12em] transition-colors',
                                        isCurrent
                                            ? 'text-foreground'
                                            : done
                                            ? 'text-emerald-500/80'
                                            : reached
                                            ? 'text-muted-foreground group-hover:text-foreground/80'
                                            : 'text-muted-foreground/40',
                                    )}
                                >
                                    {label}
                                </span>
                            </button>
                        );
                    })}
                </nav>

                {/* Right: the single active step */}
                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">

                    {/* ─────────── CARD 1 · Role & Context ─────────── */}
                    {wizardStep === STEP.role && (
                    <Card
                        accent="amber"
                        state={cardState(STEP.role)}
                        index={0}
                        onClick={() => goToStep(STEP.role)}
                    >
                        <CardHeader
                            icon={Briefcase}
                            step={STEP.role}
                            headingRef={stepHeadingRef}
                            title="Role & Context"
                            subtitle="Who & where this shift sits"
                            accent="amber"
                            state={cardState(STEP.role)}
                            completed={isRoleStepValid}
                            badge={<StatusBadge tone="accent" accent="amber">Required</StatusBadge>}
                        />

                        <div className="space-y-2.5">
                            {/* Org / Dept / SubDept context */}
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { label: 'Org', value: resolvedContext.organizationName || 'All Organizations' },
                                    { label: 'Dept', value: resolvedContext.departmentName || 'All Departments' },
                                    { label: 'SubDept', value: resolvedContext.subDepartmentName || 'All Sub-Departments' },
                                ].map(item => (
                                    <div key={item.label}>
                                        <FieldLabel>{item.label}</FieldLabel>
                                        <div
                                            className="flex h-9 select-none items-center truncate rounded-lg border border-border/40 bg-muted/40 px-2.5 text-[10px] font-semibold text-muted-foreground"
                                            title={item.value}
                                        >
                                            {item.value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Group */}
                            {isGroupLocked ? (
                                <div>
                                    <FieldLabel>Group</FieldLabel>
                                    <div className="flex h-9 select-none items-center truncate rounded-lg border border-border/40 bg-muted/30 px-2.5 text-[11px] font-semibold text-muted-foreground">
                                        {GROUP_LABEL[watchGroup] || watchGroup || resolvedContext.groupName || 'General'}
                                    </div>
                                </div>
                            ) : (
                                <FormField
                                    control={form.control}
                                    name="group_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel required>Group</FieldLabel>
                                            <Select
                                                value={field.value || ''}
                                                onValueChange={(val) => {
                                                    field.onChange(val);
                                                    form.setValue('sub_group_name', '', { shouldValidate: false });
                                                }}
                                                disabled={isReadOnly || wizardStep !== STEP.role}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11 rounded-lg border-border/60 bg-background text-sm">
                                                        <SelectValue placeholder="Select group…" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="z-[200]">
                                                    {availableGroups.map(g => (
                                                        <SelectItem
                                                            key={g.id}
                                                            value={g.external_id || g.name.toLowerCase().replace(/\s+/g, '_')}
                                                        >
                                                            {g.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage className="text-[11px] text-rose-500" />
                                        </FormItem>
                                    )}
                                />
                            )}

                            {/* Subgroup + Role side by side */}
                            <div className="grid grid-cols-2 gap-2">
                                {isSubGroupLocked ? (
                                    <div>
                                        <FieldLabel>Subgroup</FieldLabel>
                                        <div className="flex h-11 select-none items-center truncate rounded-lg border border-border/40 bg-muted/30 px-2.5 text-[11px] font-semibold text-muted-foreground">
                                            {watchSubGroupName || resolvedContext.subGroupName || 'General'}
                                        </div>
                                    </div>
                                ) : (
                                    <FormField
                                        control={form.control}
                                        name="sub_group_name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel required>Subgroup</FieldLabel>
                                                <Select
                                                    value={field.value || ''}
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        setTimeout(() => form.trigger('sub_group_name'), 0);
                                                    }}
                                                    disabled={isReadOnly || !watchGroup || wizardStep !== STEP.role}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 rounded-lg border-border/60 bg-background text-sm">
                                                            <SelectValue placeholder={!watchGroup ? 'Pick group' : 'Select…'} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="z-[200]">
                                                        {availableSubGroupsList.map(sg => (
                                                            <SelectItem key={sg.id || sg.name} value={sg.name}>
                                                                {sg.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage className="text-[11px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Role */}
                                <FormField
                                    control={form.control}
                                    name="role_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel required>Role</FieldLabel>
                                            <Select
                                                value={field.value || ''}
                                                onValueChange={field.onChange}
                                                disabled={isReadOnly || isRoleLocked || wizardStep !== STEP.role}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className={cn(
                                                        'h-11 rounded-lg border-border/60 bg-background text-sm',
                                                        (isRoleLocked || wizardStep !== STEP.role) && 'opacity-60',
                                                    )}>
                                                        <SelectValue placeholder="Select role…" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="z-[200] max-h-[280px]">
                                                    {roles.map(r => (
                                                        <SelectItem key={r.id} value={r.id}>
                                                            {r.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage className="text-[11px] text-rose-500" />
                                        </FormItem>
                                    )}
                                />

                                {/* Target Employment Type */}
                                <FormField
                                    control={form.control}
                                    name="target_employment_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel required>Target Employment Type</FieldLabel>
                                            <Select
                                                value={field.value ?? ''}
                                                onValueChange={(v) => {
                                                    field.onChange(v);
                                                    // The flexible flag is only coherent for a PT
                                                    // target — clear it as soon as the target moves
                                                    // away, so the form can never submit a pair that
                                                    // shifts_target_flexible_requires_pt_check rejects.
                                                    if (v !== 'PT') {
                                                        form.setValue('target_requires_flexible', false);
                                                    }
                                                    // Changing the target changes who is assignable.
                                                    // Drop an assignee the new target excludes rather
                                                    // than carrying a mismatch to a submit the DB
                                                    // trigger would reject.
                                                    const assigned = form.getValues('assigned_employee_id');
                                                    if (assigned) {
                                                        const emp = employees.find(e => e.id === assigned);
                                                        const stillOk = contractMatchesTarget(
                                                            emp?.employment_status ?? emp?.contract_type,
                                                            v as typeof TARGET_EMPLOYMENT_TYPES[number],
                                                            v === 'PT' && !!form.getValues('target_requires_flexible'),
                                                        );
                                                        if (!stillOk) form.setValue('assigned_employee_id', null);
                                                    }
                                                }}
                                                disabled={isReadOnly || wizardStep !== STEP.role}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className={cn(
                                                        'h-11 rounded-lg border-border/60 bg-background text-sm',
                                                        wizardStep !== STEP.role && 'opacity-60',
                                                    )}>
                                                        <SelectValue placeholder="Select employment target…" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="z-[200] max-h-[280px]">
                                                    {TARGET_EMPLOYMENT_TYPES.map(t => (
                                                        <SelectItem key={t} value={t}>
                                                            {TARGET_EMPLOYMENT_TYPE_LABELS[t]}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-[11px] text-muted-foreground">
                                                Only staff on a matching contract for this sub-department
                                                can be assigned.
                                            </p>
                                            <FormMessage className="text-[11px] text-rose-500" />
                                        </FormItem>
                                    )}
                                />

                                {/* Flexible Part-Time narrowing — only meaningful for a PT target */}
                                {watchTargetType === 'PT' && (
                                    <FormField
                                        control={form.control}
                                        name="target_requires_flexible"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                                                <div className="space-y-0.5 pr-3">
                                                    <FieldLabel>Flexible Part-Time only</FieldLabel>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Narrows the Part-Time target to staff on a Flexible
                                                        Part-Time contract.
                                                    </p>
                                                </div>
                                                <FormControl>
                                                    <Switch
                                                        checked={!!field.value}
                                                        onCheckedChange={(v) => {
                                                            field.onChange(v);
                                                            // Narrowing to Flexible can exclude the
                                                            // person already selected — drop them
                                                            // rather than submitting a pair the DB
                                                            // trigger would reject.
                                                            const assigned = form.getValues('assigned_employee_id');
                                                            if (v && assigned) {
                                                                const emp = employees.find(e => e.id === assigned);
                                                                const stillOk = contractMatchesTarget(
                                                                    emp?.employment_status ?? emp?.contract_type,
                                                                    'PT',
                                                                    true,
                                                                );
                                                                if (!stillOk) form.setValue('assigned_employee_id', null);
                                                            }
                                                        }}
                                                        disabled={isReadOnly || wizardStep !== STEP.role}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </div>
                        </div>
                    </Card>
                    )}

                    {/* ─────────── CARD 2 · Requirements & Notes ─────────── */}
                    {wizardStep === STEP.requirements && (
                    <Card
                        accent="amber"
                        state={cardState(STEP.requirements)}
                        index={1}
                        onClick={() => goToStep(STEP.requirements)}
                    >
                        <CardHeader
                            icon={GraduationCap}
                            step={STEP.requirements}
                            title="Requirements & Notes"
                            subtitle="Skills, certs & handover"
                            accent="amber"
                            state={cardState(STEP.requirements)}
                            completed={wizardStep > STEP.requirements && isRoleStepValid}
                            badge={<StatusBadge>Optional</StatusBadge>}
                        />

                        <div className="space-y-2.5">
                            {/* Skills + Certs */}
                            <div className="grid grid-cols-2 gap-2">
                                <FormField
                                    control={form.control}
                                    name="required_skills"
                                    render={({ field }) => (
                                        <FormItem>
                                            <MultiSelect
                                                label="Skills"
                                                options={skills.map(s => ({ name: s.name, id: s.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None"
                                                disabled={isReadOnly || wizardStep !== STEP.requirements}
                                                compact
                                            />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="required_licenses"
                                    render={({ field }) => (
                                        <FormItem>
                                            <MultiSelect
                                                label="Certs"
                                                options={licenses.map(l => ({ name: l.name, id: l.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None"
                                                disabled={isReadOnly || wizardStep !== STEP.requirements}
                                                compact
                                            />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Events */}
                            <FormField
                                control={form.control}
                                name="event_ids"
                                render={({ field }) => (
                                    <FormItem>
                                        <MultiSelect
                                            label="Events"
                                            options={events.map(e => ({ name: e.name, id: e.id }))}
                                            selected={field.value || []}
                                            onChange={field.onChange}
                                            placeholder="None"
                                            disabled={isReadOnly || wizardStep !== STEP.requirements}
                                            compact
                                        />
                                    </FormItem>
                                )}
                            />

                            {/* Notes */}
                            <FormField
                                control={form.control}
                                name="notes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FieldLabel>
                                            <StickyNote className="relative -top-px mr-0.5 inline h-2.5 w-2.5" />
                                            Notes
                                        </FieldLabel>
                                        <FormControl>
                                            <Textarea
                                                {...field}
                                                placeholder="Shift notes or handover…"
                                                disabled={isReadOnly || wizardStep !== STEP.requirements}
                                                className="min-h-[60px] resize-none rounded-lg border-border/60 bg-background p-2.5 text-xs font-medium placeholder:text-muted-foreground/30 focus:ring-amber-500/30"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>
                    </Card>
                    )}

                    {/* ─────────── CARD 3 · Timings ─────────── */}
                    {wizardStep === STEP.timings && (
                    <Card
                        accent="cyan"
                        state={cardState(STEP.timings)}
                        index={2}
                        onClick={() => goToStep(STEP.timings)}
                    >
                        <CardHeader
                            icon={Clock}
                            step={STEP.timings}
                            headingRef={stepHeadingRef}
                            title="Timings"
                            subtitle="Start, end & breaks"
                            accent="cyan"
                            state={cardState(STEP.timings)}
                            completed={wizardStep > STEP.timings && isTimingsStepValid}
                            badge={<StatusBadge tone="accent" accent="cyan">Required</StatusBadge>}
                        />

                        <div className="space-y-2.5">
                            {/* Date (locked) */}
                            {!isTemplateMode && (
                                <div>
                                    <FieldLabel>Date <span className="ml-1 text-[10px] text-cyan-500/70">LOCKED</span></FieldLabel>
                                    <div className="flex h-9 select-none items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3">
                                        <LockIcon className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                                        <span className="truncate text-xs font-medium text-foreground/70">{dateDisplay}</span>
                                    </div>
                                </div>
                            )}

                            {/* Training toggle — placed first so the minimum engagement floor (2h vs 3h/4h) is established before setting times */}
                            <FormField
                                control={form.control}
                                name="is_training"
                                render={({ field }) => (
                                    <FormItem className="flex min-h-[48px] items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-2.5 transition-colors hover:bg-muted/30">
                                        <div className="flex items-center gap-2">
                                            <GraduationCap className="h-4 w-4 shrink-0 text-purple-500/80" />
                                            <div>
                                                <p className="text-[11px] font-bold leading-tight text-foreground">Training shift</p>
                                                <p className="text-[11px] text-muted-foreground/80">Exempt from standard minimum engagement (2h floor)</p>
                                            </div>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                aria-label="Training shift (exempt from standard minimum engagement)"
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                disabled={isReadOnly || wizardStep !== STEP.timings}
                                                className="scale-90 data-[state=checked]:bg-purple-600 focus-visible:ring-2 focus-visible:ring-purple-400"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {/* Start / End */}
                            <div className="grid grid-cols-2 gap-2">
                                {(['start_time', 'end_time'] as const).map((name) => (
                                    <FormField
                                        key={name}
                                        control={form.control}
                                        name={name}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel required>{name === 'start_time' ? 'Start' : 'End'}</FieldLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input
                                                            type="time"
                                                            placeholder="HH:MM"
                                                            defaultValue={field.value ?? undefined}
                                                            disabled={isReadOnly || wizardStep !== STEP.timings}
                                                            onChange={e => {
                                                                const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                                                                const formatted = raw.length > 2
                                                                    ? `${raw.slice(0, 2)}:${raw.slice(2)}`
                                                                    : raw;
                                                                field.onChange(formatted);
                                                            }}
                                                            onBlur={e => {
                                                                const v = e.target.value;
                                                                if (v && /^\d{1,2}:\d{2}$/.test(v)) {
                                                                    const [h, m] = v.split(':');
                                                                    field.onChange(`${h.padStart(2, '0')}:${m}`);
                                                                }
                                                                field.onBlur();
                                                            }}
                                                            className={cn(inputCls, 'pl-9 font-mono font-semibold tracking-widest')}
                                                        />
                                                        <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-500/50" />
                                                    </div>
                                                </FormControl>
                                                <FormMessage className="text-[11px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                ))}
                            </div>

                            {/* Breaks */}
                            <div className="grid grid-cols-2 gap-2">
                                <FormField
                                    control={form.control}
                                    name="unpaid_break_minutes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel>
                                                <Coffee className="relative -top-px mr-0.5 inline h-2.5 w-2.5" />
                                                Unpaid (min)
                                            </FieldLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    value={field.value === undefined ? '' : field.value}
                                                    onChange={e =>
                                                        field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                                                    }
                                                    disabled={isReadOnly || wizardStep !== STEP.timings}
                                                    placeholder="0"
                                                    className={cn(inputCls, 'font-mono')}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="paid_break_minutes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel>
                                                <Utensils className="relative -top-px mr-0.5 inline h-2.5 w-2.5" />
                                                Paid (min)
                                            </FieldLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    value={field.value === undefined ? '' : field.value}
                                                    onChange={e =>
                                                        field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                                                    }
                                                    disabled={isReadOnly || wizardStep !== STEP.timings}
                                                    placeholder="0"
                                                    className={cn(inputCls, 'font-mono')}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Duration stats */}
                            <div className="flex gap-2">
                                <StatChip
                                    label="Length"
                                    value={formatHours(shiftLength)}
                                    colorClass={shiftLength > 0 ? 'text-foreground' : 'text-muted-foreground/30'}
                                />
                                <StatChip
                                    label="Net Paid"
                                    value={formatHours(netLength)}
                                    colorClass={
                                        netLength <= 0 ? 'text-muted-foreground/30'
                                        : shape.blocking ? 'text-rose-500'
                                        : 'text-emerald-500'
                                    }
                                />
                            </div>

                            {/* Shift-shape breaches. Every one of these is blocking and
                                gates Next — an unlawful shift shape is not reviewable.
                                Each carries a one-click fix where the required value is
                                unambiguous (breaks), since the manager's intent is never
                                "leave the break off". */}
                            {!isReadOnly && shapeBlockers.length > 0 && (
                                <div
                                    role="alert"
                                    aria-live="polite"
                                    className="space-y-1.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.05] p-2"
                                >
                                    {shapeBlockers.map(hit => (
                                        <div key={hit.rule_id} className="flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-1.5">
                                                <AlertTriangle className="h-3 w-3 shrink-0 text-rose-500" />
                                                <span className="truncate text-[11px] font-medium text-rose-500">
                                                    {hit.summary}
                                                </span>
                                            </div>
                                            {hit.fix && (
                                                <div className="flex shrink-0 items-center gap-1">
                                                    {(hit.fix.options ?? [{ value: hit.fix.value as number, label: hit.fix.label }]).map(opt => (
                                                        <button
                                                            key={String(opt.value)}
                                                            type="button"
                                                            onClick={() => form.setValue(hit.fix!.field, opt.value as never, { shouldDirty: true })}
                                                            disabled={wizardStep !== STEP.timings}
                                                            aria-label={`Set ${opt.label} — resolves: ${hit.summary}`}
                                                            className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-rose-500 ring-1 ring-rose-500/20 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
                                                        >
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>
                    )}

                    {/* ─────────── CARD 4 · Assignment ─────────── */}
                    {wizardStep === STEP.assignment && (
                    <Card
                        accent="emerald"
                        state={cardState(STEP.assignment)}
                        index={3}
                        onClick={() => goToStep(STEP.assignment)}
                    >
                        <CardHeader
                            icon={UserCircle}
                            step={STEP.assignment}
                            headingRef={stepHeadingRef}
                            title="Assignment"
                            subtitle="Pick an employee or leave open"
                            accent="emerald"
                            state={cardState(STEP.assignment)}
                            completed={wizardStep > STEP.assignment && !!form.watch('assigned_employee_id')}
                            badge={
                                isTemplateMode ? (
                                    <StatusBadge>Templates unassigned</StatusBadge>
                                ) : isEmployeeLocked ? (
                                    <StatusBadge tone="accent" accent="amber">Locked</StatusBadge>
                                ) : (
                                    <StatusBadge>Optional</StatusBadge>
                                )
                            }
                        />

                        <FormField
                            control={form.control}
                            name="assigned_employee_id"
                            render={({ field }) => {
                                const assignedEmployee = employees.find(e => e.id === field.value);
                                let displayName = 'Unassigned';
                                let initials = '';

                                if (assignedEmployee) {
                                    displayName = displayNameOf(assignedEmployee);
                                    initials = initialsOf(assignedEmployee);
                                } else if (existingShift && (existingShift.assigned_employee_id === field.value || existingShift.assignedEmployeeId === field.value)) {
                                    const profiles = existingShift.assigned_profiles || existingShift.profiles;
                                    if (profiles) {
                                        displayName = profiles.full_name || `${profiles.first_name || ''} ${profiles.last_name || ''}`.trim() || 'Assigned';
                                        initials = `${profiles.first_name?.[0] || ''}${profiles.last_name?.[0] || ''}`.toUpperCase() || '??';
                                    }
                                }

                                const isAssigned = !!field.value;

                                return (
                                    <FormItem className="flex flex-1 flex-col space-y-2.5">
                                        {/* Current assignment */}
                                        {isAssigned ? (
                                            <div className="flex items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-500 ring-2 ring-emerald-500/20">
                                                        {initials}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-foreground">{displayName}</p>
                                                        <div className="mt-1 flex items-center gap-1.5">
                                                            <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1 text-[11px] font-bold uppercase tracking-widest text-emerald-500/80"><CheckCircle2 className="h-2.5 w-2.5" /> Available</span>
                                                            <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1 text-[11px] font-bold uppercase tracking-widest text-emerald-500/80"><CheckCircle2 className="h-2.5 w-2.5" /> Qualified</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                {!isReadOnly && wizardStep === STEP.assignment && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => field.onChange(null)}
                                                        className="h-7 w-7 p-0 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/10 py-6 text-center">
                                                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-muted/40">
                                                    <UserCircle className="h-6 w-6 text-muted-foreground/30" />
                                                </div>
                                                <p className="text-xs font-semibold text-foreground/60">Unassigned</p>
                                                <p className="text-[11px] text-muted-foreground/60">Will open for bidding</p>
                                            </div>
                                        )}

                                        {/* Inline employee picker */}
                                        {!isReadOnly && !isTemplateMode && !isEmployeeLocked && wizardStep === STEP.assignment && (
                                            <Popover open={poolOpen} onOpenChange={setPoolOpen} modal={false}>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        variant="default"
                                                        className="mt-auto h-11 w-full gap-2 bg-emerald-600 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-500"
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                        {isAssigned ? 'Change Employee' : 'Select Employee'}
                                                        {/* Count the pool the planner will actually SEE, not the
                                                            raw fetch — an unfiltered number next to a filtered list
                                                            reads as a bug. */}
                                                        <span className="ml-auto font-mono normal-case tracking-normal text-emerald-100/70">
                                                            {filteredEmployees.length}
                                                        </span>
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent
                                                    className="z-[200] w-[var(--radix-popover-trigger-width)] animate-in fade-in zoom-in-95 slide-in-from-top-2 overflow-visible border-none bg-transparent p-0 shadow-none outline-none duration-300 pointer-events-auto"
                                                    sideOffset={10}
                                                    align="center"
                                                >
                                                    <Command className="w-full overflow-visible bg-transparent outline-none">
                                                        <div className="flex w-full flex-col gap-1.5">
                                                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:border-white/10 dark:bg-[#1a2333] [&_[cmdk-input-wrapper]]:border-b-0">
                                                                <CommandInput
                                                                    placeholder="Search employees…"
                                                                    value={poolQuery}
                                                                    onValueChange={setPoolQuery}
                                                                    className="h-14 w-full border-none bg-transparent text-base shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                                                                    autoFocus
                                                                />
                                                            </div>

                                                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] dark:border-white/10 dark:bg-[#1a2333]">
                                                                <CommandList className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1.5">
                                                                    <CommandEmpty className="py-8 text-center text-sm font-medium text-muted-foreground">
                                                                        {watchTargetType && excludedByTargetCount > 0
                                                                            ? `No ${TARGET_EMPLOYMENT_TYPE_LABELS[watchTargetType]}${watchTargetType === 'PT' && watchTargetFlex ? ' (Flexible)' : ''} staff are contracted to this sub-department.`
                                                                            : 'No employees found.'}
                                                                    </CommandEmpty>

                                                                    {/* State WHY the pool is short. A hard filter that silently
                                                                        shrinks the list reads as missing data; naming the
                                                                        restriction points the planner at the target field. */}
                                                                    {watchTargetType && excludedByTargetCount > 0 && (
                                                                        <div className="border-b border-border/40 px-2 py-1.5">
                                                                            <span className="text-[10px] text-muted-foreground">
                                                                                {`Showing ${TARGET_EMPLOYMENT_TYPE_LABELS[watchTargetType]}${watchTargetType === 'PT' && watchTargetFlex ? ' (Flexible)' : ''} only · ${excludedByTargetCount} excluded by the shift's employment target`}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                    <CommandGroup>
                                                                        <CommandItem
                                                                            value="__leave_unassigned__"
                                                                            onSelect={() => { field.onChange(null); setPoolOpen(false); }}
                                                                            className="group mb-1 flex cursor-pointer items-center gap-2.5 rounded-xl px-4 py-3 transition-all aria-selected:bg-indigo-600 aria-selected:text-white"
                                                                        >
                                                                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground/70 group-aria-selected:bg-white/20 group-aria-selected:text-white">—</div>
                                                                            <div className="min-w-0 flex-1">
                                                                                <p className="truncate text-xs font-semibold">Leave Unassigned</p>
                                                                                <p className="font-mono text-[11px] text-zinc-400 group-aria-selected:text-white/60">open for bidding</p>
                                                                            </div>
                                                                            {!field.value && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400 group-aria-selected:text-white" />}
                                                                        </CommandItem>

                                                                        {filteredEmployees.map(emp => {
                                                                            const selected = field.value === emp.id;
                                                                            return (
                                                                                <CommandItem
                                                                                    key={emp.id}
                                                                                    value={`${displayNameOf(emp)} ${emp.id}`.toLowerCase()}
                                                                                    onSelect={() => { field.onChange(emp.id); setPoolOpen(false); }}
                                                                                    className={cn(
                                                                                        'group mb-1 flex cursor-pointer items-center gap-2.5 rounded-xl px-4 py-3 transition-all aria-selected:bg-indigo-600 aria-selected:text-white',
                                                                                        selected && 'bg-emerald-500/10 dark:bg-emerald-500/5',
                                                                                    )}
                                                                                >
                                                                                    <div className={cn(
                                                                                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                                                                        selected
                                                                                            ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30 group-aria-selected:bg-white/20 group-aria-selected:text-white group-aria-selected:ring-0'
                                                                                            : 'bg-muted text-muted-foreground/70 group-aria-selected:bg-white/20 group-aria-selected:text-white',
                                                                                    )}>
                                                                                        {initialsOf(emp)}
                                                                                    </div>
                                                                                    <div className="min-w-0 flex-1">
                                                                                        <p className="truncate text-xs font-semibold">{displayNameOf(emp)}</p>
                                                                                        <p className="font-mono text-[11px] text-zinc-400 group-aria-selected:text-white/60">{emp.id.slice(0, 8)}</p>
                                                                                    </div>
                                                                                    {selected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400 group-aria-selected:text-white" />}
                                                                                </CommandItem>
                                                                            );
                                                                        })}
                                                                    </CommandGroup>
                                                                </CommandList>

                                                                <div className="flex items-center justify-between border-t border-indigo-500/5 bg-indigo-50/50 p-3 text-[11px] font-black uppercase tracking-[0.2em] text-indigo-500/50 dark:border-white/5 dark:bg-muted/20 dark:text-muted-foreground/50">
                                                                    <div className="flex items-center gap-4">
                                                                        <span className="flex items-center gap-1">
                                                                            <kbd className="rounded border border-indigo-500/10 bg-white/80 px-1 py-0.5 font-sans text-indigo-500/70 dark:border-border/40 dark:bg-background/50 dark:text-inherit">↑↓</kbd> NAV
                                                                        </span>
                                                                        <span className="flex items-center gap-1">
                                                                            <kbd className="rounded border border-indigo-500/10 bg-white/80 px-1 py-0.5 font-sans text-indigo-500/70 dark:border-border/40 dark:bg-background/50 dark:text-inherit">↵</kbd> SELECT
                                                                        </span>
                                                                    </div>
                                                                    <span className="flex items-center gap-1">
                                                                        <kbd className="rounded border border-indigo-500/10 bg-white/80 px-1 py-0.5 font-sans text-indigo-500/70 dark:border-border/40 dark:bg-background/50 dark:text-inherit">ESC</kbd> CLOSE
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </Command>
                                                </PopoverContent>
                                            </Popover>
                                        )}

                                        {/* Hard validation errors */}
                                        {hardValidation && !hardValidation.passed && (hardValidation.errors?.length ?? 0) > 0 && (
                                            <div className="space-y-1">
                                                {hardValidation.errors.map((err: any, i: number) => (
                                                    <div
                                                        key={i}
                                                        className="flex items-center gap-1.5 rounded-md border border-rose-500/20 bg-rose-500/[0.04] p-1.5 text-rose-500"
                                                    >
                                                        <AlertCircle className="h-3 w-3 shrink-0" />
                                                        <p className="text-[11px] font-medium">{err.message}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </FormItem>
                                );
                            }}
                        />
                    </Card>
                    )}

                    {/* ─────────── CARD 5 · Compliance (full width) ─────────── */}
                    {wizardStep === STEP.compliance && (
                    <Card
                        accent={watchEmployeeId ? "indigo" : "slate"}
                        state={cardState(STEP.compliance)}
                        index={4}
                        onClick={() => goToStep(STEP.compliance)}
                        className="lg:col-span-2"
                    >
                        <CardHeader
                            icon={Shield}
                            step={STEP.compliance}
                            title="Compliance"
                            subtitle={watchEmployeeId ? "Final guardrail checks before saving" : "Not required for unassigned shifts"}
                            accent={watchEmployeeId ? "indigo" : "slate"}
                            state={cardState(STEP.compliance)}
                            badge={
                                !watchEmployeeId ? (
                                    <StatusBadge tone="accent" accent="slate">Not Required</StatusBadge>
                                ) : blockers > 0 ? (
                                    <StatusBadge tone="danger">
                                        {blockers} blocker{blockers > 1 ? 's' : ''}
                                    </StatusBadge>
                                ) : (
                                    <StatusBadge tone="accent" accent="indigo">Final check</StatusBadge>
                                )
                            }
                        />
                        <ScrollArea className="min-h-[150px] w-full flex-1">
                            <div className="relative overflow-hidden rounded-lg">
                                {isLoadingShifts && (
                                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 backdrop-blur-[2px]">
                                        <div className="flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                                            <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-400">Fetching history…</span>
                                        </div>
                                    </div>
                                )}

                                {!watchEmployeeId ? (
                                    <div className="py-10 text-center opacity-60">
                                        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-slate-500/20 bg-slate-500/10 text-slate-500">
                                            <Shield className="h-4 w-4" />
                                        </div>
                                        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                            Compliance Not Required
                                        </p>
                                        <p className="mx-auto max-w-[240px] text-[11px] text-muted-foreground/80">
                                            Compliance is not required for unassigned shifts. Evaluated when assigned.
                                        </p>
                                    </div>
                                ) : isTemplateMode ? (
                                    <div className="py-6 text-center">
                                        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-500">
                                            <CheckCircle2 className="h-4 w-4" />
                                        </div>
                                        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                                            Checks Passed
                                        </p>
                                        <p className="mx-auto max-w-[200px] text-[11px] text-muted-foreground/80">
                                            Validated when assigned to an employee.
                                        </p>
                                    </div>
                                ) : (
                                    <CompliancePanel
                                        hook={compliancePanel}
                                        className="compliance-panel-integrated"
                                        disabled={isReadOnly || isLoadingShifts || wizardStep !== STEP.compliance}
                                    />
                                )}
                            </div>
                        </ScrollArea>
                    </Card>
                    )}
                </div>
            </div>

            {/* ── WIZARD NAV (between the cards & the action footer) ─────────── */}
            <div className="z-20 flex flex-shrink-0 items-center justify-between gap-4 border-t border-border/40 bg-card/90 px-5 py-3 backdrop-blur-xl dark:bg-[#0c0e14]/90">
                <Button
                    type="button"
                    variant="ghost"
                    disabled={wizardStep === 1}
                    onClick={() => setWizardStep(prev => Math.max(1, prev - 1))}
                    // h-11 (44px) on touch, back to the compact h-9 from sm up.
                    className="h-11 sm:h-9 gap-1.5 rounded-lg px-4 text-xs font-bold text-muted-foreground transition-all hover:bg-muted/30 hover:text-foreground disabled:opacity-40"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                </Button>

                {/* Segmented progress rail — mobile only (desktop uses the left vertical stepper).
                    The dot stays 24px visually, but the BUTTON is 44x44: a 24px
                    touch target is half of Apple HIG (44pt) and Material (48dp),
                    and only scrapes WCAG 2.5.8's 24px AA floor. Negative margins
                    keep the rail looking the same while the hit areas overlap
                    nothing — the gap between adjacent centres is unchanged. */}
                <nav aria-label="Wizard steps" className="flex items-center sm:hidden">
                    {STEP_META.map(({ n, accent, label }, i) => {
                        const reached = n <= maxUnlockedStep;
                        const isCurrent = wizardStep === n;
                        const done = n < wizardStep && reached;
                        return (
                            <React.Fragment key={n}>
                                {i > 0 && (
                                    <div
                                        aria-hidden="true"
                                        className={cn(
                                            'h-px w-3 shrink-0 transition-colors sm:w-5',
                                            n <= wizardStep ? ACCENT[accent].chip : 'bg-border/50',
                                        )}
                                    />
                                )}
                                <button
                                    type="button"
                                    disabled={!reached}
                                    onClick={() => goToStep(n)}
                                    aria-current={isCurrent ? 'step' : undefined}
                                    aria-label={
                                        `Step ${n}: ${label}` +
                                        (done ? ' (completed)' : isCurrent ? ' (current)' : reached ? '' : ' (locked)')
                                    }
                                    className={cn(
                                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full -mx-2.5 first:-ml-2.5 last:-mr-2.5',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                                        !reached && 'cursor-not-allowed',
                                    )}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black transition-all duration-300',
                                            isCurrent
                                                ? cn(ACCENT[accent].chip, 'scale-110 text-white shadow-md')
                                                : done
                                                ? 'bg-emerald-500/20 text-emerald-500'
                                                : reached
                                                ? 'bg-muted text-muted-foreground'
                                                : 'bg-muted/40 text-muted-foreground/30',
                                        )}
                                    >
                                        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
                                    </span>
                                </button>
                            </React.Fragment>
                        );
                    })}
                </nav>

                <Button
                    type="button"
                    disabled={nextDisabled}
                    onClick={() => setWizardStep(prev => Math.min(TOTAL_STEPS, prev + 1))}
                    className={cn(
                        'flex h-11 sm:h-9 items-center gap-1.5 rounded-lg px-6 text-xs font-black uppercase tracking-[0.12em] shadow-lg transition-all',
                        nextDisabled
                            ? 'cursor-not-allowed border border-border/50 bg-muted text-muted-foreground/50'
                            : 'border border-purple-400/20 bg-purple-600 text-white shadow-purple-500/20 hover:bg-purple-500 active:bg-purple-700 focus-visible:ring-2 focus-visible:ring-purple-400',
                    )}
                >
                    Next
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};
