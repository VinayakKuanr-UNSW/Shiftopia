
import React from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';

interface BidStatusBadgeProps {
    status: string;
    iteration?: number;
}

const STATUS_CONFIG: Record<string, { cls: string; label: string }> = {
    pending:         { cls: 'bg-yellow-500 hover:bg-yellow-600',  label: 'Pending' },
    accepted:        { cls: 'bg-green-500 hover:bg-green-600',    label: 'Accepted' },
    selected:        { cls: 'bg-emerald-500 hover:bg-emerald-600',label: 'Selected' },
    confirmed:       { cls: 'bg-blue-500 hover:bg-blue-600',      label: 'Confirmed' },
    rejected:        { cls: 'bg-red-500 hover:bg-red-600',        label: 'Rejected' },
    not_eligible:    { cls: 'bg-rose-700 hover:bg-rose-800',      label: 'Not Eligible' },
    not_participated:{ cls: 'bg-slate-500 hover:bg-slate-600',    label: 'Not Bid' },
    expired:         { cls: 'bg-slate-600 hover:bg-slate-700',    label: 'Expired' },
};

export const BidStatusBadge = React.memo(({ status, iteration }: BidStatusBadgeProps) => {
    const key = status.toLowerCase();
    const config = STATUS_CONFIG[key] ?? { cls: 'bg-gray-500 hover:bg-gray-600', label: status };

    return (
        <div className="flex items-center gap-1.5">
            <Badge className={`${config.cls} text-[10px] font-bold uppercase tracking-tight`}>
                {config.label}
            </Badge>
            {iteration && iteration > 1 && (
                <span className="text-[9px] font-mono font-bold text-muted-foreground/30 bg-muted/20 px-1 rounded uppercase">
                    ITR {iteration}
                </span>
            )}
        </div>
    );
});
