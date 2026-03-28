import React from 'react';

export type ShiftStatus =
    | 'Completed'
    | 'Cancelled'
    | 'Active'
    | 'No-Show'
    | 'Swapped'
    | 'InProgress'
    | 'Published'
    | 'Draft'
    | 'scheduled';

interface ShiftStatusBadgeProps {
    status: ShiftStatus | string;
}

export const ShiftStatusBadge: React.FC<ShiftStatusBadgeProps> = ({ status }) => {
    let bgColor = 'bg-gray-500/20';
    let textColor = 'text-gray-500 dark:text-gray-400';
    let borderColor = 'border-gray-500/30';
    let pulse = false;
    let label = status;

    switch (status) {
        case 'Completed':
            bgColor = 'bg-emerald-500/10';
            textColor = 'text-emerald-600 dark:text-emerald-400';
            borderColor = 'border-emerald-500/20';
            break;
        case 'Cancelled':
            bgColor = 'bg-rose-500/10';
            textColor = 'text-rose-600 dark:text-rose-400';
            borderColor = 'border-rose-500/20';
            break;
        case 'Active':
        case 'Published':
        case 'scheduled':
            bgColor = 'bg-blue-500/10';
            textColor = 'text-blue-600 dark:text-blue-400';
            borderColor = 'border-blue-500/20';
            label = status === 'scheduled' ? 'Scheduled' : status;
            break;
        case 'InProgress':
            bgColor = 'bg-amber-500/10';
            textColor = 'text-amber-600 dark:text-amber-400';
            borderColor = 'border-amber-500/20';
            pulse = true;
            label = 'In Progress';
            break;
        case 'No-Show':
            bgColor = 'bg-red-500/10';
            textColor = 'text-red-600 dark:text-red-400';
            borderColor = 'border-red-500/20';
            break;
        case 'Swapped':
            bgColor = 'bg-violet-500/10';
            textColor = 'text-violet-600 dark:text-violet-400';
            borderColor = 'border-violet-500/20';
            break;
        case 'Draft':
            bgColor = 'bg-slate-500/10';
            textColor = 'text-slate-600 dark:text-slate-400';
            borderColor = 'border-slate-500/20';
            break;
    }

    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${bgColor} ${textColor} border ${borderColor}`}>
            {pulse && (
                <span className="relative flex h-1.5 w-1.5">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${bgColor.replace('/10', '/60')}`} />
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500`} />
                </span>
            )}
            {label}
        </span>
    );
};
