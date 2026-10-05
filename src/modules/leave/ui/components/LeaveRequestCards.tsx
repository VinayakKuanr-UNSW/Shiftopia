/**
 * Leave requests as cards — one per request, in the same pastel as that leave
 * type's ledger card (`LEDGER_TONE`), so a request and the balance it draws on
 * read as the same thing. Used on both sides:
 *
 *   mine  My Leave. Footer: status pill and, while pending, Withdraw. Withdraw
 *         asks once more in place ("Keep" / "Withdraw 7.6h") — a request
 *         cannot be un-withdrawn, and a card button is easy to hit on a phone.
 *   team  Leave Approvals and an employee's ledger. The card names the person
 *         and, while pending, warns if approving takes them negative. Footer:
 *         status pill and Review. Nothing is decided on the card — the review
 *         dialog puts the balance and the roster impact in view first.
 *
 * EVERYTHING IS ON THE CARD — dates, hours, election, the note and the
 * decision reason. (There is no per-request history: auditing is removed until
 * the feature set is frozen.)
 * query per card, so it lives in the review dialog.
 */
import React from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { LEAVE_TYPE_LABELS, type LeaveRequest } from '../../model/leave.types';
import type { TeamMemberContext } from '../../api/leave.api';
import { LEDGER_TYPES } from '../../domain/leave-ledger';
import { checkApproval, displayStatus, type LeaveDisplayStatus, type RequestTab } from '../../domain/leave-approval';
import { LEDGER_TONE } from './LedgerCards';
import { fmtH, formatRange, initials } from '../format';

const EMPTY: Record<RequestTab, { mine: string; team: string }> = {
    pending: { mine: 'Nothing waiting for a decision.', team: 'Nothing waiting for a decision.' },
    approved: { mine: 'No approved leave.', team: 'No approved leave in view.' },
    rejected: { mine: 'Nothing rejected, withdrawn or revoked.', team: 'Nothing rejected, withdrawn or revoked.' },
};

const STATUS: Record<LeaveDisplayStatus, { label: string; dot: string }> = {
    pending: { label: 'Pending', dot: 'bg-amber-500' },
    approved: { label: 'Approved', dot: 'bg-emerald-500' },
    rejected: { label: 'Rejected', dot: 'bg-red-500' },
    cancelled: { label: 'Withdrawn', dot: 'bg-muted-foreground' },
    revoked: { label: 'Revoked', dot: 'bg-orange-500' },
};

