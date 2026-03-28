/* ------------------------------------------------------------------
   TimesheetRow.tsx - Migrated to new module
------------------------------------------------------------------- */

import React, { useState, useMemo } from "react";
import {
    CheckCircle,
    XCircle,
    Save,
    X,
    AlertTriangle,
    MessageSquare,
} from "lucide-react";
import { ShiftStatusBadge } from "./ShiftStatusBadge";
import { TimesheetStatusBadge } from "./TimesheetStatusBadge";
import { AttendanceBadge } from "@/modules/rosters/ui/components/AttendanceBadge";
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
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import type { TimesheetRow as TimesheetRowType } from "../../model/timesheet.types";
import { calculateHoursBetween, formatHours, formatDifferential } from "./TimesheetTable.utils";

interface TimesheetRowProps {
    entry: TimesheetRowType;
    readOnly?: boolean;
    isSelected?: boolean;
    onToggleSelect?: () => void;
    onSave?: (id: string, updates: Partial<TimesheetRowType>) => void;
}

export const TimesheetRow: React.FC<TimesheetRowProps> = ({
    entry,
    readOnly = false,
    isSelected = false,
    onToggleSelect,
    onSave,
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

    const { toast } = useToast();

    const [editedAdjusted, setEditedAdjusted] = useState({
        adjustedStart: entry.adjustedStart || "",
        adjustedEnd: entry.adjustedEnd || "",
        paidBreak: entry.paidBreak || "0",
        unpaidBreak: entry.unpaidBreak || "0",
    });

    // Shift is currently running — block both approve and reject until it ends
    const isInProgress = entry.liveStatus === 'InProgress';

    // Attendance warnings — drives the approval modal
    const warnings = useMemo(() => {
        const list: { text: string; severity: 'error' | 'warning' }[] = [];
        if (isInProgress) {
            list.push({ text: 'Shift is currently in progress — approval is only available after the shift has ended', severity: 'error' });
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
    }, [entry, isInProgress]);

    const requiresReason = warnings.some(w => w.severity === 'error') && !isInProgress;

    // Auto-calculate Length and Net Length when editing
    const calculatedValues = useMemo(() => {
        const start = editedAdjusted.adjustedStart;
        const end = editedAdjusted.adjustedEnd;
        const unpaidBreak = parseFloat(editedAdjusted.unpaidBreak) || 0;
        const length = calculateHoursBetween(start, end);
        const netLength = Math.max(0, length - unpaidBreak);
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
        if (!entry.adjustedStart || !entry.adjustedEnd) {
            return {
                length: entry.length || '-',
                netLength: entry.netLength || '-',
                differential: entry.differential || '-',
            };
        }
        const length = calculateHoursBetween(entry.adjustedStart, entry.adjustedEnd);
        const unpaidBreak = parseFloat(entry.unpaidBreak) || 0;
        const netLength = Math.max(0, length - unpaidBreak);
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
        onSave?.(String(entry.id), {
            timesheetStatus: 'APPROVED',
            ...(overrideReason.trim() ? { notes: overrideReason.trim() } : {}),
        } as any);
        toast({ title: 'Timesheet Approved', description: `Timesheet for ${entry.employee} approved.` });
        setWarningsOpen(false);
        setOverrideReason('');
    };

    const handleApprove = () => {
        if (entry.timesheetStatus !== 'SUBMITTED' && entry.timesheetStatus !== 'DRAFT') return;
        if (warnings.length > 0) { setWarningsOpen(true); return; }
        doApprove();
    };

    // Reject — always prompt for reason so employees can understand the decision
    const doReject = () => {
        if (!rejectReason.trim()) return;
        onSave?.(String(entry.id), {
            timesheetStatus: 'REJECTED',
            ...({ rejectedReason: rejectReason.trim() } as any),
        } as any);
        toast({ title: 'Timesheet Rejected', description: `Timesheet for ${entry.employee} rejected.` });
        setRejectOpen(false);
        setRejectReason('');
    };

    const handleReject = () => {
        if (entry.timesheetStatus !== 'SUBMITTED' && entry.timesheetStatus !== 'DRAFT') return;
        if (isInProgress) {
            toast({
                title: 'Cannot Reject Yet',
                description: 'Shift is still in progress. Wait until the shift ends.',
                variant: 'destructive',
            });
            return;
        }
        setRejectOpen(true);
    };

    const handleSaveAdjusted = () => {
        // Timing validation
        const { adjustedStart, adjustedEnd } = editedAdjusted;
        if (adjustedStart && adjustedEnd) {
            const [sh, sm] = adjustedStart.split(':').map(Number);
            const [eh, em] = adjustedEnd.split(':').map(Number);
            const startMins = sh * 60 + sm;
            let endMins = eh * 60 + em;
            if (endMins < startMins) endMins += 24 * 60; // overnight
            if (endMins <= startMins) {
                const msg = 'Adjusted end time must be after start time';
                setTimingError(msg);
                toast({ title: 'Invalid Times', description: msg, variant: 'destructive' });
                return;
            }
        }
        setTimingError('');

        const levelMatch = entry.remunerationLevel.match(/\d+/);
        const level = levelMatch ? parseInt(levelMatch[0]) : 1;
        const hourlyRate = 30 + (level * 5);
        const netLengthNum = parseFloat(calculatedValues.netLength) || 0;
        const approximatePay = `$${(netLengthNum * hourlyRate).toFixed(2)}`;

        onSave?.(String(entry.id), {
            adjustedStart: editedAdjusted.adjustedStart,
            adjustedEnd: editedAdjusted.adjustedEnd,
            paidBreak: editedAdjusted.paidBreak,
            unpaidBreak: editedAdjusted.unpaidBreak,
            length: calculatedValues.length,
            netLength: calculatedValues.netLength,
            differential: calculatedValues.differential,
            approximatePay,
        });
        toast({ title: 'Adjusted Values Saved', description: 'Timesheet adjustments updated.' });
        setIsEditingAdjusted(false);
    };

    const handleCancelEdit = () => {
        setEditedAdjusted({
            adjustedStart: entry.adjustedStart || "",
            adjustedEnd: entry.adjustedEnd || "",
            paidBreak: entry.paidBreak || "0",
            unpaidBreak: entry.unpaidBreak || "0",
        });
        setTimingError('');
        setIsEditingAdjusted(false);
    };

    const handleAdjustedCellClick = () => {
        if (!readOnly && !isEditingAdjusted && entry.liveStatus !== 'Cancelled' && entry.liveStatus !== 'No-Show') {
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
    const cellClass = "p-3 text-sm whitespace-nowrap border-b border-border/50 transition-all duration-200";
    const editableCellClass = `${cellClass} cursor-pointer hover:bg-primary/5 hover:text-primary font-medium text-foreground/80`;

    return (
        <>{/* TimesheetRow.tsx */}
            <tr className={cn(
            "group hover:bg-muted/30 transition-all duration-300",
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
                            isInProgress
                        }
                    />
                </td>

                {/* Employee Info */}
                <td className={`${cellClass} font-black text-[11px] text-muted-foreground/60 uppercase tracking-tighter`}>{entry.employeeId}</td>
                <td className={`${cellClass} font-black tracking-tight text-foreground border-r border-border/30`}>{entry.employee}</td>

                {/* Hierarchy */}
                <td className={cellClass}>{entry.group}</td>
                <td className={cellClass}>{entry.subGroup}</td>
                <td className={cellClass}>{entry.role}</td>
                <td className={`${cellClass} border-r border-border/30`}>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-primary/10 text-primary border border-primary/20 shadow-sm">
                        {entry.remunerationLevel}
                    </span>
                </td>

                {/* Clock (Actual) */}
                <td className={cellClass}>
                    <div className="flex flex-col">
                        <span className="font-bold">{entry.clockIn || '-'}</span>
                        {entry.varianceMinutes !== null && entry.varianceMinutes !== undefined && (
                            <span className={cn(
                                "text-[9px] font-black uppercase tracking-tighter",
                                entry.varianceMinutes > 5 ? "text-amber-500" : entry.varianceMinutes < -5 ? "text-emerald-500" : "text-muted-foreground/40"
                            )}>
                                {entry.varianceMinutes > 0 ? `+${entry.varianceMinutes}m` : `${entry.varianceMinutes}m`}
                            </span>
                        )}
                        {/* Missing check-in error indicator */}
                        {entry.attendanceStatus === 'unknown' &&
                            (entry.liveStatus === 'InProgress' || entry.liveStatus === 'Completed') &&
                            (!entry.clockIn || entry.clockIn === '-') && (
                            <span className="inline-flex items-center gap-0.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 w-fit border border-red-500/20">
                                <AlertTriangle className="h-2.5 w-2.5" />Missing
                            </span>
                        )}
                    </div>
                </td>
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className="flex flex-col gap-0.5">
                        <span>{entry.clockOut || '-'}</span>
                        {entry.attendanceStatus === 'no_show' && (
                            <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 w-fit">
                                <AlertTriangle className="h-2.5 w-2.5" />No Show
                            </span>
                        )}
                    </div>
                </td>

                {/* Scheduled */}
                <td className={cellClass}>{entry.scheduledStart}</td>
                <td className={`${cellClass} border-r border-border/30`}>{entry.scheduledEnd}</td>

                {/* Adjusted (Inline Editable) */}
                {isEditingAdjusted ? (
                    <>
                        <td className={`${cellClass} ${timingError ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedStart}
                                onChange={(e) => { setEditedAdjusted({ ...editedAdjusted, adjustedStart: e.target.value }); setTimingError(''); }}
                                className={cn("bg-background border rounded-lg px-2 py-1 w-24 text-xs font-black shadow-sm", timingError ? "border-red-500/50" : "border-primary/30")}
                            />
                        </td>
                        <td className={`${cellClass} ${timingError ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedEnd}
                                onChange={(e) => { setEditedAdjusted({ ...editedAdjusted, adjustedEnd: e.target.value }); setTimingError(''); }}
                                className={cn("bg-background border rounded-lg px-2 py-1 w-24 text-xs font-black shadow-sm", timingError ? "border-red-500/50" : "border-primary/30")}
                            />
                            {timingError && <p className="text-[8px] text-red-500 mt-0.5 font-bold">{timingError}</p>}
                        </td>
                        <td className={`${cellClass} bg-primary/10 border-r border-border/30`}>
                            <div className="flex flex-col">
                                <span className="font-black text-primary">{calculatedValues.length}</span>
                                <span className="text-[8px] font-black uppercase text-muted-foreground tracking-widest leading-none">Auto</span>
                            </div>
                        </td>
                        <td className={`${cellClass} bg-primary/5`}>
                            <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={editedAdjusted.paidBreak}
                                onChange={(e) => setEditedAdjusted({ ...editedAdjusted, paidBreak: e.target.value })}
                                className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-16 text-xs font-black shadow-sm"
                            />
                        </td>
                        <td className={`${cellClass} bg-primary/5`}>
                            <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={editedAdjusted.unpaidBreak}
                                onChange={(e) => setEditedAdjusted({ ...editedAdjusted, unpaidBreak: e.target.value })}
                                className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-16 text-xs font-black shadow-sm"
                            />
                        </td>
                        <td className={`${cellClass} bg-primary/10 border-r border-border/30`}>
                            <div className="flex flex-col">
                                <span className="font-black text-primary">{calculatedValues.netLength}</span>
                                <span className="text-[8px] font-black uppercase text-muted-foreground tracking-widest leading-none">Auto</span>
                            </div>
                        </td>
                    </>
                ) : (
                    <>
                        <td className={editableCellClass} onClick={handleAdjustedCellClick}>
                            {entry.adjustedStart || '-'}
                        </td>
                        <td className={editableCellClass} onClick={handleAdjustedCellClick}>
                            {entry.adjustedEnd || '-'}
                        </td>
                        <td className={`${cellClass} font-black text-foreground border-r border-border/30`}>
                            {displayValues.length}
                        </td>
                        <td className={editableCellClass} onClick={handleAdjustedCellClick}>
                            {entry.paidBreak || '-'}
                        </td>
                        <td className={editableCellClass} onClick={handleAdjustedCellClick}>
                            {entry.unpaidBreak || '-'}
                        </td>
                        <td className={`${cellClass} font-black text-foreground border-r border-border/30`}>
                            {displayValues.netLength}
                        </td>
                    </>
                )}

                {/* Payroll */}
                <td className={`${cellClass} font-black text-primary tracking-tight`}>
                    {entry.approximatePay || '-'}
                </td>

                {/* Differential */}
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className={`px-2 py-1 rounded-lg text-[10px] font-black text-center w-fit ${getDifferentialColor(isEditingAdjusted ? calculatedValues.differential : displayValues.differential).replace('text-', 'bg-').replace('-400', '/10 text-')}`}>
                        {isEditingAdjusted ? calculatedValues.differential : displayValues.differential}
                    </div>
                </td>

                {/* Statuses */}
                <td className={cellClass}>
                    <ShiftStatusBadge status={entry.liveStatus as any} />
                </td>
                <td className={cellClass}>
                    {entry.attendanceStatus && entry.attendanceStatus !== 'unknown' && (
                        <AttendanceBadge
                            attendanceStatus={entry.attendanceStatus as any}
                            actualStart={entry.clockIn}
                            scheduledStart={`${entry.date}T${entry.scheduledStart}`}
                            actualEnd={entry.clockOut}
                            scheduledEnd={`${entry.date}T${entry.scheduledEnd}`}
                            lifecycleStatus={entry.liveStatus === 'InProgress' ? 'InProgress' : entry.liveStatus === 'Completed' ? 'Completed' : undefined}
                        />
                    )}
                </td>
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className="flex flex-col gap-1">
                        <TimesheetStatusBadge status={entry.timesheetStatus} />
                        {/* Show action note (override/rejection reason) */}
                        {actionNote && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1 text-[8px] text-muted-foreground/60 cursor-default">
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
                                {/* Approve — blocked while InProgress */}
                                {(entry.timesheetStatus === 'SUBMITTED' || entry.timesheetStatus === 'DRAFT') && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleApprove}
                                                    disabled={isInProgress}
                                                    className={cn(
                                                        "h-8 w-8 rounded-xl",
                                                        isInProgress
                                                            ? "text-muted-foreground/40 cursor-not-allowed"
                                                            : "text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                                    )}
                                                >
                                                    <CheckCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {isInProgress ? 'Shift in progress — approve after shift ends' : 'Approve'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {/* Reject — also blocked while InProgress; always requires reason */}
                                {(entry.timesheetStatus === 'SUBMITTED' || entry.timesheetStatus === 'DRAFT') && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleReject}
                                                    disabled={isInProgress}
                                                    className={cn(
                                                        "h-8 w-8 rounded-xl",
                                                        isInProgress
                                                            ? "text-muted-foreground/40 cursor-not-allowed"
                                                            : "text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                                    )}
                                                >
                                                    <XCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {isInProgress ? 'Shift in progress — reject after shift ends' : 'Reject'}
                                            </TooltipContent>
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
                            <AlertTriangle className={cn("h-5 w-5", isInProgress ? "text-red-500" : "text-amber-500")} />
                            {isInProgress ? 'Approval Blocked' : 'Attendance Issues Detected'}
                        </DialogTitle>
                        <DialogDescription>
                            {isInProgress
                                ? <>Approval for <strong>{entry.employee}</strong>'s timesheet is blocked until the shift ends.</>
                                : <>Review the following issues before approving <strong>{entry.employee}</strong>'s timesheet.</>
                            }
                        </DialogDescription>
                    </DialogHeader>

                    <ul className="space-y-2 my-2">
                        {warnings.map((w, i) => (
                            <li key={i} className={cn(
                                'flex items-start gap-2 text-sm px-3 py-2 rounded-lg',
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
                            <Label htmlFor="override-reason" className="text-sm font-semibold">
                                Override reason <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="override-reason"
                                placeholder="e.g. Supervisor confirmed attendance verbally…"
                                value={overrideReason}
                                onChange={e => setOverrideReason(e.target.value)}
                                className="text-sm"
                            />
                            <p className="text-[11px] text-muted-foreground">This reason will be saved and visible to the employee.</p>
                        </div>
                    )}

                    <DialogFooter className="gap-2 flex-wrap">
                        {!isInProgress && (
                            <Button variant="outline" onClick={() => { setWarningsOpen(false); handleAdjustedCellClick(); }}>
                                Adjust Times
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => setWarningsOpen(false)}>
                            {isInProgress ? 'OK' : 'Cancel'}
                        </Button>
                        {!isInProgress && (
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
                        <Label htmlFor="reject-reason" className="text-sm font-semibold">
                            Rejection reason <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="reject-reason"
                            placeholder="e.g. Clock-in times do not match scheduled hours. Please review and resubmit."
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="text-sm"
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
        </>
    );
};
