import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';

type BidPriority = 'normal' | 'urgent' | 'emergent';


type ShiftLike = {
    date: string;
    startTime: string;
    startAt?: string | null;
};

export const getBidPriority = (
    shift: ShiftLike,
    now: Date = new Date()
): BidPriority => {
    const shiftStart = shift.startAt
        ? new Date(shift.startAt)
        : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);

    if (isNaN(shiftStart.getTime())) return 'normal';
    const hoursUntil = (shiftStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntil <= 24) return 'urgent';
    return 'normal';
};
