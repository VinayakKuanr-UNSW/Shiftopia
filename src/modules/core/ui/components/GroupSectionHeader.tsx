import React from 'react';
import { cn } from '@/modules/core/lib/utils';

interface GroupSectionHeaderProps {
    label: string;
    count: number;
    /** Highlight (e.g. "Today") — matches the emerald treatment used on date buckets. */
    emphasized?: boolean;
    itemNoun?: string;
    className?: string;
}

/**
 * Shared bucket header — label + hairline + item count. Used for every
 * Group By dimension (date, group, sub-group, role, status) on both
 * My Attendance and Timesheets so section headers look identical everywhere.
 */
export const GroupSectionHeader: React.FC<GroupSectionHeaderProps> = ({
    label,
    count,
    emphasized = false,
    itemNoun = 'shift',
    className,
}) => (
    <div className={cn('flex items-center gap-3 mb-3', className)}>
        <div className={cn(
            'text-xs font-black uppercase tracking-widest font-mono',
            emphasized ? 'text-emerald-500' : 'text-muted-foreground',
        )}>
            {label}
        </div>
        <div className="flex-1 h-px bg-border" />
        <div className="text-[10px] text-muted-foreground/60 font-mono">
            {count} {itemNoun}{count === 1 ? '' : 's'}
        </div>
    </div>
);

export default GroupSectionHeader;
