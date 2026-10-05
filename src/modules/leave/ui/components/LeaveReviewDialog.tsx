/**
 * A manager deciding one request, with everything the decision depends on in
 * view BEFORE the button: who is asking, what it draws from their balance,
 * and which shifts it takes off the roster.
 *
 * A centred dialog that is the request's card grown (`LeaveCardDialog`): one
 * card in the leave type's pastel, sections divided by hairlines — the same
 * frame the employee requested it in.
 *
 * The previous queue showed a leave type and dates — no name, no balance — and
 * reported roster conflicts only after approval had already landed.
 *
 * APPROVE FINISHES THE JOB. Approval deletes the employee's full-time shifts
 * (in `approveLeaveRequest`); the part-time and casual ones are then unassigned
 * in the same action, so no shift is left under approved leave to mark the
 * employee No-Show. The toast accounts for every one (`summarizeApproval`).
 */
import React from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { Ban, Check, Loader2, Undo2, X } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { DialogDescription, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { formatClockTime } from '@/modules/core/lib/date.utils';

import { LEAVE_TYPE_LABELS, type LeaveRequest } from '../../model/leave.types';
import {
    approveLeaveRequest, rejectLeaveRequest, revokeLeaveRequest, unassignConflictingShifts,
    type TeamMemberContext,
} from '../../api/leave.api';
import {
    canRevoke, checkApproval, summarizeApproval,
} from '../../domain/leave-approval';
import { useLeaveConflicts, useLeaveInvalidation } from '../../hooks/useLeave';
import { LEDGER_TYPES, dailyHoursFor, entitlementWarnings, type LedgerRequest } from '../../domain/leave-ledger';
import { certificateReasons, computeCertificateAdjacency } from '../../domain/leave-policy';
import { LeaveStatusBadge } from './LeaveStatusBadge';
import { fmtH, formatRange, initials } from '../format';
import { periodLabel } from './LedgerCards';
import { CardDialogClose, LeaveCardDialog, cardDivide, cardField, cardSection } from './LeaveCardDialog';

export interface LeaveReviewDialogProps {
    request: LeaveRequest | null;
    member: TeamMemberContext | undefined;
    /** This person's other requests (any period, incl. all-time gender affirmation) — for the entitlement checks. */
    personRequests?: readonly (LedgerRequest & Partial<Pick<LeaveRequest, 'endDate'>>)[];
    nameOf: (employeeId: string) => string;
    meId: string;
    today: string;
    onClose: () => void;
}

type Mode = 'idle' | 'reject' | 'revoke';

export const LeaveReviewDialog: React.FC<LeaveReviewDialogProps> = ({
    request, member, personRequests = [], nameOf, meId, today, onClose,
}) => {
    const { toast } = useToast();
    const invalidate = useLeaveInvalidation();
    const [mode, setMode] = React.useState<Mode>('idle');
    const [reason, setReason] = React.useState('');
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => { setMode('idle'); setReason(''); }, [request?.id]);

    const live = request && (request.status === 'pending' || request.status === 'approved');
    const conflicts = useLeaveConflicts(
        live ? request.employeeId : null, request?.startDate ?? '', request?.endDate ?? '');

    // The roster a week either side, for cl 45.5(b)(iii) — is a neighbouring day a rostered day off?
    const shiftDay = (ymd: string, n: number) => format(addDays(parseISO(ymd), n), 'yyyy-MM-dd');
    const around = useLeaveConflicts(
        request?.status === 'pending' ? request.employeeId : null,
        request ? shiftDay(request.startDate, -7) : '', request ? shiftDay(request.endDate, 7) : '');

    if (!request) return null;

    const warnings = request.status === 'pending' ? entitlementWarnings({
        leaveType: request.leaveType,
        requestedHours: request.requestedHours,
        startDate: request.startDate,
        requests: personRequests,
        excludeId: request.id,
        isCasual: member?.isCasual ?? false,
        dailyHours: dailyHoursFor(member?.contractedWeeklyHours),
        serviceStart: member?.serviceStart ?? null,
    }) : [];
    const weekdays = (() => {
        let n = 0;
        for (let d = parseISO(request.startDate); d <= parseISO(request.endDate); d = addDays(d, 1)) {
            if (d.getDay() !== 0 && d.getDay() !== 6) n++;
        }
        return n;
    })();
    const certReasons = request.status === 'pending'
        ? certificateReasons(request.leaveType, weekdays, computeCertificateAdjacency(request.startDate, request.endDate, {
            rosteredDates: new Set((around.data ?? []).map(sh => sh.shiftDate)),
            otherLeave: personRequests
                .filter(r => r.id !== request.id && (r.status === 'pending' || r.status === 'approved'))
                .map(r => ({ startDate: r.startDate, endDate: r.endDate ?? r.startDate })),
        }))
        : [];

    const name = member?.name ?? nameOf(request.employeeId);
    const check = checkApproval(request, member?.balances ?? [], member?.isCasual ?? false);
    const isSelf = request.employeeId === meId;
    const shifts = conflicts.data ?? [];
    // Worked shifts are kept, never removed — mirrors `approveLeaveRequest`.
    // Started shifts (worked or not) are never removed — mirrors `approveLeaveRequest`.
    const workedShifts = shifts.filter(s => s.started);
    const ftShifts = shifts.filter(s => !s.started && s.targetEmploymentType === 'FT');
    const otherShifts = shifts.filter(s => !s.started && s.targetEmploymentType !== 'FT');
    const revocable = canRevoke(request, today);

    const approve = async () => {
        setBusy(true);
        const res = await approveLeaveRequest(request.id, meId);
        if (res.error) {
            setBusy(false);
            toast({ variant: 'destructive', title: 'Could not approve', description: res.error });
            return;
        }
        const { conflictingShifts = [], removedShifts = [], removalFailures = [], keptWorked = [] } = res.data ?? {};
        let attempted = 0;
        let succeeded = 0;
        if (conflictingShifts.length > 0) {
            const u = await unassignConflictingShifts(conflictingShifts.map(c => c.shiftId));
            attempted = conflictingShifts.length;
            succeeded = u.data?.succeeded ?? 0;
        }
        const summary = summarizeApproval({
            removed: removedShifts.length,
            removalFailed: removalFailures.length,
            unassignAttempted: attempted,
            unassignSucceeded: succeeded,
            keptWorked: keptWorked.length,
        });
        setBusy(false);
        toast({
            title: `Approved ${name}'s leave`,
            description: summary.description,
            variant: summary.needsAction ? 'destructive' : undefined,
        });
        invalidate();
        onClose();
    };

    const decideWithReason = async () => {
        setBusy(true);
        const res = mode === 'reject'
            ? await rejectLeaveRequest(request.id, meId, reason)
            : await revokeLeaveRequest(request.id, reason, today);
        setBusy(false);
        if (res.error) {
            toast({ variant: 'destructive', title: mode === 'reject' ? 'Could not reject' : 'Could not revoke', description: res.error });
            return;
        }
        toast({
            title: mode === 'reject' ? `Rejected ${name}'s leave` : `Revoked ${name}'s leave`,
            description: mode === 'revoke'
                ? `${request.requestedHours}h returned to their balance. Any shifts removed at approval are not restored — re-roster the days if needed.`
                : 'They can see your reason.',
        });
        invalidate();
        onClose();
    };

    const def = LEDGER_TYPES.find(d => d.type === request.leaveType);
    const label = def?.label ?? LEAVE_TYPE_LABELS[request.leaveType];
    const heading = 'text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground';

    return (
        <LeaveCardDialog
            open
            onOpenChange={(o) => { if (!o) onClose(); }}
            kind={def?.kind}
            footer={
                <>
                    {request.status === 'pending' && mode === 'idle' && isSelf
                        ? <p className={text.caption}>You can&apos;t decide your own leave.</p>
                        : <span />}
                    <div className="flex flex-1 flex-wrap justify-end gap-2">
                        {request.status === 'pending' && mode === 'idle' && (
                            <>
                                <Button variant="ghost" className={cn('rounded-full', touch.targetY)} disabled={busy || isSelf} onClick={() => setMode('reject')}>
                                    <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> Reject
                                </Button>
                                <Button className={cn('rounded-full px-6', touch.targetY)} disabled={busy || isSelf} onClick={() => void approve()}>
                                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                                    Approve
                                </Button>
                            </>
                        )}
                        {request.status === 'approved' && mode === 'idle' && revocable && (
                            <Button variant="ghost" className={cn('rounded-full', touch.targetY)} disabled={isSelf} onClick={() => setMode('revoke')}>
                                <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Revoke approval
                            </Button>
                        )}
                        {mode !== 'idle' && (
                            <>
                                <Button variant="ghost" className={cn('rounded-full', touch.targetY)} disabled={busy} onClick={() => { setMode('idle'); setReason(''); }}>
                                    Back
                                </Button>
                                <Button variant="destructive" className={cn('rounded-full px-6', touch.targetY)} disabled={busy || !reason.trim()} onClick={() => void decideWithReason()}>
                                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                                    {mode === 'reject' ? 'Reject request' : 'Revoke leave'}
                                </Button>
                            </>
                        )}
                    </div>
                </>
            }
        >
            <div className={cn('flex-1 overflow-y-auto', cardDivide)}>
                {/* The request's card. */}
                <div className={cn(cardSection, 'pt-6')}>
                    <div className="flex items-start justify-between gap-2">
                        <p className={cn(text.caption, 'pt-1')}>
                            Review leave{def ? ` · ${periodLabel(def)} · ${def.clause}` : ''}
                        </p>
                        <CardDialogClose />
                    </div>
                    <DialogTitle className="mt-0.5 text-xl font-bold leading-snug tracking-tight">{label}</DialogTitle>
                    <div className="mt-2 flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                            <AvatarImage src={member?.avatarUrl ?? undefined} alt="" />
                            <AvatarFallback className="bg-white text-[11px] text-foreground dark:bg-white/10">{initials(name)}</AvatarFallback>
                        </Avatar>
                        <DialogDescription className={cn(text.label, 'min-w-0 flex-1 truncate text-foreground')}>{name}</DialogDescription>
                        <LeaveStatusBadge request={request} />
                    </div>
                    <p className="mt-4 text-3xl font-bold tracking-tight tabular-nums">{fmtH(request.requestedHours)}</p>
                    <p className={cn(text.caption, 'mt-1 tabular-nums')}>{formatRange(request.startDate, request.endDate)}</p>
                    {request.electionMode && (
                        <p className={text.caption}>
                            Elected: {request.electionMode === 'annual' ? 'paid from annual leave' : 'unpaid'} (cl 55.1 / 58.2)
                        </p>
                    )}
                    {request.reason && <p className={cn(text.caption, 'mt-1')}>Their note: &ldquo;{request.reason}&rdquo;</p>}
                </div>

                {request.status === 'pending' && (
                    <section className={cardSection}>
                        <p className={heading}>Balance</p>
                        {check.draw ? (
                            <>
                                <p className={cn('mt-1 text-3xl font-bold tracking-tight tabular-nums',
                                    check.warning && 'text-red-600 dark:text-red-400')}>
                                    {check.draw.after}h
                                </p>
                                <p className={cn(text.caption, 'tabular-nums')}>
                                    {LEAVE_TYPE_LABELS[check.draw.leaveType]} after approval · from {check.draw.before}h
                                </p>
                            </>
                        ) : (
                            <p className={cn(text.caption, 'mt-1')}>Not drawn from a balance.</p>
                        )}
                        {check.warning && (
                            <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{check.warning}</p>
                        )}
                    </section>
                )}

                {warnings.length > 0 && (
                    <section className={cn(cardSection, 'space-y-1')}>
                        <p className={heading}>Entitlement</p>
                        {warnings.map(w => (
                            <p key={w} role="alert" className="text-xs font-medium text-amber-800 dark:text-amber-300">{w}</p>
                        ))}
                    </section>
                )}

                {certReasons.length > 0 && (
                    <section className={cn(cardSection, 'space-y-1')}>
                        <p className={heading}>Evidence</p>
                        <p className={text.caption}>A medical certificate or other evidence is required (cl 45.5(b)):</p>
                        <ul className={cn(text.caption, 'list-disc pl-4')}>
                            {certReasons.map(r => <li key={r}>{r}</li>)}
                        </ul>
                    </section>
                )}

                {live && (
                    <section className={cn(cardSection, 'space-y-1.5')}>
                        <p className={heading}>Roster impact</p>
                        {conflicts.isLoading ? (
                            <p className={text.caption}>Checking the roster…</p>
                        ) : shifts.length === 0 ? (
                            <p className={text.caption}>No shifts rostered on these dates.</p>
                        ) : (
                            <>
                                <p className={text.caption}>
                                    {request.status === 'pending' ? 'Approving will ' : 'Still rostered: '}
                                    {request.status === 'pending' && ([
                                        ftShifts.length > 0 && `remove ${ftShifts.length} full-time shift${ftShifts.length === 1 ? '' : 's'}`,
                                        otherShifts.length > 0 && `unassign ${otherShifts.length} shift${otherShifts.length === 1 ? '' : 's'} for re-offer`,
                                        workedShifts.length > 0 && `keep ${workedShifts.length} already-started shift${workedShifts.length === 1 ? '' : 's'}`,
                                    ].filter((x): x is string => Boolean(x)).reduce(
                                        (acc, part, i, all) => acc + (i === 0 ? '' : i === all.length - 1 ? ' and ' : ', ') + part, '',
                                    ) || 'change nothing on the roster')}
                                    {request.status === 'pending' && '.'}
                                </p>
                                <ul className="space-y-1">
                                    {shifts.map(s => (
                                        <li key={s.shiftId} className={cn(text.caption, 'flex justify-between gap-2 tabular-nums')}>
                                            <span>
                                                {format(parseISO(s.shiftDate), 'EEE d MMM')} · {formatClockTime(s.startTime, 'h:mm a', s.startTime ?? '')}–{formatClockTime(s.endTime, 'h:mm a', s.endTime ?? '')}
                                            </span>
                                            <span className={s.started ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>
                                                {s.worked ? 'kept — worked' : s.started ? 'kept — started' : s.targetEmploymentType === 'FT' ? 'removed' : 'unassigned'}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>
                )}

                {mode !== 'idle' && (
                    <section className={cn(cardSection, 'space-y-1.5')}>
                        <Label htmlFor="decision-reason">
                            {mode === 'reject' ? 'Why is this being rejected?' : 'Why is this being revoked?'}
                        </Label>
                        <Textarea
                            id="decision-reason" rows={3} autoFocus value={reason} className={cardField}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={mode === 'reject' ? 'e.g. Peak event week — three of the team already off' : 'e.g. Event rescheduled into these dates'}
                        />
                        <p className={text.caption}>{name} will see this.</p>
                    </section>
                )}
            </div>
        </LeaveCardDialog>
    );
};
