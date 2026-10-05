/**
 * Copy one full-time shift onto a range of dates — the whole flow: range and
 * weekday choice, the plan, and the write.
 *
 * Lifted out of the Office page so the Rosters page can offer the same Copy on
 * a full-time shift (handover 2026-10-04, Phase 3) — one implementation, not
 * two. The page supplies the source shift; everything else is resolved here.
 *
 * THE PLAN IS CHECKED AGAINST THE COPY RANGE, not whatever week the page shows.
 * The range is typed by the manager and routinely runs past the visible week,
 * so leave, existing shifts, roster coverage and — above all — the cycle
 * ceiling (cl 35.1(a)) are re-read for the dates actually being written.
 *
 * NO CEILING, NO COPY. The cycle comes from the team's full-time ledger. An
 * employee who is not in it (e.g. one holding a second, non-full-time
 * contract) has no cycle this flow can check, and copying without one is how a
 * roster ends up over the ceiling with nothing saying so — so it refuses, and
 * says why. The Add Shift form, which runs the full V8 engine, still works for
 * them one shift at a time.
 */

import React from 'react';

import { useToast } from '@/modules/core/ui/primitives/use-toast';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

import { useOfficeLeave, useOfficeWeekShifts, useOfficeWorld, useRosterCoverage } from '../../hooks/useOffice';
import { computeProposal } from '../../api/office.commands';
import { copyShiftToDates } from '../../api/copyShift';
import { copyOutcomeToast, planCopy } from '../../domain/copyPlan';
import { indexApprovedLeave, indexOfficeWeek } from '../../domain/plannedWeek';
import type { IsoWeekday, OfficePattern } from '../../domain/types';
import { CopyShiftDialog } from './CopyShiftDialog';

export interface CopyShiftSource {
    employeeId: string;
    employeeName: string;
    /** `yyyy-MM-dd` of the shift being copied. */
    dateKey: string;
    shift: Shift;
    roleId: string;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
}

export interface CopyShiftFlowProps {
    /** The shift to copy; null keeps the dialog closed. */
    source: CopyShiftSource | null;
    /** Where the range starts out ending — typically the end of the visible week. */
    defaultEndDate: string;
    /** Today in Sydney, `yyyy-MM-dd`. Nothing is copied before it. */
    referenceDate: string;
    onClose: () => void;
    /** After a copy that wrote anything (or reported anything). */
    onCopied?: () => void;
}

/**
 * No patterns. `computeProposal` is called, with none, for ONE output: the
 * employee's cycles over the copy range (contracted ceiling, hours rostered, and
 * leave / public-holiday credit), which `planCopy` checks cl 35.1(a) against.
 */
const NO_PATTERNS: ReadonlyMap<string, OfficePattern> = new Map();

