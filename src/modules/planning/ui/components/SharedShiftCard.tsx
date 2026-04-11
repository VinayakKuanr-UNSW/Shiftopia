import React from 'react';
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
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { ShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { getStatusDotInfo } from '@/modules/rosters/domain/shift-ui';

export interface SharedShiftCardProps {
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
    groupVariant?: 'convention' | 'exhibition' | 'theatre' | 'default';
    complianceLabel?: string;
    statusIcons?: React.ReactNode;
    footerActions?: React.ReactNode;
    topContent?: React.ReactNode;
    className?: string;
    onClick?: () => void;
    variant?: 'default' | 'nested';
    /** Standardised shift for status dot derivation */
    shiftData?: any;
}

export const SharedShiftCard: React.FC<SharedShiftCardProps> = ({
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
    statusIcons,
    footerActions,
    topContent,
    className,
    onClick,
    variant = 'default',
    shiftData,
}) => {
    // Premium Department Color Styling (Badges)
    const getVariant = () => {
        const base = 'dept-card-glass-base';
        switch (groupVariant) {
            case 'convention': return { 
                badge: 'dept-badge-convention', 
                cardBg: `${base} dept-card-glass-convention`,
                accent: 'text-blue-500'
            };
            case 'exhibition': return { 
                badge: 'dept-badge-exhibition', 
                cardBg: `${base} dept-card-glass-exhibition`,
                accent: 'text-emerald-500'
            };
            case 'theatre': return { 
                badge: 'dept-badge-theatre', 
                cardBg: `${base} dept-card-glass-theatre`,
                accent: 'text-rose-500'
            };
            default: return { 
                badge: 'dept-badge-default', 
                cardBg: `${base} dept-card-glass-default`,
                accent: 'text-primary'
            };
        }
    };

    const isNested = variant === 'nested';

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
                <div className="text-[9px] text-muted-foreground/40 mb-1 tracking-tight font-mono font-black uppercase flex items-center gap-1">
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

                {/* ROLE + PRIORITY */}
                <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-black text-sm text-foreground/90 tracking-tight leading-tight uppercase font-mono">
                        {role}
                    </h3>
                    <div className="flex items-center gap-1.5">
                        {(() => {
                            const dot = shiftData ? getStatusDotInfo(shiftData) : null;
                            if (!dot) return null;
                            return (
                                <TooltipProvider delayDuration={0}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded-md border border-border/50 cursor-help transition-colors hover:bg-black/10 dark:hover:bg-white/10">
                                                <div
                                                    className="h-1.5 w-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.2)]"
                                                    style={{ backgroundColor: dot.color }}
                                                />
                                                <span className="text-[9px] font-black font-mono text-muted-foreground/70">
                                                    {dot.label.split(' ')[0].substring(0, 3).toUpperCase()}
                                                </span>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="bg-popover/95 backdrop-blur-md border-border/50 px-2 py-1 shadow-xl">
                                            <p className="text-[10px] font-bold uppercase tracking-widest">{dot.label}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            );
                        })()}
                        {urgency === 'emergent' ? (
                            <Badge variant="outline" className="flex items-center gap-1 text-[8px] px-1.5 py-0 font-black uppercase tracking-tighter bg-rose-500/10 text-rose-500 border-rose-500/20 animate-[pulse_0.8s_ease-in-out_infinite]">
                                <Flame className="h-2.5 w-2.5" /> Emergent
                            </Badge>
                        ) : urgency === 'urgent' || (!urgency && isUrgent) ? (
                            <Badge variant="outline" className="flex items-center gap-1 text-[8px] px-1.5 py-0 font-black uppercase tracking-tighter bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse">
                                <Zap className="h-2.5 w-2.5" /> Urgent
                            </Badge>
                        ) : urgency === 'normal' ? (
                            <Badge variant="outline" className="flex items-center gap-1 text-[8px] px-1.5 py-0 font-black uppercase tracking-tighter bg-slate-500/10 text-muted-foreground border-slate-500/20">
                                <Signal className="h-2.5 w-2.5" /> Normal
                            </Badge>
                        ) : null}
                    </div>
                </div>

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
                </div>

                {/* BREAKS & LENGTH */}
                <div className="flex items-center gap-2 mb-3 text-[9px] tracking-widest text-muted-foreground/50 uppercase font-black">
                    <div className="flex items-center gap-1">
                        <span className="font-black font-mono">Paid {paidBreak}m · Unpaid {unpaidBreak}m</span>
                    </div>
                    <span className="text-border">|</span>
                    <span className="text-primary font-black font-mono">Net Length: {(netLength / 60).toFixed(1)}h</span>
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
            <div className={cn("flex flex-col h-full", className)} onClick={onClick}>
                {content}
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "group flex flex-col rounded-[1.2rem] overflow-hidden border transition-all duration-300 bg-card/40 backdrop-blur-xl shadow-lg h-full relative",
                getVariant().cardBg,
                onClick && "cursor-pointer hover:shadow-2xl hover:translate-y-[-2px] hover:border-primary/40",
                isExpired && "opacity-60 grayscale-[0.8]",
                className
            )}
            onClick={onClick}
        >
            {content}
        </motion.div>
    );
};
