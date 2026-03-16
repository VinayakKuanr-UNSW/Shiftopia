import React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
    Plus, UserPlus, UserMinus, Send, EyeOff, Trash2, XCircle, Pencil,
    CheckCircle, Clock, Lock, Gavel, Trophy, Undo2, TimerOff, Zap,
    ArrowLeftRight, CheckCircle2, PlayCircle, LogIn, LogOut, UserX,
    Timer, ShieldCheck, X, Handshake,
} from 'lucide-react';
import { AuditLogEntryWithActor, AUDIT_ACTION_META, AuditAction } from '../types/audit.types';
import { useShiftTimeline } from '../hooks/useAuditLog';
import { Badge } from '@/modules/core/ui/primitives/badge';

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
    S7: 'Emergency Assigned', S8: 'Bidding Closed', S9: 'Trade Requested',
    S10: 'Trade Accepted', S11: 'In Progress', S12: 'In Progress (Emergency)',
    S13: 'Completed', S14: 'Completed (Emergency)', S15: 'Cancelled',
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface TimelineEventProps {
    entry: AuditLogEntryWithActor;
    isLast: boolean;
}

const TimelineEvent: React.FC<TimelineEventProps> = ({ entry, isLast }) => {
    const meta = AUDIT_ACTION_META[entry.action as AuditAction] ?? {
        label: entry.action, icon: 'Clock', color: 'bg-gray-500/20 text-gray-400', category: 'system',
    };
    const IconComp = ICON_MAP[meta.icon] ?? Clock;
    const actorName = entry.actor?.full_name ?? entry.actor_role ?? 'System';
    const isSystem  = !entry.actor_id || entry.actor_role === 'system';

    return (
        <div className="flex gap-3">
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
                        <span className="font-medium text-sm text-foreground">
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
                        <Badge variant="outline" className="text-[10px] px-1 py-0">System</Badge>
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
        <div className={`pt-2 ${className}`}>
            {entries.map((entry, idx) => (
                <TimelineEvent
                    key={entry.id}
                    entry={entry}
                    isLast={idx === entries.length - 1}
                />
            ))}
        </div>
    );
};
