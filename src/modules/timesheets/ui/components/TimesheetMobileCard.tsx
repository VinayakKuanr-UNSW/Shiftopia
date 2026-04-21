import React, { useState, useMemo } from 'react';
import {
    UserX,
    ArrowRight,
    Edit3,
    CheckSquare,
    Check,
    X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { useToast } from '@/modules/core/hooks/use-toast';
import { getProtectionContext } from '@/modules/rosters/domain/shift-ui';
import { TimesheetStatusBadge } from './TimesheetStatusBadge';
import { getGroupColor } from '@/modules/rosters/model/roster.types';
import type { TimesheetRow } from '../../model/timesheet.types';
import { isShiftFinished } from './TimesheetTable.utils';

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

export const TimesheetMobileCard: React.FC<TimesheetMobileCardProps> = ({
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
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localAdjStart, setLocalAdjStart] = useState(entry.adjustedStart || '');
    const [localAdjEnd, setLocalAdjEnd] = useState(entry.adjustedEnd || '');
    const [localPaidBreak, setLocalPaidBreak] = useState(entry.paidBreak || '0');
    const [localUnpaidBreak, setLocalUnpaidBreak] = useState(entry.unpaidBreak || '0');

    const { toast } = useToast();

    const isShiftOver = useMemo(() => 
        isShiftFinished(entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut),
    [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut]);

    const isPending = entry.timesheetStatus?.toLowerCase() === 'submitted' || entry.timesheetStatus?.toLowerCase() === 'draft';
    
    const theme = useMemo(() => {
        const group = (entry.group || '').toLowerCase();
        const dept = (entry.department || '').toLowerCase();
        const subDept = (entry.subDepartment || '').toLowerCase();
        const org = (entry.organization || '').toLowerCase();
        
        const isConvention = group.includes('convention') || dept.includes('convention') || subDept.includes('convention') || org.includes('convention');
        const isExhibition = group.includes('exhibition') || dept.includes('exhibition') || subDept.includes('exhibition') || org.includes('exhibition');
        const isTheatre = group.includes('theatre') || dept.includes('theatre') || subDept.includes('theatre') || org.includes('theatre');

        if (isConvention) return { 
            color: '#2563eb', 
            secondary: '#3b82f6', 
            atmosphere: ['#1d4ed8', '#2563eb', '#60a5fa'] 
        };
        
        if (isExhibition) return { 
            color: '#10b981', 
            secondary: '#059669', 
            atmosphere: ['#059669', '#10b981', '#34d399'] 
        };
        
        if (isTheatre) return { 
            color: '#ef4444', 
            secondary: '#dc2626', 
            atmosphere: ['#991b1b', '#ef4444', '#f87171'] 
        };
        
        return { color: '#9333ea', secondary: '#a855f7', atmosphere: ['#7e22ce', '#9333ea', '#c084fc'] };
    }, [entry.group, entry.department, entry.subDepartment, entry.organization]);

    const themeColor = theme.color;

    const isFinalized = useMemo(() => {
        const tsStatus = (entry.timesheetStatus || '').toLowerCase();
        const attStatus = (entry.attendanceStatus || '').toLowerCase();
        return ['approved', 'rejected', 'no_show'].includes(tsStatus) || attStatus === 'no_show';
    }, [entry.timesheetStatus, entry.attendanceStatus]);

    const canAction = isManager && isPending && !readOnly && !isFinalized;
    
    const showNoShowBtn = (!entry.clockIn || entry.clockIn === '-') && (!entry.clockOut || entry.clockOut === '-') && entry.statusDot?.label === 'No Show' && entry.liveStatus === 'Completed' && !readOnly && !!onMarkNoShow && !isFinalized;

    const displayStatus = useMemo(() => getDisplayStatus(entry), [entry]);

    const isPast = useMemo(() => {
        if (!entry.date || !entry.scheduledEnd) return false;
        try {
            const endStr = `${entry.date}T${entry.scheduledEnd}`;
            return new Date(endStr).getTime() < Date.now();
        } catch {
            return false;
        }
    }, [entry.date, entry.scheduledEnd]);

    const protection = useMemo(() => getProtectionContext(
        { lifecycle_status: entry.liveStatus },
        isPast
    ), [entry.liveStatus, isPast]);

    const handleApprove = () => {
        if (!canAction) return;
        onSave?.(String(entry.id), { timesheetStatus: 'approved' } as any);
        toast({ title: 'Approved', description: `Timesheet approved for ${entry.employee}.` });
    };

    const handleReject = () => {
        if (!canAction) return;
        onSave?.(String(entry.id), { timesheetStatus: 'rejected' } as any);
        toast({ title: 'Rejected', description: `Timesheet rejected for ${entry.employee}.` });
    };

    const handleSaveAdjustment = () => {
        onSave?.(String(entry.id), {
            adjustedStart: localAdjStart,
            adjustedEnd: localAdjEnd,
            paidBreak: localPaidBreak,
            unpaidBreak: localUnpaidBreak,
            isAdjustedManual: true,
        } as any);
        setIsEditing(false);
        toast({ title: 'Record Updated', description: 'Timesheet data has been updated.' });
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            style={{ 
                borderColor: isSelected ? themeColor : 'rgba(120, 120, 120, 0.08)',
                boxShadow: isSelected 
                    ? `0 20px 60px -10px ${themeColor}22` 
                    : '0 8px 32px -4px rgba(0,0,0,0.1)'
            }}
            className={cn(
                'relative rounded-[32px] border overflow-hidden transition-all duration-500',
                'backdrop-blur-3xl bg-white/60 dark:bg-zinc-950/95',
                isSelected && 'ring-1 ring-primary/40',
                isPast && !isFinalized && 'grayscale-[0.5] opacity-90'
            )}
        >
            {!hideGlow && (
                <>
                    <div 
                        style={{ 
                            background: `radial-gradient(circle at center, ${theme.atmosphere[0]}, ${theme.atmosphere[1]}, ${theme.atmosphere[2]})`,
                            mixBlendMode: 'screen'
                        }}
                        className="absolute -top-32 -right-32 w-96 h-96 blur-[120px] opacity-[0.35] dark:opacity-[0.2] pointer-events-none" 
                    />
                    <div 
                        style={{ 
                            background: `radial-gradient(circle at center, ${theme.secondary}, ${themeColor}, transparent)`,
                            mixBlendMode: 'screen'
                        }}
                        className="absolute -bottom-48 -right-32 w-80 h-80 blur-[100px] opacity-[0.25] dark:opacity-[0.1] pointer-events-none" 
                    />
                </>
            )}

            <div className="px-6 py-5 relative z-20 h-full flex flex-col">
                <div className="mb-2" />
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
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
                        <div className="min-w-0">
                            <h1 className="text-2xl font-bold text-foreground tracking-tight leading-tight truncate">
                                {entry.employee}
                            </h1>
                            <p className="text-[13px] font-medium text-foreground/40 mt-0.5 tracking-wide">
                                {entry.role}
                            </p>
                        </div>
                    </div>
                </div>

                    <TimesheetStatusBadge
                        status={displayStatus.variant}
                        className="shrink-0"
                    />
                </div>

                {protection.status !== 'DRAFT' && !isFinalized && (
                    <div className="mb-4 flex items-center gap-2">
                        <div className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 border backdrop-blur-md",
                            protection.status === 'LOCKED' ? "bg-slate-500/10 border-slate-500/20 text-slate-500" : "bg-blue-500/10 border-blue-500/20 text-blue-500"
                        )}>
                            <protection.icon className="w-3 h-3" />
                            {protection.label}
                        </div>
                    </div>
                )}

                <div className="space-y-1 mb-6">
                    <DataRow 
                        label="Scheduled" 
                        start={formatTime(entry.scheduledStart)} 
                        end={formatTime(entry.scheduledEnd)} 
                        emphasis 
                    />
                    <div className="h-[1px] w-full bg-foreground/[0.04] my-2" />
                    <DataRow 
                        label="Actual" 
                        start={formatTime(entry.clockIn)} 
                        end={formatTime(entry.clockOut)} 
                        muted={!entry.clockIn || entry.clockIn === '-'}
                    />
                    {isEditing ? (
                        <div 
                            style={{ borderColor: `${themeColor}33`, backgroundColor: `${themeColor}08` }}
                            className="py-3 px-3 my-2 border rounded-2xl flex items-center justify-between transition-all"
                        >
                            <span style={{ color: themeColor }} className="text-[10px] font-bold uppercase tracking-widest">Adjusted</span>
                            <div className="flex items-center gap-3">
                                <input 
                                    value={localAdjStart} 
                                    onChange={e => setLocalAdjStart(e.target.value)} 
                                    className="w-16 bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1 text-xs text-foreground text-center font-bold tabular-nums" 
                                />
                                <ArrowRight className="h-3 w-3 text-primary/40" />
                                <input 
                                    value={localAdjEnd} 
                                    onChange={e => setLocalAdjEnd(e.target.value)} 
                                    className="w-16 bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1 text-xs text-foreground text-center font-bold tabular-nums" 
                                />
                            </div>
                        </div>
                    ) : (
                        <DataRow 
                            label="Adjusted" 
                            start={formatTime(entry.adjustedStart)} 
                            end={formatTime(entry.adjustedEnd)} 
                            muted={!entry.adjustedStart || entry.adjustedStart === '—'}
                            accentColor="primary"
                            style={{ color: themeColor }}
                        />
                    )}
                    {isEditing ? (
                        <div className="py-2 px-3 flex items-center justify-between transition-all">
                            <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest">Breaks (m)</span>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1 bg-foreground/5 px-2 py-1 rounded-lg border border-foreground/5">
                                    <input 
                                        value={localPaidBreak} 
                                        onChange={e => setLocalPaidBreak(e.target.value)} 
                                        className="w-8 bg-transparent text-xs text-foreground text-center font-bold tabular-nums" 
                                    />
                                    <span className="text-[9px] text-foreground/20">P</span>
                                </div>
                                <div className="flex items-center gap-1 bg-foreground/5 px-2 py-1 rounded-lg border border-foreground/5">
                                    <input 
                                        value={localUnpaidBreak} 
                                        onChange={e => setLocalUnpaidBreak(e.target.value)} 
                                        className="w-8 bg-transparent text-xs text-foreground text-center font-bold tabular-nums" 
                                    />
                                    <span className="text-[9px] text-foreground/20">U</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <DataRow 
                            label="Breaks" 
                            start={entry.paidBreak ? `${entry.paidBreak}m` : '0m'} 
                            end={entry.unpaidBreak ? `${entry.unpaidBreak}m` : '0m'} 
                            muted={(!entry.paidBreak || entry.paidBreak === '0') && (!entry.unpaidBreak || entry.unpaidBreak === '0')}
                        />
                    )}
                </div>

                <div className="flex-1" />
                
                {/* Action Area */}
                <div className="flex items-center gap-3">
                    {isEditing ? (
                        <>
                                <Button
                                    onClick={handleSaveAdjustment}
                                    className="flex-1 h-11 rounded-xl font-bold bg-primary text-white p-0 flex items-center justify-center transition-all active:scale-95"
                                >
                                <Check className="h-5 w-5" />
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={() => setIsEditing(false)}
                                className="h-11 w-11 rounded-xl bg-foreground/5 text-foreground/40 hover:text-rose-500 p-0 flex items-center justify-center transition-all active:scale-95"
                            >
                                <X className="h-5 w-5" />
                            </Button>
                        </>
                    ) : isManager ? (
                        canAction ? (
                            <div className="flex-1 flex items-center gap-3">
                                <div className="flex-1 flex gap-1.5 overflow-hidden">
                                    <Button
                                        onClick={handleApprove}
                                        disabled={!isShiftOver}
                                        className="flex-1 h-11 rounded-xl font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 disabled:grayscale p-0 flex items-center justify-center transition-all active:scale-95"
                                    >
                                        <Check className="h-5 w-5" />
                                    </Button>
                                    <Button
                                        onClick={handleReject}
                                        disabled={!isShiftOver}
                                        className="flex-1 h-11 rounded-xl font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:bg-rose-500/20 disabled:opacity-30 disabled:grayscale p-0 flex items-center justify-center transition-all active:scale-95"
                                    >
                                        <X className="h-5 w-5" />
                                    </Button>
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                    {showNoShowBtn && (
                                        <Button
                                            variant="ghost"
                                            onClick={() => onMarkNoShow?.(String(entry.id))}
                                            disabled={!isShiftOver}
                                            className="h-11 w-11 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-500 disabled:opacity-30 p-0 flex items-center justify-center transition-all active:scale-95"
                                        >
                                            <UserX className="h-4 w-4" />
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        onClick={() => setIsEditing(true)}
                                        disabled={!isShiftOver}
                                        className="h-11 w-11 rounded-xl bg-foreground/5 text-foreground/20 hover:text-foreground hover:bg-foreground/10 disabled:opacity-30 p-0 flex items-center justify-center transition-all active:scale-95"
                                    >
                                        <Edit3 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col justify-center">
                                <div className="flex items-center justify-center px-4 py-3 bg-foreground/[0.04] border border-foreground/5 rounded-2xl text-foreground/40 text-[11px] font-black uppercase tracking-widest text-center">
                                    Finalized Record
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="flex-1">
                            {employeeActions}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
