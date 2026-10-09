import React, { forwardRef } from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import {
    Clock,
    Calendar,
    Building2,
    ShieldCheck,
    ArrowLeftRight,
    MapPin,
    Signal,
    Zap,
    Lock,
    Flame,
    ChevronDown,
    ChevronRight,
    User,
    Bot,
    ArrowUpRight,
    ArrowDownRight,
    Minus,
} from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { ShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import {
    getProtectionContext,
    getTimeRule,
    getLiveRuleBadges,
    getPayrollRuleBadges,
    isShiftAssigned,
    resolveGroupVariant,
} from '@/modules/rosters/domain/shift-ui';
import { ShiftRuleHeader } from '@/modules/rosters/ui/components/ShiftRuleHeader';
import { GROUP_DISPLAY_NAMES } from '@/modules/rosters/domain/projections/constants';

export type ShiftIdentityField =
    | 'org' | 'dept' | 'subDept'
    | 'group' | 'subGroup' | 'role'
    | 'employee';

interface SharedShiftCardProps {
    organization: string;
    department: string;
    subGroup?: string;
    role: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    netLength: number; // in minutes
    paidBreak: number;
    unpaidBreak: number;
    timerText?: string | null;
    isExpired?: boolean;
    lifecycleStatus?: string;
    isUrgent?: boolean;
    /** Full three-zone urgency badge. When provided, supersedes isUrgent. */
    urgency?: ShiftUrgency;
    groupVariant?: 'convention' | 'exhibition' | 'theatre' | 'cutaway' | 'office' | 'default';
    complianceLabel?: string;
    isPast?: boolean;
    statusIcons?: React.ReactNode;
    footerActions?: React.ReactNode;
    topContent?: React.ReactNode;
    className?: string;
    onClick?: () => void;
    variant?: 'default' | 'nested' | 'timecard';
    /** Standardised shift for status dot derivation */
    shiftData?: any;
    /** Removes outer border, shadow and background for seamless embedding */
    isFlat?: boolean;
    /** Attendance / Timesheet specific data */
    employeeName?: string;
    avatarUrl?: string;
    clockIn?: string | null;
    clockOut?: string | null;
    adjustedStart?: string | null;
    adjustedEnd?: string | null;
    /** Billable-time provenance (F16) — drives the 🕒/👤/🤖 icons on the billable row. */
    adjustedStartSource?: 'manual' | 'snapped' | 'auto' | null;
    adjustedEndSource?: 'manual' | 'snapped' | 'auto' | null;
    arrivalVarianceReason?: string | null;
    departureVarianceReason?: string | null;
    /**
     * EBA minimum-engagement floor (F-locked 2026-07-28): true when the
     * billable net was automatically raised to the statutory minimum because
     * the raw clocked/edited window netted less than it.
     */
    wasToppedUpToMinEngagement?: boolean;
    /** The EBA minimum (minutes) that applied when `wasToppedUpToMinEngagement` is true. */
    requiredEngagementMinutes?: number | null;
    /** When true, passes showPayrollRules to ShiftRuleHeader. */
    showPayrollRules?: boolean;
    /** Custom hex color (e.g. from groupColor) to style the department accent bar and theme */
    customColor?: string;
    /** Timesheet approval status from database ('approved', 'auto_approved', 'pending', 'rejected', 'draft') */
    timesheetStatus?: string;
    /** Control which collapsible sections are expanded by default */
    defaultExpandedSections?: {
        scheduled?: boolean;
        actual?: boolean;
        payroll?: boolean;
        variance?: boolean;
    };
    /**
     * How Scheduled / Actual / Payroll / Variance are laid out. `stack` (the
     * default) is one under another, for a card in a list or grid cell;
     * `columns` gives the card the whole width, as in the Office expand
     * dialog: Scheduled · Actual · Payroll as three equal panes, Variance full
     * width beneath them, every section open and none collapsible.
     */
    sectionLayout?: 'stack' | 'columns';
    /** When true, suppresses (hides) the Actual Clocking section entirely */
    hideActualClocking?: boolean;
    /** When true, suppresses (hides) the Payroll & Billable section entirely */
    hidePayrollSection?: boolean;
    /** When true, suppresses (hides) card box-shadow glow */
    hideGlow?: boolean;
    /** When true, hides the organization -> department -> subGroup breadcrumbs */
    hideBreadcrumbs?: boolean;
    /** When true, hides the top DATES | ROLE | TIMESHEET STATUS segmented grid */
    hideSegmentedBox?: boolean;
    /**
     * Lead the card with a labelled identity grid instead of a heading.
     *
     * The role/assignee heading and the breadcrumb trail are dropped and six
     * labelled cells render three-up in their place — Org · Dept · Sub-Dept /
     * Group · Sub-Group · Role — replacing the DATES | ROLE | TIMESHEET STATUS
     * box. It is one decision, not three: identity is either a headline or a
     * table, and mixing them repeated the same org → dept → role facts in three
     * different type sizes.
     *
     * The card derives every cell itself from the props below (falling back to
     * `shiftData` where a caller has not spelled a fact out), so adopting this
     * on a new surface is one boolean.
     *
     * `employeeName`, when given, is appended as a seventh "Employee" cell —
     * manager-facing surfaces lead on *who*, and dropping the assignee to hit a
     * tidy 3×2 would be losing information, not tightening a layout. Employee
     * surfaces showing a person their own shift simply omit it.
     */
    identityGrid?: boolean;
    /**
     * Which identity cells to render, and in what order. Defaults to all seven.
     * There are no pay cells: a shift's pay is shown in Gross Pay alone
     * (decision 2026-10-09).
     *
     * For a surface that has already stated some of these facts, repeating them
     * on every card is noise: the roster drill-down is scoped to one group,
     * sub-group and date, so five of the cells were identical across every card
     * in the panel and the two that actually distinguished the shifts — role
     * and assignee — were the smallest things on screen. Naming a subset lets
     * that panel show just `['role','employee']`.
     */
    identityFields?: ShiftIdentityField[];
    /**
     * Org-chart sub-department. Distinct from `subGroup`, which is the roster's
     * own grouping — two different facts that callers had been feeding through
     * the same prop, so the card could never show both.
     */
    subDepartment?: string;
    /** Roster group ("Theatre"). Derived from `shiftData.group_type` when omitted. */
    group?: string;
    /** When true, moves topContent (selection slot, history button, etc.) to the bottom row alongside footerActions */
    moveTopContentToBottom?: boolean;
}

/* Billable-time provenance icon (F16), shared with the desktop timesheet table. */
const BILLABLE_SOURCE_META = {
    manual: { Icon: User, cls: 'text-indigo-500', label: 'Manager adjusted' },
    snapped: { Icon: Clock, cls: 'text-sky-500', label: 'Snapped to nearest 15 min' },
    auto: { Icon: Bot, cls: 'text-amber-500', label: 'Auto clock-out (needs review)' },
} as const;

const BillableSourceIcon: React.FC<{
    source?: 'manual' | 'snapped' | 'auto' | null;
    hasValue: boolean;
    varianceReason?: string | null;
    labelPrefix?: string;
}> = ({ source, hasValue, varianceReason, labelPrefix }) => {
    const effectiveSource = source || (varianceReason ? 'manual' : null);
    if (!effectiveSource || (effectiveSource !== 'auto' && !hasValue && !varianceReason)) return null;
    const meta = BILLABLE_SOURCE_META[effectiveSource] ?? BILLABLE_SOURCE_META.manual;
    const { Icon, cls, label } = meta;
    const tooltipText = varianceReason
        ? `${labelPrefix ? `${labelPrefix} Reason: ` : ''}"${varianceReason}"`
        : label;
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="cursor-help inline-flex items-center">
                        <Icon className={cn('inline-block h-3.5 w-3.5 ml-1 align-middle', cls)} aria-label={tooltipText} />
                    </span>
                </TooltipTrigger>
                <TooltipContent className="bg-popover border border-border shadow-xl text-xs font-semibold text-foreground p-2 rounded-xl z-[999]">
                    {tooltipText}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

const DataRow: React.FC<{
    label: string;
    value: React.ReactNode;
    emphasis?: boolean;
    accentColor?: string;
}> = ({ label, value, emphasis, accentColor }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-foreground/[0.04] last:border-0">
        <span className="text-[11px] font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
            {label}
        </span>
        <div className={cn(
            "tabular-nums tracking-tight font-black font-mono flex items-center gap-2 text-right justify-end",
            emphasis ? "text-[14px] text-foreground" : "text-[12px] text-foreground/70",
            accentColor
        )}>
            {value}
        </div>
    </div>
);

function parseTimeToMinutes(timeStr?: string | null): number | null {
    if (!timeStr || timeStr === '--:--' || timeStr === '-' || timeStr === '—') return null;
    if (timeStr.includes('T')) {
        const d = new Date(timeStr);
        if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }
    const clean = timeStr.trim();
    const match = clean.match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (/pm/i.test(clean) && h < 12) h += 12;
    if (/am/i.test(clean) && h === 12) h = 0;
    return h * 60 + m;
}

function calculateGrossMinutes(startStr?: string | null, endStr?: string | null): number | null {
    const s = parseTimeToMinutes(startStr);
    let e = parseTimeToMinutes(endStr);
    if (s === null || e === null) return null;
    if (e < s) e += 1440;
    return e - s;
}

function formatMins(mins: number | null): string {
    if (mins === null || isNaN(mins) || mins < 0) return '--';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`;
    return `${m}m`;
}

/** "+1h 30m" / "-45m" / "±0" — signed minute delta for the variance section. */
function formatSignedMins(deltaMins: number | null): string {
    if (deltaMins === null || isNaN(deltaMins)) return '--';
    if (deltaMins === 0) return '±0';
    const sign = deltaMins > 0 ? '+' : '-';
    return `${sign}${formatMins(Math.abs(deltaMins))}`;
}

/**
 * A section's header row. A toggle normally; in the `columns` layout every
 * section is always open, so it is a plain row — a button that does nothing
 * would still be announced, and focused, as one.
 */
const SectionHeader: React.FC<{
    collapsible: boolean;
    open: boolean;
    controls: string;
    onToggle: () => void;
    children: React.ReactNode;
}> = ({ collapsible, open, controls, onToggle, children }) => {
    const cls = 'w-full flex items-center justify-between py-3 px-4 bg-muted/30';
    return collapsible ? (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls}
            className={cn(cls, 'hover:bg-muted/50 transition-colors')}>
            {children}
        </button>
    ) : (
        <div className={cls}>{children}</div>
    );
};

export const SharedShiftCard = forwardRef<HTMLDivElement, SharedShiftCardProps>(({
    avatarUrl,
    organization,
    department,
    subGroup,
    role,
    shiftDate,
    startTime,
    endTime,
    netLength,
    paidBreak,
    unpaidBreak,
    timerText,
    isExpired,
    lifecycleStatus = 'Published',
    isUrgent,
    urgency,
    groupVariant = 'default',
    complianceLabel = 'Compliant',
    isPast = false,
    statusIcons,
    footerActions,
    topContent,
    className,
    onClick,
    variant = 'default',
    shiftData,
    isFlat = false,
    employeeName,
    clockIn,
    clockOut,
    adjustedStart,
    adjustedEnd,
    adjustedStartSource,
    adjustedEndSource,
    arrivalVarianceReason,
    departureVarianceReason,
    wasToppedUpToMinEngagement,
    requiredEngagementMinutes,
    showPayrollRules,
    customColor,
    timesheetStatus,
    defaultExpandedSections,
    hideActualClocking = false,
    hidePayrollSection = false,
    sectionLayout = 'stack',
    hideGlow = false,
    hideBreadcrumbs = false,
    hideSegmentedBox = false,
    identityGrid = false,
    identityFields,
    subDepartment,
    group,
    moveTopContentToBottom = false,
}, ref) => {
    const protection = React.useMemo(() => getProtectionContext(
        { lifecycle_status: lifecycleStatus as 'Draft' | 'Published' | 'InProgress' | 'Completed' | 'Cancelled' },
        isPast
    ), [lifecycleStatus, isPast]);

    const rawTimesheetStatus = (timesheetStatus || shiftData?.timesheet_status || shiftData?.timesheetStatus || 'draft').toLowerCase();

    const formattedTimesheetStatus = React.useMemo(() => {
        switch (rawTimesheetStatus) {
            case 'auto_approved':
                return { label: 'Auto Approved', cls: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' };
            case 'approved':
            case 'verified':
                return { label: 'Approved', cls: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' };
            case 'submitted':
            case 'pending':
                return { label: 'Pending', cls: 'text-amber-400 bg-amber-500/15 border-amber-500/30' };
            case 'rejected':
            case 'denied':
                return { label: 'Rejected', cls: 'text-rose-400 bg-rose-500/15 border-rose-500/30' };
            default:
                return { label: 'Draft', cls: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
        }
    }, [rawTimesheetStatus]);

    const effectiveColor = customColor || shiftData?.groupColor || shiftData?.group_color;

    const resolvedVariant = React.useMemo(() => {
        if (groupVariant && groupVariant !== 'default') return groupVariant;
        return resolveGroupVariant(
            shiftData,
            department || organization,
            subGroup || role
        );
    }, [groupVariant, shiftData, department, organization, subGroup, role]);

    // Premium Department Color Styling (Badges)
    const getTheme = () => {
        const base = 'dept-card-glass-base';
        const variantToUse = resolvedVariant !== 'default' ? resolvedVariant : groupVariant;

        switch (variantToUse) {
            case 'convention': return { 
                badge: 'dept-badge-convention', 
                cardBg: `${base} dept-card-glass-convention`,
                accent: 'text-blue-500',
                color: '#2563eb',
                secondary: '#3b82f6',
                atmosphere: ['#1d4ed8', '#2563eb', '#60a5fa'],
            };
            case 'exhibition': return { 
                badge: 'dept-badge-exhibition', 
                cardBg: `${base} dept-card-glass-exhibition`,
                accent: 'text-emerald-500',
                color: '#10b981',
                secondary: '#059669',
                atmosphere: ['#059669', '#10b981', '#34d399'],
            };
            case 'theatre': return { 
                badge: 'dept-badge-theatre', 
                cardBg: `${base} dept-card-glass-theatre`,
                accent: 'text-rose-500',
                color: '#ef4444',
                secondary: '#dc2626',
                atmosphere: ['#991b1b', '#ef4444', '#f87171'],
            };
            case 'cutaway': return { 
                badge: 'dept-badge-cutaway', 
                cardBg: `${base} dept-card-glass-cutaway`,
                accent: 'text-amber-500',
                color: '#d97706',
                secondary: '#f59e0b',
                atmosphere: ['#b45309', '#d97706', '#fbbf24'],
            };
            case 'office': return {
                badge: 'dept-badge-office',
                cardBg: `${base} dept-card-glass-office`,
                accent: 'text-cyan-500',
                color: '#0891b2',
                secondary: '#06b6d4',
                atmosphere: ['#0e7490', '#0891b2', '#22d3ee'],
            };
            default:
                if (effectiveColor) {
                    return {
                        badge: 'dept-badge-default',
                        cardBg: `${base} dept-card-glass-default`,
                        accent: 'text-primary',
                        color: effectiveColor,
                        secondary: effectiveColor,
                        atmosphere: [effectiveColor, effectiveColor, effectiveColor],
                    };
                }
                return { 
                    badge: 'dept-badge-default', 
                    cardBg: `${base} dept-card-glass-default`,
                    accent: 'text-primary',
                    color: '#9333ea',
                    secondary: '#a855f7',
                    atmosphere: ['#7e22ce', '#9333ea', '#c084fc'],
                };
        }
    };

    const isNested = variant === 'nested';
    const isTimecard = variant === 'timecard';

    /**
     * The identity grid's cells.
     *
     * Derived here rather than at each call site so every surface — bids,
     * swaps, timesheets, the roster planner, the offers inbox — shows the same
     * six facts under the same six labels, in the same order. A caller that has
     * not spelled a fact out gets it off `shiftData`, which every one of them
     * already passes.
     */
    const identityGridCells = React.useMemo(() => {
        if (!identityGrid) return null;
        const groupType = shiftData?.group_type ?? shiftData?.groupType;
        const str = (v?: string | null) => (v?.trim() ? v : null);
        const byField: Record<ShiftIdentityField, { label: string; value: React.ReactNode }> = {
            org: { label: 'Org', value: str(organization) ?? str(shiftData?.organizations?.name) },
            dept: { label: 'Dept', value: str(department) ?? str(shiftData?.departments?.name) },
            subDept: { label: 'Sub-Dept', value: str(subDepartment) ?? str(shiftData?.sub_departments?.name) },
            group: {
                label: 'Group',
                value:
                    str(group) ??
                    (groupType
                        ? GROUP_DISPLAY_NAMES[groupType as keyof typeof GROUP_DISPLAY_NAMES] ?? groupType
                        : null),
            },
            subGroup: { label: 'Sub-Group', value: str(subGroup) ?? str(shiftData?.sub_group_name) },
            role: { label: 'Role', value: str(role) ?? str(shiftData?.roles?.name) },
            // An unfilled shift is a real state, not a missing value, so it reads
            // "Unassigned" rather than the em-dash used for absent facts — but
            // only where the card can actually tell the two apart. `shiftData`
            // carrying an empty `assigned_employee_id` is positive evidence that
            // nobody holds the shift; a caller that simply never passed an
            // assignee (the swap pickers select no profile at all) has told us
            // nothing, and printing "Unassigned" there would be the same lie the
            // offers inbox used to tell its own recipient.
            employee: {
                label: 'Employee',
                value:
                    str(employeeName) ??
                    (shiftData && 'assigned_employee_id' in shiftData ? 'Unassigned' : null),
            },
        };

        const order: ShiftIdentityField[] = identityFields ?? [
            'org', 'dept', 'subDept',
            'group', 'subGroup', 'role',
            'employee',
        ];
        return order.map((field) => byField[field]).filter(Boolean);
    }, [
        identityGrid, identityFields, organization, department, subDepartment, group, subGroup, role,
        employeeName, shiftData,
    ]);
    // Several of these cards can share a page (an offers inbox, a swap list),
    // so the collapsible regions need ids that are unique per instance for
    // aria-controls to resolve to the right panel.
    const sectionIdBase = React.useId();
    const theme = getTheme();

    const breadcrumbs = (
        <div className={cn(
            "text-[9px] mb-1 tracking-tight font-mono font-black uppercase flex items-center gap-1",
            isTimecard ? "text-foreground/30" : "text-muted-foreground/40"
        )}>
            <span>{organization}</span>
            <span className="text-primary/30">→</span>
            <span>{department}</span>
            {subGroup && subGroup !== 'General' && (
                <>
                    <span className="text-primary/30">→</span>
                    <span>{subGroup}</span>
                </>
            )}
        </div>
    );



    const isColumns = sectionLayout === 'columns';
    const [expandedSections, setExpandedSections] = React.useState({
        scheduled: defaultExpandedSections?.scheduled ?? false,
        actual: defaultExpandedSections?.actual ?? false,
        payroll: defaultExpandedSections?.payroll ?? false,
        variance: defaultExpandedSections?.variance ?? false,
    });
    // Columns: every section open, and no toggle offered.
    const sectionsOpen = isColumns
        ? { scheduled: true, actual: true, payroll: true, variance: true }
        : expandedSections;

    // ── Variance (Scheduled vs Billable) — feeds the 4th collapsible section.
    // Gross/Net are re-derived independently for each side (never shared) so a
    // stale prop can't make the two sides silently agree — see the Scheduled
    // section's own Net line for the bug this pattern was introduced to avoid.
    const varianceBillableStart = adjustedStart || clockIn || startTime;
    const varianceBillableEnd = adjustedEnd || clockOut || endTime;
    const varianceSchedGrossMins = calculateGrossMinutes(startTime, endTime);
    const varianceSchedNetMins = varianceSchedGrossMins !== null ? Math.max(0, varianceSchedGrossMins - unpaidBreak) : null;
    const varianceBillGrossMins = calculateGrossMinutes(varianceBillableStart, varianceBillableEnd);
    const varianceBillNetMins = varianceBillGrossMins !== null ? Math.max(0, varianceBillGrossMins - unpaidBreak) : null;
    const varianceRows: { label: string; delta: number | null; format: (d: number | null) => string }[] = [
        {
            label: 'Gross',
            delta: (varianceSchedGrossMins !== null && varianceBillGrossMins !== null) ? varianceBillGrossMins - varianceSchedGrossMins : null,
            format: formatSignedMins,
        },
        {
            label: 'Net',
            delta: (varianceSchedNetMins !== null && varianceBillNetMins !== null) ? varianceBillNetMins - varianceSchedNetMins : null,
            format: formatSignedMins,
        },
    ];

    const resolvedShiftData = React.useMemo(() => {
        if (shiftData) return shiftData;
        return {
            lifecycle_status: lifecycleStatus || 'Published',
            start_time: startTime,
            end_time: endTime,
            shift_date: shiftDate,
            actual_start: clockIn,
            actual_end: clockOut,
            adjusted_start: adjustedStart,
            adjusted_end: adjustedEnd,
            adjusted_start_source: adjustedStartSource,
            adjusted_end_source: adjustedEndSource,
        };
    }, [shiftData, lifecycleStatus, startTime, endTime, shiftDate, clockIn, clockOut, adjustedStart, adjustedEnd, adjustedStartSource, adjustedEndSource]);

    const timeRule = React.useMemo(() => getTimeRule(resolvedShiftData), [resolvedShiftData]);
    const liveBadges = React.useMemo(() => getLiveRuleBadges(resolvedShiftData), [resolvedShiftData]);
    const payrollBadges = React.useMemo(() => getPayrollRuleBadges(resolvedShiftData), [resolvedShiftData]);

    const isShiftFinished = React.useMemo(() => {
        if (lifecycleStatus === 'Completed' || shiftData?.lifecycle_status === 'Completed') return true;
        // A REAL clock-out only. NB: the `clockOut` prop is a formatted display
        // string ('—' when empty), so it must NOT be used here — an unclocked-out
        // shift would look finished and unlock billable mid-shift.
        if (shiftData?.actual_end) return true;
        const att = (shiftData?.attendance_status || '').toLowerCase();
        if (att === 'no_show') return true;
        const status = (shiftData?.timesheet_status || '').toLowerCase();
        if (['approved', 'verified', 'submitted'].includes(status)) return true;
        if (timeRule?.label === 'Closed') return true;
        return false;
    }, [lifecycleStatus, shiftData, timeRule]);

    const showPayrollSection = React.useMemo(() => {
        if (hidePayrollSection) return false;
        if (isTimecard) return true;
        // An unfilled shift has no payroll — nobody worked it. `isShiftFinished`
        // below is true for ANY shift past its end time, which is what used to
        // render a Payroll panel (over the SCHEDULED hours) on unassigned slots.
        // A real billable window still wins, so a shift unassigned after the fact
        // keeps showing what was already paid.
        const hasBillableWindow = !!(adjustedStart || adjustedEnd
            || shiftData?.adjusted_start || shiftData?.adjusted_end);
        if (hasBillableWindow) return true;
        if (!isShiftAssigned(resolvedShiftData)) return false;
        if (showPayrollRules) return true;
        if (isShiftFinished) return true;
        if (payrollBadges.arrival || payrollBadges.departure) return true;
        return false;
    }, [hidePayrollSection, isTimecard, showPayrollRules, adjustedStart, adjustedEnd, shiftData, isShiftFinished, payrollBadges, resolvedShiftData]);

    const isCardPast = isPast || isExpired;

    if (isTimecard) {
        const displayRole = role || 'Shift';

        return (
            <div
                ref={ref}
                className={cn(
                    'relative overflow-hidden transition-all duration-300',
                    isCardPast ? 'bg-slate-900/60 border-slate-700/30 grayscale-[0.85] opacity-60 saturate-50' : theme.cardBg,
                    !isFlat && 'rounded-[28px] border text-card-foreground shadow-xl p-6',
                    // No border. `isFlat` has always promised to remove it, but
                    // it added `border border-border/40` — and the width was
                    // all the `.dept-card-glass-*` rules needed, since they set
                    // `border-<colour>` with `!important`. The result was a
                    // coloured hairline down the left and along the bottom of
                    // every embedded card, tracking the container's radius
                    // rather than the card's. Background and tint are untouched.
                    isFlat && 'rounded-xl p-4 border-0 dept-card-glass-flat',
                    className
                )}
                style={!isFlat ? {
                    borderColor: isCardPast ? 'rgba(100, 116, 139, 0.25)' : `${theme.color}40`,
                    boxShadow: (hideGlow || isCardPast) ? 'none' : `0 8px 30px -10px ${theme.color}25`,
                } : undefined}
            >
                {/* Header: Role & Assignee Subtitle. Omitted entirely when the
                    caller leads with `identityCells` — those carry the same
                    facts, labelled, and the heading would only restate them. */}
                {!identityGridCells && (
                <div className="flex items-start justify-between gap-4 mb-4 pt-1">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-2xl font-black tracking-tight text-foreground truncate">
                            {displayRole}
                        </h2>
                        <div className="text-sm font-bold tracking-tight mt-0.5">
                            {employeeName ? (
                                <span className={cn(isCardPast ? "text-muted-foreground" : "text-emerald-500 dark:text-emerald-400")}>{employeeName}</span>
                            ) : (
                                <span className={cn(isCardPast ? "text-muted-foreground/60" : "text-amber-500 dark:text-amber-400")}>Unassigned</span>
                            )}
                        </div>
                        {!hideBreadcrumbs && (
                            <div className="text-sm font-mono text-muted-foreground mt-1 flex items-center gap-1.5 overflow-hidden whitespace-nowrap font-bold">
                                <span className="truncate">{organization}</span>
                                <span className="text-primary/40 shrink-0">→</span>
                                <span className="truncate">{department || 'General'}</span>
                                {/* `subDepartment` first: callers that used to cram it into
                                    `subGroup` now pass it properly, and the trail should read
                                    the same as it always did for them. */}
                                {(subDepartment || subGroup) && (subDepartment || subGroup) !== 'General' && (
                                    <>
                                        <span className="text-primary/40 shrink-0">→</span>
                                        <span className="truncate">{subDepartment || subGroup}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {!moveTopContentToBottom && topContent}
                </div>
                )}

                {identityGridCells && !moveTopContentToBottom && topContent && (
                    <div className="flex justify-end mb-3">{topContent}</div>
                )}

                {/* COUNTDOWN */}
                {timerText && (
                    <div className={cn(
                        "mb-4 px-3 py-2 rounded-xl text-[11px] font-black font-mono flex items-center justify-center gap-2 tracking-widest transition-colors border",
                        isExpired 
                            ? "bg-rose-500/10 text-rose-500 border-rose-500/20" 
                            : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                    )}>
                        <Clock className="w-3.5 h-3.5" />
                        <span className="uppercase">{isExpired ? 'CLOSED' : timerText}</span>
                    </div>
                )}

                {/* Identity grid — three-up; the full seven read as 3+3+1, the last spanning. */}
                {identityGridCells && identityGridCells.length > 0 && (
                    <dl className={cn(
                        'grid gap-2 mb-5',
                        // The column count follows the selection rather than being
                        // asserted — six read 3×2, four 2×2, and a lone cell left
                        // over on a three-up row spans it — so none is ragged.
                        identityGridCells.length % 3 === 0 ? 'grid-cols-3'
                            : identityGridCells.length % 2 === 0 ? 'grid-cols-2'
                            : 'grid-cols-3',
                    )}>
                        {/* Discrete cells rather than a divided box: Tailwind's
                            `divide-*` is a `> * + *` rule, so in a grid it puts
                            a left border on the first cell of every row and a
                            top border across the first row. */}
                        {identityGridCells.map(({ label, value }, i) => {
                            // A lone cell left on a three-up last row spans it.
                            const spansRow = identityGridCells.length % 3 === 1
                                && i === identityGridCells.length - 1;
                            return (
                                <div
                                    key={label}
                                    className={cn(
                                        'min-w-0 rounded-lg border border-border/60 bg-muted/20 p-2.5 dark:bg-zinc-900/50',
                                        spansRow && 'col-span-3',
                                    )}
                                >
                                    <dt className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                                        {label}
                                    </dt>
                                    <dd className="mt-1 text-sm font-semibold break-words text-foreground">
                                        {value == null ? (
                                            <>
                                                <span aria-hidden="true">—</span>
                                                <span className="sr-only">Not set</span>
                                            </>
                                        ) : (
                                            value
                                        )}
                                    </dd>
                                </div>
                            );
                        })}
                    </dl>
                )}

                {/* Segmented Top Selector Box: DATES | ROLE | STATUS */}
                {!hideSegmentedBox && !identityGridCells && (
                    <div className="grid grid-cols-3 rounded-xl border border-border/80 bg-muted/20 dark:bg-zinc-900/60 overflow-hidden mb-5 divide-x divide-border/80">
                        <div className="p-3.5 min-w-0">
                            <span className="block text-xs font-black uppercase tracking-widest text-muted-foreground truncate">
                                DATES
                            </span>
                            <div className="mt-1 text-sm font-bold text-foreground truncate">
                                {shiftDate}
                            </div>
                        </div>
                        <div className="p-3.5 min-w-0">
                            <span className="block text-xs font-black uppercase tracking-widest text-muted-foreground truncate">
                                ROLE
                            </span>
                            <div className="mt-1 text-sm font-bold text-foreground truncate">
                                {role}
                            </div>
                        </div>
                        <div className="p-3.5 min-w-0">
                            <span className="block text-xs font-black uppercase tracking-widest text-muted-foreground truncate">
                                TIMESHEET STATUS
                            </span>
                            <div className="mt-1 text-sm font-bold text-foreground truncate">
                                {formattedTimesheetStatus.label}
                            </div>
                        </div>
                    </div>
                )}

                {/* Collapsible Section Rows */}
                <div className={isColumns ? 'mb-6 grid gap-4 sm:grid-cols-3' : 'space-y-4 mb-6'}>
                    {/* 1. SCHEDULED SHIFT SECTION */}
                    <div className={cn('rounded-xl border border-border/60 bg-muted/10 overflow-hidden transition-all', isColumns && 'flex h-full flex-col')}>
                        <SectionHeader
                            collapsible={!isColumns}
                            open={sectionsOpen.scheduled}
                            controls={`${sectionIdBase}-scheduled`}
                            onToggle={() => setExpandedSections(prev => ({ ...prev, scheduled: !prev.scheduled }))}
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-base font-black text-foreground">Scheduled</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {timeRule && (
                                    <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border shadow-sm" style={{ backgroundColor: `${timeRule.color}25`, color: timeRule.color, borderColor: `${timeRule.color}50` }}>
                                        {timeRule.label}
                                    </span>
                                )}
                                {!isColumns && (sectionsOpen.scheduled ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />)}
                            </div>
                        </SectionHeader>

                        {sectionsOpen.scheduled && (
                            <div id={`${sectionIdBase}-scheduled`} role="region" className="p-4 pt-3 space-y-1.5 border-t border-border/40">
                                <div className="text-sm font-bold text-foreground/90">
                                    Timings: {startTime} – {endTime}
                                </div>
                                <div className="text-xs font-mono font-bold text-muted-foreground">
                                    Breaks: Paid {paidBreak}m · Unpaid {unpaidBreak}m
                                </div>
                                <div className="text-sm font-mono font-black text-emerald-600 dark:text-emerald-400">
                                    {/* The SCHEDULED net, derived from the SCHEDULED span — NOT the
                                        `netLength` prop, which carries the BILLABLE (post-floor) net
                                        and would make this line silently mirror the Payroll & Billable
                                        section's own Net below, masking any variance between them. */}
                                    Gross: {formatMins(calculateGrossMinutes(startTime, endTime))} · Net: {formatMins(Math.max(0, (calculateGrossMinutes(startTime, endTime) || 0) - unpaidBreak))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 2. ACTUAL CLOCKING SECTION */}
                    {!hideActualClocking && (
                        <div className={cn('rounded-xl border border-border/60 bg-muted/10 overflow-hidden transition-all', isColumns && 'flex h-full flex-col')}>
                            <SectionHeader
                                collapsible={!isColumns}
                                open={sectionsOpen.actual}
                                controls={`${sectionIdBase}-actual`}
                                onToggle={() => setExpandedSections(prev => ({ ...prev, actual: !prev.actual }))}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-base font-black text-foreground">Actual</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {liveBadges.arrival || liveBadges.departure ? (
                                        <div className="flex items-center gap-1">
                                            {liveBadges.arrival && (
                                                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border shadow-sm" style={{ backgroundColor: `${liveBadges.arrival.color}25`, color: liveBadges.arrival.color, borderColor: `${liveBadges.arrival.color}50` }}>
                                                    {liveBadges.arrival.label}
                                                </span>
                                            )}
                                            {liveBadges.departure && (
                                                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border shadow-sm" style={{ backgroundColor: `${liveBadges.departure.color}25`, color: liveBadges.departure.color, borderColor: `${liveBadges.departure.color}50` }}>
                                                    {liveBadges.departure.label}
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            Pending
                                        </span>
                                    )}
                                    {!isColumns && (sectionsOpen.actual ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />)}
                                </div>
                            </SectionHeader>

                            {sectionsOpen.actual && (
                                <div id={`${sectionIdBase}-actual`} role="region" className="p-4 pt-3 space-y-1.5 border-t border-border/40">
                                    <div className="text-sm font-bold text-foreground/90">
                                        Timings: {clockIn || '--:--'} – {clockOut || '--:--'}
                                    </div>
                                    <div className="text-xs font-mono font-bold text-muted-foreground">
                                        Breaks: {clockIn || clockOut ? `Paid ${paidBreak}m · Unpaid ${unpaidBreak}m` : '--'}
                                    </div>
                                    <div className={cn("text-sm font-mono font-black", (clockIn && clockOut) ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/40")}>
                                        Gross: {clockIn && clockOut ? formatMins(calculateGrossMinutes(clockIn, clockOut)) : '--'} · Net: {clockIn && clockOut ? formatMins(Math.max(0, (calculateGrossMinutes(clockIn, clockOut) || 0) - unpaidBreak)) : '--'}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 3. PAYROLL & BILLABLE SECTION */}
                    {!hidePayrollSection && showPayrollSection && (
                        <div className={cn('rounded-xl border border-border/60 bg-muted/10 overflow-hidden transition-all', isColumns && 'flex h-full flex-col')}>
                            <SectionHeader
                                collapsible={!isColumns}
                                open={sectionsOpen.payroll}
                                controls={`${sectionIdBase}-payroll`}
                                onToggle={() => setExpandedSections(prev => ({ ...prev, payroll: !prev.payroll }))}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-base font-black text-foreground">Payroll</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {payrollBadges.arrival || payrollBadges.departure ? (
                                        <div className="flex items-center gap-1">
                                            {payrollBadges.arrival && (
                                                (arrivalVarianceReason || shiftData?.arrival_variance_reason) ? (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border cursor-help shadow-sm" style={{ backgroundColor: `${payrollBadges.arrival.color}15`, color: payrollBadges.arrival.color, borderColor: `${payrollBadges.arrival.color}30` }}>
                                                                    {payrollBadges.arrival.label}
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="bg-popover border border-border shadow-xl text-xs font-semibold text-foreground p-2 rounded-xl z-[999]">
                                                                <span className="font-bold text-amber-500">Arrival Reason:</span> {arrivalVarianceReason || shiftData?.arrival_variance_reason}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                ) : (
                                                    <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border" style={{ backgroundColor: `${payrollBadges.arrival.color}15`, color: payrollBadges.arrival.color, borderColor: `${payrollBadges.arrival.color}30` }}>
                                                        {payrollBadges.arrival.label}
                                                    </span>
                                                )
                                            )}
                                            {payrollBadges.departure && (
                                                (departureVarianceReason || shiftData?.departure_variance_reason) ? (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border cursor-help shadow-sm" style={{ backgroundColor: `${payrollBadges.departure.color}15`, color: payrollBadges.departure.color, borderColor: `${payrollBadges.departure.color}30` }}>
                                                                    {payrollBadges.departure.label}
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="bg-popover border border-border shadow-xl text-xs font-semibold text-foreground p-2 rounded-xl z-[999]">
                                                                <span className="font-bold text-amber-500">Departure Reason:</span> {departureVarianceReason || shiftData?.departure_variance_reason}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                ) : (
                                                    <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border" style={{ backgroundColor: `${payrollBadges.departure.color}15`, color: payrollBadges.departure.color, borderColor: `${payrollBadges.departure.color}30` }}>
                                                        {payrollBadges.departure.label}
                                                    </span>
                                                )
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            Pending
                                        </span>
                                    )}
                                    {!isColumns && (sectionsOpen.payroll ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />)}
                                </div>
                            </SectionHeader>

                            {sectionsOpen.payroll && (
                                <div id={`${sectionIdBase}-payroll`} role="region" className="p-4 pt-3 space-y-1.5 border-t border-border/40">
                                    {!isShiftFinished ? (
                                        // Billable/payable is locked until the shift ends — no value is
                                        // shown or editable while the shift is still live.
                                        <div className="text-sm font-bold text-muted-foreground/40 italic flex items-center gap-2">
                                            <Lock className="h-3.5 w-3.5 shrink-0" />
                                            Billable is locked until the shift ends
                                        </div>
                                    ) : (
                                    <>
                                    <div className="text-sm font-bold text-foreground/90 flex items-center">
                                        Timings:&nbsp;{adjustedStart || clockIn || startTime || '--:--'}
                                        <BillableSourceIcon
                                            source={adjustedStartSource}
                                            hasValue={!!adjustedStart}
                                            varianceReason={arrivalVarianceReason || shiftData?.arrival_variance_reason}
                                            labelPrefix="Arrival"
                                        />
                                        <span className="mx-1">–</span>
                                        {adjustedEnd || clockOut || endTime || '--:--'}
                                        <BillableSourceIcon
                                            source={adjustedEndSource}
                                            hasValue={!!adjustedEnd}
                                            varianceReason={departureVarianceReason || shiftData?.departure_variance_reason}
                                            labelPrefix="Departure"
                                        />
                                    </div>
                                    <div className="text-xs font-mono font-bold text-muted-foreground">
                                        Breaks: Paid {paidBreak}m · Unpaid {unpaidBreak}m
                                    </div>
                                    <div className="text-sm font-mono font-black text-indigo-600 dark:text-indigo-400">
                                        Gross: {formatMins(calculateGrossMinutes(adjustedStart || clockIn || startTime, adjustedEnd || clockOut || endTime))} · Net: {formatMins(Math.max(0, (calculateGrossMinutes(adjustedStart || clockIn || startTime, adjustedEnd || clockOut || endTime) || 0) - unpaidBreak))}
                                    </div>
                                    {wasToppedUpToMinEngagement && (
                                        <div
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black font-mono tracking-tight uppercase border w-fit"
                                            style={{ color: '#0891B2', backgroundColor: '#0891B210', borderColor: '#0891B220' }}
                                            title={`Clocked hours were below the EBA minimum engagement${requiredEngagementMinutes ? ` (${requiredEngagementMinutes / 60}h)` : ''} — pay was automatically topped up to the guaranteed minimum.`}
                                        >
                                            Topped Up to Min
                                        </div>
                                    )}
                                    {(arrivalVarianceReason || departureVarianceReason || shiftData?.notes || shiftData?.attendance_note) && (
                                        <div className="text-xs font-medium text-muted-foreground/90 italic pt-1 border-t border-border/20 font-mono flex items-start gap-1 flex-wrap">
                                            <span className="font-bold text-amber-500/90 not-italic uppercase tracking-wider text-[10px] shrink-0">NOTE:</span>
                                            <span className="text-foreground/80">
                                                {[
                                                    arrivalVarianceReason ? `Arrival: "${arrivalVarianceReason}"` : null,
                                                    departureVarianceReason ? `Departure: "${departureVarianceReason}"` : null,
                                                    shiftData?.notes || shiftData?.attendance_note ? `"${shiftData?.notes || shiftData?.attendance_note}"` : null,
                                                ].filter(Boolean).join(' · ')}
                                            </span>
                                        </div>
                                    )}
                                    </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 4. VARIANCE SECTION — Scheduled vs Billable, at a glance */}
                    {!hidePayrollSection && showPayrollSection && (
                        <div className={cn('rounded-xl border border-border/60 bg-muted/10 overflow-hidden transition-all', isColumns && 'sm:col-span-3')}>
                            <SectionHeader
                                collapsible={!isColumns}
                                open={sectionsOpen.variance}
                                controls={`${sectionIdBase}-variance`}
                                onToggle={() => setExpandedSections(prev => ({ ...prev, variance: !prev.variance }))}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-base font-black text-foreground">Variance</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!isColumns && (sectionsOpen.variance ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />)}
                                </div>
                            </SectionHeader>

                            {sectionsOpen.variance && (
                                <div id={`${sectionIdBase}-variance`} role="region" className="p-4 pt-3 border-t border-border/40">
                                    {!isShiftFinished ? (
                                        <div className="text-sm font-bold text-muted-foreground/40 italic flex items-center gap-2">
                                            <Lock className="h-3.5 w-3.5 shrink-0" />
                                            Variance is available once the shift ends
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 rounded-xl border border-border/80 bg-muted/20 dark:bg-zinc-900/60 overflow-hidden divide-x divide-border/80">
                                            {varianceRows.map((row) => {
                                                const isZero = row.delta === 0;
                                                const isNeg = row.delta != null && row.delta < 0;
                                                const color = row.delta == null
                                                    ? 'text-muted-foreground/40'
                                                    : isZero
                                                        ? 'text-muted-foreground'
                                                        : isNeg
                                                            ? 'text-red-500 dark:text-red-400'
                                                            : 'text-emerald-600 dark:text-emerald-400';
                                                const Icon = row.delta == null || isZero ? Minus : isNeg ? ArrowDownRight : ArrowUpRight;
                                                return (
                                                    <div key={row.label} className="p-3.5 min-w-0">
                                                        <span className="block text-xs font-black uppercase tracking-widest text-muted-foreground truncate">
                                                            {row.label}
                                                        </span>
                                                        <div className={cn('mt-1 text-sm font-bold tabular-nums flex items-center gap-0.5 truncate', color)}>
                                                            <Icon className="h-3.5 w-3.5 shrink-0" />
                                                            <span>{row.format(row.delta)}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Bottom Actions */}
                {(footerActions || (moveTopContentToBottom && topContent)) && (
                    <div className="pt-3 border-t border-border/40 flex items-center justify-center gap-3 w-full">
                        {moveTopContentToBottom && topContent && (
                            <div className="flex items-center gap-2 shrink-0">
                                {topContent}
                            </div>
                        )}
                        {footerActions && (
                            <div className="flex-1 w-full min-w-0 flex items-center justify-center">
                                {footerActions}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    const content = (
        <>
            {/* Optional TOP Content (e.g. Checkbox) */}
            {topContent && (
                <div className="px-4 pt-3">
                    {topContent}
                </div>
            )}

            {/* COMPACT BODY (px-4 py-3) */}
            <div className={cn("px-4 py-3 flex flex-col flex-1", isNested && "px-0 py-0")}>
                {/* BREADCRUMB */}
                {breadcrumbs}

                {/* ROLE + PRIORITY */}
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                        <h3 className="font-black text-sm text-foreground/90 tracking-tight leading-tight uppercase font-mono truncate">
                            {role}
                        </h3>
                        {employeeName && (
                            <p className="text-[9px] font-black text-primary/60 uppercase tracking-widest mt-0.5 font-mono">
                                {employeeName}
                            </p>
                        )}
                    </div>

                </div>

                {shiftData && (
                    <ShiftRuleHeader shift={shiftData} variant="compact" className="mb-2" showPayrollRules={showPayrollRules} />
                )}

                {/* TIMING BOXES */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {/* Date */}
                    <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-lg border border-border/50 backdrop-blur-sm">
                        <Calendar className="h-3 w-3 text-primary/60" />
                        <span className="text-[10px] font-black font-mono tracking-tight leading-none uppercase">{shiftDate}</span>
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-lg border border-border/50 backdrop-blur-sm">
                        <Clock className="h-3 w-3 text-primary/60" />
                        <span className="text-[10px] font-black font-mono tracking-tight leading-none uppercase">{startTime} – {endTime}</span>
                    </div>

                    {/* Clock In/Out compact */}
                    {(clockIn || clockOut) && (
                        <div className="flex items-center gap-1.5 bg-indigo-500/10 px-2 py-1 rounded-lg border border-indigo-500/20 backdrop-blur-sm">
                            <Signal className="h-3 w-3 text-indigo-500/60" />
                            <span className="text-[10px] font-black font-mono tracking-tight leading-none uppercase text-indigo-500/80">
                                {clockIn || '--:--'} – {clockOut || '--:--'}
                            </span>
                        </div>
                    )}
                </div>

                {/* BREAKS & LENGTH */}
                <div className="flex items-center gap-2 mb-3 text-[9px] tracking-widest text-muted-foreground/50 uppercase font-black">
                    <div className="flex items-center gap-1">
                        <span className="font-black font-mono">Paid {paidBreak}m · Unpaid {unpaidBreak}m</span>
                    </div>
                    <span className="text-border">|</span>
                    <span className="text-primary font-black font-mono">
                        Net Length: {(() => {
                            const h = Math.floor(netLength / 60);
                            const m = Math.round(netLength % 60);
                            return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                        })()}
                    </span>
                </div>

                {/* COUNTDOWN */}
                {timerText && (
                    <div className={cn(
                        "mb-3 px-3 py-1.5 rounded-lg text-[10px] font-black font-mono flex items-center gap-2 tracking-tight transition-colors",
                        isExpired 
                            ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" 
                            : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                    )}>
                        <Clock className="w-3 h-3" />
                        <span className="uppercase">{isExpired ? 'CLOSED' : timerText}</span>
                    </div>
                )}

                {/* STATUS INDICATORS GRID (3x2) */}
                {statusIcons && (
                    <div className="pt-3 border-t border-border/20">
                        <div className="grid grid-cols-3 gap-y-2 gap-x-1 text-center items-center">
                            {statusIcons}
                        </div>
                    </div>
                )}
            </div>

            {/* ACTION FOOTER */}
            {footerActions && (
                <div className="p-2 pt-0 w-full">
                    {footerActions}
                </div>
            )}
        </>
    );

    if (isNested) {
        return (
            <div 
                ref={ref}
                className={cn("flex flex-col h-full", className)} 
                onClick={onClick}
            >
                {content}
            </div>
        );
    }

    return (
        <div
            ref={ref}
            onClick={onClick}
            className={cn(
                "group flex flex-col overflow-hidden transition-all duration-300 h-full relative",
                isCardPast ? 'bg-slate-900/60 border-slate-700/30 grayscale-[0.85] opacity-60 saturate-50' : theme.cardBg,
                !isFlat && "rounded-[1.2rem] border border-border/50 shadow-lg",
                isFlat && "rounded-none border-none backdrop-blur-none shadow-none",
                onClick && !isFlat && !isCardPast && "cursor-pointer hover:shadow-2xl hover:translate-y-[-2px] hover:border-primary/40",
                className
            )}
        >
            {content}
        </div>
    );
});
