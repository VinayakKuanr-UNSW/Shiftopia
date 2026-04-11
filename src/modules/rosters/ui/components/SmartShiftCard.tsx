/**
 * SmartShiftCard - Phase 2 Enterprise Component
 *
 * A "Smart Card" with two rendering modes:
 * - Compact: Minimal footprint for grid views (replaces ShiftCardCompact in dense layouts)
 * - Detailed: Full info card with compliance warnings, skills, and actions
 */

import React, { useMemo } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import {
    Clock,
    User,
    AlertTriangle,
    Megaphone,
    Edit,
    XCircle,
    CheckCircle,
    Hourglass,
    GripVertical,
    MoreHorizontal,
    Flame,
    Lock,
    CopyPlus,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import type { Shift } from '../../domain/shift.entity';
import { getShiftUIContext, getLockState, getStatusDotInfo } from '../../domain/shift-ui';


// ============================================================================
// TYPES & HELPERS
// ============================================================================

export type ShiftCardVariant = 'compact' | 'detailed';
export interface ComplianceInfo {
    status: 'compliant' | 'warning' | 'violation';
    violations: string[];
    warnings: string[];
    weeklyHours?: number;
    maxWeeklyHours?: number;
}

export interface SmartShiftCardProps {
    shift: Shift;
    variant?: ShiftCardVariant;
    compliance?: ComplianceInfo;
    onClick?: (e: React.MouseEvent) => void;
    isSelected?: boolean;
    onSelect?: (shiftId: string) => void;
    isDragging?: boolean;
    isDragOver?: boolean;
    headerAction?: React.ReactNode;
    groupColor?: string;
    isLocked?: boolean;
    isPast?: boolean;
    isDnDActive?: boolean;
    className?: string;
    compliancePending?: boolean;
}

const GROUP_COLORS: Record<string, { header: string; accent: string; text: string; badge: string }> = {
    blue: { header: 'bg-blue-600 dark:bg-blue-600', accent: 'border-blue-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    green: { header: 'bg-emerald-600 dark:bg-emerald-600', accent: 'border-emerald-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    red: { header: 'bg-red-600 dark:bg-red-600', accent: 'border-red-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    orange: { header: 'bg-orange-600 dark:bg-orange-600', accent: 'border-orange-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    purple: { header: 'bg-purple-600 dark:bg-purple-600', accent: 'border-purple-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    convention_centre: { header: 'bg-blue-600', accent: 'border-blue-500/30', text: 'text-white', badge: 'bg-white/20' },
    exhibition_centre: { header: 'bg-emerald-600', accent: 'border-emerald-500/30', text: 'text-white', badge: 'bg-white/20' },
    theatre: { header: 'bg-red-600', accent: 'border-red-500/30', text: 'text-white', badge: 'bg-white/20' },
    default_yellow: { header: 'bg-amber-400', accent: 'border-amber-400/30', text: 'text-amber-950', badge: 'bg-black/10' },
};

function formatTime(time: string | null): string {
    if (!time) return '--:--';
    const timePart = time.includes('T') ? time.split('T')[1].substring(0, 5) : time;
    const parts = timePart.split(':');
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
    return timePart;
}

function getInitials(name: string): string {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().substring(0, 2);
}

function getLifecycleIcon(status: string) {
    const s = (status || 'draft').toLowerCase();
    if (s === 'draft') return <Edit className="h-3.5 w-3.5 text-gray-400" />;
    if (s === 'published') return <Megaphone className="h-3.5 w-3.5 text-blue-500" />;
    if (s === 'inprogress' || s === 'on_going') return <Hourglass className="h-3.5 w-3.5 text-orange-500" />;
    if (s === 'completed') return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    if (s === 'cancelled') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    return <Edit className="h-3.5 w-3.5 text-gray-400" />;
}

/**
 * Normalizes shift lifecycle status for inconsistent API responses.
 */
function getNormalizedStatus(shift: any): string {
    return (shift.lifecycle_status || shift.lifecycleStatus || 'draft').toLowerCase();
}

/**
 * Hook for 3D tilt effect that follows the mouse cursor.
 */
function useTilt() {
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const mouseXSpring = useSpring(x, { stiffness: 300, damping: 30 });
    const mouseYSpring = useSpring(y, { stiffness: 300, damping: 30 });
    const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["7.5deg", "-7.5deg"]);
    const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-7.5deg", "7.5deg"]);

    const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - rect.left) / rect.width - 0.5);
        y.set((e.clientY - rect.top) / rect.height - 0.5);
    };
    const onMouseLeave = () => {
        x.set(0);
        y.set(0);
    };

    return { rotateX, rotateY, onMouseMove, onMouseLeave };
}

