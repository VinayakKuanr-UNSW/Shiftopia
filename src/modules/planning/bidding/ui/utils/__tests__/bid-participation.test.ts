import { describe, expect, it } from 'vitest';
import { getBiddingClosesAt, getParticipationStatus } from '../bid-participation';

const USER = 'u1';
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const shift = (startAt: string) => ({ id: 's1', date: '2026-01-01', startTime: '09:00', startAt });

describe('bidding window (03-bidding-fsm.md B-D1/B-D2)', () => {
    it('closes at the shift start, not 4h before', () => {
        const startAt = inHours(2);
        expect(getBiddingClosesAt(shift(startAt)).toISOString()).toBe(startAt);
    });

    it('is still open 2h before start for someone who has not bid', () => {
        expect(getParticipationStatus(shift(inHours(2)), [], USER)).toBe('not_participated');
    });

    it('is closed once the shift has started', () => {
        expect(getParticipationStatus(shift(inHours(-1)), [], USER)).toBe('expired');
    });
});

describe('a bid from an earlier round', () => {
    it.each(['withdrawn', 'expired', 'cancelled'] as const)('%s does not count as the current bid', status => {
        const bids = [{ shiftId: 's1', status }];
        expect(getParticipationStatus(shift(inHours(48)), bids, USER)).toBe('not_participated');
    });

    it('a pending bid is the current bid', () => {
        const bids = [{ shiftId: 's1', status: 'pending' as const }];
        expect(getParticipationStatus(shift(inHours(48)), bids, USER)).toBe('pending');
    });
});
