import React from 'react';
import { TimesheetAuditEntry } from "../../model/audit.types";
import { AuditTrailItem } from './AuditTrailItem';
import { X } from 'lucide-react';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';

interface AuditTrailProps {
    events: TimesheetAuditEntry[];
    onClose: () => void;
    showAsPage?: boolean;
}

export const AuditTrail: React.FC<AuditTrailProps> = ({
    events,
    onClose,
    showAsPage = false,
}) => {
    if (!events?.length) return null;

    const sorted = [...events].sort(
        (a, b) => +new Date(b.performedAt) - +new Date(a.performedAt),
    );

    if (showAsPage) {
        // Full page layout
        return (
            <div className="w-full">
                <ScrollArea className="h-[calc(100vh-400px)] pr-4">
                    <ul className="space-y-6">
                        {sorted.map((event) => (
                            <AuditTrailItem key={event.id} event={event} />
                        ))}
                    </ul>
                </ScrollArea>
            </div>
        );
    }

    // Modal layout
    return (
        <div className="bg-[#131516] text-slate-100 rounded-2xl shadow-xl w-80 max-h-[80vh] p-6">
            <header className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                    Audit Trail
                </h2>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 rounded"
                >
                    <X size={20} />
                    <span className="sr-only">Close audit trail</span>
                </button>
            </header>

            <ul className="space-y-5 overflow-y-auto pr-1">
                {sorted.map((event) => (
                    <AuditTrailItem key={event.id} event={event} />
                ))}
            </ul>
        </div>
    );
};
