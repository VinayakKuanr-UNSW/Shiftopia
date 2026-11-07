import {
    categoryMinutes,
    effectiveDebtsByEmployee,
    shiftFairnessPenaltyCents,
    type FairnessStanding,
} from '@/modules/rosters/domain/fairness-ledger';
import type { ManagerBidShift } from './types';

/** Fairness is casual-only. */
export function isCasualTargetShift(shift: Pick<ManagerBidShift, 'target_employment_type'>): boolean {
    return shift.target_employment_type === 'Casual';
}

interface ShiftWindow {
    date: string;
    startTime: string;
    endTime: string;
    unpaidBreak?: number;
}

const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
};

/**
 * Most-owed bidder first: ascending by what the solver would charge (SC-11 /
 * SC-11b) for giving them this shift. Stable, so equal standing keeps FIFO.
 */
export function orderBidsByFairness<T extends { employee_id: string }>(
    bids: T[],
    standings: FairnessStanding[],
    shift: ShiftWindow,
): T[] {
    const s0 = toMinutes(shift.startTime);
    let s1 = toMinutes(shift.endTime);
    if (s1 <= s0) s1 += 1440;
    const minutes = categoryMinutes(shift.date, shift.startTime, shift.endTime, Math.max(0, s1 - s0 - (shift.unpaidBreak ?? 0)));
    const debts = effectiveDebtsByEmployee(standings);
    const cost = new Map(bids.map(b => [b.employee_id, shiftFairnessPenaltyCents(debts.get(b.employee_id), minutes)]));
    return [...bids].sort((a, b) => (cost.get(a.employee_id) ?? 0) - (cost.get(b.employee_id) ?? 0));
}
