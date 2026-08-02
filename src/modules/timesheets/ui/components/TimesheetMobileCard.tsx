import React, { useState, useMemo, forwardRef } from 'react';
import {
    UserX,
    ArrowRight,
    Edit3,
    CheckSquare,
    Check,
    X,
    RotateCcw,
} from 'lucide-react';
import { motion } from 'framer-motion';
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
import { getProtectionContext } from '@/modules/rosters/domain/shift-ui';
import { TimesheetStatusBadge } from './TimesheetStatusBadge';
import { TimesheetHistoryPopover } from './TimesheetHistoryPopover';
import { getGroupColor } from '@/modules/rosters/model/roster.types';
import type { TimesheetRow } from '../../model/timesheet.types';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { resolveGroupVariant } from '@/modules/rosters/domain/shift-ui';
import { isShiftFinished, isEntryReviewable, cleanTime, calculateHoursBetween } from './TimesheetTable.utils';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { buildOrdinaryEarningsLines } from '@/modules/payroll/domain/computeShiftGrossPay';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { ARRIVAL_VARIANCE_REASONS, DEPARTURE_VARIANCE_REASONS, VARIANCE_GRACE_MIN } from '../../domain/variance-reasons';
import { validateBillableEdit, billableVarianceVsRoster } from '../../domain/billable-edit';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { resolvePaymentMinEngagementMinutes } from '@/modules/rosters/domain/projections/utils/cost/min-engagement-floor';

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
    hideGlow?: boolean;
    useGroupColoring?: boolean;
    className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DataRow: React.FC<{
    label: string;
    start: string;
    end?: string;
    emphasis?: boolean;
    muted?: boolean;
    accentColor?: string;
    style?: React.CSSProperties;
}> = ({ label, start, end, emphasis, muted, accentColor, style }) => (
    <div 
        style={style}
        className={cn(
            "flex items-center justify-between py-2 transition-all duration-300",
            muted ? "opacity-30" : "opacity-100"
        )}
    >
        <span className="text-[12px] font-medium text-foreground/50">
            {label}
        </span>
        <div className="flex items-center gap-3">
            <span className={cn(
                "tabular-nums tracking-tight",
                emphasis ? "text-[16px] font-bold text-foreground" : "text-[14px] font-medium text-foreground/90",
                accentColor && !muted ? accentColor : ""
            )}>
                {start}
            </span>
            {end && (
                <>
                    <ArrowRight className="h-3 w-3 text-foreground/20" />
                    <span className={cn(
                        "tabular-nums tracking-tight",
                        emphasis ? "text-[16px] font-bold text-foreground" : "text-[14px] font-medium text-foreground/90",
                        accentColor && !muted ? accentColor : ""
                    )}>
                        {end}
                    </span>
                </>
            )}
        </div>
    </div>
);

function formatTime(t: string | null | undefined): string {
    if (!t || t === '-') return '—';
    if (t.includes('AM') || t.includes('PM')) return t;
    
    let timeStr = t;
    if (t.includes('T')) {
        const d = new Date(t);
        if (!isNaN(d.getTime())) {
            const h = d.getHours();
            const m = d.getMinutes();
            return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
        }
    }

    const parts = timeStr.split(':').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const h = parts[0], m = parts[1];
        return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    return timeStr;
}

