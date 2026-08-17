/**
 * What this page means for THIS employee.
 *
 * THE PROBLEM IT SOLVES. My Availabilities renders the same "declare your
 * slots" editor for everyone, so a full-timer opens it, sees an empty
 * calendar, and reasonably concludes there is work outstanding. There is not:
 * permanents are regulated by their LEAVE, not by an offer of availability.
 * Filling the calendar in is at best redundant and at worst harmful — a narrow
 * declaration NARROWS what they can be rostered for, because the solver treats
 * a declaration on a date as binding for that date (HC-5d, per-date OPT_OUT).
 *
 * Production has the scar: all 17 full-timers carry seeded availability rules,
 * five of them a single 12:00-14:00 weekly window, which left them eligible
 * for almost nothing while still owed 38h a week.
 *
 * So the banner says the opposite thing to each population:
 *   casual   — silence means unavailable; an empty calendar IS the problem.
 *   FT / PT  — silence means available; an empty calendar is the normal state,
 *              and leave is where their agency actually lives.
 */

import React from 'react';
import { CalendarCheck, CalendarClock, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/modules/core/lib/utils';
import type { ContractBasis } from '../../domain/contract-basis';
// Shared with the Full-Time card on AvailabilityPage so both render the same
// contract field identically. See ui/envelope-format.ts.
import { formatEnvelopeDays as formatDays, formatEnvelopeTime as formatTime } from '../envelope-format';


export interface ContractBasisBannerProps {
    basis: ContractBasis;
    /** True while the contract is still being read — renders nothing. */
    loading?: boolean;
}

export const ContractBasisBanner: React.FC<ContractBasisBannerProps> = ({ basis, loading }) => {
    // Never guess. While the contract is loading the resolved basis is the
    // empty one, whose mode is the strict OPT_IN — rendering it would flash
    // "your availability is required" at a full-timer on every page load.
    if (loading) return null;

    const isOptOut = basis.availabilityMode === 'OPT_OUT';
    const weekly = basis.contractedWeeklyHours;
    const { envelope } = basis;

    if (!isOptOut) {
        return (
            <div className={cn(
                'flex items-start gap-3 rounded-2xl border p-3 lg:p-4',
                'border-amber-500/20 bg-amber-500/5',
            )}>
                <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                    <span className="font-semibold">You are only offered shifts you declare for.</span>{' '}
                    Days with no availability on them are treated as unavailable, so add the times
                    you can work to be considered for them.
                </div>
            </div>
        );
    }

    return (
        <div className={cn(
            'flex items-start gap-3 rounded-2xl border p-3 lg:p-4',
            'border-sky-500/20 bg-sky-500/5',
        )}>
            <CalendarCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600 dark:text-sky-400" />
            <div className="min-w-0 space-y-1.5 text-xs leading-relaxed text-sky-900 dark:text-sky-200">
                <p>
                    <span className="font-semibold">
                        You do not need to declare availability
                        {typeof weekly === 'number' ? ` — your contract is ${weekly}h a week` : ''}.
                    </span>{' '}
                    {envelope.isConfigured
                        ? `You can be rostered ${formatTime(envelope.spanStart)}–${formatTime(envelope.spanEnd)}, ${formatDays(envelope.days)}.`
                        : 'You can be rostered at any time your contract allows.'}
                    {' '}Time off is managed through{' '}
                    <Link to="/my-leave" className="font-semibold underline underline-offset-2">
                        leave
                    </Link>
                    , not here.
                </p>
                <p className="flex items-start gap-1.5 text-sky-800/80 dark:text-sky-300/80">
                    <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    {/* The genuinely counter-intuitive part, and the one that
                        actually bit production: a declaration does not ADD
                        availability for a permanent, it SUBTRACTS. */}
                    <span>
                        Anything you add below <span className="font-semibold">narrows</span> when you
                        can be rostered on that day — use it for one-off exceptions, not to list every
                        hour you are free.
                    </span>
                </p>
            </div>
        </div>
    );
};