export const CopyShiftFlow: React.FC<CopyShiftFlowProps> = ({
    source, defaultEndDate, referenceDate, onClose, onCopied,
}) => {
    const { toast } = useToast();
    const generatedAt = React.useMemo(() => new Date().toISOString(), []);

    const [copyStart, setCopyStart] = React.useState('');
    const [copyEnd, setCopyEnd] = React.useState('');
    const [copyExcluded, setCopyExcluded] = React.useState<ReadonlySet<IsoWeekday>>(new Set());
    const [copying, setCopying] = React.useState(false);
    const [copyProgress, setCopyProgress] = React.useState<{ done: number; total: number } | null>(null);

    // Seeded from the source (or today, if the source has passed) through
    // `defaultEndDate`: the common case is "the rest of this week". Never before
    // today — nothing is copied into the past.
    const sourceKey = source ? `${source.shift.id}|${source.dateKey}` : null;
    React.useEffect(() => {
        if (!source) return;
        const start = source.dateKey < referenceDate ? referenceDate : source.dateKey;
        setCopyStart(start);
        setCopyEnd(defaultEndDate < start ? start : defaultEndDate);
        setCopyExcluded(new Set());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceKey]);

    const subDepartmentId = source?.subDepartmentId ?? null;
    const copyRangeValid = Boolean(source && copyStart && copyEnd && copyStart <= copyEnd);

    const copyRangeShifts = useOfficeWeekShifts(source ? [source.employeeId] : [], copyStart, copyEnd);
    const copyRangeCoverage = useRosterCoverage(source ? subDepartmentId : null, copyStart, copyEnd);
    const copyRangeLeave = useOfficeLeave(
        source ? [source.employeeId] : [], copyStart, copyEnd, Boolean(source));

    // The world loader widens any range to whole cycles, so this covers every target date.
    const copyWorld = useOfficeWorld(
        copyRangeValid ? subDepartmentId : null, copyStart, copyEnd);

    /** `undefined` while loading; `null` when the employee has no ledger in this team. */
    const copyCycles = React.useMemo(() => {
        if (!source || !copyWorld.data) return undefined;
        const { ledgers } = computeProposal({
            world: copyWorld.data,
            patternsByEmployee: NO_PATTERNS as Map<string, OfficePattern>,
            organizationId: source.organizationId,
            departmentId: source.departmentId,
            subDepartmentId: source.subDepartmentId,
            periodStart: copyStart, periodEnd: copyEnd, referenceDate, generatedAt,
        });
        return ledgers.find(l => l.employeeId === source.employeeId)?.cycles ?? null;
    }, [source, copyWorld.data, copyStart, copyEnd, referenceDate, generatedAt]);

    const blockedReason = copyCycles === null
        ? `${source?.employeeName || 'This employee'} is not one of this team's full-time employees, `
            + 'so the contracted-hours cycle a copy must be checked against (ICC EBA cl 35.1(a)) '
            + 'cannot be read. Add their shifts one at a time instead.'
        : null;

    /** True until the copy range's cycles are known — Apply stays shut meanwhile. */
    const copyPlanning = copyRangeValid && (copyWorld.isLoading || copyCycles === undefined);

    const copyPlan = React.useMemo(() => {
        // No plan until the ceiling can be checked: an empty plan disables Apply.
        if (!source || !copyCycles) return { targets: [], skipped: [] };
        const sh = source.shift as unknown as Record<string, any>;
        const rangeKeys = new Set((copyRangeShifts.data ?? []).map(x => (x as any).shift_date));
        const leave = copyRangeLeave.data?.get(source.employeeId) ?? [];
        return planCopy({
            sourceDate: source.dateKey,
            netMinutes: Number(sh.net_length_minutes ?? 0),
            startDate: copyStart,
            endDate: copyEnd,
            excludeWeekdays: copyExcluded,
            existing: indexOfficeWeek(copyRangeShifts.data ?? [], rangeKeys)
                .get(source.employeeId) ?? new Map(),
            approvedLeave: indexApprovedLeave(leave, new Set(leave.map(l => l.date))),
            writableDates: copyRangeCoverage.data?.writable ?? new Set<string>(),
            lockedOutDates: copyRangeCoverage.data?.lockedOut ?? new Set<string>(),
            cycles: copyCycles,
            today: referenceDate,
        });
    }, [source, copyStart, copyEnd, copyExcluded, copyCycles,
        copyRangeShifts.data, copyRangeLeave.data, copyRangeCoverage.data, referenceDate]);

    const confirmCopy = React.useCallback(async () => {
        if (!source) return;
        const sh = source.shift as unknown as Record<string, any>;
        setCopying(true);
        try {
            const outcome = await copyShiftToDates({
                employeeId: source.employeeId,
                organizationId: source.organizationId,
                departmentId: source.departmentId,
                subDepartmentId: source.subDepartmentId,
                startTime: String(sh.start_time ?? '').slice(0, 5),
                endTime: String(sh.end_time ?? '').slice(0, 5),
                unpaidBreakMinutes: Number(sh.unpaid_break_minutes ?? 0),
                paidBreakMinutes: Number(sh.paid_break_minutes ?? 0),
                roleId: source.roleId,
            }, copyPlan.targets, {
                onProgress: (done, total) => setCopyProgress({ done, total }),
            });

            // Both halves, always. "Copied 8" with three silent skips is how a
            // manager finds out a fortnight later. Skipped = what the plan left
            // out (leave, already rostered, past, no draft roster, ceiling) plus
            // what the database then refused.
            toast(copyOutcomeToast(outcome.created, [...copyPlan.skipped, ...outcome.failed]));
            onClose();
            onCopied?.();
        } catch (e) {
            toast({
                title: 'Could not copy the shift',
                description: e instanceof Error ? e.message : 'Unknown error',
                variant: 'destructive',
            });
        } finally {
            setCopying(false);
            setCopyProgress(null);
        }
    }, [source, copyPlan, toast, onClose, onCopied]);

    if (!source) return null;

    const sh = source.shift as unknown as Record<string, any>;
    return (
        <CopyShiftDialog
            open
            onOpenChange={(o) => { if (!o) onClose(); }}
            employeeName={source.employeeName}
            sourceDate={source.dateKey}
            sourceTimeLabel={`${String(sh.start_time ?? '').slice(0, 5)}–${String(sh.end_time ?? '').slice(0, 5)}`}
            startDate={copyStart}
            endDate={copyEnd}
            excluded={copyExcluded}
            minDate={referenceDate}
            onStartDateChange={setCopyStart}
            onEndDateChange={setCopyEnd}
            onToggleWeekday={(iso) => setCopyExcluded(prev => {
                const next = new Set(prev);
                if (next.has(iso)) next.delete(iso);
                else next.add(iso);
                return next;
            })}
            plan={copyPlan}
            planning={copyPlanning}
            blockedReason={blockedReason}
            onConfirm={() => { void confirmCopy(); }}
            busy={copying}
            progress={copyProgress}
        />
    );
};
