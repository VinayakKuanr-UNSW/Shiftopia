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
    shift_created_draft: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
    shift_created_published: 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20',
    // Status
    published: 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20',
    unpublished: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
    draft_status_changed: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
    cancelled: 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20',
    uncancelled: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
    shift_soft_deleted: 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20',
    shift_deleted: 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20',
    shift_completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
    // Assignment
    employee_assigned: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
    employee_unassigned: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20',
    assignment_swapped: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 hover:bg-violet-500/20',
    // Schedule
    schedule_changed: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20 hover:bg-teal-500/20',
    notes_updated: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20 hover:bg-teal-500/20',
    // Bidding
    pushed_to_bidding: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20',
    removed_from_bidding: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
    bid_placed: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20',
    bid_submitted: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20',
    bid_won: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
    bid_accepted: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
    bid_rejected: 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20',
    bid_withdrawn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20',
    bid_status_changed: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20',
    // Trading
    trade_requested: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 hover:bg-violet-500/20',
    trade_offer_submitted: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 hover:bg-violet-500/20',
    trade_offer_selected: 'bg-violet-600/10 text-violet-600 dark:text-violet-400 border-violet-600/20 hover:bg-violet-600/20',
    trade_pending_manager: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20',
    trade_approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
    trade_rejected: 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20',
    trade_cancelled: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
    trade_expired: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
    trade_offer_rejected: 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20',
    trade_offer_withdrawn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20',
    trade_offer_expired: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
    // Modification
    field_updated: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20',
    status_changed: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20',
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
            'inline-flex items-center px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all duration-200',
            eventBadgeColors[eventType] || 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
        )}>
            {eventLabels[eventType] || eventType.replace(/_/g, ' ')}
        </span>
    );
}

