import React from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { TimesheetStatus } from '../../model/timesheet.types';
import { cn } from '@/modules/core/lib/utils';
import { Bot, CheckCircle, Clock, XCircle, UserX } from 'lucide-react';

interface TimesheetStatusBadgeProps {
    status: TimesheetStatus | string;
    className?: string;
}

export const TimesheetStatusBadge: React.FC<TimesheetStatusBadgeProps> = ({ status, className }) => {
    const s = (status as string || '').toLowerCase();

    if (s === 'auto_approved' || s === 'auto_verified') {
        return (
            <Badge 
                variant="outline" 
                className={cn(
                    "rounded-full border px-3 py-1 text-[9px] font-black tracking-[0.15em] uppercase transition-all duration-500",
                    "backdrop-blur-md bg-emerald-500/15 text-emerald-400 border-emerald-500/20 flex items-center gap-1.5",
                    className
                )}
            >
                <Bot className="h-3 w-3 text-emerald-400 shrink-0" />
                <span className="relative z-10">Auto-Approved</span>
            </Badge>
        );
    }

    if (s === 'approved') {
        return (
            <Badge 
                variant="outline" 
                className={cn(
                    "rounded-full border px-3 py-1 text-[9px] font-black tracking-[0.15em] uppercase transition-all duration-500",
                    "backdrop-blur-md bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1.5",
                    className
                )}
            >
                <CheckCircle className="h-3 w-3 text-emerald-400 shrink-0" />
                <span className="relative z-10">Approved</span>
            </Badge>
        );
    }

    if (s === 'denied' || s === 'rejected') {
        return (
            <Badge 
                variant="outline" 
                className={cn(
                    "rounded-full border px-3 py-1 text-[9px] font-black tracking-[0.15em] uppercase transition-all duration-500",
                    "backdrop-blur-md bg-rose-500/15 text-rose-400 border-rose-500/20 flex items-center gap-1.5",
                    className
                )}
            >
                <XCircle className="h-3 w-3 text-rose-400 shrink-0" />
                <span className="relative z-10">Denied</span>
            </Badge>
        );
    }

    if (s === 'no_show') {
        return (
            <Badge 
                variant="outline" 
                className={cn(
                    "rounded-full border px-3 py-1 text-[9px] font-black tracking-[0.15em] uppercase transition-all duration-500",
                    "backdrop-blur-md bg-red-600/20 text-red-500 border-red-600/20 font-bold flex items-center gap-1.5",
                    className
                )}
            >
                <UserX className="h-3 w-3 text-red-500 shrink-0" />
                <span className="relative z-10">No Show</span>
            </Badge>
        );
    }

    return (
        <Badge 
            variant="outline" 
            className={cn(
                "rounded-full border px-3 py-1 text-[9px] font-black tracking-[0.15em] uppercase transition-all duration-500",
                "backdrop-blur-md bg-amber-500/10 text-amber-500 border-amber-500/20 flex items-center gap-1.5",
                className
            )}
        >
            <Clock className="h-3 w-3 text-amber-500 shrink-0" />
            <span className="relative z-10">Pending</span>
        </Badge>
    );
};
