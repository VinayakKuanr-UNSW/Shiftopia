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
        'DRAFT': 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
        'SUBMITTED': 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
        'APPROVED': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        'REJECTED': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
        'LOCKED': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    };

    const variant = variants[s] || 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';

    return (
        <Badge variant="outline" className={`${variant} ${className}`}>
            {s}
        </Badge>
    );
};