function EventTimeline({ events }: { events: AuditEvent[] }) {
    return (
        <div className="px-8 py-6 bg-muted/20 border-t border-border/50">
            <div className="space-y-4">
                {events.map((event, index) => {
                    const snap = event.snapshot || {};
                    return (
                        <div
                            key={event.id}
                            className="flex items-start gap-6 group/event"
                        >
                            {/* Timeline connector */}
                            <div className="flex flex-col items-center pt-2">
                                <div className={cn(
                                    'w-3 h-3 rounded-full border-2 transition-all duration-300',
                                    index === events.length - 1
                                        ? 'bg-primary border-primary shadow-[0_0_10px_rgba(var(--primary),0.4)]'
                                        : 'bg-card border-primary/20 group-hover/event:border-primary/50'
                                )} />
                                {index < events.length - 1 && (
                                    <div className="w-[1px] flex-1 min-h-[32px] bg-gradient-to-b from-primary/20 via-primary/10 to-transparent mt-2" />
                                )}
                            </div>

                            {/* Event content */}
                            <div className="flex-1 min-w-0 pb-3">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <EventBadge eventType={event.event_type} />
                                    {event.changes && event.changes.length > 0 && (
                                        <div className="flex items-center gap-2 bg-card border border-border px-3 py-1 rounded-lg shadow-sm">
                                            <span className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground/40">
                                                {event.changes[0].field}
                                            </span>
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-muted-foreground/40 line-through font-mono">{event.changes[0].before || '—'}</span>
                                                <ArrowRight className="w-3 h-3 text-primary" />
                                                <span className="text-emerald-500 font-bold font-mono">{event.changes[0].after || '—'}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Snapshot context */}
                                {(snap.bidder_name || snap.requester_name || snap.offerer_name || snap.approved_by) && (
                                    <div className="mt-2.5 p-3 rounded-xl bg-card border border-border/50 shadow-sm max-w-2xl">
                                        {snap.bidder_name && (
                                            <div className="text-xs text-purple-600 dark:text-purple-400 font-medium flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                                Bidder: {snap.bidder_name}
                                                {snap.decided_by && <span className="text-emerald-600 font-bold"> • Decided by {snap.decided_by}</span>}
                                                {snap.decided_at && <span className="text-muted-foreground/50"> at {format(new Date(snap.decided_at), 'HH:mm:ss')}</span>}
                                            </div>
                                        )}
                                        {snap.requester_name && !snap.bidder_name && (
                                            <div className="text-xs text-violet-600 dark:text-violet-400 font-medium flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                                Requested by: {snap.requester_name}
                                            </div>
                                        )}
                                        {snap.offerer_name && (
                                            <div className="text-xs text-violet-600 dark:text-violet-400 font-medium flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                                Offered by: {snap.offerer_name}
                                            </div>
                                        )}
                                        {snap.approved_by && !snap.bidder_name && (
                                            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-2 mt-1">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                Approved by {snap.approved_by}
                                                {snap.approved_at && <span className="text-muted-foreground/50"> at {format(new Date(snap.approved_at), 'HH:mm:ss')}</span>}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground/50">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                                            <User className="w-3 h-3 text-primary" />
                                        </div>
                                        <span className="text-foreground font-black uppercase tracking-widest text-[10px]">{event.performed_by_name}</span>
                                    </div>
                                    {event.performed_by_role && (
                                        <>
                                            <span className="text-primary/10 font-bold">•</span>
                                            <span className="text-[10px] font-black italic uppercase tracking-widest text-primary/40">{event.performed_by_role}</span>
                                        </>
                                    )}
                                    <span className="text-primary/10 font-bold">•</span>
                                    <div className="flex items-center gap-1.5">
                                        <History className="w-3 h-3" />
                                        <span className="font-medium text-[10px] uppercase tracking-widest">{formatDistanceToNow(new Date(event.performed_at), { addSuffix: true })}</span>
                                    </div>
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
            <table className="w-full border-collapse">
                <thead>
                    <tr className="bg-muted/30 border-b border-border">
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em] w-12"></th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em]">Shift ID</th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em]">Date</th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em]">Time</th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em]">Role</th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em]">Events</th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em]">Last Activity</th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em]">Actor</th>
                        <th className="px-6 py-5 text-left text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em] w-16"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                    {groupedShifts.map((group) => {
                        const isExpanded = expandedShifts.has(group.shift_id);

                        return (
                            <React.Fragment key={group.shift_id}>
                                <tr
                                    className={cn(
                                        'transition-all duration-300 cursor-pointer group/row relative',
                                        isExpanded
                                            ? 'bg-primary/[0.03] shadow-inner'
                                            : 'hover:bg-muted/10'
                                    )}
                                    onClick={(e) => toggleExpand(group.shift_id, e)}
                                >
                                    {/* Expand button */}
                                    <td className="px-6 py-5">
                                        <button
                                            className={cn(
                                                'w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300',
                                                isExpanded
                                                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 rotate-90'
                                                    : 'bg-muted/40 text-muted-foreground group-hover/row:bg-primary/10 group-hover/row:text-primary'
                                            )}
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </td>

                                    {/* Shift ID */}
                                    <td className="px-6 py-5">
                                        <span className="inline-flex items-center gap-2 text-primary font-mono text-xs font-black bg-primary/5 px-3 py-1.5 rounded-xl border border-primary/10 group-hover/row:border-primary/30 transition-all">
                                            #{group.shift_id.slice(0, 8).toUpperCase()}
                                        </span>
                                    </td>

                                    {/* Date */}
                                    <td className="px-6 py-5">
                                        <span className="text-sm font-bold text-foreground/80 lowercase tracking-tight">
                                            {group.shift_date ? format(new Date(group.shift_date), 'dd MMM yyyy') : '—'}
                                        </span>
                                    </td>

                                    {/* Time */}
                                    <td className="px-6 py-5">
                                        <span className="text-xs text-muted-foreground/60 font-mono font-bold">
                                            {group.start_time || '—'}
                                        </span>
                                    </td>

                                    {/* Role */}
                                    <td className="px-6 py-5">
                                        <span className="text-xs font-black uppercase tracking-[0.1em] text-foreground">
                                            {group.role_name || '—'}
                                        </span>
                                    </td>

                                    {/* Event Count */}
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-3">
                                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-black shadow-lg shadow-primary/20">
                                                {group.event_count}
                                            </span>
                                            {/* Mini event indicators */}
                                            <div className="flex gap-1">
                                                {group.events.slice(-4).map((evt, i) => (
                                                    <span
                                                        key={i}
                                                        className={cn(
                                                            'w-1 h-4 rounded-full transition-all duration-300',
                                                            eventBadgeColors[evt.event_type]?.includes('emerald') ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' :
                                                                eventBadgeColors[evt.event_type]?.includes('primary') ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary),0.4)]' :
                                                                    eventBadgeColors[evt.event_type]?.includes('destructive') ? 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.4)]' :
                                                                        eventBadgeColors[evt.event_type]?.includes('amber') ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' :
                                                                            eventBadgeColors[evt.event_type]?.includes('cyan') ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.4)]' :
                                                                                eventBadgeColors[evt.event_type]?.includes('purple') ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]' :
                                                                                    'bg-muted-foreground/30'
                                                        )}
                                                        title={eventLabels[evt.event_type] || evt.event_type}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </td>

                                    {/* Last Activity */}
                                    <td className="px-6 py-5">
                                        <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/60">
                                            {formatDistanceToNow(new Date(group.last_event_at), { addSuffix: true })}
                                        </span>
                                    </td>

                                    {/* Actor */}
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-xl bg-muted/40 flex items-center justify-center text-[10px] font-black text-foreground border border-border group-hover/row:border-primary/30 transition-all">
                                                {group.latest_actor_name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-xs font-bold text-foreground/80">{group.latest_actor_name}</span>
                                        </div>
                                    </td>

                                    {/* View Details */}
                                    <td className="px-6 py-5">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                startTransition(() => navigate(`/audit/${group.shift_id}`));
                                            }}
                                            className="w-10 h-10 rounded-xl bg-primary/5 hover:bg-primary text-primary hover:text-primary-foreground transition-all flex items-center justify-center shadow-sm opacity-0 group-hover/row:opacity-100"
                                            title="View full details"
                                        >
                                            <ExternalLink className="w-4 h-4" />
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
