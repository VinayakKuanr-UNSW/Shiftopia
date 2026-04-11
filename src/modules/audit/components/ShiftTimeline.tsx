import React, { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
    Plus, UserPlus, UserMinus, Send, EyeOff, Trash2, XCircle, Pencil,
    CheckCircle, Clock, Lock, Gavel, Trophy, Undo2, TimerOff, Zap,
    ArrowLeftRight, CheckCircle2, PlayCircle, LogIn, LogOut, UserX,
    Timer, ShieldCheck, X, Handshake, ChevronDown, ChevronRight
} from 'lucide-react';
import { AuditLogEntryWithActor, AUDIT_ACTION_META, AuditAction } from '../types/audit.types';
import { useShiftTimeline } from '../hooks/useAuditLog';
import { AuditLogGroup, groupAuditLogs } from '../utils/auditGrouping';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';

// ── Icon map (Lucide component per action) ────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Plus, UserPlus, UserMinus, Send, EyeOff, Trash2, XCircle, Pencil,
    CheckCircle, Clock, Lock, Gavel, Trophy, Undo2, TimerOff, Zap,
    ArrowLeftRight, CheckCircle2, PlayCircle, LogIn, LogOut, UserX,
    Timer, ShieldCheck, X, Handshake,
};

// ── State label helpers ───────────────────────────────────────────────────────

const STATE_LABEL: Record<string, string> = {
    S1: 'Draft', S2: 'Draft Assigned', S3: 'Offered',
    S4: 'Confirmed', S5: 'Bidding (Normal)', S6: 'Bidding (Urgent)',
    S7: 'Confirmed (Emergency)', S8: 'Bidding Closed', S9: 'Trade Requested',
    S10: 'Trade Accepted', S11: 'In Progress', S12: 'In Progress',
    S13: 'Completed', S14: 'Completed', S15: 'Cancelled',
};

// ── Group Component ───────────────────────────────────────────────────────────

interface GroupedTimelineEventProps {
    group: AuditLogGroup;
    isLast: boolean;
}