const pill = cn(
    'inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold shadow-sm',
    'dark:bg-white/10',
    touch.targetY,
);
const pillButton = cn(pill,
    'transition-colors hover:bg-white/70 dark:hover:bg-white/15',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60');

const StatusPill: React.FC<{ status: LeaveDisplayStatus }> = ({ status }) => (
    <span className={pill}>
        <span className={cn('h-2 w-2 rounded-full', STATUS[status].dot)} aria-hidden="true" />
        {STATUS[status].label}
    </span>
);

type Mode =
    | { mode: 'mine'; onWithdraw: (id: string) => void; withdrawingId: string | null }
    | { mode: 'team'; members: ReadonlyMap<string, TeamMemberContext>; onOpen: (r: LeaveRequest) => void };

const RequestCard: React.FC<{ request: LeaveRequest } & Mode> = (props) => {
    const { request: r } = props;
    const [confirming, setConfirming] = React.useState(false);
    const def = LEDGER_TYPES.find(d => d.type === r.leaveType);
    const s = displayStatus(r);
    const why = (s === 'rejected' || s === 'revoked') ? r.rejectionReason : null;
    const label = def?.label ?? LEAVE_TYPE_LABELS[r.leaveType] ?? r.leaveType;
    const member = props.mode === 'team' ? props.members.get(r.employeeId) : undefined;
    const name = member?.name ?? '…';
    const negative = props.mode === 'team' && r.status === 'pending' && member
        ? checkApproval(r, member.balances, member.isCasual).draw
        : null;

    return (
        <article
            aria-label={`${props.mode === 'team' ? `${name}, ` : ''}${label}, ${formatRange(r.startDate, r.endDate)}`}
            className={cn('flex min-h-[12.5rem] flex-col rounded-3xl border p-5',
                def ? LEDGER_TONE[def.kind] : 'bg-muted border-border')}
        >
            <div className="flex items-center justify-between gap-2">
                {props.mode === 'team' ? (
                    <div className="flex min-w-0 items-center gap-2">
                        <Avatar className="h-6 w-6">
                            <AvatarImage src={member?.avatarUrl ?? undefined} alt="" />
                            <AvatarFallback className="bg-white text-[10px] text-foreground dark:bg-white/10">{initials(name)}</AvatarFallback>
                        </Avatar>
                        <p className={cn(text.label, 'truncate text-foreground')}>{name}</p>
                    </div>
                ) : (
                    <p className={text.caption}>Requested {format(parseISO(r.createdAt), 'd MMM yyyy')}</p>
                )}
                {def && <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{def.clause}</span>}
            </div>
            <p className="mt-1 text-lg font-bold leading-snug tracking-tight text-foreground">{label}</p>

            <div className="mt-auto space-y-1 pt-4">
                <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">{fmtH(r.requestedHours)}</p>
                <p className={cn(text.caption, 'tabular-nums')}>
                    {formatRange(r.startDate, r.endDate)}
                    {r.electionMode && ` · ${r.electionMode === 'annual' ? 'paid from annual leave' : 'unpaid'}`}
                </p>
                {props.mode === 'team' && (
                    <p className={text.caption}>Requested {format(parseISO(r.createdAt), 'd MMM yyyy')}</p>
                )}
                {r.reason && (
                    <p className={text.caption}>{props.mode === 'mine' ? 'Your' : 'Their'} note: &ldquo;{r.reason}&rdquo;</p>
                )}
                {why && (
                    <p className="text-xs font-medium text-red-700 dark:text-red-300">
                        {s === 'revoked' ? 'Revoked' : 'Rejected'}: &ldquo;{why}&rdquo;
                    </p>
                )}
                {negative && negative.after < 0 && (
                    <p className="flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-300">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Balance goes to {fmtH(negative.after)}
                    </p>
                )}
                {props.mode === 'mine' && s === 'approved' && (
                    <p className={text.caption}>Only your manager can change approved leave.</p>
                )}
            </div>

            <div className="mt-4 flex items-center gap-2">
                {props.mode === 'team' ? (
                    <>
                        <StatusPill status={s} />
                        <button
                            type="button"
                            className={pillButton}
                            onClick={() => props.onOpen(r)}
                            aria-label={`${r.status === 'pending' ? 'Review' : 'Open'} ${name}'s ${label}`}
                        >
                            {r.status === 'pending' ? 'Review' : 'Open'}
                        </button>
                    </>
                ) : confirming ? (
                    <>
                        <button type="button" className={pillButton} onClick={() => setConfirming(false)} disabled={props.withdrawingId === r.id}>
                            Keep
                        </button>
                        <button
                            type="button"
                            className={cn(pillButton, 'text-red-700 dark:text-red-300')}
                            onClick={() => props.onWithdraw(r.id)}
                            disabled={props.withdrawingId === r.id}
                        >
                            {props.withdrawingId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                            Withdraw {fmtH(r.requestedHours)}
                        </button>
                    </>
                ) : (
                    <>
                        <StatusPill status={s} />
                        {r.status === 'pending' && (
                            <button type="button" className={pillButton} onClick={() => setConfirming(true)}>
                                Withdraw
                            </button>
                        )}
                    </>
                )}
            </div>
            {confirming && (
                <p className={cn(text.caption, 'mt-2 text-center')}>Its {fmtH(r.requestedHours)} goes back to your available balance.</p>
            )}
        </article>
    );
};

export const LeaveRequestCards: React.FC<{
    tab: RequestTab;
    /** This tab's requests, already in tab order (`splitRequestTabs`). */
    requests: readonly LeaveRequest[];
    className?: string;
} & Mode> = ({ tab, requests, className, ...mode }) => {
    if (requests.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border py-12 text-center">
                <Inbox className="mb-2 h-7 w-7 text-muted-foreground" aria-hidden="true" />
                <p className={text.caption}>{EMPTY[tab][mode.mode]}</p>
            </div>
        );
    }
    return (
        <section aria-label="Leave requests" className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}>
            {requests.map(r => <RequestCard key={r.id} request={r} {...mode} />)}
        </section>
    );
};
