import { describe, expect, it } from 'vitest';
import type { FairnessStanding } from '@/modules/rosters/domain/fairness-ledger';
import { isCasualTargetShift, orderBidsByFairness } from '../bid-fairness';

const standing = (employeeId: string, metric: FairnessStanding['metric'], debtHours: number, confidence = 1): FairnessStanding => ({
    employeeId, metric, debtHours, confidence,
    actualHours: 0, expectedHours: 0, opportunityCount: 10,
    windowStart: '2026-11-07', windowEnd: '2026-12-01',
});

const bids = [{ employee_id: 'X' }, { employee_id: 'Y' }, { employee_id: 'Z' }];
const sunday = { date: '2026-12-06', startTime: '09:00', endTime: '17:30', unpaidBreak: 30 };
const monday = { date: '2026-12-07', startTime: '09:00', endTime: '17:30', unpaidBreak: 30 };

describe('isCasualTargetShift', () => {
    it('reads the raw target_employment_type the mapper keeps on the row', () => {
        expect(isCasualTargetShift({ target_employment_type: 'Casual' })).toBe(true);
        expect(isCasualTargetShift({ target_employment_type: 'FT' })).toBe(false);
        expect(isCasualTargetShift({})).toBe(false);
    });
});

describe('orderBidsByFairness — most owed first, priced like the solver', () => {
    it('puts the bidder owed Sunday work first and the one above their share last', () => {
        const ordered = orderBidsByFairness(bids, [standing('Y', 'sunday_hours', -8), standing('Z', 'sunday_hours', 8)], sunday);
        expect(ordered.map(b => b.employee_id)).toEqual(['Y', 'X', 'Z']);
    });

    it('keeps FIFO when nobody has a standing', () => {
        expect(orderBidsByFairness(bids, [], sunday).map(b => b.employee_id)).toEqual(['X', 'Y', 'Z']);
    });

    it('weights debts by confidence: a thin record steers less', () => {
        const ordered = orderBidsByFairness(bids, [standing('Y', 'sunday_hours', -8, 0.1), standing('X', 'sunday_hours', -2, 1)], sunday);
        expect(ordered.map(b => b.employee_id)).toEqual(['X', 'Y', 'Z']);
    });

    it('a weekday shift ignores Sunday debt but follows total-hours debt', () => {
        const ordered = orderBidsByFairness(bids, [standing('X', 'sunday_hours', -8), standing('Z', 'total_hours', -5)], monday);
        expect(ordered.map(b => b.employee_id)).toEqual(['Z', 'X', 'Y']);
    });

    it('does not mutate the input', () => {
        const input = [...bids];
        orderBidsByFairness(input, [standing('Z', 'sunday_hours', -8)], sunday);
        expect(input.map(b => b.employee_id)).toEqual(['X', 'Y', 'Z']);
    });
});
