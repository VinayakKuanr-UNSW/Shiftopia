/**
 * "Request leave" — a centred dialog that IS the type's ledger card, grown:
 * one card in that type's pastel (`LEDGER_TONE`) with the same figure, then
 * dates, hours, what is left after, heads-up warnings and a note as sections of
 * it, divided by hairlines rather than split into separate tiles.
 *
 * THE TYPE IS FIXED. It is opened from a ledger card's "Request" pill, for that
 * card's type; there is no picker.
 *
 * HOURS ARE NOT TYPED. They are derived from the roster / contract
 * (`resolveRequestedLeaveHours`) and shown read-only with how they were worked out.
 *
 * IT SHOWS THE CONSEQUENCE BEFORE SUBMITTING. The shifts already rostered in
 * the range are listed as the dates are typed. They are also what the hours are
 * derived from (see `resolveRequestedLeaveHours`), so the employee sees both
 * what the leave will cost and what their manager will have to cover.
 *
 * DATES ARE NOT LIMITED TO THE FUTURE. Personal/sick leave is routinely applied
 * for after the absence; the overlap constraint and the balance are the guards.
 */
import React from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { AlertCircle, CalendarClock, Loader2, Send } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { RadioGroup, RadioGroupItem } from '@/modules/core/ui/primitives/radio-group';
import {
    DialogDescription, DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { formatClockTime } from '@/modules/core/lib/date.utils';

import {
    ELECTION_LEAVE_TYPES, LEAVE_TYPE_LABELS,
    type LeaveBalance, type LeaveElectionMode, type LeavePolicy, type LeaveRequest, type LeaveTypeCode,
} from '../../model/leave.types';
import { certificateReasons, computeCertificateAdjacency } from '../../domain/leave-policy';
import { resolveRequestedLeaveHours } from '../../domain/leave-hours';
import { balanceTypeFor, ledgerFor } from '../../domain/leave-approval';
import {
    LEDGER_TYPES, dailyHoursFor, entitlementWarnings, type LedgerEntry,
} from '../../domain/leave-ledger';
import { createLeaveRequest } from '../../api/leave.api';
import { useLeaveConflicts, useLeaveInvalidation } from '../../hooks/useLeave';
import { LedgerFigure, periodLabel } from './LedgerCards';
import { CardDialogClose, LeaveCardDialog, cardDivide, cardField, cardSection } from './LeaveCardDialog';

/** Weekdays in a range — the certificate threshold counts working days. */
function weekdaysBetween(start: string, end: string): number {
    const cur = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    let n = 0;
    while (cur <= last) {
        const d = cur.getDay();
        if (d !== 0 && d !== 6) n++;
        cur.setDate(cur.getDate() + 1);
    }
    return n;
}

export interface RequestLeaveDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    employeeId: string;
    balances: LeaveBalance[];
    /** My requests — pending ones already hold hours against the balance. */
    requests: readonly LeaveRequest[];
    policies: Record<LeaveTypeCode, LeavePolicy>;
    isCasual: boolean;
    contractedWeeklyHours: number | null | undefined;
    ordinaryDays: readonly number[] | null | undefined;
    /** When continuous service began — for the 12-month checks (cl 51.1, 52.1). */
    serviceStart?: string | null;
    /** The type being requested — the ledger card it was opened from. */
    leaveType: LeaveTypeCode;
    /** The ledger the page already built — the header shows the chosen type's figure. */
    entries?: readonly LedgerEntry[];
}

