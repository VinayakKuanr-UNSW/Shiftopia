
import React from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';

interface BidStatusBadgeProps {
    status: string;
}

export const BidStatusBadge = React.memo(({ status }: BidStatusBadgeProps) => {
    const getStatusColor = () => {
        // Handle both lowercase and titlecase
        const s = status.toLowerCase();
        switch (s) {
            case 'pending':
                return 'bg-yellow-500 hover:bg-yellow-600';
            case 'approved':
                return 'bg-green-500 hover:bg-green-600';
            case 'confirmed':
                return 'bg-blue-500 hover:bg-blue-600';
            case 'rejected':
                return 'bg-red-500 hover:bg-red-600';
            default:
                return 'bg-gray-500 hover:bg-gray-600';
        }
    };

    return (
        <Badge className={`${getStatusColor()} text-xs font-medium`}>
            {status}
        </Badge>
    );
});
