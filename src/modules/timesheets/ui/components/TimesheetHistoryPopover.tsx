import React, { useCallback, useState } from 'react';
import {
    Bot, History, Pencil, Plus, RotateCcw, Send, ShieldCheck, Undo2, UserCheck, UserX, XCircle,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { cn } from '@/modules/core/lib/utils';
import { getTimesheetAuditTrail, type TimesheetAuditEvent } from '../../api/timesheetAudit.api';

/**
 * Per-timesheet lifecycle history — the human-readable answer to "was it
 * auto-approved by the bot, manually approved (by whom), edited again?".
 * Reads the append-only `timesheet_audit_log` on open.
 */

const EVENT_META: Record<string, { label: string; Icon: typeof History; cls: string }> = {
    CREATED:           { label: 'Created',           Icon: Plus,        cls: 'text-muted-foreground' },
    SUBMITTED:         { label: 'Submitted',         Icon: Send,        cls: 'text-sky-500' },
    AUTO_APPROVED:     { label: 'Auto-verified',     Icon: Bot,         cls: 'text-emerald-500' },
    MANUALLY_APPROVED: { label: 'Approved',          Icon: UserCheck,   cls: 'text-emerald-500' },
    REJECTED:          { label: 'Rejected',          Icon: XCircle,     cls: 'text-rose-500' },
    EDITED:            { label: 'Edited',            Icon: Pencil,      cls: 'text-amber-500' },
    REOPENED:          { label: 'Reopened',          Icon: RotateCcw,   cls: 'text-amber-500' },
    REVERTED:          { label: 'Auto-verify undone', Icon: Undo2,      cls: 'text-muted-foreground' },
    NO_SHOW:           { label: 'No-show',           Icon: UserX,       cls: 'text-slate-400' },
};

const SOURCE_LABEL: Record<string, string> = { bot: 'AutoPilot', manager: 'Manager', employee: 'Employee', system: 'System' };

const fmtTime = (t: unknown): string => {
    if (t == null || t === '') return '—';
    const s = String(t);
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
};

const EditDetail: React.FC<{ detail: Record<string, unknown> }> = ({ detail }) => {
    const before = (detail?.before ?? {}) as Record<string, unknown>;
    const after = (detail?.after ?? {}) as Record<string, unknown>;
    const changed = (a: unknown, b: unknown) => String(a ?? '') !== String(b ?? '');
    const rows: Array<[string, unknown, unknown]> = [
        ['In', before.start_time, after.start_time],
        ['Out', before.end_time, after.end_time],
        ['Paid brk', before.paid_break, after.paid_break],
        ['Unpaid brk', before.unpaid_break, after.unpaid_break],
    ].filter(([, a, b]) => changed(a, b)) as Array<[string, unknown, unknown]>;
    if (rows.length === 0) return null;
    return (
        <div className="flex flex-col gap-0.5 mt-0.5">
            {rows.map(([label, a, b]) => (
                <span key={label} className="text-[9px] font-mono text-muted-foreground/70">
                    {label}: <span className="line-through opacity-60">{fmtTime(a)}</span> → <span className="text-foreground/80">{fmtTime(b)}</span>
                </span>
            ))}
        </div>
    );
};

const EventRow: React.FC<{ event: TimesheetAuditEvent }> = ({ event }) => {
    const meta = EVENT_META[event.eventType] ?? { label: event.eventType, Icon: History, cls: 'text-muted-foreground' };
    const Icon = meta.Icon;
    const who = event.actorName || SOURCE_LABEL[event.source] || event.source;
    return (
        <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/20">
            <div className={cn('mt-0.5 shrink-0', meta.cls)}><Icon className="h-3.5 w-3.5" /></div>
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">{meta.label}</span>
                    <span className={cn(
                        'text-[8px] font-black font-mono uppercase px-1.5 py-0 rounded-full border',
                        event.source === 'bot'
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-border bg-muted text-muted-foreground/70',
                    )}>
                        {SOURCE_LABEL[event.source] ?? event.source}
                    </span>
                </div>
                <span className="text-[9px] font-mono text-foreground/60 truncate">{who}</span>
                {event.eventType === 'EDITED' && <EditDetail detail={event.detail} />}
                {event.eventType === 'REJECTED' && typeof event.detail?.reason === 'string' && (
                    <span className="text-[9px] text-muted-foreground/70 italic">{String(event.detail.reason)}</span>
                )}
                <span className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-wider">
                    {formatDistanceToNow(parseISO(event.createdAt), { addSuffix: true })}
                </span>
            </div>
        </div>
    );
};

export const TimesheetHistoryPopover: React.FC<{ shiftId: string; className?: string }> = ({ shiftId, className }) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [events, setEvents] = useState<TimesheetAuditEvent[] | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setEvents(await getTimesheetAuditTrail(shiftId));
        } catch {
            setEvents([]);
        } finally {
            setLoading(false);
        }
    }, [shiftId]);

    return (
        // modal={false}: modal popovers inside overlay contexts break pointer-events
        <Popover open={open} onOpenChange={o => { setOpen(o); if (o) load(); }} modal={false}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title="Timesheet history"
                    className={cn(
                        'inline-flex items-center justify-center h-6 w-6 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors',
                        className,
                    )}
                >
                    <History className="h-3.5 w-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-[300px] p-0 rounded-2xl border-border bg-popover shadow-2xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/50 bg-muted/20 flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Timesheet history</span>
                </div>
                <div className="max-h-[300px] overflow-y-auto py-1.5 custom-scrollbar">
                    {loading ? (
                        <div className="py-6 text-center text-[10px] font-mono text-muted-foreground/40">Loading…</div>
                    ) : !events || events.length === 0 ? (
                        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                            <ShieldCheck className="h-5 w-5 text-muted-foreground/20" />
                            <span className="text-[10px] text-muted-foreground/40 font-mono">No recorded activity yet.</span>
                        </div>
                    ) : (
                        events.map(e => <EventRow key={e.id} event={e} />)
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};
