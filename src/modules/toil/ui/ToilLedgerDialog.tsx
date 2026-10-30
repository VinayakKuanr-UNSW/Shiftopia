/**
 * One person's TOIL — opened from the TOIL card's "History" button on My Leave
 * (their own) or from an employee's ledger on Leave Approvals (a manager).
 *
 * The leave dialogs' frame (`LeaveCardDialog`) in the TOIL pastel: the balance,
 * what has to be taken by when (oldest first — that is the order it is used
 * and the order it expires), every ledger entry in words, and the two direct
 * actions there are:
 *
 *   Pay out   The employee may ask at any time; it is paid in the next pay run
 *             at the salary's hourly rate. No approval — the employer must pay
 *             on request. A manager may also pay out on someone's behalf.
 *   Adjust    Managers only, never their own, always with a reason.
 *
 * Hours only. Money appears on Gross Pay and nowhere else.
 */
import React from 'react';
import { format, parseISO } from 'date-fns';
import { Banknote, Loader2, SlidersHorizontal } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { DialogDescription, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import {
    CardDialogClose, LeaveCardDialog, cardDivide, cardField, cardSection,
} from '@/modules/leave/ui/components/LeaveCardDialog';

import type { ToilPosition } from '../model/toil.types';
import { adjustToil, requestToilPayout } from '../api/toil.api';
import { useToilInvalidation, useToilLedger, useToilLots } from '../hooks/useToil';
import { describeEntry, fmtToil, hoursToMinutes, payoutCheck, toilHours } from '../domain/toil-rules';

type Action = null | 'payout' | 'adjust';

export interface ToilLedgerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    employeeId: string;
    /** Shown in the manager view; omitted for one's own. */
    employeeName?: string;
    position: ToilPosition | undefined;
    /** 'self' — the employee's own ledger. 'manager' — someone else's, with adjust. */
    mode: 'self' | 'manager';
}

const heading = 'text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground';
const dateLabel = (ymd: string) => format(parseISO(ymd), 'd MMM yyyy');

