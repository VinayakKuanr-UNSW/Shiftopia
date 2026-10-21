/**
 * `validateShiftCompliance` must say whether the real compliance engine
 * answered.
 *
 * When the `evaluate-compliance` edge function errors, `validateCompliance`
 * falls back to a local check that only sees past dates and start=end, and
 * reports `passed`. Interactive screens treat that as best effort (they run the
 * client engine too). A write cannot: Publish must not confirm or offer a shift
 * nobody checked. `engineReached` is how a write path tells the difference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    invoke: (async () => ({ data: null, error: null })) as (...a: any[]) => Promise<any>,
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: { functions: { invoke: (...a: any[]) => h.invoke(...a) } },
}));

import { complianceService } from '../compliance.service';

const EMP = '11111111-1111-4111-8111-111111111111';
const FUTURE = '2099-11-20';

beforeEach(() => {
    h.invoke = async () => ({ data: null, error: null });
});

describe('validateShiftCompliance — engineReached', () => {
    it('is false when the edge function errors, even though the local fallback passes', async () => {
        h.invoke = async () => ({ data: null, error: new Error('FunctionsHttpError: 503') });

        const r = await complianceService.validateShiftCompliance(EMP, FUTURE, '09:00:00', '15:00:00', 330, 's1');

        expect(r.engineReached).toBe(false);
    });

    it('is false when the edge function throws', async () => {
        h.invoke = async () => { throw new Error('TypeError: Failed to fetch'); };

        const r = await complianceService.validateShiftCompliance(EMP, FUTURE, '09:00:00', '15:00:00', 330, 's1');

        expect(r.engineReached).toBe(false);
    });

    it('is true when the engine answered', async () => {
        h.invoke = async () => ({
            data: { status: 'passed', violations: [], warnings: [], weeklyHours: 6, maxWeeklyHours: 48, checksPerformed: ['overlap'], checksSkipped: [], qualificationViolations: [] },
            error: null,
        });

        const r = await complianceService.validateShiftCompliance(EMP, FUTURE, '09:00:00', '15:00:00', 330, 's1');

        expect(r.engineReached).toBe(true);
        expect(r.isValid).toBe(true);
    });
});
