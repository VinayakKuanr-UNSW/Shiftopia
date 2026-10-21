/**
 * Auto-Schedule opens on the roster period on screen.
 *
 * The toolbar computed that period and never passed it on, so the window
 * defaulted to the span of the page's unassigned drafts — empty in Month +
 * Group, where the page loads no shifts — and the modal opened on "Please
 * select both start and end dates".
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/modules/rosters/state/useRosterShifts', () => ({
    useShiftsByDateRange: () => ({ data: [], isFetching: false }),
}));
vi.mock('@/modules/core/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<typeof import('@tanstack/react-query')>()),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { useAutoScheduler } from '../useAutoScheduler';

const base = { open: false, onClose: () => {}, onComplete: () => {}, employees: [], organizationId: 'org' };

describe('useAutoScheduler — initial window', () => {
    it('opens on the range it is given', () => {
        const { result } = renderHook(() => useAutoScheduler({
            ...base,
            shifts: [],
            initialRange: { startDate: '2026-10-01', endDate: '2026-10-31' },
        }));

        expect(result.current.startDate).toBe('2026-10-01');
        expect(result.current.endDate).toBe('2026-10-31');
        expect(result.current.validationError).toBeNull();
    });

    it('without one, still falls back to the span of the drafts it was handed', () => {
        const { result } = renderHook(() => useAutoScheduler({
            ...base,
            shifts: [
                { id: 'a', shift_date: '2026-10-09', start_time: '09:00', end_time: '15:00' },
                { id: 'b', shift_date: '2026-10-03', start_time: '09:00', end_time: '15:00' },
            ] as any,
        }));

        expect(result.current.startDate).toBe('2026-10-03');
        expect(result.current.endDate).toBe('2026-10-09');
    });
});