export const ToilLedgerDialog: React.FC<ToilLedgerDialogProps> = ({
    open, onOpenChange, employeeId, employeeName, position, mode,
}) => {
    const { toast } = useToast();
    const invalidate = useToilInvalidation();
    const ledger = useToilLedger(employeeId, open);
    const lots = useToilLots(employeeId, open);

    const [action, setAction] = React.useState<Action>(null);
    const [hours, setHours] = React.useState('');
    const [note, setNote] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);

    const reset = () => { setAction(null); setHours(''); setNote(''); setError(null); };
    React.useEffect(() => { if (!open) reset(); }, [open]);

    const open_ = (a: Exclude<Action, null>) => {
        setAction(a);
        setError(null);
        setNote('');
        setHours(a === 'payout' && position ? String(toilHours(Math.max(0, position.availableMinutes))) : '');
    };

    const minutes = hoursToMinutes(Number(hours));
    const payoutProblem = action === 'payout' && hours !== '' ? payoutCheck(minutes, position) : null;
    const adjustProblem = action === 'adjust'
        ? (!Number.isFinite(minutes) || minutes === 0 ? 'Enter the hours to add, or a negative number to remove.'
            : (position?.balanceMinutes ?? 0) + minutes < 0 ? `That would take the balance below zero (it is ${fmtToil(position?.balanceMinutes ?? 0)}).`
                : !note.trim() ? 'Say why the balance is being adjusted.' : null)
        : null;
    const canSubmit = !busy && hours !== '' && (action === 'payout' ? !payoutProblem : !adjustProblem);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit || !action) return;
        setBusy(true);
        setError(null);
        const res = action === 'payout'
            ? await requestToilPayout(employeeId, minutes, note)
            : await adjustToil(employeeId, minutes, note);
        setBusy(false);
        if (res.error) { setError(res.error); return; }
        toast({
            title: action === 'payout' ? `${fmtToil(minutes)} of time in lieu paid out` : 'Time in lieu adjusted',
            description: action === 'payout'
                ? 'It is paid in the next pay run, at the salary’s hourly rate.'
                : `${minutes > 0 ? '+' : ''}${fmtToil(minutes)} · ${note.trim()}`,
        });
        invalidate();
        reset();
    };

    const unused = (lots.data ?? []).filter(l => l.remainingMinutes > 0);
    const entries = ledger.data ?? [];

    return (
        <LeaveCardDialog
            open={open}
            onOpenChange={onOpenChange}
            kind="toil"
            footer={action ? (
                <>
                    <span />
                    <div className="flex flex-1 justify-end gap-2">
                        <Button type="button" variant="ghost" className={cn('rounded-full', touch.targetY)} onClick={reset} disabled={busy}>
                            Back
                        </Button>
                        <Button type="submit" form="toil-action" className={cn('rounded-full px-6', touch.targetY)} disabled={!canSubmit}>
                            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                            {action === 'payout' ? 'Pay out' : 'Save adjustment'}
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    <p className={cn(text.caption, 'hidden sm:block')}>Hours only — pay is on Gross Pay.</p>
                    <div className="flex flex-1 flex-wrap justify-end gap-2">
                        {mode === 'manager' && (
                            <Button type="button" variant="ghost" className={cn('rounded-full', touch.targetY)} onClick={() => open_('adjust')}>
                                <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" /> Adjust
                            </Button>
                        )}
                        <Button
                            type="button"
                            className={cn('rounded-full px-6', touch.targetY)}
                            disabled={!position || position.availableMinutes <= 0}
                            onClick={() => open_('payout')}
                        >
                            <Banknote className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            {mode === 'self' ? 'Ask for a payout' : 'Pay out'}
                        </Button>
                    </div>
                </>
            )}
        >
            <div className={cn('flex-1 overflow-y-auto', cardDivide)}>
                <div className={cn(cardSection, 'pt-6')}>
                    <div className="flex items-start justify-between gap-2">
                        <p className={cn(text.caption, 'pt-1')}>Banked hours · salaried contracts</p>
                        <CardDialogClose />
                    </div>
                    <DialogTitle className="mt-0.5 text-[17px] font-bold leading-snug tracking-tight">
                        Time in Lieu (TOIL){employeeName ? ` · ${employeeName}` : ''}
                    </DialogTitle>
                    <p className="mt-3 text-[24px] font-bold tracking-tight tabular-nums">{fmtToil(position?.balanceMinutes ?? 0)}</p>
                    <p className={cn(text.caption, 'tabular-nums')}>
                        {fmtToil(position?.availableMinutes ?? 0)} available
                        {position && position.heldMinutes > 0 ? ` · ${fmtToil(position.heldMinutes)} held by pending requests` : ''}
                    </p>
                    {position && (
                        <p className={cn(text.caption, 'tabular-nums')}>
                            {fmtToil(position.earnedMinutes)} earned · {fmtToil(position.takenMinutes)} taken · {fmtToil(position.paidOutMinutes)} paid out
                        </p>
                    )}
                    <DialogDescription className={cn(text.caption, 'mt-3')}>
                        Earned from approved timesheets on a salaried full-time or part-time contract: hours over 7.6 in a day,
                        and hours over the contracted week (approved leave and public holidays lower it). Taken back hour for hour.
                        Any not taken within 6 months is paid out. Casual and EBA hours never count — their overtime is paid.
                    </DialogDescription>
                </div>

                {action ? (
                    <form id="toil-action" onSubmit={submit} className={cn(cardSection, 'space-y-4')}>
                        <p className={heading}>{action === 'payout' ? 'Pay out' : 'Adjust the balance'}</p>
                        <div className="space-y-1.5">
                            <Label htmlFor="toil-hours">{action === 'payout' ? 'Hours to pay out' : 'Hours to add (negative to remove)'}</Label>
                            <Input
                                id="toil-hours"
                                type="number"
                                inputMode="decimal"
                                step="0.25"
                                min={action === 'payout' ? 0.25 : undefined}
                                value={hours}
                                onChange={(e) => setHours(e.target.value)}
                                className={cn(cardField, touch.targetY, 'max-w-[10rem] tabular-nums')}
                                autoFocus
                            />
                            {action === 'payout' && (
                                <p className={text.caption}>
                                    Paid in the next pay run at the salary’s hourly rate. {fmtToil(Math.max(0, position?.availableMinutes ?? 0))} can be paid out.
                                </p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="toil-note">{action === 'payout' ? 'Note (optional)' : 'Reason'}</Label>
                            <Textarea id="toil-note" rows={2} value={note} className={cardField}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder={action === 'adjust' ? 'e.g. Timesheet for 3 Oct approved on paper' : undefined} />
                        </div>
                        {(payoutProblem || adjustProblem || error) && (
                            <p role="alert" className="text-[11px] font-medium text-red-700 dark:text-red-400">
                                {error ?? payoutProblem ?? adjustProblem}
                            </p>
                        )}
                    </form>
                ) : (
                    <>
                        <section className={cn(cardSection, 'space-y-2')}>
                            <p className={heading}>To take by</p>
                            {lots.isLoading ? (
                                <p className={text.caption}>Loading…</p>
                            ) : unused.length === 0 ? (
                                <p className={text.caption}>Nothing banked.</p>
                            ) : (
                                <ul className="space-y-1">
                                    {unused.map(l => (
                                        <li key={l.lotDate} className={cn(text.caption, 'flex justify-between gap-2 tabular-nums')}>
                                            <span>Earned {dateLabel(l.lotDate)}</span>
                                            <span className="font-semibold text-foreground">
                                                {fmtToil(l.remainingMinutes)} by {dateLabel(l.expiresOn)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className={cn(cardSection, 'space-y-2')}>
                            <p className={heading}>History</p>
                            {ledger.isLoading ? (
                                <p className={text.caption}>Loading…</p>
                            ) : ledger.isError ? (
                                <p className="text-[11px] font-medium text-red-700 dark:text-red-400">Could not load the history.</p>
                            ) : entries.length === 0 ? (
                                <p className={text.caption}>No time in lieu yet.</p>
                            ) : (
                                <ul className="space-y-2.5">
                                    {entries.map(e => {
                                        const d = describeEntry(e);
                                        return (
                                            <li key={e.id} className="flex items-start justify-between gap-3">
                                                <span className="min-w-0">
                                                    <span className={cn(text.label, 'block')}>{d.title}</span>
                                                    <span className={cn(text.caption, 'block')}>{d.detail}</span>
                                                </span>
                                                <span className={cn('shrink-0 text-[13px] font-semibold tabular-nums',
                                                    e.minutes > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground')}>
                                                    {e.minutes > 0 ? '+' : '−'}{fmtToil(Math.abs(e.minutes))}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    </>
                )}
            </div>
        </LeaveCardDialog>
    );
};
