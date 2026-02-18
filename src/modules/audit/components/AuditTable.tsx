import React, { useState, startTransition } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    ChevronDown,
    ChevronRight,
    User,
    History,
    ExternalLink
} from 'lucide-react';
import type { ShiftAuditGroup, AuditEvent } from '../types/audit-types';
import { cn } from '@/modules/core/lib/utils';

interface AuditTableProps {
    groupedShifts: ShiftAuditGroup[];
    loading: boolean;
}

const eventBadgeColors: Record<string, string> = {
    // Creation
    shift_created_draft: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    shift_created_published: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    // Status
    published: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    unpublished: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    draft_status_changed: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    cancelled: 'bg-red-600/20 text-red-400 border-red-600/30',
    uncancelled: 'bg-green-500/20 text-green-300 border-green-500/30',
    shift_soft_deleted: 'bg-red-700/20 text-red-400 border-red-700/30',
    shift_deleted: 'bg-red-700/20 text-red-400 border-red-700/30',
    shift_completed: 'bg-green-600/20 text-green-400 border-green-600/30',
    // Assignment
    employee_assigned: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    employee_unassigned: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    assignment_swapped: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    // Schedule
    schedule_changed: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
    notes_updated: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
    // Bidding
    pushed_to_bidding: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    removed_from_bidding: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    bid_placed: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    bid_submitted: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    bid_won: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    bid_accepted: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    bid_rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
    bid_withdrawn: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    bid_status_changed: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    // Trading
    trade_requested: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    trade_offer_submitted: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    trade_offer_selected: 'bg-violet-600/20 text-violet-300 border-violet-600/30',
    trade_pending_manager: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    trade_approved: 'bg-green-500/20 text-green-300 border-green-500/30',
    trade_rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
    trade_cancelled: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    trade_expired: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    trade_offer_rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
    trade_offer_withdrawn: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    trade_offer_expired: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    // Modification
    field_updated: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    status_changed: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
};

const eventLabels: Record<string, string> = {
    // Creation
    shift_created_draft: 'Draft Created',
    shift_created_published: 'Created & Published',
    // Status
    published: 'Published',
    unpublished: 'Unpublished',
    draft_status_changed: 'Draft Changed',
    cancelled: 'Cancelled',
    uncancelled: 'Restored',
    shift_soft_deleted: 'Soft Deleted',
    shift_deleted: 'Deleted',
    shift_completed: 'Completed',
    // Assignment
    employee_assigned: 'Assigned',
    employee_unassigned: 'Unassigned',
    assignment_swapped: 'Swapped',
    // Schedule
    schedule_changed: 'Schedule Changed',
    notes_updated: 'Notes Updated',
    // Bidding
    pushed_to_bidding: 'To Bidding',
    removed_from_bidding: 'From Bidding',
    bid_placed: 'Bid Placed',
    bid_submitted: 'Bid Submitted',
    bid_won: 'Bid Won',
    bid_accepted: 'Bid Accepted',
    bid_rejected: 'Bid Rejected',
    bid_withdrawn: 'Bid Withdrawn',
    bid_status_changed: 'Bid Updated',
    // Trading
    trade_requested: 'Trade Requested',
    trade_offer_submitted: 'Offer Submitted',
    trade_offer_selected: 'Offer Selected',
    trade_pending_manager: 'Pending Manager',
    trade_approved: 'Trade Approved',
    trade_rejected: 'Trade Rejected',
    trade_cancelled: 'Trade Cancelled',
    trade_expired: 'Trade Expired',
    trade_offer_rejected: 'Offer Rejected',
    trade_offer_withdrawn: 'Offer Withdrawn',
    trade_offer_expired: 'Offer Expired',
    // Modification
    field_updated: 'Updated',
    status_changed: 'Status Changed',
};

function EventBadge({ eventType }: { eventType: string }) {
    return (
        <span className={cn(
            'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border',
            eventBadgeColors[eventType] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
        )}>
            {eventLabels[eventType] || eventType.replace(/_/g, ' ')}
        </span>
    );
}

