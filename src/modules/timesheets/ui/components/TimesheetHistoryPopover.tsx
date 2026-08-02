import React, { useCallback, useState } from 'react';
import {
    Bot, Clock, Eye, History, Pencil, Plus, RotateCcw, Send, ShieldCheck, Undo2, UserCheck, UserX, XCircle,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from '@/modules/core/ui/primitives/dialog';
import { cn } from '@/modules/core/lib/utils';
import { getTimesheetAuditTrail, type TimesheetAuditEvent } from '../../api/timesheetAudit.api';

/**
 * Per-timesheet lifecycle history — full provenance timeline:
 * Snaps, Edits, Finalizations, AutoPilot Decisions, Shadow Audits, Clocks.
 */

const EVENT_META: Record<string, { label: string; Icon: typeof History; cls: string }> = {
    CREATED:                 { label: 'Created',                 Icon: Plus,        cls: 'text-slate-400' },
    SUBMITTED:               { label: 'Submitted',               Icon: Send,        cls: 'text-sky-400' },
    AUTO_APPROVED:           { label: 'Auto-Verified',           Icon: Bot,         cls: 'text-emerald-400' },
    AUTO_VERIFIED:           { label: 'Auto-Verified',           Icon: Bot,         cls: 'text-emerald-400' },
    BOT_REVIEW:              { label: 'AutoPilot Review Needed', Icon: Eye,         cls: 'text-amber-400' },
    NEEDS_REVIEW:            { label: 'Review Needed',           Icon: Eye,         cls: 'text-amber-400' },
    MANUALLY_APPROVED:       { label: 'Approved & Finalized',    Icon: UserCheck,   cls: 'text-emerald-400' },
    RECORD_FINALIZED:        { label: 'Record Finalized',        Icon: ShieldCheck, cls: 'text-indigo-400' },
    FINALIZED:               { label: 'Record Finalized',        Icon: ShieldCheck, cls: 'text-indigo-400' },
    REJECTED:                { label: 'Rejected',                Icon: XCircle,     cls: 'text-rose-500' },
    EDITED:                  { label: 'Adjusted by Manager',     Icon: Pencil,      cls: 'text-amber-400' },
    MANAGER_EDIT:            { label: 'Manager Edit',            Icon: Pencil,      cls: 'text-amber-400' },
    PAYROLL_EDIT:            { label: 'Payroll Adjustment',      Icon: Pencil,      cls: 'text-indigo-400' },
    SNAPPED:                 { label: '15-Min Billable Snap',    Icon: Clock,       cls: 'text-sky-400' },
    SNAPPED_BILLABLE:        { label: '15-Min Billable Snap',    Icon: Clock,       cls: 'text-sky-400' },
    AUTO_SNAPPED:            { label: 'Auto-Snapped',            Icon: Clock,       cls: 'text-sky-400' },
    SHADOW_SUPPRESSED:       { label: 'Shadow Audit Suppressed', Icon: Bot,         cls: 'text-indigo-400' },
    SHADOW_PASS:             { label: 'Shadow Audit Pass',       Icon: Bot,         cls: 'text-emerald-400' },
    CLOCK_IN:                { label: 'Clock In Recorded',       Icon: Clock,       cls: 'text-emerald-400' },
    CLOCK_OUT:               { label: 'Clock Out Recorded',      Icon: Clock,       cls: 'text-emerald-400' },
    REOPENED:                { label: 'Reopened',                Icon: RotateCcw,   cls: 'text-amber-400' },
    REVERTED:                { label: 'Auto-Verify Undone',      Icon: Undo2,      cls: 'text-slate-400' },
    NO_SHOW:                 { label: 'Marked No-Show',          Icon: UserX,       cls: 'text-slate-400' },
};

const SOURCE_LABEL: Record<string, string> = { bot: 'AutoPilot', manager: 'Manager', employee: 'Employee', system: 'System' };

const fmtTime = (t: unknown): string => {
    if (t == null || t === '') return '—';
    const s = String(t);
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
};

function formatEventLabel(type: string): string {
    if (EVENT_META[type]) return EVENT_META[type].label;
    return type
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
}

const fmtVal = (label: string, v: unknown): string => {
    if (v == null || v === '' || v === '—') return '—';
    if (label.includes('brk')) return `${v}m`;
    return fmtTime(v);
};

const EventDetailsView: React.FC<{ event: TimesheetAuditEvent }> = ({ event }) => {
    const detail = event.detail || {};
    const before = (detail?.before ?? {}) as Record<string, unknown>;
    const after = (detail?.after ?? {}) as Record<string, unknown>;
    
    // Before/After Edits
    const changed = (a: unknown, b: unknown) => {
        if (a === undefined && b === undefined) return false;
        return String(a ?? '') !== String(b ?? '');
    };
    const rows: Array<[string, unknown, unknown]> = [
        ['In', before.start_time ?? before.clock_in, after.start_time ?? after.clock_in],
        ['Out', before.end_time ?? before.clock_out, after.end_time ?? after.clock_out],
        ['Paid brk', before.paid_break ?? before.paid_break_minutes, after.paid_break ?? after.paid_break_minutes],
        ['Unpaid brk', before.unpaid_break ?? before.unpaid_break_minutes, after.unpaid_break ?? after.unpaid_break_minutes],
    ].filter(([, a, b]) => changed(a, b)) as Array<[string, unknown, unknown]>;

    // Direct clocking times
    const clockInVal = (detail.clock_in ?? detail.start_time ?? detail.actual_start) as string | number | null | undefined;
    const clockOutVal = (detail.clock_out ?? detail.end_time ?? detail.actual_end) as string | number | null | undefined;

    // Variance reasons & Notes
    const arrivalReason = typeof detail.arrival_variance_reason === 'string' ? detail.arrival_variance_reason : null;
    const departureReason = typeof detail.departure_variance_reason === 'string' ? detail.departure_variance_reason : null;
    const reason = typeof detail.reason === 'string' ? detail.reason : typeof detail.notes === 'string' ? detail.notes : null;

    if (rows.length === 0 && !clockInVal && !clockOutVal && !arrivalReason && !departureReason && !reason) return null;

    return (
        <div className="flex flex-col gap-1 mt-1 p-2 rounded-lg bg-slate-900/80 border border-slate-800/80">
            {event.eventType === 'CLOCK_IN' && clockInVal && (
                <span className="text-[10px] font-mono text-emerald-400">
                    Recorded Clock In: <span className="font-bold">{fmtTime(clockInVal)}</span>
                </span>
            )}
            {event.eventType === 'CLOCK_OUT' && clockOutVal && (
                <span className="text-[10px] font-mono text-emerald-400">
                    Recorded Clock Out: <span className="font-bold">{fmtTime(clockOutVal)}</span>
                </span>
            )}

            {rows.length > 0 && (
                <div className="flex flex-col gap-0.5">
                    {rows.map(([label, a, b]) => (
                        <span key={label} className="text-[10px] font-mono text-slate-400">
                            {label}: <span className="line-through opacity-50">{fmtVal(label, a)}</span> → <span className="text-slate-100 font-bold">{fmtVal(label, b)}</span>
                        </span>
                    ))}
                </div>
            )}

            {arrivalReason && (
                <span className="text-[10px] font-mono text-amber-400/90">
                    Arrival Reason: {arrivalReason}
                </span>
            )}
            {departureReason && (
                <span className="text-[10px] font-mono text-amber-400/90">
                    Departure Reason: {departureReason}
                </span>
            )}
            {reason && (
                <span className="text-[10px] text-slate-300 italic">
                    "{reason}"
                </span>
            )}
        </div>
    );
};

const EventRow: React.FC<{ event: TimesheetAuditEvent; editIndex?: number }> = ({ event, editIndex }) => {
    const meta = EVENT_META[event.eventType] ?? { label: formatEventLabel(event.eventType), Icon: History, cls: 'text-slate-400' };
    const Icon = meta.Icon;
    const who = event.actorName || SOURCE_LABEL[event.source] || event.source;
    return (
        <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#131b2e]/90 hover:bg-[#162138] transition-all flex items-start gap-3">
            <div className={cn('mt-0.5 shrink-0 p-1.5 rounded-lg bg-slate-900/80 border border-slate-800', meta.cls)}>
                <Icon className="h-4 w-4" />
            </div>
            <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-100">
                        {meta.label} {editIndex != null ? `(EDIT #${editIndex})` : ''}
                    </span>
                    <span className={cn(
                        'text-[8px] font-black font-mono uppercase px-2 py-0.5 rounded-full border',
                        event.source === 'bot'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : 'border-slate-700 bg-slate-800 text-slate-400',
                    )}>
                        {SOURCE_LABEL[event.source] ?? event.source}
                    </span>
                </div>
                <span className="text-xs font-mono text-slate-400 truncate">{who}</span>
                <EventDetailsView event={event} />
                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">
                    {formatDistanceToNow(parseISO(event.createdAt), { addSuffix: true })}
                </span>
            </div>
        </div>
    );
};

export const TimesheetHistoryModal: React.FC<{ shiftId: string; className?: string; hasWarning?: boolean }> = ({ shiftId, className, hasWarning }) => {
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

    const editEvents = React.useMemo(() => {
        if (!events) return [];
        return events.filter(e => ['EDITED', 'MANAGER_EDIT', 'PAYROLL_EDIT'].includes(String(e.eventType)));
    }, [events]);

    const totalEdits = editEvents.length;

    return (
        <Dialog open={open} onOpenChange={o => { setOpen(o); if (o) load(); }}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    title={hasWarning ? "Timesheet needs review — view history" : totalEdits > 0 ? `Timesheet history (${totalEdits} edit${totalEdits === 1 ? '' : 's'})` : "Timesheet history"}
                    className={cn(
                        'relative inline-flex items-center justify-center h-8 w-8 rounded-xl transition-all',
                        hasWarning 
                            ? 'text-amber-500 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                            : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted/40',
                        className,
                    )}
                >
                    <History className={cn('h-4 w-4', hasWarning && 'text-amber-500 animate-pulse')} />
                    {totalEdits > 0 && (
                        <span className="absolute -top-1 -right-1 h-3.5 min-w-[14px] px-1 rounded-full bg-amber-500 text-[8px] font-mono font-black text-black flex items-center justify-center shadow-sm">
                            {totalEdits}
                        </span>
                    )}
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-md w-full p-0 rounded-2xl border border-slate-800 bg-[#0c1220] text-slate-100 shadow-2xl overflow-hidden backdrop-blur-xl">
                <DialogDescription className="sr-only">Timesheet lifecycle audit history timeline</DialogDescription>
                <div className="px-5 py-4 border-b border-slate-800/80 bg-[#11192d]/90 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <History className="h-4 w-4 text-slate-400" />
                        <DialogTitle className="text-xs font-black uppercase tracking-widest text-slate-200">
                            TIMESHEET HISTORY
                        </DialogTitle>
                    </div>
                    {totalEdits > 0 && (
                        <span className="text-[10px] font-mono font-black uppercase px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                            📝 {totalEdits} {totalEdits === 1 ? 'EDIT' : 'EDITS'}
                        </span>
                    )}
                </div>
                <div className="max-h-[440px] overflow-y-auto p-4 space-y-2.5 custom-scrollbar bg-[#0c1220]">
                    {loading ? (
                        <div className="py-12 text-center text-xs font-mono text-slate-500">Loading history…</div>
                    ) : !events || events.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-12 text-center">
                            <ShieldCheck className="h-6 w-6 text-slate-700" />
                            <span className="text-xs text-slate-500 font-mono">No recorded activity yet.</span>
                        </div>
                    ) : (
                        events.map(e => {
                            const isEdit = ['EDITED', 'MANAGER_EDIT', 'PAYROLL_EDIT'].includes(String(e.eventType));
                            let editIndex: number | undefined;
                            if (isEdit) {
                                const idxInEdits = editEvents.findIndex(ev => ev.id === e.id);
                                if (idxInEdits !== -1) {
                                    editIndex = totalEdits - idxInEdits;
                                }
                            }
                            return <EventRow key={e.id} event={e} editIndex={editIndex} />;
                        })
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const TimesheetHistoryPopover = TimesheetHistoryModal;

