import React from 'react';

export type ShiftStatus = 'Completed' | 'Cancelled' | 'Active' | 'No-Show' | 'Swapped';

interface ShiftStatusBadgeProps {
    status: ShiftStatus;
}

export const ShiftStatusBadge: React.FC<ShiftStatusBadgeProps> = ({ status }) => {
    let bgColor = 'bg-gray-500/20';
    let textColor = 'text-gray-300';
    let borderColor = 'border-gray-500/30';

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
            bgColor = 'bg-blue-500/10';
            textColor = 'text-blue-600 dark:text-blue-400';
            borderColor = 'border-blue-500/20';
            break;
        case 'No-Show':
            bgColor = 'bg-amber-500/10';
            textColor = 'text-amber-600 dark:text-amber-400';
            borderColor = 'border-amber-500/20';
            break;
        case 'Swapped':
            bgColor = 'bg-violet-500/10';
            textColor = 'text-violet-600 dark:text-violet-400';
            borderColor = 'border-violet-500/20';
            break;
    }

    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${bgColor} ${textColor} border ${borderColor}`}>
            {status}
        </span>
    );
};
