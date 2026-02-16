import React from 'react';
import { EVENT_META } from "./auditTrailMeta";
import type { TimesheetAuditEntry } from "../../../model/audit.types";
import { cn } from "@/modules/core/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";

export interface AuditTrailItemProps {
    event: TimesheetAuditEntry;
}

export const AuditTrailItem: React.FC<AuditTrailItemProps> = ({ event }) => {
    const meta = EVENT_META[event.action] || EVENT_META.UNKNOWN;

    return (
        <li className="flex justify-between">
            {/* icon + labels */}
            <div className="flex gap-4">
                <meta.Icon
                    aria-hidden
                    size={22}
                    strokeWidth={2.3}
                    className={cn(meta.color, "audit-trail-icon")}
                />

                <div>
                    <p className="text-sm font-medium">{meta.label}</p>
                    <p className="text-xs text-slate-400">{meta.sub}</p>
                    {event.reason && (
                        <p className="text-xs text-slate-500 mt-1 italic">
                            "{event.reason}"
                        </p>
                    )}
                </div>
            </div>

            {/* semantic time */}
            <time
                aria-hidden="true"
                dateTime={new Date(event.performedAt).toISOString()}
                className="text-xs text-slate-500"
            >
                {formatDistanceToNowStrict(new Date(event.performedAt), { addSuffix: true })}
            </time>
        </li>
    );
};
