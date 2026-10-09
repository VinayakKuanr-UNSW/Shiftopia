/**
 * A full-time shift, expanded: Scheduled · Actual · Payroll as three equal
 * panes and Variance full width beneath. Every section open; none collapses.
 * No pay: a shift's pay is shown in Gross Pay alone (decision 2026-10-09).
 *
 * Moved from the Office page's card (handover 2026-10-04, Phase 3) so the
 * Rosters page offers the same view from a shift's ⋯ menu. The roster keeps its
 * own card face — it names the employee, which the Office card could omit
 * because every Office row WAS one employee.
 *
 * IT IS HANDED THE RAW SHIFT ROW, NOT A VIEW MODEL. `shiftData` drives the
 * card's status dot, its Live Rules badges and its payroll rows, which a
 * hand-built camelCase object would silently lose.
 *
 * TIMES GO THROUGH `formatClockTime`: a full timestamp is converted to Sydney,
 * a naive `HH:mm` is already Sydney and must not move.
 */
import React from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Layers, X } from 'lucide-react';

import { formatClockTime } from '@/modules/core/lib/date.utils';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { resolveGroupVariant } from '@/modules/rosters/domain/shift-ui';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/modules/core/ui/primitives/dialog';

export interface ShiftExpandDialogProps {
    /** The raw shift row. Null keeps the dialog closed. */
    shift: Shift | null;
    /** Further shifts the same person holds that day — a cl 39.1 breach, said out loud. */
    alsoOnThisDay?: readonly Shift[];
    onOpenChange: (open: boolean) => void;
}

/** "7h 36m". */
export function formatDuration(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m === 0 ? `${h}h` : h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/** A second shift on the same day. Shown, never hidden. */
export const SplitShiftBadge: React.FC<{ alsoOnThisDay: readonly Shift[] }> = ({ alsoOnThisDay }) => (
    <div className="flex items-center gap-1.5">
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-400 bg-red-500/10 border border-red-500/30">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Split shift
                </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
                <p>
                    This employee holds {alsoOnThisDay.length + 1} shifts on this day.
                    A full-time split shift is not permitted (ICC EBA cl 39.1).
                </p>
                <ul className="mt-1.5 space-y-0.5">
                    {alsoOnThisDay.map(s => (
                        <li key={s.id} className="tabular-nums">
                            {formatClockTime(s.start_time, 'h:mm a', s.start_time)}
                            {' – '}
                            {formatClockTime(s.end_time, 'h:mm a', s.end_time)}
                        </li>
                    ))}
                </ul>
            </TooltipContent>
        </Tooltip>
        <Layers className="h-2.5 w-2.5 text-red-400/70" aria-hidden="true" />
    </div>
);

export const ShiftExpandDialog: React.FC<ShiftExpandDialogProps> = ({ shift, alsoOnThisDay = [], onOpenChange }) => {
    const row = (shift ?? {}) as unknown as Record<string, any>;

    if (!shift) return null;

    const start = formatClockTime(row.start_time, 'h:mm a', row.start_time) ?? '--:--';
    const end = formatClockTime(row.end_time, 'h:mm a', row.end_time) ?? '--:--';
    const unpaid = Number(row.unpaid_break_minutes ?? 0);
    // The SCHEDULED net. `netLength` is documented on the card as the BILLABLE
    // (post-floor) net, which for a shift nobody has clocked yet is the same
    // number — and the only one that exists.
    const net = Number(row.net_length_minutes ?? 0);
    const dateLabel = row.shift_date ? format(parseISO(row.shift_date), 'EEE d MMM') : '';
    const who = row.assigned_profiles
        ? [row.assigned_profiles.first_name, row.assigned_profiles.last_name].filter(Boolean).join(' ')
        : '';

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent
                hideClose
                className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-6xl overflow-y-auto rounded-3xl border-0 bg-background p-0 sm:rounded-3xl"
            >
                <SharedShiftCard
                    variant="timecard"
                    isFlat
                    identityGrid
                    // The header states who and when; the panes carry what differs.
                    identityFields={[]}
                    shiftData={row}
                    organization={row.organizations?.name ?? ''}
                    department={row.departments?.name ?? ''}
                    subDepartment={row.sub_departments?.name ?? undefined}
                    group={row.roster_subgroup?.roster_group?.name ?? undefined}
                    subGroup={row.sub_group_name ?? undefined}
                    role={row.roles?.name ?? 'Shift'}
                    shiftDate={row.shift_date}
                    startTime={start}
                    endTime={end}
                    netLength={net}
                    paidBreak={Number(row.paid_break_minutes ?? 0)}
                    unpaidBreak={unpaid}
                    clockIn={row.actual_start ?? null}
                    clockOut={row.actual_end ?? null}
                    adjustedStart={row.adjusted_start ?? null}
                    adjustedEnd={row.adjusted_end ?? null}
                    adjustedStartSource={row.adjusted_start_source ?? null}
                    adjustedEndSource={row.adjusted_end_source ?? null}
                    timesheetStatus={row.timesheet_status ?? undefined}
                    lifecycleStatus={row.lifecycle_status ?? undefined}
                    groupVariant={resolveGroupVariant(row, row.departments?.name, row.sub_departments?.name)}
                    sectionLayout="columns"
                    hideBreadcrumbs
                    hideSegmentedBox
                    hideGlow
                    className="w-full rounded-3xl text-left"
                    topContent={<>
                        <div className="mb-3 flex items-start justify-between gap-2">
                            {/* Radix requires the dialog be titled and described. */}
                            <div className="min-w-0">
                                <DialogTitle className="text-xl font-bold tracking-tight tabular-nums">
                                    {dateLabel} · {start} – {end}
                                </DialogTitle>
                                <DialogDescription className="mt-0.5 text-sm font-medium opacity-80 tabular-nums">
                                    {[who, row.roles?.name ?? 'Shift', `Net ${formatDuration(net)}`, `Unpaid break ${unpaid}m`]
                                        .filter(Boolean).join(' · ')}
                                </DialogDescription>
                            </div>
                            <DialogClose className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-white/30 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-white/10">
                                <X className="h-[18px] w-[18px]" aria-hidden="true" />
                                <span className="sr-only">Close</span>
                            </DialogClose>
                        </div>
                        {alsoOnThisDay.length > 0 && <SplitShiftBadge alsoOnThisDay={alsoOnThisDay} />}
                    </>}
                />
            </DialogContent>
        </Dialog>
    );
};

export default ShiftExpandDialog;
