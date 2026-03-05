import { formatDistanceToNow, format } from 'date-fns';
import { Link2, Undo2, Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { ShiftSnapshot } from '../types/audit-types';
import { getEventIcon, getRoleIcon, BatchIcon } from '../utils/event-icons';
import { cn } from '@/modules/core/lib/utils';

interface TimelineEventProps {
    snapshot: ShiftSnapshot;
    isLast: boolean;
    onRevert?: (snapshotId: string) => void;
}

// Fields to show in summary (human-readable labels)
const DISPLAY_FIELDS: Record<string, string> = {
    shift_date: 'Date',
    start_time: 'Start Time',
    end_time: 'End Time',
    status: 'Status',
    lifecycle_status: 'Lifecycle',
    assigned_employee_id: 'Employee',
    role_id: 'Role',
    is_draft: 'Draft',
    is_published: 'Published',
    is_on_bidding: 'On Bidding',
    department_id: 'Department',
    sub_department_id: 'Sub-Department',
    notes: 'Notes',
};

// Format snapshot data into human-readable summary
function formatSnapshotSummary(data: any): { label: string; value: string }[] {
    if (!data || typeof data !== 'object') return [];

    const summary: { label: string; value: string }[] = [];

    for (const [key, label] of Object.entries(DISPLAY_FIELDS)) {
        if (data[key] !== undefined && data[key] !== null) {
            let value = data[key];

            // Format specific types
            if (typeof value === 'boolean') {
                value = value ? 'Yes' : 'No';
            } else if (key.includes('_id') && typeof value === 'string' && value.length > 8) {
                // Truncate UUIDs
                value = `#${value.slice(0, 6)}`;
            } else if (key === 'shift_date' && value) {
                try {
                    value = format(new Date(value), 'MMM dd, yyyy');
                } catch { /* keep original */ }
            } else if ((key === 'start_time' || key === 'end_time') && value) {
                value = value.slice(0, 5); // HH:MM format
            }

            summary.push({ label, value: String(value) });
        }
    }

    return summary.slice(0, 8); // Limit to 8 fields
}

/**
 * Enhanced Timeline Event with:
 * - Event-specific icons with color coding
 * - Role-based "Who" badges
 * - Inline diff display
 * - Batch grouping indicators
 * - Revert functionality
 */
export function TimelineEvent({ snapshot, isLast, onRevert }: TimelineEventProps) {
    const [linkCopied, setLinkCopied] = useState(false);
    const iconConfig = getEventIcon(snapshot.event_type);
    const Icon = iconConfig.icon;
    const RoleIcon = getRoleIcon(snapshot.performed_by_role || 'employee');

    // Check if this event can be reverted
    const isRevertible = ['employee_unassigned', 'unpublished', 'cancelled', 'removed_from_bidding'].includes(
        snapshot.event_type
    );

    const isBatchEvent = snapshot.batch_id != null;

    // Get formatted summary for display
    const dataSummary = formatSnapshotSummary(snapshot.data);

    // Handle copy link
    const handleCopyLink = () => {
        const url = `${window.location.origin}${window.location.pathname}#event-${snapshot.id}`;
        navigator.clipboard.writeText(url);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    };

    return (
        <div className="relative" id={`event-${snapshot.id}`}>
            {/* Timeline line */}
            {!isLast && <div className="absolute left-6 top-12 bottom-0 w-px bg-border group-hover:bg-primary/20 transition-colors" />}

            {/* Event card */}
            <div className="flex gap-4 pb-6 group">
                {/* Icon with category color */}
                <div
                    className={cn(
                        "flex-shrink-0 w-12 h-12 rounded-full border border-border flex items-center justify-center relative z-10 shadow-sm transition-all group-hover:scale-105",
                        iconConfig.bgColor
                    )}
                >
                    <Icon className={cn("w-5 h-5", iconConfig.color)} />
                </div>

                {/* Content */}
                <div className="flex-1 bg-card border border-border rounded-xl p-5 hover:bg-muted/20 transition-all shadow-sm group-hover:shadow-md group-hover:border-primary/20">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                            {/* Title with batch indicator */}
                            <div className="flex items-center gap-3 mb-1.5">
                                <h3 className="font-bold text-foreground tracking-tight">{iconConfig.label}</h3>
                                {isBatchEvent && (
                                    <div
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-xs"
                                        title="Part of bulk operation"
                                    >
                                        <BatchIcon className="w-3 h-3" />
                                        Batch
                                    </div>
                                )}
                            </div>

                            {/* Who, when, and role badge */}
                            <div className="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest text-muted-foreground/60 flex-wrap">
                                {/* Who badge with role icon */}
                                <div className="inline-flex items-center gap-1.5">
                                    <RoleIcon className="w-3.5 h-3.5" />
                                    <span className="text-foreground">{snapshot.performed_by_name}</span>
                                    {snapshot.performed_by_role && (
                                        <span className="text-primary/60 italic">({snapshot.performed_by_role})</span>
                                    )}
                                </div>
                                <span>•</span>
                                <span>
                                    {snapshot.performed_at
                                        ? format(new Date(snapshot.performed_at), 'MMM dd, HH:mm')
                                        : '-'}
                                </span>
                                <span>•</span>
                                <span>
                                    {snapshot.performed_at
                                        ? formatDistanceToNow(new Date(snapshot.performed_at), { addSuffix: true })
                                        : '-'}
                                </span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            {isRevertible && onRevert && (
                                <button
                                    onClick={() => onRevert(snapshot.id)}
                                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-amber-500/10 transition-colors"
                                    title="Revert this change"
                                >
                                    <Undo2 className="w-3 h-3" />
                                    Revert
                                </button>
                            )}
                            <button
                                onClick={handleCopyLink}
                                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
                            >
                                {linkCopied ? (
                                    <>
                                        <Check className="w-3 h-3 text-green-400" />
                                        <span className="text-green-400">Copied!</span>
                                    </>
                                ) : (
                                    <>
                                        <Link2 className="w-3 h-3" />
                                        Copy Link
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Inline Diff for Field Changes */}
                    {snapshot.changes && snapshot.changes.length > 0 && (
                        <div className="bg-muted/30 border border-border/50 rounded-lg p-4 mt-4 space-y-3">
                            <div className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.15em] mb-2">Changes</div>
                            {snapshot.changes.map((change, idx) => (
                                <div key={idx} className="flex items-baseline gap-3 text-sm">
                                    <div className="w-32 text-muted-foreground font-medium">
                                        {DISPLAY_FIELDS[change.field] || change.field}
                                    </div>
                                    <div className="flex items-baseline gap-2 flex-1 font-mono text-xs">
                                        {(change.oldValue != null || change.before != null) && (
                                            <span className="text-red-500/80 line-through">
                                                {String(change.oldValue ?? change.before)}
                                            </span>
                                        )}
                                        <span className="text-muted-foreground/50">→</span>
                                        <span className="text-emerald-500 font-bold">
                                            {String(change.newValue ?? change.after ?? 'null')}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Formatted snapshot summary (instead of raw JSON) */}
                    {(!snapshot.changes || snapshot.changes.length === 0) && dataSummary.length > 0 && (
                        <div className="bg-muted/30 border border-border/50 rounded-lg p-4 mt-4">
                            <div className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.15em] mb-3">
                                Initial State
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {dataSummary.map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground/70 font-medium">{item.label}</span>
                                        <span className="text-foreground font-bold">{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty state */}
                    {(!snapshot.changes || snapshot.changes.length === 0) && dataSummary.length === 0 && (
                        <div className="bg-muted/30 border border-border/50 rounded-lg p-4 mt-4 text-center text-xs font-medium text-muted-foreground/60 italic">
                            No additional details available
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