const GroupedTimelineEvent: React.FC<GroupedTimelineEventProps> = ({ group, isLast }) => {
    const meta = AUDIT_ACTION_META[group.action as AuditAction];
    const fallbackMeta = { label: group.action, icon: 'Clock', color: 'bg-gray-500/20 text-gray-400', category: 'system', priority: 'low', is_system: true };
    const IconComp = ICON_MAP[meta?.icon || fallbackMeta.icon] ?? Clock;
    const [expanded, setExpanded] = useState(false);

    const isHighPriority = meta?.priority === 'high';
    const isLowPriority = meta?.priority === 'low';

    return (
        <div className={`flex gap-3 ${isLowPriority ? 'opacity-85 grayscale-[30%]' : ''}`}>
            {/* Connector line + icon */}
            <div className="flex flex-col items-center">
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${meta?.color || fallbackMeta.color}`}>
                    <IconComp className="w-4 h-4" />
                </div>
                {!isLast && <div className="w-px flex-1 bg-border dark:bg-white/10 mt-1" />}
            </div>

            {/* Content */}
            <div className="pb-6 flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <span className={`text-sm ${isHighPriority ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>
                            {group.entries.length} {meta?.label ? meta.label.toLowerCase() + 's' : 'events'}
                        </span>
                        {meta?.priority === 'low' && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                                Auto
                            </span>
                        )}
                    </div>
                    <time
                        className="flex-shrink-0 text-xs text-muted-foreground"
                        title={format(new Date(group.primaryEntry.occurred_at), 'PPpp')}
                    >
                        {formatDistanceToNow(new Date(group.primaryEntry.occurred_at), { addSuffix: true })}
                    </time>
                </div>

                <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1 mt-1.5 text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
                >
                    {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {expanded ? 'Hide details' : 'View details'}
                </button>

                {expanded && (
                    <div className="mt-3 space-y-2 border-l-2 border-border/50 dark:border-white/5 pl-3 ml-1.5">
                        {group.entries.map((entry) => {
                            const actorName = entry.actor?.full_name ?? entry.actor_role ?? 'System';
                            return (
                                <div key={entry.id} className="flex items-start justify-between text-xs">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
                                        <span className="text-muted-foreground">
                                            {actorName}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground/60 w-20 text-right flex-shrink-0">
                                        {formatDistanceToNow(new Date(entry.occurred_at), { addSuffix: true })}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface TimelineEventProps {
    entry: AuditLogEntryWithActor;
    isLast: boolean;
}

const TimelineEvent: React.FC<TimelineEventProps> = ({ entry, isLast }) => {
    const meta = AUDIT_ACTION_META[entry.action as AuditAction] ?? {
        label: entry.action, icon: 'Clock', color: 'bg-gray-500/20 text-gray-400', category: 'system', priority: 'low', is_system: true
    };
    const IconComp = ICON_MAP[meta.icon] ?? Clock;
    const actorName = entry.actor?.full_name ?? entry.actor_role ?? 'System';
    const isSystem  = !entry.actor_id || entry.actor_role === 'system';

    const isHighPriority = meta?.priority === 'high';
    const isLowPriority = meta?.priority === 'low' || isSystem;

    return (
        <div className={`flex gap-3 ${isLowPriority ? 'opacity-85 grayscale-[30%]' : ''}`}>
            {/* Connector line + icon */}
            <div className="flex flex-col items-center">
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${meta.color}`}>
                    <IconComp className="w-4 h-4" />
                </div>
                {!isLast && <div className="w-px flex-1 bg-border dark:bg-white/10 mt-1" />}
            </div>

            {/* Content */}
            <div className="pb-6 flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <span className={`text-sm ${isHighPriority ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>
                            {meta.label}
                        </span>
                        {entry.from_state ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                                {STATE_LABEL[entry.from_state] ?? entry.from_state}
                                {' → '}
                                {STATE_LABEL[entry.to_state!] ?? entry.to_state}
                            </span>
                        ) : entry.to_state ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                                <span className="text-blue-400 font-medium">New</span>
                                {' → '}
                                {STATE_LABEL[entry.to_state] ?? entry.to_state}
                            </span>
                        ) : null}
                    </div>
                    <time
                        className="flex-shrink-0 text-xs text-muted-foreground"
                        title={format(new Date(entry.occurred_at), 'PPpp')}
                    >
                        {formatDistanceToNow(new Date(entry.occurred_at), { addSuffix: true })}
                    </time>
                </div>

                {/* Actor */}
                <p className="text-xs text-muted-foreground mt-0.5">
                    by {isSystem ? (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-muted-foreground/20 text-muted-foreground">System</Badge>
                    ) : (
                        <span className="font-medium text-foreground/80">{actorName}</span>
                    )}
                </p>

                {/* Source badges for CREATE and ASSIGN events */}
                {(entry.action === 'CREATE' || entry.action === 'ASSIGN' || entry.action === 'EMERGENCY_ASSIGN') && (
                    <div className="flex flex-wrap gap-2 mt-1.5">
                        {(() => {
                            const creationSrc = entry.metadata?.creation_source as string | undefined;
                            const assignmentSrc = entry.metadata?.assignment_source as string | undefined;
                            const LABELS: Record<string, string> = {
                                manual: 'Manual',
                                template: 'Template',
                                autoscheduler: 'AutoScheduler',
                                direct: 'Direct (at creation)',
                                dnd: 'Drag & Drop',
                            };

                            const badges: React.ReactNode[] = [];

                            // Creation source
                            if (entry.action === 'CREATE' && creationSrc) {
                                badges.push(
                                    <span key="creation" className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                        via {LABELS[creationSrc] ?? creationSrc}
                                    </span>
                                );
                            }

                            // Assignment source (can happen during CREATE or ASSIGN)
                            if (assignmentSrc) {
                                badges.push(
                                    <span key="assignment" className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                        via {LABELS[assignmentSrc] ?? assignmentSrc}
                                    </span>
                                );
                            }

                            return badges;
                        })()}
                    </div>
                )}

                {/* Target (Who was affected) */}
                {entry.target && (
                    <p className="text-[11px] text-foreground/70 mt-1.5 flex items-center gap-1.5 bg-muted/30 w-fit px-2 py-0.5 rounded">
                        <span className="text-muted-foreground">
                            {entry.action.startsWith('TRADE') ? 'Partner:' : 
                             entry.action === 'OFFER_ACCEPTED' ? 'Offerer:' : 'Recipient:'}
                        </span>
                        <span className="font-medium text-foreground">{entry.target.full_name}</span>
                    </p>
                )}

                {/* Reason */}
                {entry.reason && (
                    <p className="mt-1 text-xs text-muted-foreground italic">
                        "{entry.reason}"
                    </p>
                )}

                {/* Field edit diff */}
                {entry.action === 'FIELD_EDIT' && entry.metadata?.changed_fields && (
                    <div className="mt-2 space-y-0.5 border-l border-border/50 dark:border-white/5 pl-3">
                        {Object.entries(entry.metadata.changed_fields as Record<string, { from: unknown; to: unknown }>)
                            .map(([field, diff]) => (
                                <p key={field} className="text-[11px] text-muted-foreground">
                                    <span className="font-mono text-foreground/60">{field}</span>
                                    {': '}
                                    <span className="line-through text-red-500/50">{String(diff.from ?? '–')}</span>
                                    {' → '}
                                    <span className="text-emerald-500/60 font-medium">{String(diff.to ?? '–')}</span>
                                </p>
                            ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

interface ShiftTimelineProps {
    shiftId: string;
    className?: string;
}

export const ShiftTimeline: React.FC<ShiftTimelineProps> = ({ shiftId, className = '' }) => {
    const { data: entries, isLoading, error } = useShiftTimeline(shiftId);
    const [showSystemEvents, setShowSystemEvents] = useState(false);

    const groups = useMemo(() => groupAuditLogs(entries || []), [entries]);

    const filteredGroups = useMemo(() => {
        return groups.filter(g => {
            if (showSystemEvents) return true;
            const meta = AUDIT_ACTION_META[g.action as AuditAction];
            return !meta?.is_system; // hide system events unless toggle is on
        });
    }, [groups, showSystemEvents]);

    if (isLoading) {
        return (
            <div className={`space-y-4 ${className}`}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="flex gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-muted dark:bg-white/10 flex-shrink-0" />
                        <div className="flex-1 space-y-2 pt-1">
                            <div className="h-3 bg-muted dark:bg-white/10 rounded w-1/3" />
                            <div className="h-2 bg-muted dark:bg-white/10 rounded w-1/4" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <p className={`text-sm text-destructive ${className}`}>
                Failed to load shift timeline.
            </p>
        );
    }

    if (!entries || entries.length === 0) {
        return (
            <p className={`text-sm text-muted-foreground ${className}`}>
                No audit events recorded yet.
            </p>
        );
    }

    return (
        <div className={`flex flex-col ${className}`}>
            {/* Toolbar */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-border/50 sticky top-0 bg-background/95 backdrop-blur z-10 pt-2 -mt-2 px-1">
                <p className="text-xs font-medium text-muted-foreground">Log History</p>
                <div className="flex items-center gap-2">
                    <Label htmlFor="show-system" className="text-[11px] text-muted-foreground cursor-pointer">
                        Show system events
                    </Label>
                    <Switch
                        id="show-system"
                        checked={showSystemEvents}
                        onCheckedChange={setShowSystemEvents}
                        className="scale-75 origin-right"
                    />
                </div>
            </div>

            {/* Timeline */}
            <div className="pt-2 px-1">
                {filteredGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        No events visible. 
                        {!showSystemEvents && <button onClick={() => setShowSystemEvents(true)} className="text-blue-500 hover:underline ml-1">Show hidden</button>}
                    </p>
                ) : (
                    filteredGroups.map((group, idx) => {
                        const isLast = idx === filteredGroups.length - 1;
                        if (group.entries.length === 1) {
                            return (
                                <TimelineEvent
                                    key={group.id}
                                    entry={group.primaryEntry}
                                    isLast={isLast}
                                />
                            );
                        }
                        return (
                            <GroupedTimelineEvent
                                key={group.id}
                                group={group}
                                isLast={isLast}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
};
