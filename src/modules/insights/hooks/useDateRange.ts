import { useState, useMemo } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { DatePreset } from '../model/metric.types';

function toISO(d: Date): string {
    return format(d, 'yyyy-MM-dd');
}

function rangeForPreset(preset: DatePreset): { startDate: string; endDate: string } {
    const today = new Date();
    switch (preset) {
        case 'THIS_WEEK':
            return {
                startDate: toISO(startOfWeek(today, { weekStartsOn: 1 })),
                endDate:   toISO(endOfWeek(today,   { weekStartsOn: 1 })),
            };
        case 'THIS_MONTH':
            return {
                startDate: toISO(startOfMonth(today)),
                endDate:   toISO(endOfMonth(today)),
            };
        case 'LAST_30':
            return {
                startDate: toISO(subDays(today, 29)),
                endDate:   toISO(today),
            };
        case 'LAST_90':
            return {
                startDate: toISO(subDays(today, 89)),
                endDate:   toISO(today),
            };
        default:
            return {
                startDate: toISO(startOfWeek(today, { weekStartsOn: 1 })),
                endDate:   toISO(endOfWeek(today,   { weekStartsOn: 1 })),
            };
    }
}

export interface DateRangeState {
    preset: DatePreset;
    startDate: string;
    endDate: string;
    setPreset: (p: DatePreset) => void;
    setCustomRange: (start: string, end: string) => void;
}

export function useDateRange(initial: DatePreset = 'THIS_MONTH'): DateRangeState {
    const [preset, setPresetState] = useState<DatePreset>(initial);
    const [customRange, setCustomRangeState] = useState<{ start: string; end: string } | null>(null);

    const { startDate, endDate } = useMemo(() => {
        if (preset === 'CUSTOM' && customRange) {
            return { startDate: customRange.start, endDate: customRange.end };
        }
        return rangeForPreset(preset);
    }, [preset, customRange]);

    function setPreset(p: DatePreset) {
        setPresetState(p);
        if (p !== 'CUSTOM') setCustomRangeState(null);
    }

    function setCustomRange(start: string, end: string) {
        setCustomRangeState({ start, end });
        setPresetState('CUSTOM');
    }

    return { preset, startDate, endDate, setPreset, setCustomRange };
}

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
    THIS_WEEK:  'This Week',
    THIS_MONTH: 'This Month',
    LAST_30:    'Last 30 Days',
    LAST_90:    'Last 90 Days',
    CUSTOM:     'Custom',
};
