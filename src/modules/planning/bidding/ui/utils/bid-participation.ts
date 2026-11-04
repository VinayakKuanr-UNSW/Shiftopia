import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import type { BidStatus, ParticipationStatus } from '../../model/bid.types';

type ShiftLike = {
    id: unknown;
    date: string;
    startTime: string;
    startAt?: string | null;
    last_rejected_by?: string | null;
    last_dropped_by?: string | null;
};

type BidLike = {
    shiftId: unknown;
    status: BidStatus;
};

// Bids that ended without an outcome for the bidder; they may bid again.
const CLOSED_WITHOUT_OUTCOME: ReadonlySet<BidStatus> = new Set(['withdrawn', 'expired', 'cancelled']);

/** Bidding stays open until the shift starts (TTS > 0); there is no earlier lock. */
export function getBiddingClosesAt(shift: Pick<ShiftLike, 'date' | 'startTime' | 'startAt'>): Date {
    return shift.startAt
        ? new Date(shift.startAt)
        : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);
}

export function getParticipationStatus(
    shift: ShiftLike,
    allMyBids: BidLike[],
    userId: string
): ParticipationStatus {
    // Permanent lockout if user dropped or rejected
    if (shift.last_rejected_by === userId) return 'rejected_offer';
    if (shift.last_dropped_by === userId) return 'dropped';

    // Find user's bid (only one active bid per shift now)
    const currentBid = allMyBids.find(b =>
        String(b.shiftId) === String(shift.id) &&
        !CLOSED_WITHOUT_OUTCOME.has(b.status)
    );

    const shiftStart = getBiddingClosesAt(shift);

    if (!currentBid) {
        if (new Date() >= shiftStart) return 'expired';
        return 'not_participated';
    }

    if (currentBid.status === 'pending') {
        if (new Date() >= shiftStart) return 'auto_rejected';
        return 'pending';
    }
    if (currentBid.status === 'accepted' || currentBid.status === 'selected') return 'selected';
    if (currentBid.status === 'rejected') return 'rejected';
    return 'not_participated';
}
