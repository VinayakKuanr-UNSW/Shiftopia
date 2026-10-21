/**
 * Creating a shift WITH an employee must not save it unchecked.
 *
 * `createShift` gates an assigned shift on `validateShiftCompliance`. When the
 * `evaluate-compliance` edge function was unreachable, the local fallback
 * reported `passed`, so the shift was saved with nobody having checked rest
 * gaps, weekly hours or qualifications. Decision (2026-10-18): block it, the
 * same as Publish. An unassigned shift has no person to check and still saves.
 *
 * The REAL compliance service runs; only `supabase.functions.invoke` and the
 * RPC client are mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    rpcCalls: [] as Array<{ fn: string; args: any }>,
    invoke: (async () => ({ data: null, error: null })) as (...a: any[]) => Promise<any>,
}));

vi.mock('@/platform/supabase/client', () => {
    const chain: any = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'then') return (res: any) => Promise.resolve({ data: [{ id: 'shift-1' }], error: null }).then(res);
            if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: { id: 'shift-1' }, error: null });
            return () => chain;
        },
    });
    return {
        supabase: {
            from: () => chain,
            functions: { invoke: (...a: any[]) => h.invoke(...a) },
        },
    };
});

vi.mock('@/platform/supabase/rpc/client', () => ({
    requireUser: async () => ({ id: 'user-1' }),
    callRpc: async (fn: string, args: any) => { h.rpcCalls.push({ fn, args }); return 'new-shift-id'; },
    callAuthenticatedRpc: async (fn: string, args: any) => { h.rpcCalls.push({ fn, args }); return { code: 'APPLIED', version: 2 }; },
    callAuthenticatedVoidRpc: async (fn: string, args: any) => { h.rpcCalls.push({ fn, args }); },
}));

vi.mock('../shifts.queries', () => ({
    shiftsQueries: {
        getShiftById: async (id: string) => ({
            id, version: 1, shift_date: '2099-01-01', start_time: '09:00', end_time: '17:30',
            unpaid_break_minutes: 30, paid_break_minutes: 30, is_training: false, role_id: null, roles: null,
        }),
    },
}));

import { shiftsCommands } from '../shifts.commands';
import { ComplianceError, ComplianceUnavailableError } from '@/platform/supabase/rpc/errors';

const EMP = '22222222-2222-4222-8222-222222222222';
// Lawful under the shape gate: 8h net, 30m unpaid meal break, 30m paid rest.
const baseShift = {
    roster_id: 'r1',
    department_id: '11111111-1111-4111-8111-111111111111',
    shift_date: '2099-06-01',
    start_time: '09:00',
    end_time: '17:30',
    unpaid_break_minutes: 30,
    paid_break_minutes: 30,
};
const passed = { status: 'passed', violations: [], warnings: [], weeklyHours: 8, maxWeeklyHours: 48, checksPerformed: ['overlap'], checksSkipped: [], qualificationViolations: [] };
const created = () => h.rpcCalls.some(c => c.fn === 'sm_create_shift');

beforeEach(() => {
    h.rpcCalls.length = 0;
    h.invoke = async () => ({ data: passed, error: null });
});

describe('createShift — compliance for an assigned shift fails closed', () => {
    it('refuses to save when the compliance engine is unreachable', async () => {
        h.invoke = async () => ({ data: null, error: new Error('FunctionsHttpError: 503') });

        await expect(shiftsCommands.createShift({ ...baseShift, assigned_employee_id: EMP } as any))
            .rejects.toBeInstanceOf(ComplianceUnavailableError);
        expect(created()).toBe(false);
    });

    it('refuses to save when the engine names a violation, and says which', async () => {
        h.invoke = async () => ({ data: { ...passed, status: 'violated', violations: ['Weekly hours would exceed 48'] }, error: null });

        const err = await shiftsCommands.createShift({ ...baseShift, assigned_employee_id: EMP } as any).catch(e => e);
        expect(err).toBeInstanceOf(ComplianceError);
        expect(err.message).toMatch(/Weekly hours would exceed 48/);
        expect(created()).toBe(false);
    });

    it('saves when the engine answered and passed', async () => {
        await shiftsCommands.createShift({ ...baseShift, assigned_employee_id: EMP } as any);

        expect(created()).toBe(true);
    });

    it('saves an unassigned shift without calling the engine — there is nobody to check', async () => {
        h.invoke = async () => { throw new Error('must not be called'); };

        await shiftsCommands.createShift({ ...baseShift } as any);

        expect(created()).toBe(true);
    });
});
