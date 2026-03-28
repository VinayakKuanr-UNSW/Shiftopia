/**
 * SmartShiftCard - Phase 2 Enterprise Component
 *
 * A "Smart Card" with two rendering modes:
 * - Compact: Minimal footprint for grid views (replaces ShiftCardCompact in dense layouts)
 * - Detailed: Full info card with compliance warnings, skills, and actions
 *
 * RESPONSIBILITIES:
 * - Render shift data in both compact and detailed variants
 * - Show inline compliance warnings (violations/warnings)
 * - Display assignment status, bidding status, lifecycle state
 * - Support drag-and-drop via isDragging prop
 * - Support selection via isSelected/onSelect
 *
 * MUST NOT:
 * - Fetch data directly (receives shift as prop)
 * - Mutate shift state (emits events via callbacks)
 */

import React, { useMemo } from 'react';
import {
    Clock,
    User,
    UserCheck,
    UserPlus,
    UserX,
    AlertTriangle,
    Shield,
    ShieldAlert,
    ShieldCheck,
    Gavel,
    ArrowLeftRight,
    Zap,
    MailOpen,
    BadgeCheck,
    Megaphone,
    Edit,
    XCircle,
    CheckCircle,
    Hourglass,
    GripVertical,
    MoreHorizontal,
    Flame,
    Ban,
    Minus,
    Circle,
    HelpCircle,
    Lock,
    CopyPlus,
    Loader2,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import type { Shift } from '../../domain/shift.entity';
import { determineShiftState } from '../../domain/shift-state.utils';
import { computeBiddingUrgency, isOnBidding } from '../../domain/bidding-urgency';
import { AttendanceBadge } from './AttendanceBadge';

// ============================================================================
// STATUS ICONS HELPER
// ============================================================================

const ShiftStatusIcons: React.FC<{ shift: Shift; isLocked?: boolean }> = ({ shift, isLocked }) => {
    const isDraft = (shift.lifecycle_status?.toLowerCase() === 'draft');
    const isPublished = shift.lifecycle_status === 'Published';
    
    const isAssigned = !!shift.assigned_employee_id;
    
    const _isOnBidding = isOnBidding(shift.bidding_status);
    const _biddingUrgency = _isOnBidding ? computeBiddingUrgency(shift.shift_date, shift.start_time) : null;
    const isBiddingNormal = _isOnBidding && _biddingUrgency === 'normal';
    const isBiddingUrgent = _isOnBidding && _biddingUrgency === 'urgent';
    const isBiddingOff = !isBiddingNormal && !isBiddingUrgent;
    
    const isTradeRequested = shift.trading_status === 'TradeRequested';
    const isTradeAccepted = shift.trading_status === 'TradeAccepted';
    const isTrading = isTradeRequested || isTradeAccepted;
    const isTradeUrgent = (shift.bidding_priority_text?.toLowerCase() === 'urgent' || shift.bidding_priority_text?.toLowerCase() === 'critical') && isTrading;
    const isTradingOff = !isTrading;

    return (
        <TooltipProvider delayDuration={0}>
            <div className="flex items-center justify-around gap-1 mt-auto pt-1.5 border-t border-border/30 px-1">
                {/* 1. Lifecycle Cluster: Draft/Published */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div>
                            {isPublished ? (
                                <Megaphone className="h-3.5 w-3.5 text-blue-500" />
                            ) : (
                                <Edit className="h-3.5 w-3.5 text-muted-foreground/40" />
                            )}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-[10px] py-1 px-2">
                        {isPublished ? 'Published Shift' : 'Draft Shift'}
                    </TooltipContent>
                </Tooltip>

                {/* 2. Assignment Cluster: Assigned/Unassigned */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div>
                            {isAssigned ? (
                                <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                                <UserX className="h-3.5 w-3.5 text-muted-foreground/40" />
                            )}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-[10px] py-1 px-2">
                        {isAssigned ? 'Assigned' : 'Unassigned'}
                    </TooltipContent>
                </Tooltip>

                {/* 3. Bidding Cluster: Off/Normal/Urgent */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div>
                            {isBiddingUrgent ? (
                                <Flame className="h-3.5 w-3.5 text-orange-600 animate-pulse" />
                            ) : isBiddingNormal ? (
                                <Gavel className="h-3.5 w-3.5 text-amber-500" />
                            ) : (
                                <Gavel className="h-3.5 w-3.5 text-muted-foreground/20" />
                            )}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-[10px] py-1 px-2">
                        {isBiddingUrgent ? 'Urgent Bidding' : isBiddingNormal ? 'Normal Bidding' : 'Bidding Off'}
                    </TooltipContent>
                </Tooltip>

                {/* 4. Trading Cluster: Normal/Urgent / Off */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div>
                            {isTradeUrgent ? (
                                <Zap className="h-3.5 w-3.5 text-red-500" />
                            ) : isTrading ? (
                                <ArrowLeftRight className="h-3.5 w-3.5 text-amber-500" />
                            ) : (
                                <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground/20" />
                            )}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-[10px] py-1 px-2">
                        {isTradeUrgent ? 'Urgent Trade Requested' : isTrading ? 'Trade Requested' : 'Trading Off'}
                    </TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );
};

// ============================================================================
// TYPES
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
    /** The shift data (raw from API, snake_case) */
    shift: Shift;
    /** Rendering variant */
    variant?: ShiftCardVariant;
    /** Optional compliance data (from pre-validation) */
    compliance?: ComplianceInfo;
    /** Click handler */
    onClick?: (e: React.MouseEvent) => void;
    /** Selection state */
    isSelected?: boolean;
    onSelect?: (shiftId: string) => void;
    /** Drag state */
    isDragging?: boolean;
    isDragOver?: boolean;
    /** Custom header action (e.g., context menu trigger) */
    headerAction?: React.ReactNode;
    /** Group color for the header */
    groupColor?: string;
    /** Locked state (e.g. past shift) */
    isLocked?: boolean;
    /** Additional class names */
    className?: string;
    /**
     * When true, compliance is still being evaluated (map entry not yet populated).
     * Renders a loading spinner in the compliance icon slot instead of a result.
     */
    compliancePending?: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

const GROUP_COLORS: Record<string, { header: string; accent: string; text: string; badge: string }> = {
    blue: { 
        header: 'bg-blue-600 dark:bg-blue-600', 
        accent: 'border-blue-500/30', 
        text: 'text-white', 
        badge: 'bg-white/20 dark:bg-white/10' 
    },
    green: { 
        header: 'bg-emerald-600 dark:bg-emerald-600', 
        accent: 'border-emerald-500/30', 
        text: 'text-white', 
        badge: 'bg-white/20 dark:bg-white/10' 
    },
    red: { 
        header: 'bg-red-600 dark:bg-red-600', 
        accent: 'border-red-500/30', 
        text: 'text-white', 
        badge: 'bg-white/20 dark:bg-white/10' 
    },
    orange: { 
        header: 'bg-orange-600 dark:bg-orange-600', 
        accent: 'border-orange-500/30', 
        text: 'text-white', 
        badge: 'bg-white/20 dark:bg-white/10' 
    },
    purple: { 
        header: 'bg-purple-600 dark:bg-purple-600', 
        accent: 'border-purple-500/30', 
        text: 'text-white', 
        badge: 'bg-white/20 dark:bg-white/10' 
    },
    // Map template group types to colors
    convention_centre: { header: 'bg-blue-600', accent: 'border-blue-500/30', text: 'text-white', badge: 'bg-white/20' },
    exhibition_centre: { header: 'bg-emerald-600', accent: 'border-emerald-500/30', text: 'text-white', badge: 'bg-white/20' },
    theatre: { header: 'bg-red-600', accent: 'border-red-500/30', text: 'text-white', badge: 'bg-white/20' },
};

function formatTime(time: string | null): string {
    if (!time) return '--:--';
    const timePart = time.includes('T') ? time.split('T')[1].substring(0, 5) : time;
    const parts = timePart.split(':');
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
    return timePart;
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
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

function getComplianceIcon(status?: ComplianceInfo['status']) {
    if (!status || status === 'compliant') return <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />;
    if (status === 'warning') return <Shield className="h-3.5 w-3.5 text-amber-500" />;
    return <ShieldAlert className="h-3.5 w-3.5 text-red-500" />;
}

// ============================================================================
// COMPACT VARIANT
// ============================================================================

const CompactCard: React.FC<SmartShiftCardProps> = ({
    shift,
    compliance,
    compliancePending,
    onClick,
    isSelected,
    isDragging,
    isDragOver,
    isLocked,
    headerAction,
    groupColor = 'blue',
    className,
}) => {
    const colors = GROUP_COLORS[groupColor] || GROUP_COLORS.blue;
    const employeeName =
        shift.assigned_employee_id
            ? (shift as any).assigned_profiles
                ? `${(shift as any).assigned_profiles.first_name} ${(shift as any).assigned_profiles.last_name}`
                : 'Assigned'
            : null;
    const roleName = shift.roles?.name || 'No Role';
    const hasComplianceIssue = compliance && compliance.status !== 'compliant';

    // Calculate state ID — memoized on the six fields determineShiftState reads,
    // so hover/selection/compliance re-renders don't rerun the state machine.
    const stateId = useMemo(
        () => determineShiftState(shift),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            shift.lifecycle_status,
            shift.is_cancelled,
            shift.assignment_status,
            shift.assignment_outcome,
            shift.bidding_status,
            shift.trade_requested_at,
        ],
    );

    const isDraft = (shift.lifecycle_status?.toLowerCase() === 'draft');

    return (
        <div
            className={cn(
                'relative flex flex-col rounded-lg overflow-hidden border bg-card shadow-sm transition-all h-full group select-none',
                onClick && (!isLocked || isSelected) && 'cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30',
                isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background border-primary/50 bg-primary/5 dark:bg-primary/20',
                isDragging && 'opacity-50 scale-95',
                isDragOver && 'ring-2 ring-blue-400 ring-offset-1',
                hasComplianceIssue && 'border-amber-500/40',
                shift.bidding_status === 'bidding_closed_no_winner' && 'ring-2 ring-orange-500 ring-offset-1 border-orange-500/50 bg-orange-500/5',
                isLocked && shift.bidding_status !== 'bidding_closed_no_winner' && 'opacity-70 grayscale-[0.5] cursor-not-allowed border-dashed',
                isDraft && 'border-dashed opacity-[0.98]',
                !isDraft && !isLocked && 'border-solid',
                className
            )}
            onClick={isLocked ? undefined : onClick}
        >
            {/* Header */}
            <div className={cn('px-3 py-1.5 flex justify-between items-center transition-all duration-300',
                shift.bidding_status === 'bidding_closed_no_winner' ? 'bg-orange-500/20 text-orange-900 dark:text-orange-100' : colors.header,
                isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-40 backdrop-blur-[2px]',
                !isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-100',
                shift.bidding_status !== 'bidding_closed_no_winner' && colors.text,
                isLocked && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-muted dark:bg-slate-700 text-muted-foreground')}>
                {/* State ID Badge */}
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className={cn(
                        "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded",
                        isLocked ? "bg-black/20 dark:bg-black/50 opacity-70" : colors.badge
                    )}>
                        {stateId}
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-widest truncate opacity-80">
                        {shift.roster_subgroup?.name || shift.sub_group_name || roleName}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {shift.is_from_template && (
                        <div className="mr-1" title="From Template">
                            <CopyPlus className="h-3 w-3 opacity-60" />
                        </div>
                    )}
                    {shift.bidding_status === 'bidding_closed_no_winner' ? (
                        <TooltipProvider delayDuration={0}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Lock className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                                </TooltipTrigger>
                                <TooltipContent className="bg-orange-600 text-white border-none py-1 px-2">
                                    <p className="text-[10px] font-medium">Locked (Emergency Only)</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        isLocked && (
                            <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center justify-center bg-amber-500/10 rounded p-0.5">
                                            <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-amber-600 text-white border-none py-1 px-2">
                                        <p className="text-[10px] font-medium">Shift Started & Locked (Read-Only)</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )
                    )}
                    {headerAction || (!isLocked && <MoreHorizontal className="h-3.5 w-3.5 opacity-40" />)}
                </div>
            </div>

            {/* Body */}
            <div className="px-3 py-1.5 flex flex-col gap-1 flex-1">
                {/* Employee & Expired Warning */}
                <div className="flex flex-col items-center justify-center min-h-[20px] gap-0.5">
                    <div className="text-sm font-semibold text-foreground truncate text-center">
                        {employeeName || 'Unassigned'}
                    </div>
                    {(!shift.assigned_employee_id && shift.last_modified_reason?.startsWith('Offer expired')) && (
                        <div className="text-[9px] font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 rounded uppercase tracking-wider">
                            Offer Expired
                        </div>
                    )}
                </div>

                {/* Time */}
                <div className="flex justify-center mb-1">
                    <div className="bg-muted/50 rounded-md px-2 py-0.5 flex items-center gap-1.5 text-[10px]">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono font-medium text-foreground">
                            {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                        </span>
                    </div>
                </div>

                {/* Attendance Badge (InProgress / Completed only) */}
                {(shift.lifecycle_status === 'InProgress' || shift.lifecycle_status === 'Completed') && (
                    <div className="flex justify-center">
                        <AttendanceBadge
                            attendanceStatus={shift.attendance_status ?? 'unknown'}
                            actualStart={shift.actual_start}
                            scheduledStart={`${shift.shift_date}T${shift.start_time}`}
                            actualEnd={shift.actual_end}
                            scheduledEnd={`${shift.shift_date}T${shift.end_time}`}
                            lifecycleStatus={shift.lifecycle_status as 'InProgress' | 'Completed'}
                        />
                    </div>
                )}

                {/* Status Icons Footer */}
                <ShiftStatusIcons shift={shift} isLocked={isLocked} />

            </div>
        </div>
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
    headerAction,
    groupColor = 'blue',
    className,
}) => {
    const colors = GROUP_COLORS[groupColor] || GROUP_COLORS.blue;
    const employeeName =
        shift.assigned_employee_id
            ? (shift as any).assigned_profiles
                ? `${(shift as any).assigned_profiles.first_name} ${(shift as any).assigned_profiles.last_name}`
                : 'Assigned'
            : null;
    const roleName = shift.roles?.name || 'No Role';
    const hasComplianceIssue = compliance && compliance.status !== 'compliant';
    const totalHours = shift.net_length_minutes ? (shift.net_length_minutes / 60).toFixed(1) : null;

    const isDraft = (shift.lifecycle_status?.toLowerCase() === 'draft');

    return (
        <div
            className={cn(
                'relative flex flex-col rounded-xl overflow-hidden border bg-card shadow-sm transition-all group select-none',
                onClick && !isLocked && 'cursor-pointer hover:shadow-lg hover:ring-1 hover:ring-primary/30',
                isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background border-primary/50 bg-primary/5 dark:bg-primary/20',
                isDragging && 'opacity-50 scale-95',
                isDragOver && 'ring-2 ring-blue-400 ring-offset-2',
                hasComplianceIssue && compliance?.status === 'violation' && 'border-red-500/50',
                hasComplianceIssue && compliance?.status === 'warning' && 'border-amber-500/40',
                shift.bidding_status === 'bidding_closed_no_winner' && 'ring-2 ring-orange-500 ring-offset-1 border-orange-500/50 bg-orange-500/5',
                isLocked && shift.bidding_status !== 'bidding_closed_no_winner' && 'opacity-70 grayscale-[0.5] cursor-not-allowed border-dashed',
                isDraft && 'border-dashed opacity-[0.98]',
                !isDraft && !isLocked && 'border-solid',
                className
            )}
            onClick={isLocked ? undefined : onClick}
        >
            {/* Header */}
            <div className={cn('px-4 py-2.5 flex justify-between items-center transition-all duration-300',
                shift.bidding_status === 'bidding_closed_no_winner' ? 'bg-orange-500/20 text-orange-900 dark:text-orange-100' : colors.header,
                isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-40 backdrop-blur-[2px]',
                !isDraft && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-opacity-100',
                shift.bidding_status !== 'bidding_closed_no_winner' && colors.text,
                isLocked && shift.bidding_status !== 'bidding_closed_no_winner' && 'bg-muted dark:bg-slate-700 text-muted-foreground')}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <GripVertical className={cn("h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity", isLocked ? "cursor-not-allowed" : "cursor-grab")} />
                    <span className="text-xs font-bold uppercase tracking-widest truncate opacity-90">
                        {shift.roster_subgroup?.name || shift.sub_group_name || 'Shift'}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    {shift.is_from_template && (
                        <Badge variant="outline" className="text-[9px] bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 h-4 px-1 gap-1">
                            <CopyPlus className="h-2.5 w-2.5" />
                            Template
                        </Badge>
                    )}
                    {shift.bidding_status === 'bidding_closed_no_winner' ? (
                        <TooltipProvider delayDuration={0}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Lock className="h-4 w-4 text-orange-600 dark:text-orange-400 mr-1" />
                                </TooltipTrigger>
                                <TooltipContent className="bg-orange-600 text-white border-none py-1 px-2">
                                    <p className="text-xs font-medium">Shift locked. Only emergency assignment allowed.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        isLocked && (
                            <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center justify-center bg-amber-500/10 rounded p-1 mr-1">
                                            <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-amber-600 text-white border-none py-1 px-2">
                                        <p className="text-xs font-medium">Shift Started & Locked (Read-Only)</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )
                    )}
                    {getLifecycleIcon(shift.lifecycle_status)}
                    {headerAction || (!isLocked && <MoreHorizontal className="h-4 w-4 opacity-50" />)}
                </div>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3">
                {/* Employee + Role */}
                <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 border border-border">
                        <AvatarFallback className={cn(
                            'text-xs font-bold',
                            employeeName ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                        )}>
                            {employeeName ? getInitials(employeeName) : <User className="h-4 w-4" />}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                            {employeeName || 'Unassigned'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{roleName}</p>
                    </div>

                    {/* Assignment outcome badge */}
                    {shift.assignment_outcome && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    {shift.assignment_outcome === 'confirmed' && <BadgeCheck className="h-4 w-4 text-emerald-500" />}
                                    {shift.assignment_outcome === 'offered' && <MailOpen className="h-4 w-4 text-blue-500" />}
                                    {shift.assignment_outcome === 'pending' && <Clock className="h-4 w-4 text-amber-500" />}
                                    {shift.assignment_outcome === 'emergency_assigned' && <Zap className="h-4 w-4 text-red-500" />}
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p className="capitalize">{shift.assignment_outcome.replace('_', ' ')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>

                {/* Time + Duration */}
                <div className="flex items-center justify-between">
                    <div className="bg-muted/50 rounded-lg px-3 py-1.5 flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-mono font-medium text-foreground">
                            {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                        </span>
                    </div>
                    <div className="flex gap-1.5 items-center">
                        {totalHours && (
                            <Badge variant="secondary" className="text-xs">
                                {totalHours}h net
                            </Badge>
                        )}
                        {(!shift.assigned_employee_id && shift.last_modified_reason?.startsWith('Offer expired')) && (
                            <Badge variant="destructive" className="text-[10px] bg-red-500/10 text-red-600 border-red-500/30 font-semibold px-1.5">
                                Offer Expired
                            </Badge>
                        )}
                    </div>
                </div>



                {/* Attendance Badge (InProgress / Completed only) */}
                {(shift.lifecycle_status === 'InProgress' || shift.lifecycle_status === 'Completed') && (
                    <AttendanceBadge
                        attendanceStatus={shift.attendance_status ?? 'unknown'}
                        actualStart={shift.actual_start}
                        scheduledStart={`${shift.shift_date}T${shift.start_time}`}
                        actualEnd={shift.actual_end}
                        scheduledEnd={`${shift.shift_date}T${shift.end_time}`}
                        lifecycleStatus={shift.lifecycle_status as 'InProgress' | 'Completed'}
                    />
                )}

                {/* Required Skills */}
                {shift.required_skills && shift.required_skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {shift.required_skills.map((skill) => (
                            <Badge key={skill} variant="secondary" className="text-[9px] px-1.5 py-0">
                                {skill}
                            </Badge>
                        ))}
                    </div>
                )}

                {/* Compliance Warning */}
                {hasComplianceIssue && (
                    <div
                        className={cn(
                            'rounded-lg p-2.5 text-xs border',
                            compliance?.status === 'violation'
                                ? 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300'
                                : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300'
                        )}
                    >
                        <div className="flex items-center gap-1.5 font-semibold mb-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {compliance?.status === 'violation' ? 'Compliance Violation' : 'Compliance Warning'}
                        </div>
                        <ul className="space-y-0.5 pl-5 list-disc">
                            {compliance?.violations.map((v, i) => (
                                <li key={`v-${i}`}>{v}</li>
                            ))}
                            {compliance?.warnings.map((w, i) => (
                                <li key={`w-${i}`}>{w}</li>
                            ))}
                        </ul>
                        {compliance?.weeklyHours !== undefined && compliance?.maxWeeklyHours && (
                            <p className="mt-1 text-[10px] opacity-80">
                                Weekly: {compliance.weeklyHours.toFixed(1)}h / {compliance.maxWeeklyHours}h
                            </p>
                        )}
                    </div>
                )}

                {/* Notes */}
                {shift.notes && (
                    <p className="text-xs text-muted-foreground italic truncate">{shift.notes}</p>
                )}

                {/* Status Icons Footer */}
                <ShiftStatusIcons shift={shift} isLocked={isLocked} />
            </div>
        </div>
    );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const SmartShiftCard: React.FC<SmartShiftCardProps> = (props) => {
    const { variant = 'compact' } = props;

    if (variant === 'detailed') {
        return <DetailedCard {...props} />;
    }

    return <CompactCard {...props} />;
};

export default SmartShiftCard;
