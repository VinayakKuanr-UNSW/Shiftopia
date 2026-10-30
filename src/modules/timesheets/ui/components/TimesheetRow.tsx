/* ------------------------------------------------------------------
   TimesheetRow.tsx - Migrated to new module
------------------------------------------------------------------- */

import { tableTokens } from '@/modules/core/ui/primitives/table';
import React, { useState, useMemo } from "react";
import {
    CheckCircle,
    XCircle,
    Save,
    X,
    AlertTriangle,
    MessageSquare,
    UserX,
    Lock,
    Pencil,
    Clock,
    User,
    Bot,
    TrendingUp,
} from "lucide-react";


import { cn } from "@/modules/core/lib/utils";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import type { TimesheetRow as TimesheetRowType } from "../../model/timesheet.types";
import { calculateHoursBetween, formatHours, formatDifferential, isShiftFinished, timesheetEntryToShiftInput } from "./TimesheetTable.utils";
import { getTimeRule, getLiveRuleBadges, getPayrollRuleBadges, isTimesheetReviewable } from "@/modules/rosters/domain/shift-ui";
import { validateBillableEdit, parseHHMM } from "../../domain/billable-edit";
import { ARRIVAL_VARIANCE_REASONS, DEPARTURE_VARIANCE_REASONS, VARIANCE_GRACE_MIN } from '../../domain/variance-reasons';
import { getShiftDayType } from "@/modules/core/lib/holidays";
import { resolvePaymentMinEngagementMinutes } from '@/modules/rosters/domain/projections/utils/cost/min-engagement-floor';

/* Billable-time provenance icons (F16) — explicit iconography, not a bare `*`. */
type BillableSource = 'manual' | 'snapped' | 'auto' | null | undefined;
const BILLABLE_SOURCE_META = {
    manual: { Icon: User, cls: 'text-indigo-600 dark:text-indigo-400', label: 'Manager adjusted' },
    snapped: { Icon: Clock, cls: 'text-sky-600 dark:text-sky-400', label: 'Snapped to nearest 15 min' },
    auto: { Icon: Bot, cls: 'text-amber-600 dark:text-amber-400', label: 'Auto clock-out (needs review)' },
} as const;

const BillableSourceIcon: React.FC<{
    source: BillableSource;
    hasValue: boolean;
    varianceReason?: string | null;
    labelPrefix?: string;
}> = ({ source, hasValue, varianceReason, labelPrefix }) => {
    const effectiveSource = source || (varianceReason ? 'manual' : null);
    if (!effectiveSource || (effectiveSource !== 'auto' && !hasValue && !varianceReason)) return null;
    const meta = BILLABLE_SOURCE_META[effectiveSource] ?? BILLABLE_SOURCE_META.manual;
    const { Icon, cls } = meta;
    const label = labelPrefix ? `${labelPrefix}: ${meta.label}` : meta.label;
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={cn('inline-flex shrink-0', cls)} aria-label={label}>
                        <Icon className="h-3 w-3" />
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px]">{label}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

interface TimesheetRowProps {
    entry: TimesheetRowType;
    readOnly?: boolean;
    isSelected?: boolean;
    onToggleSelect?: () => void;
    onSave?: (id: string, updates: Partial<TimesheetRowType>) => void;
    onMarkNoShow?: (id: string) => void;
    showDate?: boolean;
}

