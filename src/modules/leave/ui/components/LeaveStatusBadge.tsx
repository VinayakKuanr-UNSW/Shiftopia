/**
 * A request's status as a reader understands it — including "Revoked", which
 * the database stores as `cancelled` (see `displayStatus`).
 */
import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { displayStatus, type LeaveDisplayStatus } from '../../domain/leave-approval';
import type { LeaveRequest } from '../../model/leave.types';

const STYLES: Record<LeaveDisplayStatus, string> = {
    pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
    approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    rejected: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
    cancelled: 'bg-muted text-muted-foreground border-border',
    revoked: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/25',
};

const LABELS: Record<LeaveDisplayStatus, string> = {
    pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
    cancelled: 'Withdrawn', revoked: 'Revoked',
};

export const LeaveStatusBadge: React.FC<{
    request: Pick<LeaveRequest, 'status' | 'approvedBy'>;
    className?: string;
}> = ({ request, className }) => {
    const s = displayStatus(request);
    return (
        <span className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
            STYLES[s], className,
        )}>
            {LABELS[s]}
        </span>
    );
};
