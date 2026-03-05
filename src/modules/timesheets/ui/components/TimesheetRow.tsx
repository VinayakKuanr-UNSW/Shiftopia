/* ------------------------------------------------------------------
   TimesheetRow.tsx - Migrated to new module
------------------------------------------------------------------- */

import React, { useState, useMemo } from "react";
import {
    Clock,
    CheckCircle,
    XCircle,
    Save,
    X,
} from "lucide-react";
import { ShiftStatusBadge } from "./ShiftStatusBadge";
import { TimesheetStatusBadge } from "./TimesheetStatusBadge";
import { AuditTrailModal } from "./audit/AuditTrailModal";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { TimesheetRow as TimesheetRowType, TimesheetEntry } from "../../model/timesheet.types";
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
    const [historyOpen, setHistoryOpen] = useState(false);
    const { toast } = useToast();

    const [editedAdjusted, setEditedAdjusted] = useState({
        adjustedStart: entry.adjustedStart || "",
        adjustedEnd: entry.adjustedEnd || "",
        paidBreak: entry.paidBreak || "0",
        unpaidBreak: entry.unpaidBreak || "0",
    });

    // Auto-calculate Length and Net Length when editing
    const calculatedValues = useMemo(() => {
        const start = editedAdjusted.adjustedStart;
        const end = editedAdjusted.adjustedEnd;
        const unpaidBreak = parseFloat(editedAdjusted.unpaidBreak) || 0;

        // Calculate length (handles overnight shifts)
        const length = calculateHoursBetween(start, end);

        // Calculate net length (length - unpaid break)
        const netLength = Math.max(0, length - unpaidBreak);

        // Calculate scheduled hours
        const scheduledHours = calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd);

        // Calculate differential (actual net hours - scheduled hours)
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
    const handleApprove = () => {
        if (entry.timesheetStatus !== 'SUBMITTED' && entry.timesheetStatus !== 'DRAFT') return;
        onSave?.(String(entry.id), { timesheetStatus: 'APPROVED' });
        toast({
            title: "Timesheet Approved",
            description: `Timesheet for ${entry.employee} has been approved.`,
        });
    };

    const handleReject = () => {
        if (entry.timesheetStatus !== 'SUBMITTED' && entry.timesheetStatus !== 'DRAFT') return;
        onSave?.(String(entry.id), { timesheetStatus: 'REJECTED' });
        toast({
            title: "Timesheet Rejected",
            description: `Timesheet for ${entry.employee} has been rejected.`,
        });
    };

    const handleSaveAdjusted = () => {
        // Calculate approximate pay based on remuneration level
        const levelMatch = entry.remunerationLevel.match(/\d+/);
        const level = levelMatch ? parseInt(levelMatch[0]) : 1;
        const hourlyRate = 30 + (level * 5); // Base rate + level bonus
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

        toast({
            title: "Adjusted Values Saved",
            description: "Timesheet adjustments have been updated.",
        });
        setIsEditingAdjusted(false);
    };

    const handleCancelEdit = () => {
        setEditedAdjusted({
            adjustedStart: entry.adjustedStart || "",
            adjustedEnd: entry.adjustedEnd || "",
            paidBreak: entry.paidBreak || "0",
            unpaidBreak: entry.unpaidBreak || "0",
        });
        setIsEditingAdjusted(false);
    };

    const handleAdjustedCellClick = () => {
        if (!readOnly && !isEditingAdjusted && entry.liveStatus !== 'Cancelled' && entry.liveStatus !== 'No-Show') {
            setIsEditingAdjusted(true);
        }
    };

    // Get differential color based on value
    const getDifferentialColor = (diff: string) => {
        if (!diff || diff === '-' || diff === '0.00' || diff === '0.00 h') return 'text-muted-foreground/60';
        if (diff.startsWith('+')) return 'text-green-500';
        if (diff.startsWith('-')) return 'text-red-500';
        return 'text-muted-foreground/60';
    };

    /* -- render ------------------------------------------------ */
    const cellClass = "p-3 text-sm whitespace-nowrap border-b border-border/50 transition-all duration-200";
    const editableCellClass = `${cellClass} cursor-pointer hover:bg-primary/5 hover:text-primary font-medium text-foreground/80`;

    return (
        <>{/* TimesheetRow.tsx */}
            <tr className="group hover:bg-muted/30 transition-all duration-300">
                {/* Select */}
                <td className={`${cellClass} text-center border-r border-border/30`}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={onToggleSelect}
                        className="rounded border-border bg-background focus:ring-primary h-4 w-4 transition-all"
                        disabled={entry.timesheetStatus !== 'SUBMITTED' && entry.timesheetStatus !== 'DRAFT'}
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

                {/* Scheduled */}
                <td className={cellClass}>{entry.scheduledStart}</td>
                <td className={`${cellClass} border-r border-border/30`}>{entry.scheduledEnd}</td>

                {/* Geofenced */}
                <td className={cellClass}>{entry.clockIn || '-'}</td>
                <td className={`${cellClass} border-r border-border/30`}>{entry.clockOut || '-'}</td>

                {/* Adjusted (Inline Editable) */}
                {isEditingAdjusted ? (
                    <>
                        <td className={`${cellClass} bg-primary/5`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedStart}
                                onChange={(e) => setEditedAdjusted({ ...editedAdjusted, adjustedStart: e.target.value })}
                                className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-24 text-xs font-black shadow-sm"
                            />
                        </td>
                        <td className={`${cellClass} bg-primary/5`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedEnd}
                                onChange={(e) => setEditedAdjusted({ ...editedAdjusted, adjustedEnd: e.target.value })}
                                className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-24 text-xs font-black shadow-sm"
                            />
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
                <td className={`${cellClass} border-r border-border/30`}>
                    <TimesheetStatusBadge status={entry.timesheetStatus} />
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
                                {/* Audit Trail - Always visible */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setHistoryOpen(true)}
                                                className="h-8 w-8 rounded-xl text-primary hover:bg-primary/10"
                                            >
                                                <Clock size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Audit Trail</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                {/* Approve - Only when Pending/Draft/Submitted */}
                                {(entry.timesheetStatus === 'SUBMITTED' || entry.timesheetStatus === 'DRAFT') && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleApprove}
                                                    className="h-8 w-8 rounded-xl text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                                >
                                                    <CheckCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Approve</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {/* Reject - Only when Pending/Submitted */}
                                {(entry.timesheetStatus === 'SUBMITTED' || entry.timesheetStatus === 'DRAFT') && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleReject}
                                                    className="h-8 w-8 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                                >
                                                    <XCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Reject</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </>
                        )}
                    </div>
                </td>
            </tr>

            {/* Audit Trail Modal */}
            <AuditTrailModal
                timesheetId={String(entry.id)}
                open={historyOpen}
                onOpenChange={setHistoryOpen}
            />
        </>
    );
};