// ============================================================================
// COMPACT VARIANT
// ============================================================================

const CompactCard: React.FC<SmartShiftCardProps> = ({
    shift,
    onClick,
    isSelected,
    isDragging,
    isDragOver,
    isLocked,
    isPast,
    isDnDActive,
    headerAction,
    groupColor = 'default_yellow',
    className,
}) => {
    const colors = GROUP_COLORS[groupColor] || GROUP_COLORS.default_yellow;
    const employeeName = shift.assigned_employee_id ? (shift as any).assigned_profiles ? `${(shift as any).assigned_profiles.first_name} ${(shift as any).assigned_profiles.last_name}` : 'Assigned' : null;
    const roleName = shift.roles?.name || 'No Role';

    const ctx = useMemo(() => getShiftUIContext({
        lifecycle_status:   shift.lifecycle_status  ?? 'Draft',
        assignment_status:  shift.assignment_status ?? 'unassigned',
        assignment_outcome: shift.assignment_outcome ?? null,
        trading_status:     shift.trading_status    ?? null,
        is_cancelled:       shift.is_cancelled      ?? false,
        scheduled_start:    shift.scheduled_start   ?? null,
        actual_start:       shift.actual_start      ?? null,
        emergency_source:   (shift as any).emergency_source ?? null,
    }), [shift.lifecycle_status, shift.is_cancelled, shift.assignment_status, shift.assignment_outcome, shift.trading_status, shift.scheduled_start, shift.actual_start, (shift as any).emergency_source]);

    const stateId = ctx.state;
    const fsmLock = getLockState(ctx.state);
    // FSM-based lock overrides — differentiation between interactive protection vs absolute lock
    const isFullyLocked = isLocked || fsmLock.fullyLocked;
    const isProtected = fsmLock.partialLock;

    const lockTooltip = useMemo(() => {
        if (stateId === 'S3') return 'Offer Sent — Schedule Protected';
        if (stateId === 'S11') return 'Shift In Progress — Locked';
        if (stateId === 'S13') return 'Shift Completed — Locked';
        if (stateId === 'S15') return 'Shift Cancelled — Locked';
        if (isLocked) return 'Roster/Group Locked';
        return 'Protected';
    }, [stateId, isLocked]);

    const dot = getStatusDotInfo({
        lifecycle_status:   shift.lifecycle_status,
        is_cancelled:       shift.is_cancelled,
        assignment_outcome: shift.assignment_outcome,
        attendance_status:  shift.attendance_status,
        actual_start:       shift.actual_start,
        actual_end:         shift.actual_end,
        start_at:           shift.start_at,
        end_at:             shift.end_at,
        shift_date:         shift.shift_date,
        start_time:         shift.start_time,
        end_time:           shift.end_time,
    });

    const statusStr = getNormalizedStatus(shift);
    const isDraft = statusStr === 'draft';
    const isPublished = statusStr === 'published';

    const { rotateX, rotateY, onMouseMove, onMouseLeave } = useTilt();

    return (
        <motion.div
            style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: "1000px" }}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            className={cn(
                'relative flex flex-col rounded-lg overflow-hidden border bg-card shadow-sm transition-all h-full group select-none',
                onClick && (!isFullyLocked || isSelected) && 'cursor-pointer hover:shadow-md',
                isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background border-primary/50 bg-primary/5 dark:bg-primary/20',
                isDragging && 'opacity-50 scale-95',
                isDragOver && 'ring-2 ring-blue-400 ring-offset-1',
                // No dot + past = fully expired draft → greyscale whole card
                !isDnDActive && dot === null && isPast && 'grayscale opacity-60 cursor-not-allowed',
                !isDnDActive && dot === null && isFullyLocked && !isPast && shift.bidding_status !== 'bidding_closed_no_winner' && 'opacity-70 grayscale-[0.5] cursor-not-allowed border-dashed',
                isDraft && !isPast && shift.bidding_status !== 'bidding_closed_no_winner' && 'border-dashed opacity-[0.98]',
                !isDraft && !isFullyLocked && !isPast && 'border-solid',
                className
            )}
            onClick={isFullyLocked || isPast ? undefined : onClick}
        >
            {/* Content container — body greyscales on past, header (dot) stays crisp */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Header */}
                <div className={cn('px-3 py-1.5 flex justify-between items-center transition-all duration-300 relative z-[20]',
                    shift.bidding_status === 'bidding_closed_no_winner' ? 'bg-orange-500/20 text-orange-900 dark:text-orange-100' : colors.header,
                    isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-40 backdrop-blur-[2px]',
                    !isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-100',
                    shift.bidding_status !== 'bidding_closed_no_winner' && colors.text,
                    isFullyLocked && !isDnDActive && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-muted dark:bg-slate-700 text-muted-foreground')}>
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-1.5 cursor-help">
                                    {dot && (
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-black/10" style={{ backgroundColor: dot.color }} />
                                    )}
                                    <span className={cn("text-[9px] font-mono font-bold px-1.5 py-0.5 rounded", isFullyLocked ? "bg-black/20 dark:bg-black/50 opacity-70" : colors.badge)}>
                                        {ctx.state === 'S3' && ctx.urgency === 'emergent' ? 'S3*'
                                        : ctx.state === 'S5' && ctx.urgency === 'emergent' ? 'S5*'
                                        : stateId}
                                    </span>
                                </div>
                            </TooltipTrigger>
                            {dot && (
                                <TooltipContent className="bg-slate-900 text-white border-none py-1 px-2 text-[10px] font-bold" style={{ backgroundColor: dot.color }}>
                                    {dot.label}
                                </TooltipContent>
                            )}
                        </Tooltip>
                        <span className="text-[11px] font-bold uppercase tracking-widest truncate opacity-80">
                            {shift.roster_subgroup?.name || shift.sub_group_name || roleName}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        {shift.is_from_template && <div className="mr-1" title="From Template"><CopyPlus className="h-3 w-3 opacity-60" /></div>}
                        {ctx.emergencyLabel && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center justify-center bg-rose-500/20 rounded p-0.5">
                                        <Flame className="h-3 w-3 text-rose-500" />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-rose-600 text-white border-none py-1 px-2 text-[10px] font-medium">{ctx.emergencyLabel}</TooltipContent>
                            </Tooltip>
                        )}
                        {(isFullyLocked || isProtected) && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className={cn(
                                        "flex items-center justify-center rounded p-0.5",
                                        isFullyLocked ? "bg-muted dark:bg-slate-800" : "bg-amber-500/10"
                                    )}>
                                        <Lock className={cn(
                                            "h-3 w-3",
                                            isFullyLocked ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                                        )} />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-amber-600 text-white border-none py-1 px-2 text-[10px] font-medium">{lockTooltip}</TooltipContent>
                            </Tooltip>
                        )}
                        {headerAction || (!isFullyLocked && (
                          <button className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-1">
                            <MoreHorizontal className="h-3.5 w-3.5 opacity-40" />
                          </button>
                        ))}
                    </div>
                </div>

                {/* Body — greyscaled for past shifts while header/dot stays crisp */}
                <div className={cn("px-3 py-1.5 flex flex-col gap-1 flex-1 relative z-[20]",
                    !isDnDActive && isPast && dot !== null && "grayscale opacity-60")}>
                    <div className="flex flex-col items-center justify-center min-h-[20px] gap-0.5">
                        <div className="text-sm font-semibold text-foreground truncate text-center">{employeeName || 'Unassigned'}</div>
                    </div>
                    <div className="flex justify-center mb-1">
                        <div className="bg-muted/50 rounded-md px-2 py-0.5 flex items-center gap-1.5 text-[10px]">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono font-medium text-foreground">{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* DnD Blocking Overlay (highest layer) */}
            {isDnDActive && isLocked && isPublished && (
                <div 
                    className="absolute inset-0 bg-stripe-red pointer-events-none rounded-inherit z-[100] border-2 border-red-500/50 shadow-[inset_0_0_20px_rgba(239,68,68,0.3)]" 
                    aria-hidden="true" 
                />
            )}
        </motion.div>
    );
};

