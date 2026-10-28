import React, { useState, useMemo, forwardRef } from 'react';
import {
    UserX,
    CheckSquare,
    Check,
    X,
    AlertTriangle,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import type { TimesheetRow } from '../../model/timesheet.types';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { resolveGroupVariant } from '@/modules/rosters/domain/shift-ui';
import { isShiftFinished, isEntryReviewable, cleanTime, calculateHoursBetween } from './TimesheetTable.utils';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { buildOrdinaryEarningsLines } from '@/modules/payroll/domain/computeShiftGrossPay';
import { ARRIVAL_VARIANCE_REASONS, DEPARTURE_VARIANCE_REASONS, VARIANCE_GRACE_MIN } from '../../domain/variance-reasons';
import { validateBillableEdit, parseHHMM } from '../../domain/billable-edit';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { resolvePaymentMinEngagementMinutes } from '@/modules/rosters/domain/projections/utils/cost/min-engagement-floor';
import { formatClockTime } from '@/modules/core/lib/date.utils';

interface TimesheetMobileCardProps {
    entry: TimesheetRow;
    isSelected: boolean;
    isSelectMode: boolean;
    onToggleSelect: () => void;
    onSave?: (id: string, updates: Partial<TimesheetRow>) => void;
    onMarkNoShow?: (id: string) => void;
    readOnly?: boolean;
    isManager?: boolean;
    employeeHeader?: React.ReactNode;
    employeeActions?: React.ReactNode;
    useGroupColoring?: boolean;
    className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────


/**
 * Sydney-pinned, via the shared formatter.
 *
 * This used `new Date(t).getHours()` — the BROWSER's timezone. Correct in
 * Sydney by coincidence and wrong for every other viewer, which is exactly the
 * kind of bug no local dev ever sees.
 */
function formatTime(t: string | null | undefined): string {
    return formatClockTime(t, 'h:mm a', '—') ?? '—';
}


// ─── Main Component ──────────────────────────────────────────────────────────

export const TimesheetMobileCard = forwardRef<HTMLDivElement, TimesheetMobileCardProps>(({
    entry,
    isSelected,
    isSelectMode,
    onToggleSelect,
    onSave,
    onMarkNoShow,
    readOnly = false,
    isManager = true,
    employeeHeader,
    employeeActions,
    useGroupColoring = false,
    className,
}, ref) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localAdjStart, setLocalAdjStart] = useState(entry.adjustedStart || '');
    const [localAdjEnd, setLocalAdjEnd] = useState(entry.adjustedEnd || '');
    const [localPaidBreak, setLocalPaidBreak] = useState(entry.paidBreak || '0');
    const [localUnpaidBreak, setLocalUnpaidBreak] = useState(entry.unpaidBreak || '0');
    const [localActualBreakStart, setLocalActualBreakStart] = useState(entry.actualBreakStart || '');
    const [localActualBreakEnd, setLocalActualBreakEnd] = useState(entry.actualBreakEnd || '');

    // Billable variance-reason flow (mirrors the desktop row).
    const [varianceOpen, setVarianceOpen] = useState(false);
    const [pendingSave, setPendingSave] = useState<
        null | { payload: Record<string, any>; needArrival: boolean; needDeparture: boolean }
    >(null);
    const [arrivalReason, setArrivalReason] = useState('');
    const [departureReason, setDepartureReason] = useState('');

    // Estimated pay for the SCHEDULED shift (award estimate, not payroll) — shown
    // in the Scheduled section, with an itemised rate breakdown on hover. This
    // is a lightweight preview (`estimateDetailedCostFromShift`), NOT the
    // authoritative payroll calculation — the Gross Pay module is that, and
    // already resolves employmentType precisely (incl. Flexible Part-Time,
    // which this shared estimator's own regex-based mapping collapses into
    // plain Part-Time — a pre-existing, documented imprecision of the
    // "quick estimate" utility, not something this tooltip can fully correct).
    const scheduledCost = useMemo(() => {
        if (!entry.scheduledStart || !entry.scheduledEnd) return null;
        try {
            return estimateDetailedCostFromShift({
                shift_date: String(entry.date),
                start_time: entry.scheduledStart,
                end_time: entry.scheduledEnd,
                roles: { name: entry.role },
                remuneration_level: entry.remunerationLevelNumber,
                shift_pay_terms: entry.payTerms,
                employmentType: entry.employmentType,
                is_training: entry.isTraining,
                unpaid_break_minutes: parseFloat(entry.unpaidBreak) || 0,
                break_start: entry.rosteredBreakStart || undefined,
                scheduled_length_minutes: calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd) * 60,
            });
        } catch {
            return null;
        }
    }, [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.role, entry.remunerationLevelNumber, entry.payTerms, entry.employmentType, entry.isTraining, entry.unpaidBreak]);
    // A salaried shift has no per-shift pay — the salary is paid per period.
    const scheduledPay = scheduledCost
        ? (scheduledCost.payBasis === 'salary' ? 'Salaried' : `$${scheduledCost.totalCost.toFixed(2)}`)
        : null;
    const scheduledPayLines = useMemo(
        () => scheduledCost && scheduledCost.payBasis !== 'salary'
            ? buildOrdinaryEarningsLines(scheduledCost, { isSecurityRole: !!entry.isSecurityRole, shiftDate: String(entry.date), startTime: entry.scheduledStart })
            : [],
        [scheduledCost, entry.isSecurityRole, entry.date, entry.scheduledStart],
    );

    // Estimated pay for the BILLABLE window — what payroll will actually pay,
    // priced off the resolved billable start/end and the EBA-floored net
    // minutes (`entry.netLengthMinutes`, already topped up if applicable —
    // see billable-time.ts) rather than letting the estimator re-derive net
    // minutes from the raw times, so a topped-up shift prices at the floor
    // here too, not the shorter raw span. Only shown once the billable window
    // has actually resolved (mirrors "not surfaced until the shift ends").
    const billableCost = useMemo(() => {
        if (!entry.adjustedStart || !entry.adjustedEnd || entry.netLengthMinutes == null) return null;
        try {
            return estimateDetailedCostFromShift({
                shift_date: String(entry.date),
                start_time: entry.adjustedStart,
                end_time: entry.adjustedEnd,
                roles: { name: entry.role },
                remuneration_level: entry.remunerationLevelNumber,
                shift_pay_terms: entry.payTerms,
                employmentType: entry.employmentType,
                is_training: entry.isTraining,
                unpaid_break_minutes: parseFloat(entry.unpaidBreak) || 0,
                break_start: entry.actualBreakStart || entry.rosteredBreakStart || undefined,
                scheduled_length_minutes: calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd) * 60,
            }, entry.netLengthMinutes);
        } catch {
            return null;
        }
    }, [entry.date, entry.adjustedStart, entry.adjustedEnd, entry.netLengthMinutes, entry.role, entry.remunerationLevelNumber, entry.payTerms, entry.employmentType, entry.isTraining, entry.unpaidBreak, entry.scheduledStart, entry.scheduledEnd]);
    const billablePay = billableCost
        ? (billableCost.payBasis === 'salary' ? 'Salaried' : `$${billableCost.totalCost.toFixed(2)}`)
        : null;
    const billablePayLines = useMemo(
        () => billableCost && billableCost.payBasis !== 'salary'
            ? buildOrdinaryEarningsLines(billableCost, { isSecurityRole: !!entry.isSecurityRole, shiftDate: String(entry.date), startTime: entry.adjustedStart ?? undefined })
            : [],
        [billableCost, entry.isSecurityRole, entry.date, entry.adjustedStart],
    );

    const { toast } = useToast();

    const handleStartEditing = () => {
        if (reviewLocked) {
            toast({
                title: 'Cannot Edit Yet',
                description: 'Billable times unlock once the shift ends with a clock-out, an auto clock-out, or a no-show.',
                variant: 'destructive',
            });
            return;
        }
        setLocalAdjStart(entry.adjustedStart || entry.scheduledStart || '');
        setLocalAdjEnd(entry.adjustedEnd || entry.scheduledEnd || '');
        setLocalPaidBreak(entry.paidBreak || '0');
        setLocalUnpaidBreak(entry.unpaidBreak || '0');
        setLocalActualBreakStart(entry.actualBreakStart || '');
        setLocalActualBreakEnd(entry.actualBreakEnd || '');
        setIsEditing(true);
    };

    const isShiftOver = useMemo(() =>
        isShiftFinished(entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut),
    [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut]);

    // Manager review gate: approve / reject / edit unlock only once the shift
    // reaches a terminal attendance state (No-Show, clock-out, or auto clock-out).
    const reviewLocked = useMemo(() => !isEntryReviewable(entry), [entry]);

    const isPending = ['submitted', 'draft', 'pending'].includes((entry.timesheetStatus || '').toLowerCase());
    


    const isFinalized = useMemo(() => {
        const tsStatus = (entry.timesheetStatus || '').toLowerCase();
        return ['approved', 'verified', 'auto_approved', 'rejected', 'finalized'].includes(tsStatus);
    }, [entry.timesheetStatus]);

    const canAction = isManager && isPending && !readOnly && !isFinalized;
    
    const showNoShowBtn = isShiftOver && (!entry.clockIn || entry.clockIn === '-') && (!entry.clockOut || entry.clockOut === '-') && entry.attendanceStatus !== 'no_show' && !readOnly && !!onMarkNoShow && !isFinalized;




    const reviewLockedToast = () => toast({
        title: 'Locked',
        description: 'Unlocks once the shift ends with a clock-out, an auto clock-out, or a no-show.',
        variant: 'destructive',
    });

    const handleApprove = () => {
        if (!canAction) return;
        if (reviewLocked) { reviewLockedToast(); return; }
        onSave?.(String(entry.id), { timesheetStatus: 'approved' } as any);
        toast({ title: 'Approved', description: `Timesheet approved for ${entry.employee}.` });
    };

    const handleReject = () => {
        if (!canAction) return;
        if (reviewLocked) { reviewLockedToast(); return; }
        onSave?.(String(entry.id), { timesheetStatus: 'rejected' } as any);
        toast({ title: 'Rejected', description: `Timesheet rejected for ${entry.employee}.` });
    };

    const handleSaveAdjustment = () => {
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
            editedStart: localAdjStart,
            editedEnd: localAdjEnd,
            initialStart: entry.adjustedStart || '',
            initialEnd: entry.adjustedEnd || '',
            scheduledStart: entry.scheduledStart,
            scheduledEnd: entry.scheduledEnd,
            unpaidBreakMinutes: parseFloat(localUnpaidBreak) || 0,
            requiredMinutes,
            actualBreakStart: localActualBreakStart || null,
            actualBreakEnd: localActualBreakEnd || null,
            rosteredBreakStart: entry.rosteredBreakStart || null,
            rosteredBreakEnd: entry.rosteredBreakEnd || null,
        });
        if (!v.ok) {
            toast({ title: 'Check the edit', description: v.error!, variant: 'destructive' });
            return;
        }

        const payload: Record<string, any> = {
            adjustedStart: v.normalizedStart,
            adjustedEnd: v.normalizedEnd,
            paidBreak: localPaidBreak,
            unpaidBreak: localUnpaidBreak,
            actualBreakStart: v.normalizedBreakStart || null,
            actualBreakEnd: v.normalizedBreakEnd || null,
            isAdjustedManual: true,
        };
        if (v.startChanged && !v.needArrivalReason) payload.arrivalVarianceReason = null;
        if (v.endChanged && !v.needDepartureReason) payload.departureVarianceReason = null;

        if (v.needArrivalReason || v.needDepartureReason) {
            setArrivalReason(v.needArrivalReason ? entry.arrivalVarianceReason || '' : '');
            setDepartureReason(v.needDepartureReason ? entry.departureVarianceReason || '' : '');
            setPendingSave({ payload, needArrival: v.needArrivalReason, needDeparture: v.needDepartureReason });
            setVarianceOpen(true);
            return;
        }

        onSave?.(String(entry.id), payload as any);
        setIsEditing(false);
        toast({ title: 'Record Updated', description: 'Timesheet data has been updated.' });
    };

    const confirmVarianceSave = () => {
        if (!pendingSave) return;
        const { payload, needArrival, needDeparture } = pendingSave;
        if ((needArrival && !arrivalReason) || (needDeparture && !departureReason)) return;
        onSave?.(String(entry.id), {
            ...payload,
            ...(needArrival ? { arrivalVarianceReason: arrivalReason } : {}),
            ...(needDeparture ? { departureVarianceReason: departureReason } : {}),
        } as any);
        const isApproval = payload.timesheetStatus === 'approved';
        toast({
            title: isApproval ? 'Approved' : 'Record Updated',
            description: isApproval
                ? `Timesheet approved for ${entry.employee}.`
                : 'Timesheet data has been updated.',
        });
        setVarianceOpen(false);
        setPendingSave(null);
        setIsEditing(false);
    };

    return (
        <>
            <SharedShiftCard
            variant="timecard"
            identityGrid
            organization={entry.organization}
            department={entry.department}
            subDepartment={entry.subDepartment}
            group={entry.group}
            subGroup={entry.subGroup}
            role={entry.role}
            shiftDate={String(entry.date)}
            startTime={formatTime(entry.scheduledStart)}
            endTime={formatTime(entry.scheduledEnd)}
            netLength={(() => {
                if (!entry.netLength) return 0;
                const parts = entry.netLength.split(':').map(Number);
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    return parts[0] * 60 + parts[1];
                }
                return parseInt(entry.netLength, 10) || 0;
            })()}
            paidBreak={parseInt(entry.paidBreak) || 0}
            unpaidBreak={parseInt(entry.unpaidBreak) || 0}
            rosteredBreakStart={entry.rosteredBreakStart}
            rosteredBreakEnd={entry.rosteredBreakEnd}
            actualBreakStart={entry.actualBreakStart}
            actualBreakEnd={entry.actualBreakEnd}
            lifecycleStatus={entry.liveStatus}
            groupVariant={resolveGroupVariant(entry.groupType, `${entry.group} ${entry.department}`, entry.role)}
            employeeName={entry.employee}
            clockIn={formatTime(entry.clockIn)}
            clockOut={formatTime(entry.clockOut)}
            adjustedStart={formatTime(entry.adjustedStart)}
            adjustedEnd={formatTime(entry.adjustedEnd)}
            adjustedStartSource={entry.adjustedStartSource}
            adjustedEndSource={entry.adjustedEndSource}
            arrivalVarianceReason={entry.arrivalVarianceReason}
            departureVarianceReason={entry.departureVarianceReason}
            wasToppedUpToMinEngagement={entry.wasToppedUpToMinEngagement}
            requiredEngagementMinutes={entry.requiredEngagementMinutes}
            estimatedPay={scheduledPay}
            estimatedPayBreakdown={scheduledPayLines}
            billablePay={billablePay}
            billablePayBreakdown={billablePayLines}
            showPayrollRules
            timesheetStatus={entry.timesheetStatus}
            shiftData={{
                lifecycle_status: entry.liveStatus,
                timesheet_status: entry.timesheetStatus,
                assignment_outcome: entry.attendanceStatus,
                attendance_status: entry.attendanceStatus,
                attendance_note: entry.attendanceNote,
                actual_start: cleanTime(entry.rawActualStart) ?? cleanTime(entry.clockIn),
                actual_end: cleanTime(entry.rawActualEnd) ?? cleanTime(entry.clockOut),
                adjusted_start: entry.adjustedStart,
                adjusted_end: entry.adjustedEnd,
                adjusted_start_is_manual: entry.adjustedStartSource === 'manual',
                adjusted_end_is_manual: entry.adjustedEndSource === 'manual',
                adjusted_is_manual: entry.isAdjustedManual,
                adjusted_start_source: entry.adjustedStartSource,
                adjusted_end_source: entry.adjustedEndSource,
                arrival_variance_reason: entry.arrivalVarianceReason,
                departure_variance_reason: entry.departureVarianceReason,
                start_at: entry.rawStartAt,
                end_at: entry.rawEndAt,
                shift_date: entry.date,
                start_time: entry.scheduledStart,
                end_time: entry.scheduledEnd,
            }}
            topContent={
                <div className="flex items-center gap-2">
                    {entry.hasBreakVarianceFlag && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Break dev {entry.breakVarianceMinutes ? `±${entry.breakVarianceMinutes}m` : '>15m'}
                        </span>
                    )}
                    {isSelectMode && (
                        <button
                            onClick={onToggleSelect}
                            className={cn(
                                "shrink-0 h-10 w-10 rounded-xl border-2 flex items-center justify-center transition-all",
                                isSelected ? "bg-primary border-primary shadow-lg" : "border-foreground/10 bg-foreground/5"
                            )}
                        >
                            {isSelected && <CheckSquare className="w-5 h-5 text-white" />}
                        </button>
                    )}
                </div>
            }
            footerActions={
                <div className="w-full flex flex-col gap-3">
                    {isEditing ? (
                        <div className="space-y-3 w-full">
                            <div className="grid grid-cols-2 gap-2 w-full">
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[11px] font-semibold uppercase tracking-widest opacity-40">Adj In</Label>
                                    <input 
                                        value={localAdjStart} 
                                        onChange={e => setLocalAdjStart(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-[11px] text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[11px] font-semibold uppercase tracking-widest opacity-40">Adj Out</Label>
                                    <input 
                                        value={localAdjEnd} 
                                        onChange={e => setLocalAdjEnd(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-[11px] text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 w-full">
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[11px] font-semibold uppercase tracking-widest opacity-40">Paid Break</Label>
                                    <input 
                                        value={localPaidBreak} 
                                        onChange={e => setLocalPaidBreak(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-[11px] text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[11px] font-semibold uppercase tracking-widest opacity-40">Unpaid Break</Label>
                                    <input 
                                        value={localUnpaidBreak} 
                                        onChange={e => setLocalUnpaidBreak(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-[11px] text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 w-full">
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[11px] font-semibold uppercase tracking-widest opacity-40">Actual Break Start</Label>
                                    <input 
                                        value={localActualBreakStart} 
                                        onChange={e => {
                                            const val = e.target.value;
                                            setLocalActualBreakStart(val);
                                            if (val && localActualBreakEnd) {
                                                const s = parseHHMM(val);
                                                const end = parseHHMM(localActualBreakEnd);
                                                if (s !== null && end !== null) {
                                                    const dur = end <= s ? end + 1440 - s : end - s;
                                                    // Sch 3 §3.2(a)/§5.3(a): a Security meal break is paid.
                                                    setLocalUnpaidBreak(entry.isSecurityRole ? '0' : String(dur));
                                                }
                                            }
                                        }} 
                                        placeholder="HH:MM"
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-[11px] text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[11px] font-semibold uppercase tracking-widest opacity-40">Actual Break End</Label>
                                    <input 
                                        value={localActualBreakEnd} 
                                        onChange={e => {
                                            const val = e.target.value;
                                            setLocalActualBreakEnd(val);
                                            if (localActualBreakStart && val) {
                                                const s = parseHHMM(localActualBreakStart);
                                                const end = parseHHMM(val);
                                                if (s !== null && end !== null) {
                                                    const dur = end <= s ? end + 1440 - s : end - s;
                                                    // Sch 3 §3.2(a)/§5.3(a): a Security meal break is paid.
                                                    setLocalUnpaidBreak(entry.isSecurityRole ? '0' : String(dur));
                                                }
                                            }
                                        }} 
                                        placeholder="HH:MM"
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-[11px] text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-center gap-2 w-full pt-1">
                                <Button
                                    onClick={handleSaveAdjustment}
                                    className="flex-1 h-11 rounded-xl font-bold bg-primary text-primary-foreground shadow-lg active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <Check className="h-5 w-5 mr-2" /> Save
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setIsEditing(false)}
                                    className="h-11 px-4 rounded-xl border-border/50 text-foreground/40 hover:text-rose-500 hover:bg-rose-500/5 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>
                    ) : isManager ? (
                        canAction ? (
                            <div className="flex items-center justify-center gap-2 w-full">
                                <Button
                                    onClick={handleApprove}
                                    disabled={reviewLocked}
                                    title={reviewLocked ? 'Unlocks after clock-out, auto clock-out, or no-show' : undefined}
                                    className="flex-1 h-9 rounded-xl font-semibold uppercase text-[11px] tracking-widest bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 transition-all active:scale-95 px-0 shadow-none text-center"
                                >
                                    Approve
                                </Button>
                                <Button
                                    onClick={handleReject}
                                    disabled={reviewLocked}
                                    title={reviewLocked ? 'Unlocks after clock-out, auto clock-out, or no-show' : undefined}
                                    className="flex-1 h-9 rounded-xl font-semibold uppercase text-[11px] tracking-widest bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:bg-rose-500/20 disabled:opacity-30 transition-all active:scale-95 px-0 shadow-none text-center"
                                >
                                    Reject
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleStartEditing}
                                    disabled={reviewLocked}
                                    title={reviewLocked ? 'Unlocks after clock-out, auto clock-out, or no-show' : undefined}
                                    className="flex-1 h-9 rounded-xl border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[11px] font-semibold uppercase tracking-widest transition-all active:scale-95 px-0 disabled:opacity-30 text-center"
                                >
                                    Edit
                                </Button>
                                {showNoShowBtn && (
                                    <Button
                                        variant="outline"
                                        onClick={() => onMarkNoShow?.(String(entry.id))}
                                        disabled={!isShiftOver}
                                        className="flex-1 h-9 rounded-xl border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400 text-[11px] font-semibold uppercase tracking-widest disabled:opacity-30 transition-all active:scale-95 px-1 flex items-center justify-center"
                                    >
                                        <UserX className="h-3 w-3 mr-1" /> No-Show
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="w-full flex items-center justify-center gap-2">
                                <div className="flex-1 flex items-center justify-center h-9 bg-foreground/[0.04] border border-foreground/5 rounded-xl text-foreground/40 text-[11px] font-semibold uppercase tracking-widest text-center">
                                    Finalized Record
                                </div>
                                {!readOnly && (
                                    <Button
                                        variant="outline"
                                        onClick={handleStartEditing}
                                        className="h-9 px-4 rounded-xl border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[11px] font-semibold uppercase tracking-widest transition-all active:scale-95"
                                    >
                                        Edit
                                    </Button>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="w-full flex items-center justify-center">
                            {employeeActions}
                        </div>
                    )}
                </div>
            }
            className={cn(
                isSelected && 'ring-2 ring-primary/60',
                className
            )}
            ref={ref}
        />

        {/* Billable variance reason modal */}
        <Dialog open={varianceOpen} onOpenChange={open => { setVarianceOpen(open); if (!open) setPendingSave(null); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Billable variance — reason required</DialogTitle>
                    <DialogDescription>
                        The billable time for <strong>{entry.employee}</strong> differs from the roster by more than
                        {' '}{VARIANCE_GRACE_MIN} minutes. Record why, so payroll and audit have it.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 my-2">
                    {pendingSave?.needArrival && (
                        <div className="space-y-1.5">
                            <Label htmlFor="m-arrival-variance" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Arrival variance reason <span className="text-red-500">*</span>
                            </Label>
                            <Select value={arrivalReason} onValueChange={setArrivalReason}>
                                <SelectTrigger id="m-arrival-variance" className="h-11 rounded-xl border border-border bg-muted/20 text-[13px] font-semibold text-foreground">
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
                            <Label htmlFor="m-departure-variance" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Departure variance reason <span className="text-red-500">*</span>
                            </Label>
                            <Select value={departureReason} onValueChange={setDepartureReason}>
                                <SelectTrigger id="m-departure-variance" className="h-11 rounded-xl border border-border bg-muted/20 text-[13px] font-semibold text-foreground">
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
                        <Check className="h-4 w-4 mr-1.5" />
                        Save with reason
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
});
