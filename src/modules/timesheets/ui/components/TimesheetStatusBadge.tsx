import React from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { TimesheetStatus } from '../../model/timesheet.types';

interface TimesheetStatusBadgeProps {
    status: TimesheetStatus | string;
    className?: string;
}

export const TimesheetStatusBadge: React.FC<TimesheetStatusBadgeProps> = ({ status, className }) => {
    const s = (status as string).toUpperCase();

    const variants: Record<string, string> = {
        'DRAFT': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        'SUBMITTED': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        'APPROVED': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        'REJECTED': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
        'LOCKED': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    };

    const variant = variants[s] || 'bg-slate-500/20 text-slate-400 border-slate-500/30';

    return (
        <Badge variant="outline" className={`${variant} ${className}`}>
            {s}
        </Badge>
    );
};