function getDisplayStatus(entry: TimesheetRow): { label: string; variant: string; isPrimary: boolean } {
    const tsStatus = (entry.timesheetStatus || '').toLowerCase();
    const attStatus = (entry.attendanceStatus || '').toLowerCase();
    const live = entry.liveStatus;

    if (tsStatus === 'approved') return { label: 'Approved', variant: 'APPROVED', isPrimary: true };
    if (tsStatus === 'rejected') return { label: 'Rejected', variant: 'REJECTED', isPrimary: true };
    if (attStatus === 'no_show') return { label: 'No Show', variant: 'NO_SHOW', isPrimary: true };

    if (live === 'Ongoing Session') return { label: 'Active', variant: 'ACTIVE', isPrimary: true };
    if (live === 'Completed') return { label: 'Completed', variant: 'COMPLETED', isPrimary: true };
    if (live === 'Upcoming') return { label: 'Upcoming', variant: 'UPCOMING', isPrimary: true };

    if (tsStatus === 'submitted') return { label: 'Published', variant: 'SUBMITTED', isPrimary: false };
    return { label: 'Draft', variant: 'DRAFT', isPrimary: false };
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
    hideGlow = false,
    useGroupColoring = false,
    className,
}, ref) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localAdjStart, setLocalAdjStart] = useState(entry.adjustedStart || '');
    const [localAdjEnd, setLocalAdjEnd] = useState(entry.adjustedEnd || '');
    const [localPaidBreak, setLocalPaidBreak] = useState(entry.paidBreak || '0');
    const [localUnpaidBreak, setLocalUnpaidBreak] = useState(entry.unpaidBreak || '0');

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
                employmentType: entry.employmentType,
                is_training: entry.isTraining,
                unpaid_break_minutes: parseFloat(entry.unpaidBreak) || 0,
                scheduled_length_minutes: calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd) * 60,
            });
        } catch {
            return null;
        }
    }, [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.role, entry.employmentType, entry.isTraining, entry.unpaidBreak]);
    const scheduledPay = scheduledCost ? `$${scheduledCost.totalCost.toFixed(2)}` : null;
    const scheduledPayLines = useMemo(
        () => scheduledCost
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
                employmentType: entry.employmentType,
                is_training: entry.isTraining,
                unpaid_break_minutes: parseFloat(entry.unpaidBreak) || 0,
                scheduled_length_minutes: calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd) * 60,
            }, entry.netLengthMinutes);
        } catch {
            return null;
        }
    }, [entry.date, entry.adjustedStart, entry.adjustedEnd, entry.netLengthMinutes, entry.role, entry.employmentType, entry.isTraining, entry.unpaidBreak, entry.scheduledStart, entry.scheduledEnd]);
    const billablePay = billableCost ? `$${billableCost.totalCost.toFixed(2)}` : null;
    const billablePayLines = useMemo(
        () => billableCost
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
        setIsEditing(true);
    };

    const isShiftOver = useMemo(() =>
        isShiftFinished(entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut),
    [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut]);

    // Manager review gate: approve / reject / edit unlock only once the shift
    // reaches a terminal attendance state (No-Show, clock-out, or auto clock-out).
    const reviewLocked = useMemo(() => !isEntryReviewable(entry), [entry]);

    const isPending = ['submitted', 'draft', 'pending'].includes((entry.timesheetStatus || '').toLowerCase());
    
    const theme = useMemo(() => {
        const type = entry.groupType;
        const group = (entry.group || '').toLowerCase();
        const dept = (entry.department || '').toLowerCase();
        const subDept = (entry.subDepartment || '').toLowerCase();
        const org = (entry.organization || '').toLowerCase();
        
        const isConvention = type === 'convention_centre' || group.includes('convention') || dept.includes('convention') || subDept.includes('convention') || org.includes('convention');
        const isExhibition = type === 'exhibition_centre' || group.includes('exhibition') || dept.includes('exhibition') || subDept.includes('exhibition') || org.includes('exhibition');
        const isTheatre = type === 'theatre' || group.includes('theatre') || dept.includes('theatre') || subDept.includes('theatre') || org.includes('theatre');
        const isCutaway = type === 'the_cutaway' || group.includes('cutaway') || dept.includes('cutaway') || subDept.includes('cutaway') || org.includes('cutaway');

        if (isConvention) return { 
            color: '#2563eb', 
            secondary: '#3b82f6', 
            atmosphere: ['#1d4ed8', '#2563eb', '#60a5fa'],
            tint: 'rgba(37, 99, 235, 0.04)'
        };
        
        if (isExhibition) return { 
            color: '#10b981', 
            secondary: '#059669', 
            atmosphere: ['#059669', '#10b981', '#34d399'],
            tint: 'rgba(16, 185, 129, 0.04)'
        };
        
        if (isTheatre) return {
            color: '#ef4444',
            secondary: '#dc2626',
            atmosphere: ['#991b1b', '#ef4444', '#f87171'],
            tint: 'rgba(239, 68, 68, 0.04)'
        };

        if (isCutaway) return {
            color: '#d97706',
            secondary: '#f59e0b',
            atmosphere: ['#b45309', '#d97706', '#fbbf24'],
            tint: 'rgba(245, 158, 11, 0.04)'
        };

        return { color: '#9333ea', secondary: '#a855f7', atmosphere: ['#7e22ce', '#9333ea', '#c084fc'], tint: 'transparent' };
    }, [entry.groupType, entry.group, entry.department, entry.subDepartment, entry.organization]);

    const themeColor = theme.color;

    const isFinalized = useMemo(() => {
        const tsStatus = (entry.timesheetStatus || '').toLowerCase();
        return ['approved', 'verified', 'auto_approved', 'rejected', 'finalized'].includes(tsStatus);
    }, [entry.timesheetStatus]);

    const canAction = isManager && isPending && !readOnly && !isFinalized;
    
    const showNoShowBtn = isShiftOver && (!entry.clockIn || entry.clockIn === '-') && (!entry.clockOut || entry.clockOut === '-') && entry.attendanceStatus !== 'no_show' && !readOnly && !!onMarkNoShow && !isFinalized;

    const displayStatus = useMemo(() => getDisplayStatus(entry), [entry]);

    const isPast = useMemo(() => {
        if (!entry.date || !entry.scheduledEnd) return false;
        try {
            // Compare the shift's Sydney wall-clock end instant against the real
            // current epoch — browser-timezone-independent.
            return parseZonedDateTime(String(entry.date), entry.scheduledEnd, SYDNEY_TZ).getTime() < Date.now();
        } catch {
            return false;
        }
    }, [entry.date, entry.scheduledEnd]);

    const protection = useMemo(() => getProtectionContext(
        { lifecycle_status: entry.liveStatus as any },
        isPast
    ), [entry.liveStatus, isPast]);

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
            hideGlow={hideGlow}
            organization={entry.organization}
            department={entry.department}
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
                    <TimesheetHistoryPopover shiftId={String(entry.id)} />
                </div>
            }
            footerActions={
                <div className="w-full flex flex-col gap-3">
                    {isEditing ? (
                        <div className="space-y-3 w-full">
                            <div className="grid grid-cols-2 gap-2 w-full">
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Adj In</Label>
                                    <input 
                                        value={localAdjStart} 
                                        onChange={e => setLocalAdjStart(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Adj Out</Label>
                                    <input 
                                        value={localAdjEnd} 
                                        onChange={e => setLocalAdjEnd(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 w-full">
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Paid Break</Label>
                                    <input 
                                        value={localPaidBreak} 
                                        onChange={e => setLocalPaidBreak(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Unpaid Break</Label>
                                    <input 
                                        value={localUnpaidBreak} 
                                        onChange={e => setLocalUnpaidBreak(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-center gap-2 w-full pt-1">
                                <Button
                                    onClick={handleSaveAdjustment}
                                    className="flex-1 h-11 rounded-xl font-bold bg-primary text-white shadow-lg active:scale-95 transition-all flex items-center justify-center"
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
                                    className="flex-1 h-9 rounded-xl font-black uppercase text-[9px] tracking-widest bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 transition-all active:scale-95 px-0 shadow-none text-center"
                                >
                                    Approve
                                </Button>
                                <Button
                                    onClick={handleReject}
                                    disabled={reviewLocked}
                                    title={reviewLocked ? 'Unlocks after clock-out, auto clock-out, or no-show' : undefined}
                                    className="flex-1 h-9 rounded-xl font-black uppercase text-[9px] tracking-widest bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:bg-rose-500/20 disabled:opacity-30 transition-all active:scale-95 px-0 shadow-none text-center"
                                >
                                    Reject
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleStartEditing}
                                    disabled={reviewLocked}
                                    title={reviewLocked ? 'Unlocks after clock-out, auto clock-out, or no-show' : undefined}
                                    className="flex-1 h-9 rounded-xl border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 px-0 disabled:opacity-30 text-center"
                                >
                                    Edit
                                </Button>
                                {showNoShowBtn && (
                                    <Button
                                        variant="outline"
                                        onClick={() => onMarkNoShow?.(String(entry.id))}
                                        disabled={!isShiftOver}
                                        className="flex-1 h-9 rounded-xl border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400 text-[8px] font-black uppercase tracking-widest disabled:opacity-30 transition-all active:scale-95 px-1 flex items-center justify-center"
                                    >
                                        <UserX className="h-3 w-3 mr-1" /> No-Show
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="w-full flex items-center justify-center gap-2">
                                <div className="flex-1 flex items-center justify-center h-9 bg-foreground/[0.04] border border-foreground/5 rounded-xl text-foreground/40 text-[9px] font-black uppercase tracking-widest text-center">
                                    Finalized Record
                                </div>
                                {!readOnly && (
                                    <Button
                                        variant="outline"
                                        onClick={handleStartEditing}
                                        className="h-9 px-4 rounded-xl border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[9px] font-black uppercase tracking-widest transition-all active:scale-95"
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
                            <Label htmlFor="m-arrival-variance" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Arrival variance reason <span className="text-red-500">*</span>
                            </Label>
                            <Select value={arrivalReason} onValueChange={setArrivalReason}>
                                <SelectTrigger id="m-arrival-variance" className="h-11 rounded-xl border border-border bg-muted/20 text-sm font-semibold text-foreground">
                                    <SelectValue placeholder="Select a reason…" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl z-[999] max-h-60 overflow-y-auto">
                                    {ARRIVAL_VARIANCE_REASONS.map(r => (
                                        <SelectItem key={r} value={r} className="rounded-xl py-2.5 text-xs font-semibold cursor-pointer">
                                            {r}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {pendingSave?.needDeparture && (
                        <div className="space-y-1.5">
                            <Label htmlFor="m-departure-variance" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Departure variance reason <span className="text-red-500">*</span>
                            </Label>
                            <Select value={departureReason} onValueChange={setDepartureReason}>
                                <SelectTrigger id="m-departure-variance" className="h-11 rounded-xl border border-border bg-muted/20 text-sm font-semibold text-foreground">
                                    <SelectValue placeholder="Select a reason…" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl z-[999] max-h-60 overflow-y-auto">
                                    {DEPARTURE_VARIANCE_REASONS.map(r => (
                                        <SelectItem key={r} value={r} className="rounded-xl py-2.5 text-xs font-semibold cursor-pointer">
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