export const RequestLeaveDialog: React.FC<RequestLeaveDialogProps> = ({
    open, onOpenChange, employeeId, balances, requests, policies, isCasual,
    contractedWeeklyHours, ordinaryDays, serviceStart = null, leaveType: type, entries,
}) => {
    const { toast } = useToast();
    const invalidate = useLeaveInvalidation();

    const [election, setElection] = React.useState<LeaveElectionMode | ''>('');
    const [start, setStart] = React.useState('');
    const [end, setEnd] = React.useState('');
    const [reason, setReason] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);

    const reset = () => {
        setElection(''); setStart(''); setEnd('');
        setReason(''); setError(null);
    };

    const rangeValid = Boolean(start && end && start <= end);
    const conflicts = useLeaveConflicts(open && rangeValid ? employeeId : null, start, end);

    const derived = React.useMemo(() => resolveRequestedLeaveHours({
        leaveType: type,
        startDate: start,
        endDate: end,
        contractedWeeklyHours: contractedWeeklyHours ?? undefined,
        ordinaryDays: ordinaryDays ? [...ordinaryDays] : undefined,
        // `undefined` = not looked yet; [] = looked, nothing rostered. They differ.
        rosteredShifts: conflicts.data?.map(c => ({
            shiftDate: c.shiftDate, startTime: c.startTime, endTime: c.endTime,
            // The conflict read has no break column; over-stating is the safe side
            // for a figure the employee can still see and correct.
            unpaidBreakMinutes: 0,
        })),
    }),
    [type, start, end, contractedWeeklyHours, ordinaryDays, conflicts.data]);

    const hours = derived.hours;

    const policy = policies[type];
    const needsElection = ELECTION_LEAVE_TYPES.includes(type);
    // Which balance this draws on — including cl 55/58 leave elected as annual.
    const drawType = balanceTypeFor(type, isCasual, needsElection && election ? election : null);
    /*
     * Measured against what is AVAILABLE, not the raw balance: my other pending
     * requests already hold their hours. Checking the raw balance let two 20h
     * requests each pass against 30h.
     */
    const line = drawType
        ? ledgerFor(
            balances.find(b => b.leaveType === drawType) ?? { leaveType: drawType, balanceHours: 0 },
            requests, isCasual)
        : null;
    const after = line ? Math.round((line.available - hours) * 10) / 10 : 0;
    /*
     * cl 45.5(b) needs the roster a week either side (is the neighbouring day a
     * ROSTERED day off?) and my other leave (does this run on from it?).
     */
    const shiftDay = (ymd: string, n: number) => format(addDays(parseISO(ymd), n), 'yyyy-MM-dd');
    const around = useLeaveConflicts(
        open && rangeValid ? employeeId : null,
        rangeValid ? shiftDay(start, -7) : '', rangeValid ? shiftDay(end, 7) : '');
    const certReasons = React.useMemo(() => {
        if (!rangeValid) return [];
        const rosteredDates = new Set((around.data ?? []).map(sh => sh.shiftDate));
        const otherLeave = requests.filter(r => r.status === 'pending' || r.status === 'approved');
        return certificateReasons(type, weekdaysBetween(start, end),
            computeCertificateAdjacency(start, end, { rosteredDates, otherLeave }));
    }, [rangeValid, around.data, requests, type, start, end]);

    /** Where this goes past what the Agreement gives — warned, never blocked. */
    const warnings = React.useMemo(() => (rangeValid && hours > 0
        ? entitlementWarnings({
            leaveType: type, requestedHours: hours, startDate: start, requests, isCasual,
            dailyHours: dailyHoursFor(contractedWeeklyHours), serviceStart,
        })
        : []), [rangeValid, hours, type, start, requests, isCasual, contractedWeeklyHours, serviceStart]);

    const canSubmit = rangeValid && hours > 0 && !submitting
        && (!needsElection || election !== '');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        const res = await createLeaveRequest(employeeId, {
            leaveType: type,
            electionMode: needsElection ? (election as LeaveElectionMode) : undefined,
            startDate: start,
            endDate: end,
            requestedHours: hours,
            reason: reason.trim() || undefined,
        });
        setSubmitting(false);
        if (res.error) { setError(res.error); return; }
        toast({
            title: 'Leave requested',
            description: `${LEAVE_TYPE_LABELS[type]}, ${hours}h. Your manager has been asked to approve it.`,
        });
        invalidate();
        reset();
        onOpenChange(false);
    };

    const shifts = conflicts.data ?? [];
    const def = LEDGER_TYPES.find(d => d.type === type);
    const entry = entries?.find(e => e.def.type === type);

    const field = cn(cardField, touch.targetY);
    const section = cardSection;
    const headsUp = rangeValid && (shifts.length > 0 || warnings.length > 0 || certReasons.length > 0);

    return (
        <LeaveCardDialog
            open={open}
            onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
            kind={def?.kind}
            footer={
                <>
                    <p className={cn(text.caption, 'hidden sm:block')}>You can withdraw it until your manager decides.</p>
                    <div className="flex flex-1 justify-end gap-2">
                        <Button type="button" variant="ghost" className={cn('rounded-full', touch.targetY)} onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" form="request-leave" className={cn('rounded-full px-6', touch.targetY)} disabled={!canSubmit}>
                            {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                            Submit request
                        </Button>
                    </div>
                </>
            }
        >
            <form
                id="request-leave"
                onSubmit={submit}
                className={cn('flex-1 overflow-y-auto', cardDivide)}
            >
                {/* The ledger card this was opened from. */}
                <div className={cn(section, 'pt-6')}>
                    <div className="flex items-start justify-between gap-2">
                        <p className={cn(text.caption, 'pt-1')}>
                            Request leave{def ? ` · ${periodLabel(def)} · ${def.clause}` : ''}
                        </p>
                        <CardDialogClose />
                    </div>
                    <DialogTitle className="mt-0.5 text-xl font-bold leading-snug tracking-tight">
                        {def?.label ?? LEAVE_TYPE_LABELS[type]}
                    </DialogTitle>
                    {entry && entry.applicable && (
                        <div className="mt-3 space-y-0.5"><LedgerFigure entry={entry} /></div>
                    )}
                    <DialogDescription className={cn(text.caption, 'mt-3')}>
                        {policy?.description ?? 'Your manager is asked to approve it.'}
                    </DialogDescription>
                </div>

                {needsElection && (
                    <fieldset className={cn(section, 'space-y-2')}>
                        <legend className="sr-only">How should this be paid?</legend>
                        <p className={text.label}>How should this be paid?</p>
                        <p className={text.caption}>The Agreement lets you choose (cl 55.1 / cl 58.2).</p>
                        <RadioGroup value={election} onValueChange={(v) => setElection(v as LeaveElectionMode)} className="flex gap-4 pt-1">
                            <div className="flex items-center gap-2">
                                <RadioGroupItem id="elect-annual" value="annual" />
                                <Label htmlFor="elect-annual" className="font-normal">Use annual leave</Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem id="elect-unpaid" value="unpaid" />
                                <Label htmlFor="elect-unpaid" className="font-normal">Unpaid</Label>
                            </div>
                        </RadioGroup>
                    </fieldset>
                )}

                <div className={cn(section, 'grid grid-cols-2 gap-3')}>
                    <div className="space-y-1.5">
                        <Label htmlFor="leave-start">First day</Label>
                        <Input id="leave-start" type="date" value={start} className={field}
                            onChange={(e) => setStart(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="leave-end">Last day</Label>
                        <Input id="leave-end" type="date" value={end} min={start || undefined} className={field}
                            onChange={(e) => setEnd(e.target.value)} required />
                    </div>
                </div>

                <div className={cn(section, 'grid gap-5', drawType && line && 'sm:grid-cols-2')}>
                    <div>
                        <p className={text.caption}>Hours</p>
                        <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums" aria-live="polite">
                            {rangeValid ? `${hours}h` : '—'}
                        </p>
                        <p className={cn(text.caption, 'mt-1')}>{derived.explanation}</p>
                    </div>
                    {drawType && line && (
                        /* A warning, never a block: leave in advance is allowed and
                           the manager decides (2026-09-30). */
                        <div role={after < 0 ? 'alert' : undefined}>
                            <p className={text.caption}>
                                {drawType === type ? 'Left after this' : `${LEAVE_TYPE_LABELS[drawType]} after this`}
                            </p>
                            <p className={cn('mt-1 text-3xl font-bold tracking-tight tabular-nums',
                                after < 0 && 'text-red-600 dark:text-red-400')}>
                                {after}h
                            </p>
                            <p className={cn(text.caption, 'mt-1 tabular-nums', after < 0 && 'text-red-600 dark:text-red-400')}>
                                {after < 0
                                    ? `${Math.abs(after)}h in advance — you can still submit; your manager decides.`
                                    : `of ${line.available}h available${line.held > 0 ? ` · ${line.held}h held by other requests` : ''}`}
                            </p>
                        </div>
                    )}
                </div>

                {headsUp && (
                    <div role="alert" className={cn(section, 'flex items-start gap-2.5')}>
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                        <div className="min-w-0 space-y-2 text-xs font-medium">
                            {shifts.length > 0 && (
                                <div>
                                    <p>If approved, {shifts.length === 1 ? 'this shift comes' : 'these shifts come'} off your roster:</p>
                                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                                        {shifts.map(sh => (
                                            <li key={sh.shiftId} className="flex items-center gap-1.5 tabular-nums">
                                                <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                                {format(parseISO(sh.shiftDate), 'EEE d MMM')} · {formatClockTime(sh.startTime, 'h:mm a', sh.startTime ?? '')}–{formatClockTime(sh.endTime, 'h:mm a', sh.endTime ?? '')}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {warnings.map(w => <p key={w}>{w}</p>)}
                            {certReasons.length > 0 && (
                                <div>
                                    <p>A medical certificate or other evidence is required (cl 45.5(b)):</p>
                                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                                        {certReasons.map(r => <li key={r}>{r}</li>)}
                                    </ul>
                                </div>
                            )}
                            {(warnings.length > 0 || certReasons.length > 0) && (
                                <p className="text-muted-foreground">You can still submit; your manager sees this too and decides.</p>
                            )}
                        </div>
                    </div>
                )}

                <div className={cn(section, 'space-y-1.5')}>
                    <Label htmlFor="leave-reason">Note for your manager (optional)</Label>
                    <Textarea id="leave-reason" rows={3} value={reason}
                        className={cardField}
                        onChange={(e) => setReason(e.target.value)} />
                </div>

                {error && (
                    <p role="alert" className={cn(section, 'text-xs font-medium text-red-700 dark:text-red-400')}>
                        {error}
                    </p>
                )}
            </form>
        </LeaveCardDialog>
    );
};