function EventTimeline({ events }: { events: AuditEvent[] }) {
    return (
        <div className="px-6 py-4 bg-slate-900/80 border-t border-slate-700/30">
            <div className="space-y-3">
                {events.map((event, index) => {
                    const snap = event.snapshot || {};
                    return (
                        <div
                            key={event.id}
                            className="flex items-start gap-4"
                        >
                            {/* Timeline connector */}
                            <div className="flex flex-col items-center pt-1">
                                <div className={cn(
                                    'w-2.5 h-2.5 rounded-full ring-2 ring-offset-2 ring-offset-slate-900',
                                    index === events.length - 1
                                        ? 'bg-emerald-400 ring-emerald-400/30'
                                        : 'bg-slate-500 ring-slate-500/30'
                                )} />
                                {index < events.length - 1 && (
                                    <div className="w-0.5 flex-1 min-h-[24px] bg-gradient-to-b from-slate-600 to-slate-700 mt-1" />
                                )}
                            </div>

                            {/* Event content */}
                            <div className="flex-1 min-w-0 pb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <EventBadge eventType={event.event_type} />
                                    {event.changes && event.changes.length > 0 && (
                                        <span className="text-gray-400 text-xs bg-slate-800/50 px-2 py-0.5 rounded">
                                            {event.changes[0].field}:
                                            <span className="text-red-400/70 line-through mx-1">{event.changes[0].before || '—'}</span>

                                            <span className="text-emerald-400">{event.changes[0].after || '—'}</span>
                                        </span>
                                    )}
                                </div>

                                {/* Snapshot context */}
                                {snap.bidder_name && (
                                    <div className="text-xs text-purple-400/80 mt-1">
                                        Bidder: {snap.bidder_name}
                                        {snap.decided_by && <span className="text-emerald-400"> • Decided by {snap.decided_by}</span>}
                                        {snap.decided_at && <span className="text-gray-500"> at {new Date(snap.decided_at).toLocaleString()}</span>}
                                    </div>
                                )}
                                {snap.requester_name && !snap.bidder_name && (
                                    <div className="text-xs text-violet-400/80 mt-1">
                                        Requested by: {snap.requester_name}
                                    </div>
                                )}
                                {snap.offerer_name && (
                                    <div className="text-xs text-violet-400/80 mt-1">
                                        Offered by: {snap.offerer_name}
                                    </div>
                                )}
                                {snap.approved_by && !snap.bidder_name && (
                                    <div className="text-xs text-green-400/80 mt-1">
                                        Approved by Manager: {snap.approved_by}
                                        {snap.approved_at && <span className="text-gray-500"> at {new Date(snap.approved_at).toLocaleString()}</span>}
                                    </div>
                                )}

                                <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                                    <User className="w-3 h-3" />
                                    <span className="text-gray-400">{event.performed_by_name}</span>
                                    {event.performed_by_role && (
                                        <>
                                            <span className="text-gray-600">•</span>
                                            <span className="text-gray-500 italic">{event.performed_by_role}</span>
                                        </>
                                    )}
                                    <span className="text-gray-600">•</span>
                                    <span>{formatDistanceToNow(new Date(event.performed_at), { addSuffix: true })}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function AuditTable({ groupedShifts, loading }: AuditTableProps) {
    const navigate = useNavigate();
    const [expandedShifts, setExpandedShifts] = useState<Set<string>>(new Set());

    const toggleExpand = (shiftId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedShifts(prev => {
            const next = new Set(prev);
            if (next.has(shiftId)) {
                next.delete(shiftId);
            } else {
                next.add(shiftId);
            }
            return next;
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-gray-400">Loading audit events...</span>
                </div>
            </div>
        );
    }

    if (groupedShifts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <History className="w-12 h-12 mb-4 text-gray-600" />
                <p className="text-lg font-medium text-gray-400">No audit events found</p>
                <p className="text-sm mt-1">Try adjusting your filters or date range</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead>
                    <tr className="bg-slate-800/50 border-b border-slate-700/50">
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-12"></th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Shift ID</th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Time</th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Events</th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Last Activity</th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Actor</th>
                        <th className="px-4 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-16"></th>
                    </tr>
                </thead>
                <tbody>
                    {groupedShifts.map((group, index) => {
                        const isExpanded = expandedShifts.has(group.shift_id);

                        return (
                            <React.Fragment key={group.shift_id}>
                                <tr
                                    className={cn(
                                        'transition-all duration-200 cursor-pointer group',
                                        isExpanded
                                            ? 'bg-slate-800/60'
                                            : 'hover:bg-slate-800/40',
                                        index % 2 === 0 ? 'bg-slate-900/20' : ''
                                    )}
                                    onClick={(e) => toggleExpand(group.shift_id, e)}
                                >
                                    {/* Expand button */}
                                    <td className="px-4 py-4">
                                        <button
                                            className={cn(
                                                'p-1.5 rounded-lg transition-all duration-200',
                                                isExpanded
                                                    ? 'bg-blue-500/20 text-blue-400'
                                                    : 'hover:bg-slate-700 text-gray-500 group-hover:text-gray-400'
                                            )}
                                        >
                                            {isExpanded ? (
                                                <ChevronDown className="w-4 h-4" />
                                            ) : (
                                                <ChevronRight className="w-4 h-4" />
                                            )}
                                        </button>
                                    </td>

                                    {/* Shift ID */}
                                    <td className="px-4 py-4">
                                        <span className="inline-flex items-center gap-1.5 text-blue-400 font-mono text-sm font-semibold bg-blue-500/10 px-2.5 py-1 rounded-lg border border-blue-500/20">
                                            #{group.shift_id.slice(0, 8)}
                                        </span>
                                    </td>

                                    {/* Date */}
                                    <td className="px-4 py-4">
                                        <span className="text-sm text-gray-200">
                                            {group.shift_date ? format(new Date(group.shift_date), 'dd MMM yyyy') : '—'}
                                        </span>
                                    </td>

                                    {/* Time */}
                                    <td className="px-4 py-4">
                                        <span className="text-sm text-gray-400 font-mono">
                                            {group.start_time || '—'}
                                        </span>
                                    </td>

                                    {/* Role */}
                                    <td className="px-4 py-4">
                                        <span className="text-sm text-gray-200">
                                            {group.role_name || '—'}
                                        </span>
                                    </td>

                                    {/* Event Count */}
                                    <td className="px-4 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex items-center justify-center min-w-[28px] h-7 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/20">
                                                {group.event_count}
                                            </span>
                                            {/* Mini event indicators */}
                                            <div className="flex gap-0.5">
                                                {group.events.slice(-3).map((evt, i) => (
                                                    <span
                                                        key={i}
                                                        className={cn(
                                                            'w-1.5 h-3 rounded-full opacity-70',
                                                            eventBadgeColors[evt.event_type]?.includes('emerald') ? 'bg-emerald-400' :
                                                                eventBadgeColors[evt.event_type]?.includes('blue') ? 'bg-blue-400' :
                                                                    eventBadgeColors[evt.event_type]?.includes('red') ? 'bg-red-400' :
                                                                        eventBadgeColors[evt.event_type]?.includes('amber') ? 'bg-amber-400' :
                                                                            eventBadgeColors[evt.event_type]?.includes('cyan') ? 'bg-cyan-400' :
                                                                                eventBadgeColors[evt.event_type]?.includes('purple') ? 'bg-purple-400' :
                                                                                    'bg-gray-400'
                                                        )}
                                                        title={eventLabels[evt.event_type] || evt.event_type}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </td>

                                    {/* Last Activity */}
                                    <td className="px-4 py-4">
                                        <span className="text-sm text-gray-400">
                                            {formatDistanceToNow(new Date(group.last_event_at), { addSuffix: true })}
                                        </span>
                                    </td>

                                    {/* Actor */}
                                    <td className="px-4 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-xs font-medium text-gray-300">
                                                {group.latest_actor_name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-sm text-gray-200">{group.latest_actor_name}</span>
                                        </div>
                                    </td>

                                    {/* View Details */}
                                    <td className="px-4 py-4">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                startTransition(() => navigate(`/audit/${group.shift_id}`));
                                            }}
                                            className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600 transition-all opacity-0 group-hover:opacity-100"
                                            title="View full details"
                                        >
                                            <ExternalLink className="w-4 h-4 text-gray-400" />
                                        </button>
                                    </td>
                                </tr>

                                {/* Expanded timeline */}
                                {isExpanded && (
                                    <tr>
                                        <td colSpan={9} className="p-0">
                                            <EventTimeline events={group.events} />
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