// ============================================================================
// DETAILED VARIANT
// ============================================================================

const DetailedCard: React.FC<SmartShiftCardProps> = ({
    shift,
    compliance,
    onClick,
    isSelected,
    isDragging,
    isDragOver,
    isLocked,
    isPast,
    isDnDActive,
    headerAction,
    groupColor = 'default_yellow',
    className,
}) => {
    const colors = GROUP_COLORS[groupColor] || GROUP_COLORS.default_yellow;
    const employeeName = shift.assigned_employee_id ? (shift as any).assigned_profiles ? `${(shift as any).assigned_profiles.first_name} ${(shift as any).assigned_profiles.last_name}` : 'Assigned' : null;
    const roleName = shift.roles?.name || 'No Role';
    const hasComplianceIssue = compliance && compliance.status !== 'compliant';
    const totalHours = shift.net_length_minutes ? (shift.net_length_minutes / 60).toFixed(1) : null;
    
    const statusStr = getNormalizedStatus(shift);
    const ctx = useMemo(() => getShiftUIContext({
        lifecycle_status:   shift.lifecycle_status  ?? 'Draft',
        assignment_status:  shift.assignment_status ?? 'unassigned',
        assignment_outcome: shift.assignment_outcome ?? null,
        trading_status:     shift.trading_status    ?? null,
        is_cancelled:       shift.is_cancelled      ?? false,
        scheduled_start:    shift.scheduled_start   ?? null,
        actual_start:       shift.actual_start      ?? null,
        emergency_source:   (shift as any).emergency_source ?? null,
    }), [shift.lifecycle_status, shift.is_cancelled, shift.assignment_status, shift.assignment_outcome, shift.trading_status, shift.scheduled_start, shift.actual_start, (shift as any).emergency_source]);
    
    const fsmLock = getLockState(ctx.state);
    const isFullyLocked = isLocked || fsmLock.fullyLocked;
    const isProtected = fsmLock.partialLock;
    const isDraft = statusStr === 'draft';
    const isPublished = statusStr === 'published';

    const dot = getStatusDotInfo({
        lifecycle_status:   shift.lifecycle_status,
        is_cancelled:       shift.is_cancelled,
        assignment_outcome: shift.assignment_outcome,
        attendance_status:  shift.attendance_status,
        actual_start:       shift.actual_start,
        actual_end:         shift.actual_end,
        start_at:           shift.start_at,
        end_at:             shift.end_at,
        shift_date:         shift.shift_date,
        start_time:         shift.start_time,
        end_time:           shift.end_time,
    });

    const stateLabel =
        ctx.state === 'S3' && ctx.urgency === 'emergent' ? 'S3*'
        : ctx.state === 'S5' && ctx.urgency === 'emergent' ? 'S5*'
        : ctx.state;

    const { rotateX, rotateY, onMouseMove, onMouseLeave } = useTilt();

    return (
        <motion.div
            style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: "1000px" }}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            className={cn(
                'relative flex flex-col rounded-xl overflow-hidden border bg-card shadow-sm transition-all group select-none',
                onClick && !isFullyLocked && 'cursor-pointer hover:shadow-lg',
                isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background border-primary/50 bg-primary/5 dark:bg-primary/20',
                isDragging && 'opacity-50 scale-95',
                isDragOver && 'ring-2 ring-blue-400 ring-offset-2',
                !isDnDActive && dot === null && isPast && 'grayscale opacity-60 cursor-not-allowed',
                !isDnDActive && dot === null && isFullyLocked && !isPast && shift.bidding_status !== 'bidding_closed_no_winner' && 'opacity-70 grayscale-[0.5] cursor-not-allowed border-dashed',
                isDraft && !isPast && shift.bidding_status !== 'bidding_closed_no_winner' && 'border-dashed opacity-[0.98]',
                !isDraft && !isFullyLocked && !isPast && 'border-solid',
                className
            )}
            onClick={isFullyLocked || isPast ? undefined : onClick}
        >
            {/* Content container — body greyscales on past, header (dot) stays crisp */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Header */}
                <div className={cn('px-4 py-2.5 flex justify-between items-center transition-all duration-300 relative z-[20]',
                    shift.bidding_status === 'bidding_closed_no_winner' ? 'bg-orange-500/20 text-orange-900 dark:text-orange-100' : colors.header,
                    isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-40 backdrop-blur-[2px]',
                    !isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-100',
                    shift.bidding_status !== 'bidding_closed_no_winner' && colors.text,
                    isFullyLocked && !isDnDActive && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-muted dark:bg-slate-700 text-muted-foreground')}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <GripVertical className={cn("h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-40 transition-opacity", isFullyLocked ? "cursor-not-allowed" : "cursor-grab")} />
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-2 flex-shrink-0 cursor-help">
                                    {dot && (
                                        <span className="w-2.5 h-2.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: dot.color }} />
                                    )}
                                    <span className={cn("text-[9px] font-mono font-bold px-1 py-0.5 rounded",
                                        isFullyLocked ? "bg-black/20 dark:bg-black/50 opacity-70" : colors.badge)}>
                                        {stateLabel}
                                    </span>
                                </div>
                            </TooltipTrigger>
                            {dot && (
                                <TooltipContent className="bg-slate-900 text-white border-none py-1.5 px-3 text-[11px] font-bold" style={{ backgroundColor: dot.color }}>
                                    {dot.label}
                                </TooltipContent>
                            )}
                        </Tooltip>
                        <span className="text-xs font-bold uppercase tracking-widest truncate opacity-90">
                            {shift.roster_subgroup?.name || shift.sub_group_name || 'Shift'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {shift.is_from_template && <Badge variant="outline" className="text-[9px] bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 h-4 px-1 gap-1"><CopyPlus className="h-2.5 w-2.5" />Template</Badge>}
                        {(isFullyLocked || isProtected) && (
                            <div className={cn(
                                "flex items-center justify-center rounded p-1 mr-1",
                                isFullyLocked ? "bg-muted dark:bg-slate-800" : "bg-amber-500/10"
                            )}>
                                <Lock className={cn(
                                    "h-3.5 w-3.5",
                                    isFullyLocked ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                                )} />
                            </div>
                        )}
                        {getLifecycleIcon(statusStr)}
                        {headerAction || (!isFullyLocked && (
                          <button className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-1">
                            <MoreHorizontal className="h-4 w-4 opacity-50" />
                          </button>
                        ))}
                    </div>
                </div>

                {/* Body — greyscaled for past shifts while header (dot) stays crisp */}
                <div className={cn("p-4 space-y-3 relative z-[20]",
                    !isDnDActive && isPast && dot !== null && "grayscale opacity-60")}>
                    <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border border-border">
                            <AvatarFallback className={cn('text-xs font-bold', employeeName ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground')}>
                                {employeeName ? getInitials(employeeName) : <User className="h-4 w-4" />}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{employeeName || 'Unassigned'}</p>
                            <p className="text-xs text-muted-foreground truncate">{roleName}</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="bg-muted/50 rounded-lg px-3 py-1.5 flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-mono font-medium text-foreground">{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span>
                        </div>
                        {totalHours && <Badge variant="secondary" className="text-xs">{totalHours}h net</Badge>}
                    </div>

                    {hasComplianceIssue && (
                        <div className={cn('rounded-lg p-2.5 text-xs border', compliance?.status === 'violation' ? 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300')}>
                            <div className="flex items-center gap-1.5 font-semibold mb-1"><AlertTriangle className="h-3.5 w-3.5" />{compliance?.status === 'violation' ? 'Compliance Violation' : 'Compliance Warning'}</div>
                            <ul className="space-y-0.5 pl-5 list-disc">
                                {compliance?.violations.map((v, i) => <li key={`v-${i}`}>{v}</li>)}
                                {compliance?.warnings.map((w, i) => <li key={`w-${i}`}>{w}</li>)}
                            </ul>
                        </div>
                    )}

                    {shift.notes && <p className="text-xs text-muted-foreground italic truncate">{shift.notes}</p>}
                </div>
            </div>

            {/* DnD Blocking Overlay (highest layer) */}
            {isDnDActive && isLocked && isPublished && (
                <div 
                    className="absolute inset-0 bg-stripe-red pointer-events-none rounded-inherit z-[100] border-2 border-red-500/50 shadow-[inset_0_0_20px_rgba(239,68,68,0.3)]" 
                    aria-hidden="true" 
                />
            )}
        </motion.div>
    );
};

export const SmartShiftCard: React.FC<SmartShiftCardProps> = (props) => {
    const { variant = 'compact' } = props;
    
    return variant === 'detailed' ? <DetailedCard {...props} /> : <CompactCard {...props} />;
};

export default SmartShiftCard;