export const TimesheetRow: React.FC<TimesheetRowProps> = ({
    entry,
    readOnly = false,
    isSelected = false,
    onToggleSelect,
    onSave,
    onMarkNoShow,
    showDate = false,
}) => {
    /* -- state -------------------------------------------------- */
    const [isEditingAdjusted, setIsEditingAdjusted] = useState(false);
    const [timingError, setTimingError] = useState('');

    // Approve flow
    const [warningsOpen, setWarningsOpen] = useState(false);
    const [overrideReason, setOverrideReason] = useState('');

    // Reject flow — requires a reason
    const [rejectOpen, setRejectOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState('');

    // Billable variance-reason flow — required when a manager edits billable
    // times beyond the ±grace vs roster (arrival and/or departure).
    const [varianceOpen, setVarianceOpen] = useState(false);
    const [pendingSave, setPendingSave] = useState<
        null | { payload: Record<string, any>; needArrival: boolean; needDeparture: boolean }
    >(null);
    const [arrivalReason, setArrivalReason] = useState('');
    const [departureReason, setDepartureReason] = useState('');

    const { toast } = useToast();

    // Decision is finalized — no more edits allowed
    const isFinalized = useMemo(() => {
        const tsStatus = (entry.timesheetStatus || '').toLowerCase();
        return ['approved', 'verified', 'auto_approved', 'rejected', 'finalized'].includes(tsStatus);
    }, [entry.timesheetStatus]);

    const [editedAdjusted, setEditedAdjusted] = useState({
        adjustedStart: entry.adjustedStart || "",
        adjustedEnd: entry.adjustedEnd || "",
        paidBreak: entry.paidBreak || "0",
        unpaidBreak: entry.unpaidBreak || "0",
        actualBreakStart: entry.actualBreakStart || "",
        actualBreakEnd: entry.actualBreakEnd || "",
    });
    // Snapshot of the editor prefill — only sides the manager actually CHANGED
    // are persisted (and thus become manual/`*`). Saving an untouched side
    // would silently convert its snapped/auto value into a manual override.
    const [initialEdit, setInitialEdit] = useState({ adjustedStart: "", adjustedEnd: "" });

    // Shift physically over (used to gate the "Mark No-Show" affordance).
    const isShiftOver = useMemo(() =>
        isShiftFinished(entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut),
    [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut]);



    // Single shared projection — keeps row, mobile card, and bulk-select gating
    // derived from the exact same ShiftDotInput (incl. per-side manual signals).
    const shiftInput = useMemo(() => timesheetEntryToShiftInput(entry), [entry]);

    const timeRuleBadge = useMemo(() => getTimeRule(shiftInput), [shiftInput]);
    const liveRuleBadges = useMemo(() => getLiveRuleBadges(shiftInput), [shiftInput]);
    const payrollRuleBadges = useMemo(() => getPayrollRuleBadges(shiftInput), [shiftInput]);

    // Manager review gate: approve / reject / edit are only allowed once the
    // shift reaches a terminal attendance state — No-Show, a recorded clock-out,
    // or an auto clock-out. Everything else (in progress, Missing, Working
    // Overtime) stays locked. Supersedes the looser "scheduled end passed" gate.
    const isReviewable = useMemo(() => isTimesheetReviewable(shiftInput), [shiftInput]);
    // Approve / reject / edit are locked until the shift is reviewable.
    const reviewLocked = !isReviewable;

    // Attendance warnings — drives the approval modal
    const warnings = useMemo(() => {
        const list: { text: string; severity: 'error' | 'warning' }[] = [];
        if (!isReviewable) {
            list.push({ text: 'Shift has not reached a final attendance state — review unlocks after a clock-out, auto clock-out, or no-show', severity: 'error' });
        }
        if (entry.attendanceStatus === 'no_show') {
            list.push({ text: 'Employee was marked as no-show for this shift', severity: 'error' });
        }
        const isActiveOrComplete = entry.liveStatus === 'InProgress' || entry.liveStatus === 'Completed';
        const noCheckIn = !entry.clockIn || entry.clockIn === '-';
        // Missing check-in on an active/completed shift is an error — requires override reason
        if (noCheckIn && isActiveOrComplete && entry.attendanceStatus !== 'no_show') {
            list.push({ text: 'No clock-in recorded — cannot verify attendance', severity: 'error' });
        }
        if (entry.varianceMinutes != null && entry.varianceMinutes > 15) {
            list.push({ text: `Late arrival: ${entry.varianceMinutes} min after scheduled start`, severity: 'warning' });
        }
        const noCheckOut = !entry.clockOut || entry.clockOut === '-';
        if (noCheckOut && entry.liveStatus === 'Completed' && !noCheckIn) {
            list.push({ text: 'No clock-out recorded — auto clock-out may have been applied', severity: 'warning' });
        }
        return list;
    }, [entry, reviewLocked]);

    const requiresReason = warnings.some(w => w.severity === 'error') && !reviewLocked;

    // Auto-calculate Length and Net Length when editing
    const calculatedValues = useMemo(() => {
        const start = editedAdjusted.adjustedStart;
        const end = editedAdjusted.adjustedEnd;
        const unpaidBreak = parseFloat(editedAdjusted.unpaidBreak) || 0;
        const length = calculateHoursBetween(start, end);
        const netLength = Math.max(0, length - (unpaidBreak / 60));
        const scheduledHours = calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd);
        const differential = length - scheduledHours;
        return {
            length: formatHours(length),
            netLength: formatHours(netLength),
            differential: formatDifferential(differential),
        };
    }, [editedAdjusted, entry.scheduledStart, entry.scheduledEnd]);

    // Calculate display values for non-edit mode
    const displayValues = useMemo(() => {
        if (entry.attendanceStatus === 'no_show') {
            return {
                length: '0.00',
                netLength: '0.00',
                differential: formatDifferential(0 - calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd)),
            };
        }
        if (!entry.adjustedStart || !entry.adjustedEnd) {
            return {
                length: '0.00',
                netLength: '0.00',
                differential: formatDifferential(0 - calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd)),
            };
        }
        const length = calculateHoursBetween(entry.adjustedStart, entry.adjustedEnd);
        const unpaidBreak = parseFloat(entry.unpaidBreak) || 0;
        const netLength = Math.max(0, length - (unpaidBreak / 60));
        const scheduledHours = calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd);
        const differential = length - scheduledHours;
        return {
            length: formatHours(length),
            netLength: formatHours(netLength),
            differential: formatDifferential(differential),
        };
    }, [entry]);

    /* -- handlers ---------------------------------------------- */

    // Approve
    const doApprove = () => {
        const approvePayload: Record<string, any> = {
            timesheetStatus: 'approved',
            ...(overrideReason.trim() ? { notes: overrideReason.trim() } : {}),
        };

        onSave?.(String(entry.id), approvePayload as any);
        toast({ title: 'Timesheet Approved', description: `Timesheet for ${entry.employee} approved.` });
        setWarningsOpen(false);
        setOverrideReason('');
    };

    const handleApprove = () => {
        const status = entry.timesheetStatus?.toLowerCase();
        if (status !== 'submitted' && status !== 'draft') return;
        if (entry.attendanceStatus === 'no_show') {
            toast({
                title: 'Cannot Approve',
                description: 'Shift is marked as No-Show. Marks as approved is only for worked shifts.',
                variant: 'destructive',
            });
            return;
        }
        if (warnings.length > 0) { setWarningsOpen(true); return; }
        doApprove();
    };

    // Reject — always prompt for reason so employees can understand the decision
    const doReject = () => {
        if (!rejectReason.trim()) return;
        onSave?.(String(entry.id), {
            timesheetStatus: 'rejected',
            ...({ rejectedReason: rejectReason.trim() } as any),
        } as any);
        toast({ title: 'Timesheet Rejected', description: `Timesheet for ${entry.employee} rejected.` });
        setRejectOpen(false);
        setRejectReason('');
    };

    const handleReject = () => {
        const status = entry.timesheetStatus?.toLowerCase();
        if (status !== 'submitted' && status !== 'draft') return;
        if (reviewLocked) {
            toast({
                title: 'Cannot Reject Yet',
                description: 'Review unlocks once the shift ends with a clock-out, an auto clock-out, or a no-show.',
                variant: 'destructive',
            });
            return;
        }
        setRejectOpen(true);
    };

    /**
     * Validate the edit fields (shared rules) and build the save payload. Returns
     * null (and surfaces `timingError` + a toast) on failure; otherwise the
     * payload plus which sides need a variance reason.
     */
    const buildAndValidate = ():
        | { payload: Record<string, any>; needArrival: boolean; needDeparture: boolean }
        | null => {
        // EBA minimum-engagement PAYMENT floor (F-locked 2026-07-28): a manager
        // cannot save billable times netting less than the statutory minimum
        // for this shift — same employment-type-aware resolver the cost engine
        // and payroll adapter use (Full-Time gets no floor at all). Applies
        // even on a no-show/cancelled-flagged entry — a manager entering a
        // manual billable override there is choosing to pay for real time, and
        // that window must still meet the guarantee (only a BLANK edit, which
        // validateBillableEdit already skips the check for, means "no billable
        // time at all").
        const { isSunday, isPublicHoliday } = getShiftDayType(String(entry.date));
        const requiredMinutes = resolvePaymentMinEngagementMinutes({
            isTraining: !!entry.isTraining,
            isSunday,
            isPublicHoliday,
            employmentType: entry.employmentType,
            isSecurityRole: entry.isSecurityRole,
        }) ?? undefined;

        const v = validateBillableEdit({
            editedStart: editedAdjusted.adjustedStart,
            editedEnd: editedAdjusted.adjustedEnd,
            initialStart: initialEdit.adjustedStart,
            initialEnd: initialEdit.adjustedEnd,
            scheduledStart: entry.scheduledStart,
            scheduledEnd: entry.scheduledEnd,
            unpaidBreakMinutes: parseFloat(editedAdjusted.unpaidBreak) || 0,
            requiredMinutes,
            actualBreakStart: editedAdjusted.actualBreakStart || null,
            actualBreakEnd: editedAdjusted.actualBreakEnd || null,
            rosteredBreakStart: entry.rosteredBreakStart || null,
            rosteredBreakEnd: entry.rosteredBreakEnd || null,
        });
        if (!v.ok) {
            setTimingError(v.error!);
            toast({ title: 'Check the edit', description: v.error!, variant: 'destructive' });
            return null;
        }
        setTimingError('');

        const { normalizedStart: adjustedStart, normalizedEnd: adjustedEnd, startChanged, endChanged, needArrivalReason: needArrival, needDepartureReason: needDeparture } = v;

        // Persist ONLY the sides the manager changed — an untouched side keeps
        // its snapped/auto provenance and must not become a manual override.
        const payload: Record<string, any> = {
            ...(startChanged ? { adjustedStart } : {}),
            ...(endChanged ? { adjustedEnd } : {}),
            paidBreak: editedAdjusted.paidBreak,
            unpaidBreak: editedAdjusted.unpaidBreak,
            actualBreakStart: v.normalizedBreakStart || null,
            actualBreakEnd: v.normalizedBreakEnd || null,
            length: calculatedValues.length,
            netLength: calculatedValues.netLength,
            differential: calculatedValues.differential,
        };
        // A changed side that's back on-roster clears any stale reason.
        if (startChanged && !needArrival) payload.arrivalVarianceReason = null;
        if (endChanged && !needDeparture) payload.departureVarianceReason = null;

        return { payload, needArrival, needDeparture };
    };

    const handleSaveAdjusted = () => {
        const result = buildAndValidate();
        if (!result) return;
        const { payload, needArrival, needDeparture } = result;

        // Variance from roster on either side → require a reason first.
        if (needArrival || needDeparture) {
            setArrivalReason(needArrival ? entry.arrivalVarianceReason || '' : '');
            setDepartureReason(needDeparture ? entry.departureVarianceReason || '' : '');
            setPendingSave({ payload, needArrival, needDeparture });
            setVarianceOpen(true);
            return;
        }

        onSave?.(String(entry.id), payload as any);
        toast({ title: 'Adjusted Values Saved', description: 'Timesheet adjustments updated.' });
        setIsEditingAdjusted(false);
    };

    const confirmVarianceSave = () => {
        if (!pendingSave) return;
        const { payload, needArrival, needDeparture } = pendingSave;
        if ((needArrival && !arrivalReason) || (needDeparture && !departureReason)) return; // required
        onSave?.(String(entry.id), {
            ...payload,
            ...(needArrival ? { arrivalVarianceReason: arrivalReason } : {}),
            ...(needDeparture ? { departureVarianceReason: departureReason } : {}),
        } as any);
        const isApproval = payload.timesheetStatus === 'approved';
        toast({
            title: isApproval ? 'Timesheet Approved' : 'Adjusted Values Saved',
            description: isApproval
                ? `Timesheet for ${entry.employee} approved with variance reasons.`
                : 'Timesheet adjustments updated with variance reasons.',
        });
        setVarianceOpen(false);
        setPendingSave(null);
        setIsEditingAdjusted(false);
        setOverrideReason('');
    };

    const handleCancelEdit = () => {
        setEditedAdjusted({
            adjustedStart: entry.adjustedStart || "",
            adjustedEnd: entry.adjustedEnd || "",
            paidBreak: entry.paidBreak || "0",
            unpaidBreak: entry.unpaidBreak || "0",
            actualBreakStart: entry.actualBreakStart || "",
            actualBreakEnd: entry.actualBreakEnd || "",
        });
        setTimingError('');
        setIsEditingAdjusted(false);
    };

    const handleAdjustedCellClick = () => {
        if (reviewLocked) {
            toast({
                title: 'Cannot Edit Yet',
                description: 'Billable times can only be edited once the shift ends with a clock-out, an auto clock-out, or a no-show.',
                variant: 'destructive',
            });
            return;
        }
        if (!readOnly && !isFinalized && !isEditingAdjusted && entry.liveStatus !== 'Cancelled') {
            const prefill = {
                adjustedStart: entry.adjustedStart || entry.scheduledStart || "",
                adjustedEnd: entry.adjustedEnd || entry.scheduledEnd || "",
            };
            setEditedAdjusted({
                ...prefill,
                paidBreak: entry.paidBreak || "0",
                unpaidBreak: entry.unpaidBreak || "0",
                actualBreakStart: entry.actualBreakStart || "",
                actualBreakEnd: entry.actualBreakEnd || "",
            });
            setInitialEdit(prefill);
            setIsEditingAdjusted(true);
        }
    };

    const getDifferentialColor = (diff: string) => {
        if (!diff || diff === '-' || diff === '0.00' || diff === '0.00 h') return 'text-muted-foreground/60';
        if (diff.startsWith('+')) return 'text-green-500';
        if (diff.startsWith('-')) return 'text-red-500';
        return 'text-muted-foreground/60';
    };

    // Notes from prior actions (override reason or rejection reason)
    const actionNote = (entry as any).notes || (entry as any).rejectedReason;

    /* -- render ------------------------------------------------ */
    const cellClass = cn(tableTokens.cell, "px-3 whitespace-nowrap");

    return (
        <>{/* TimesheetRow.tsx */}
            <tr className={cn(
            tableTokens.row, "group",
            entry.attendanceStatus === 'no_show' && "bg-red-500/5 hover:bg-red-500/10",
        )}>
                {/* Select */}
                <td className={`${cellClass} text-center border-r border-border/30`}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={onToggleSelect}
                        className="rounded border-border bg-background focus:ring-primary h-4 w-4 transition-all"
                        disabled={
                            (entry.timesheetStatus !== 'SUBMITTED' && entry.timesheetStatus !== 'DRAFT') ||
                            reviewLocked
                        }
                    />
                </td>
 
                {/* Date column (Optional) */}
                {showDate && (
                    <td className={`${cellClass} font-semibold text-primary border-r border-border/30`}>
                        {String(entry.date)}
                    </td>
                )}

                {/* Employee Info */}
                <td className={`${cellClass} max-w-[96px] truncate font-mono text-muted-foreground`} title={String(entry.employeeId)}>{entry.employeeId}</td>
                <td className={`${cellClass} font-semibold text-foreground border-r border-border/30`}>{entry.employee}</td>

                {/* Hierarchy */}
                <td className={cellClass}>{entry.group}</td>
                <td className={cellClass}>{entry.subGroup}</td>
                <td className={cellClass}>{entry.role}</td>
                <td className={`${cellClass} border-r border-border/30`}>
                    {entry.remunerationLevel && !entry.remunerationLevel.toLowerCase().includes('team lead') && !entry.remunerationLevel.toLowerCase().includes('operational control') && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-black uppercase bg-primary/10 text-primary border border-primary/20 shadow-sm">
                            {entry.remunerationLevel}
                        </span>
                    )}
                </td>

                {/* Scheduled — always first to match header order */}
                <td className={cellClass}>{entry.scheduledStart}</td>
                <td className={`${cellClass} border-r border-border/30`}>{entry.scheduledEnd}</td>

                {/* Clock (Actual) */}
                <td className={cellClass}>
                    <div className="flex flex-col">
                        <span className="font-bold">{entry.clockIn || '-'}</span>
                        {entry.varianceMinutes !== null && entry.varianceMinutes !== undefined && (
                            <span className={cn(
                                "text-[11px] font-black uppercase tracking-tighter",
                                entry.varianceMinutes > 5 ? "text-amber-500" : entry.varianceMinutes < -5 ? "text-emerald-500" : "text-muted-foreground/40"
                            )}>
                                {entry.varianceMinutes > 0 ? `+${entry.varianceMinutes}m` : `${entry.varianceMinutes}m`}
                            </span>
                        )}
                        {/* Missing check-in badge */}
                        {(!entry.clockIn || entry.clockIn === '-') &&
                            (entry.liveStatus === 'InProgress' || entry.liveStatus === 'Completed') && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 w-fit border border-red-500/20">
                                <AlertTriangle className="h-2.5 w-2.5" />Missing
                            </span>
                        )}
                    </div>
                </td>
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className="flex flex-col gap-0.5">
                        <span className="font-bold">{entry.clockOut || '-'}</span>
                        {entry.clockOutVarianceMinutes !== null && entry.clockOutVarianceMinutes !== undefined && (
                            <span className={cn(
                                "text-[11px] font-black uppercase tracking-tighter",
                                entry.clockOutVarianceMinutes > 5 ? "text-amber-500" : entry.clockOutVarianceMinutes < -5 ? "text-emerald-500" : "text-muted-foreground/40"
                            )}>
                                {entry.clockOutVarianceMinutes > 0 ? `+${entry.clockOutVarianceMinutes}m` : `${entry.clockOutVarianceMinutes}m`}
                            </span>
                        )}
                        {/* Missing check-out badge — shown when a completed/in-progress shift has no clock-out */}
                        {(!entry.clockOut || entry.clockOut === '-') &&
                            (entry.liveStatus === 'Completed') && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 w-fit border border-red-500/20">
                                <AlertTriangle className="h-2.5 w-2.5" />Missing
                            </span>
                        )}
                    </div>
                </td>

                {/* Adjusted (Inline Editable) */}
                {isEditingAdjusted ? (
                    <>
                        <td className={`${cellClass} ${timingError ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedStart}
                                onChange={(e) => { setEditedAdjusted({ ...editedAdjusted, adjustedStart: e.target.value }); setTimingError(''); }}
                                className={cn("bg-background border rounded-lg px-2 py-1 w-24 text-[11px] font-black shadow-sm", timingError ? "border-red-500/50" : "border-primary/30")}
                            />
                        </td>
                        <td className={`${cellClass} ${timingError ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedEnd}
                                onChange={(e) => { setEditedAdjusted({ ...editedAdjusted, adjustedEnd: e.target.value }); setTimingError(''); }}
                                className={cn("bg-background border rounded-lg px-2 py-1 w-24 text-[11px] font-black shadow-sm", timingError ? "border-red-500/50" : "border-primary/30")}
                            />
                            {timingError && <p className="text-[11px] text-red-500 mt-0.5 font-bold">{timingError}</p>}
                        </td>
                        <td className={`${cellClass} bg-primary/10 border-r border-border/30`}>
                            <div className="flex flex-col">
                                <span className="font-black text-primary">{calculatedValues.length}</span>
                                <span className="text-[11px] font-black uppercase text-muted-foreground tracking-widest leading-none">Auto</span>
                            </div>
                        </td>
                        <td className={`${cellClass} bg-primary/5`}>
                            <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={editedAdjusted.paidBreak}
                                onChange={(e) => setEditedAdjusted({ ...editedAdjusted, paidBreak: e.target.value })}
                                className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-16 text-[11px] font-black shadow-sm"
                            />
                        </td>
                        <td className={`${cellClass} bg-primary/5`}>
                            <div className="flex flex-col gap-1">
                                <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    value={editedAdjusted.unpaidBreak}
                                    onChange={(e) => setEditedAdjusted({ ...editedAdjusted, unpaidBreak: e.target.value })}
                                    className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-16 text-[11px] font-black shadow-sm"
                                    title="Unpaid break minutes"
                                />
                                <div className="flex items-center gap-1">
                                    <input
                                        type="text"
                                        placeholder="Start"
                                        value={editedAdjusted.actualBreakStart}
                                        onChange={(e) => {
                                            const start = e.target.value;
                                            const updated = { ...editedAdjusted, actualBreakStart: start };
                                            if (start && editedAdjusted.actualBreakEnd) {
                                                const s = parseHHMM(start);
                                                const end = parseHHMM(editedAdjusted.actualBreakEnd);
                                                if (s !== null && end !== null) {
                                                    const dur = end <= s ? end + 1440 - s : end - s;
                                                    // Sch 3 §3.2(a)/§5.3(a): a Security meal break is paid.
                                                    updated.unpaidBreak = entry.isSecurityRole ? '0' : String(dur);
                                                }
                                            }
                                            setEditedAdjusted(updated);
                                        }}
                                        className="bg-background border border-primary/30 rounded px-1 py-0.5 w-14 text-[11px] font-mono shadow-sm"
                                        title="Actual break start (HH:MM)"
                                    />
                                    <span className="text-[11px] text-muted-foreground">-</span>
                                    <input
                                        type="text"
                                        placeholder="End"
                                        value={editedAdjusted.actualBreakEnd}
                                        onChange={(e) => {
                                            const end = e.target.value;
                                            const updated = { ...editedAdjusted, actualBreakEnd: end };
                                            if (editedAdjusted.actualBreakStart && end) {
                                                const s = parseHHMM(editedAdjusted.actualBreakStart);
                                                const endM = parseHHMM(end);
                                                if (s !== null && endM !== null) {
                                                    const dur = endM <= s ? endM + 1440 - s : endM - s;
                                                    // Sch 3 §3.2(a)/§5.3(a): a Security meal break is paid.
                                                    updated.unpaidBreak = entry.isSecurityRole ? '0' : String(dur);
                                                }
                                            }
                                            setEditedAdjusted(updated);
                                        }}
                                        className="bg-background border border-primary/30 rounded px-1 py-0.5 w-14 text-[11px] font-mono shadow-sm"
                                        title="Actual break end (HH:MM)"
                                    />
                                </div>
                            </div>
                        </td>
                        <td className={`${cellClass} bg-primary/10 border-r border-border/30`}>
                            <div className="flex flex-col">
                                <span className={cn(
                                    "font-black",
                                    calculatedValues.netLength === '0.00' ? "text-muted-foreground/40" : "text-primary"
                                )}>
                                    {calculatedValues.netLength}
                                </span>
                                <span className="text-[11px] font-black uppercase text-muted-foreground/30 tracking-widest leading-none">Preview</span>
                            </div>
                        </td>
                    </>
                ) : (
                    <>
                        <td className={cn(
                            cellClass,
                            "font-medium text-foreground/80",
                            (!entry.adjustedStart || entry.adjustedStart === '-') && "bg-muted/5"
                        )}>
                            <div className="flex items-center gap-1">
                                {readOnly && <Lock className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />}
                                <span className={cn(
                                    "font-bold",
                                    entry.adjustedStartSource === 'manual' ? "text-indigo-600 dark:text-indigo-400" :
                                    entry.adjustedStartSource === 'snapped' ? "text-sky-600 dark:text-sky-400" :
                                    entry.adjustedStartSource === 'auto' ? "text-amber-600 dark:text-amber-400" :
                                    "text-muted-foreground/30 italic font-medium"
                                )}>
                                    {entry.adjustedStart || '-'}
                                </span>
                                <BillableSourceIcon
                                    source={entry.adjustedStartSource}
                                    hasValue={!!entry.adjustedStart}
                                    varianceReason={entry.arrivalVarianceReason}
                                    labelPrefix="Arrival"
                                />
                            </div>
                        </td>
                        {/* Adjusted End — color coded by source */}
                        <td className={cn(
                            cellClass,
                            "font-medium text-foreground/80",
                            (!entry.adjustedEnd || entry.adjustedEnd === '-') && "bg-muted/5"
                        )}>
                            <div className="flex items-center gap-1">
                                {readOnly && <Lock className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />}
                                <span className={cn(
                                    "font-bold",
                                    entry.adjustedEndSource === 'manual' ? "text-indigo-600 dark:text-indigo-400" :
                                    entry.adjustedEndSource === 'snapped' ? "text-sky-600 dark:text-sky-400" :
                                    entry.adjustedEndSource === 'auto' ? "text-amber-600 dark:text-amber-400" :
                                    "text-muted-foreground/30 italic font-medium"
                                )}>
                                    {entry.adjustedEnd || '-'}
                                </span>
                                <BillableSourceIcon
                                    source={entry.adjustedEndSource}
                                    hasValue={!!entry.adjustedEnd}
                                    varianceReason={entry.departureVarianceReason}
                                    labelPrefix="Departure"
                                />
                            </div>
                        </td>
                        <td className={`${cellClass} font-black text-foreground border-r border-border/30`}>
                            {displayValues.length}
                        </td>
                        <td className={cn(cellClass, "font-medium text-foreground/80")}>
                            {entry.paidBreak || '0'}
                        </td>
                        <td className={cn(cellClass, "font-medium text-foreground/80")}>
                            <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                    <span>{entry.unpaidBreak || '0'}</span>
                                    {entry.actualBreakStart && entry.actualBreakEnd && (
                                        <span className="text-[11px] font-mono text-muted-foreground/60">
                                            ({entry.actualBreakStart}–{entry.actualBreakEnd})
                                        </span>
                                    )}
                                </div>
                                {entry.hasBreakVarianceFlag && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 w-fit border border-amber-500/20 cursor-default">
                                                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                                    {entry.breakVarianceMinutes != null ? `±${entry.breakVarianceMinutes}m` : '>15m dev'}
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>Actual break ({entry.actualBreakStart}–{entry.actualBreakEnd}) deviates {entry.breakVarianceMinutes != null ? `${entry.breakVarianceMinutes}m` : '>15m'} from rostered break ({entry.rosteredBreakStart || '-'}–{entry.rosteredBreakEnd || '-'}). Manager review required.</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </td>
                        <td className={`${cellClass} font-black text-foreground border-r border-border/30`}>
                            {displayValues.netLength}
                        </td>
                    </>
                )}

                {/* Differential */}
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className={`px-2 py-1 rounded-lg text-[11px] font-black text-center w-fit ${getDifferentialColor(isEditingAdjusted ? calculatedValues.differential : displayValues.differential).replace('text-', 'bg-').replace('-400', '/10 text-')}`}>
                        {isEditingAdjusted ? calculatedValues.differential : displayValues.differential}
                    </div>
                </td>


                {/* Time Rules */}
                <td className={cellClass}>
                    {timeRuleBadge && (
                        <span 
                            className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-black font-mono tracking-tight uppercase border w-fit whitespace-nowrap"
                            style={{
                                color: timeRuleBadge.color,
                                backgroundColor: `${timeRuleBadge.color}10`,
                                borderColor: `${timeRuleBadge.color}20`,
                            }}
                        >
                            {timeRuleBadge.label}
                        </span>
                    )}
                </td>
                {/* Live Rules */}
                <td className={cellClass}>
                    <div className="flex flex-col gap-1 items-start">
                        <div className="flex items-center gap-1">
                            {!!entry.editCount && entry.editCount > 0 && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-black font-mono cursor-default">
                                                <Pencil className="h-2.5 w-2.5" />
                                                {entry.editCount}
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-[11px]">
                                            {entry.editCount} manager {entry.editCount === 1 ? 'edit' : 'edits'} — see History
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                        {[liveRuleBadges.arrival, liveRuleBadges.departure].map((badge, i) => badge && (
                            <span
                                key={i}
                                className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-black font-mono tracking-tight uppercase border w-fit whitespace-nowrap"
                                style={{
                                    color: badge.color,
                                    backgroundColor: `${badge.color}10`,
                                    borderColor: `${badge.color}20`,
                                }}
                            >
                                {badge.label}
                            </span>
                        ))}
                        {/* Show action note (override/rejection reason) */}
                        {actionNote && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 cursor-default mt-0.5">
                                            <MessageSquare className="h-2.5 w-2.5 shrink-0" />
                                            <span className="truncate max-w-[80px]">{actionNote}</span>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">{actionNote}</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                </td>

                {/* Payroll Rules — billable window vs roster (what we pay) */}
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className="flex flex-col gap-1 items-start">
                        {liveRuleBadges.arrival || liveRuleBadges.departure || payrollRuleBadges.arrival || payrollRuleBadges.departure ? (
                            [payrollRuleBadges.arrival, payrollRuleBadges.departure].some(Boolean) ? (
                                [payrollRuleBadges.arrival, payrollRuleBadges.departure].map((badge, i) => badge && (
                                    <span
                                        key={i}
                                        className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-black font-mono tracking-tight uppercase border w-fit whitespace-nowrap"
                                        style={{
                                            color: badge.color,
                                            backgroundColor: `${badge.color}10`,
                                            borderColor: `${badge.color}20`,
                                        }}
                                    >
                                        {badge.label}
                                    </span>
                                ))
                            ) : (
                                <span className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider">No billable</span>
                            )
                        ) : null}
                        {entry.wasToppedUpToMinEngagement && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black font-mono tracking-tight uppercase border w-fit whitespace-nowrap cursor-default"
                                            style={{ color: '#0891B2', backgroundColor: '#0891B210', borderColor: '#0891B220' }}
                                        >
                                            <TrendingUp className="h-2.5 w-2.5" />
                                            Topped Up to Min
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs text-[11px]">
                                        Clocked hours were below the EBA minimum engagement
                                        {entry.requiredEngagementMinutes ? ` (${entry.requiredEngagementMinutes / 60}h)` : ''} for this shift —
                                        pay was automatically topped up to the guaranteed minimum.
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        {(entry.arrivalVarianceReason || entry.departureVarianceReason) && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 cursor-default mt-0.5">
                                            <MessageSquare className="h-2.5 w-2.5 shrink-0" />
                                            <span>Variance reason</span>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs text-[11px] space-y-0.5">
                                        {entry.arrivalVarianceReason && <div><strong>Arrival:</strong> {entry.arrivalVarianceReason}</div>}
                                        {entry.departureVarianceReason && <div><strong>Departure:</strong> {entry.departureVarianceReason}</div>}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                </td>

                {/* Actions */}
                <td className={`${cellClass} text-center`}>
                    <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isEditingAdjusted ? (
                            <>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={handleSaveAdjusted}
                                                className="h-8 w-8 rounded-xl text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                            >
                                                <Save size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Save Changes</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={handleCancelEdit}
                                                className="h-8 w-8 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                            >
                                                <X size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Cancel</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </>
                        ) : (
                            <>
                                {/* Edit Adjusted Times */}
                                {!readOnly && !isFinalized && entry.liveStatus !== 'Cancelled' && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleAdjustedCellClick}
                                                    disabled={reviewLocked}
                                                    className={cn(
                                                        "h-8 w-8 rounded-xl",
                                                        reviewLocked
                                                            ? "text-muted-foreground/40 cursor-not-allowed"
                                                            : "text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20"
                                                    )}
                                                >
                                                    <Pencil size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {reviewLocked ? 'Locked — unlocks after clock-out, auto clock-out, or no-show' : 'Edit adjusted times'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {/* Approve — blocked while InProgress or if No-Show */}
                                {(entry.timesheetStatus?.toLowerCase() === 'submitted' || entry.timesheetStatus?.toLowerCase() === 'draft') && entry.attendanceStatus !== 'no_show' && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleApprove}
                                                    disabled={reviewLocked}
                                                    className={cn(
                                                        "h-8 w-8 rounded-xl",
                                                        reviewLocked
                                                            ? "text-muted-foreground/40 cursor-not-allowed"
                                                            : "text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                                    )}
                                                >
                                                    <CheckCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {reviewLocked ? 'Locked — unlocks after clock-out, auto clock-out, or no-show' : 'Approve'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {/* Reject — also blocked while InProgress; always requires reason; hidden if No-Show */}
                                {(entry.timesheetStatus?.toLowerCase() === 'submitted' || entry.timesheetStatus?.toLowerCase() === 'draft') && entry.attendanceStatus !== 'no_show' && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleReject}
                                                    disabled={reviewLocked}
                                                    className={cn(
                                                        "h-8 w-8 rounded-xl",
                                                        reviewLocked
                                                            ? "text-muted-foreground/40 cursor-not-allowed"
                                                            : "text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                                    )}
                                                >
                                                    <XCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {reviewLocked ? 'Locked — unlocks after clock-out, auto clock-out, or no-show' : 'Reject'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {/* Mark as No-Show — only available when shift is over + no clocks recorded */}
                                {(!entry.clockIn || entry.clockIn === '-') && (!entry.clockOut || entry.clockOut === '-') && isShiftOver && entry.attendanceStatus !== 'no_show' && !readOnly && onMarkNoShow && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onMarkNoShow(String(entry.id))}
                                                    className="h-8 w-8 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                                >
                                                    <UserX size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Mark as No-Show</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </>
                        )}
                    </div>
                </td>
            </tr>

            {/* ── Approve warnings modal ── */}
            <Dialog open={warningsOpen} onOpenChange={open => { setWarningsOpen(open); if (!open) setOverrideReason(''); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className={cn("h-5 w-5", reviewLocked ? "text-red-500" : "text-amber-500")} />
                            {reviewLocked ? 'Approval Blocked' : 'Attendance Issues Detected'}
                        </DialogTitle>
                        <DialogDescription>
                            {reviewLocked
                                ? <>Approval for <strong>{entry.employee}</strong>'s timesheet is blocked until the shift reaches a final attendance state — a clock-out, an auto clock-out, or a no-show.</>
                                : <>Review the following issues before approving <strong>{entry.employee}</strong>'s timesheet.</>
                            }
                        </DialogDescription>
                    </DialogHeader>

                    <ul className="space-y-2 my-2">
                        {warnings.map((w, i) => (
                            <li key={i} className={cn(
                                'flex items-start gap-2 text-[13px] px-3 py-2 rounded-lg',
                                w.severity === 'error'
                                    ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
                                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20',
                            )}>
                                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                {w.text}
                            </li>
                        ))}
                    </ul>

                    {requiresReason && (
                        <div className="space-y-1.5">
                            <Label htmlFor="override-reason" className="text-[13px] font-semibold">
                                Override reason <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="override-reason"
                                placeholder="e.g. Supervisor confirmed attendance verbally…"
                                value={overrideReason}
                                onChange={e => setOverrideReason(e.target.value)}
                                className="text-[13px]"
                            />
                            <p className="text-[11px] text-muted-foreground">This reason will be saved and visible to the employee.</p>
                        </div>
                    )}

                    <DialogFooter className="gap-2 flex-wrap">
                        {!reviewLocked && (
                            <Button variant="outline" onClick={() => { setWarningsOpen(false); handleAdjustedCellClick(); }}>
                                Adjust Times
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => setWarningsOpen(false)}>
                            {reviewLocked ? 'OK' : 'Cancel'}
                        </Button>
                        {!reviewLocked && (
                            <Button
                                onClick={doApprove}
                                disabled={requiresReason && !overrideReason.trim()}
                                className="bg-green-600 hover:bg-green-700 text-white"
                            >
                                <CheckCircle className="h-4 w-4 mr-1.5" />
                                Approve Anyway
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Reject reason modal ── */}
            <Dialog open={rejectOpen} onOpenChange={open => { setRejectOpen(open); if (!open) setRejectReason(''); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <XCircle className="h-5 w-5 text-red-500" />
                            Reject Timesheet
                        </DialogTitle>
                        <DialogDescription>
                            Provide a reason for rejecting <strong>{entry.employee}</strong>'s timesheet.
                            This reason will be visible to the employee.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-1.5 my-2">
                        <Label htmlFor="reject-reason" className="text-[13px] font-semibold">
                            Rejection reason <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="reject-reason"
                            placeholder="e.g. Clock-in times do not match scheduled hours. Please review and resubmit."
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="text-[13px]"
                            rows={3}
                        />
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setRejectOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={doReject}
                            disabled={!rejectReason.trim()}
                        >
                            <XCircle className="h-4 w-4 mr-1.5" />
                            Confirm Rejection
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Billable variance reason modal ── */}
            <Dialog open={varianceOpen} onOpenChange={open => { setVarianceOpen(open); if (!open) setPendingSave(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            Billable variance — reason required
                        </DialogTitle>
                        <DialogDescription>
                            The billable time for <strong>{entry.employee}</strong> differs from the roster
                            by more than {VARIANCE_GRACE_MIN} minutes. Record why, so payroll and audit have it.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 my-2">
                        {pendingSave?.needArrival && (
                            <div className="space-y-1.5">
                                <Label htmlFor="arrival-variance" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Arrival variance reason <span className="text-red-500">*</span>
                                </Label>
                                <Select value={arrivalReason} onValueChange={setArrivalReason}>
                                    <SelectTrigger id="arrival-variance" className="h-11 rounded-xl border border-border bg-muted/20 text-[13px] font-semibold text-foreground">
                                        <SelectValue placeholder="Select a reason…" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl z-[999] max-h-60 overflow-y-auto">
                                        {ARRIVAL_VARIANCE_REASONS.map(r => (
                                            <SelectItem key={r} value={r} className="rounded-xl py-2.5 text-[11px] font-semibold cursor-pointer">
                                                {r}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        {pendingSave?.needDeparture && (
                            <div className="space-y-1.5">
                                <Label htmlFor="departure-variance" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Departure variance reason <span className="text-red-500">*</span>
                                </Label>
                                <Select value={departureReason} onValueChange={setDepartureReason}>
                                    <SelectTrigger id="departure-variance" className="h-11 rounded-xl border border-border bg-muted/20 text-[13px] font-semibold text-foreground">
                                        <SelectValue placeholder="Select a reason…" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl z-[999] max-h-60 overflow-y-auto">
                                        {DEPARTURE_VARIANCE_REASONS.map(r => (
                                            <SelectItem key={r} value={r} className="rounded-xl py-2.5 text-[11px] font-semibold cursor-pointer">
                                                {r}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => { setVarianceOpen(false); setPendingSave(null); }}>
                            Cancel
                        </Button>
                        <Button
                            onClick={confirmVarianceSave}
                            disabled={(!!pendingSave?.needArrival && !arrivalReason) || (!!pendingSave?.needDeparture && !departureReason)}
                        >
                            <Save className="h-4 w-4 mr-1.5" />
                            Save with reason
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
