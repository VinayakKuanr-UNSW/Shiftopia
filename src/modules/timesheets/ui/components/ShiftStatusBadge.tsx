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
            bgColor = 'bg-green-500/20';
            textColor = 'text-green-300';
            borderColor = 'border-green-500/30';
            break;
        case 'Cancelled':
            bgColor = 'bg-red-500/20';
            textColor = 'text-red-300';
            borderColor = 'border-red-500/30';
            break;
        case 'Active':
            bgColor = 'bg-blue-500/20';
            textColor = 'text-blue-300';
            borderColor = 'border-blue-500/30';
            break;
        case 'No-Show':
            bgColor = 'bg-yellow-500/20';
            textColor = 'text-yellow-300';
            borderColor = 'border-yellow-500/30';
            break;
        case 'Swapped':
            bgColor = 'bg-purple-500/20';
            textColor = 'text-purple-300';
            borderColor = 'border-purple-500/30';
            break;
    }

    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${bgColor} ${textColor} border ${borderColor}`}>
            {status}
        </span>
    );
};
