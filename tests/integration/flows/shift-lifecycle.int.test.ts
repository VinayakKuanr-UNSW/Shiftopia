/**
 * Core shift flows over HTTP — the RPCs the roster, bulk-action and clock-in
 * UI drive — with the persona fixtures (supabase/tests/access_matrix/). Each
 * test starts from freshly applied fixtures.
 *
 * Shift 1 (S1, assigned X) and shift 2 (S2, unassigned) sit in department D1
 * and run 09:00–12:00 on the same day; shift 4 belongs to another
 * organisation. X is an employee with a contract in S1 only.
 *
 * Writers are gammas, the managerial level with full rights in one
 * sub-department: G manages S1, G2 manages S2. D (delta, D1) and E (epsilon)
 * are view-only since the 2026-10-14 access suites, and are refused here like
 * DD (another department) and F (another organisation).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { personaClient, personaId, stack, type Persona } from '../support/clients';
import { psql, resetFixtures } from '../support/stack';

const S1 = 'b1000000-0000-4000-8000-000000000001';
const S2 = 'b1000000-0000-4000-8000-000000000002';
const S4 = 'b1000000-0000-4000-8000-000000000004';
const TIMESHEET_S1 = '70000000-0000-4000-8000-000000000001';

function db(sql: string): string[][] {
    return psql(stack().dbContainer, sql);
}

function shift(id: string): Record<string, string> | null {
    const rows = db(`SELECT version, lifecycle_status, assignment_status, coalesce(assigned_employee_id::text, ''),
                            coalesce(last_modified_by::text, ''), shift_date
                       FROM public.shifts WHERE id = '${id}'`);
    if (!rows.length) return null;
    const [version, lifecycle, assignment, assignee, modifiedBy, date] = rows[0];
    return { version, lifecycle, assignment, assignee, modifiedBy, date };
}

function gateway(p: Persona, id: string, version: number, op: string, payload: Record<string, unknown> = {}) {
    return personaClient(p).rpc('sm_apply_shift_op', {
        p_shift_id: id, p_expected_version: version, p_op: op, p_payload: payload,
    });
}

beforeEach(() => resetFixtures(stack().dbContainer));

describe('shift gateway (sm_apply_shift_op)', () => {
    it('a manager publishes and unpublishes a draft; every write advances the version', async () => {
        const pub = await gateway('G2', S2, 1, 'publish');
        expect(pub.error).toBeNull();
        expect(pub.data).toMatchObject({ ok: true, code: 'APPLIED', state: 'S5', version: 2 });
        expect(shift(S2)).toMatchObject({ lifecycle: 'Published', version: '2' });

        const unpub = await gateway('G2', S2, 2, 'unpublish', { reason: 'integration test' });
        expect(unpub.data).toMatchObject({ ok: true, code: 'APPLIED', state: 'S1', version: 3 });
        expect(shift(S2)).toMatchObject({ lifecycle: 'Draft', version: '3' });
    });

    it('refuses a write against a stale version and changes nothing (optimistic concurrency)', async () => {
        expect((await gateway('G2', S2, 1, 'publish')).data).toMatchObject({ ok: true });
        const stale = await gateway('G2', S2, 1, 'unpublish', { reason: 'stale' });
        expect(stale.data).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
        expect(stale.data.server_row.version).toBe(2);
        expect(shift(S2)).toMatchObject({ lifecycle: 'Published', version: '2' });
    });

    it('refuses to double-book an employee who already works that time', async () => {
        const r = await gateway('G2', S2, 1, 'assign', { employee_id: personaId('X') });
        // The gateway runs the EBA engine before writing and reports the first
        // blocking rule. X also has no contract in S2's sub-department, so check
        // the engine's whole blocking set for the overlap itself.
        expect(r.data).toMatchObject({ ok: false, code: 'WRITE_REJECTED', note: 'EBA_COMPLIANCE_BREACH' });
        const blocking = db(`SELECT rule_id FROM internal.eba_check_assignment('${S2}', '${personaId('X')}')
                              WHERE tier = 'BLOCKING'`).map(([rule]) => rule);
        expect(blocking).toContain('V8_NO_OVERLAP');
        expect(shift(S2)).toMatchObject({ assignment: 'unassigned', assignee: '' });
    });

    it('reports an impossible transition instead of applying it', async () => {
        const r = await gateway('G2', S2, 1, 'unassign');
        expect(r.data).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION', current_state: 'S1' });
    });

    it('will not move a shift onto a day that has no roster', async () => {
        const r = await gateway('G2', S2, 1, 'edit', { shift_date: '2026-12-05' });
        expect(r.data).toMatchObject({ ok: false });
        expect(r.data.error).toMatch(/no roster/i);
        expect(shift(S2)?.date).toBe('2026-12-01');
    });

    it.each([
        ['X', 'an employee'],
        ['G', 'a gamma of another sub-department'],
        ['DD', 'a delta of another department'],
        ['D', 'the department\'s delta — view-only'],
        ['E', 'an epsilon — view-only'],
    ] as const)('refuses %s (%s) publishing', async (p, _who) => {
        expect((await gateway(p, S2, 1, 'publish')).data).toMatchObject({ ok: false, code: 'FORBIDDEN' });
        expect(shift(S2)?.lifecycle).toBe('Draft');
    });
});

describe('bulk publish (sm_bulk_publish_shifts)', () => {
    it('publishes a manager\'s in-scope shifts and records the real caller, not the claimed actor', async () => {
        const r = await personaClient('G2').rpc('sm_bulk_publish_shifts', {
            p_shift_ids: [S2], p_actor_id: personaId('X'),
        });
        expect(r.data).toMatchObject({ success: true, success_count: 1 });
        expect(shift(S2)).toMatchObject({ lifecycle: 'Published', modifiedBy: personaId('G2') });
    });

    // Regression: until 2026-10-13 this RPC had no authorisation check at all.
    it('refuses an employee, even for another organisation\'s shift', async () => {
        const r = await personaClient('X').rpc('sm_bulk_publish_shifts', { p_shift_ids: [S4], p_actor_id: personaId('X') });
        expect(r.data).toMatchObject({ success: false });
        expect(r.data.error).toMatch(/not authorised/i);
        expect(shift(S4)?.lifecycle).toBe('Draft');
    });

    it('refuses the whole batch when any shift is outside the manager\'s scope', async () => {
        const r = await personaClient('G2').rpc('sm_bulk_publish_shifts', { p_shift_ids: [S2, S4], p_actor_id: personaId('G2') });
        expect(r.data).toMatchObject({ success: false });
        expect(shift(S2)?.lifecycle).toBe('Draft');
        expect(shift(S4)?.lifecycle).toBe('Draft');
    });
});

describe('deleting a shift (sm_delete_shift)', () => {
    it('refuses an employee and leaves the shift', async () => {
        const r = await personaClient('X').rpc('sm_delete_shift', { p_shift_id: S1 });
        expect(r.data).toMatchObject({ success: false, code: 'FORBIDDEN' });
        expect(shift(S1)).not.toBeNull();
    });

    it('refuses a view-only delta and leaves the shift', async () => {
        const r = await personaClient('D').rpc('sm_delete_shift', { p_shift_id: S2 });
        expect(r.data).toMatchObject({ success: false, code: 'FORBIDDEN' });
        expect(shift(S2)).not.toBeNull();
    });

    it('lets the shift\'s gamma delete an unworked shift — permanently', async () => {
        const r = await personaClient('G2').rpc('sm_delete_shift', { p_shift_id: S2 });
        expect(r.data).toMatchObject({ success: true });
        expect(shift(S2)).toBeNull();
    });
});

describe('emergency assignment (sm_emergency_assign)', () => {
    beforeEach(async () => {
        expect((await gateway('G2', S2, 1, 'publish')).data).toMatchObject({ ok: true, state: 'S5' });
    });

    it('refuses an employee', async () => {
        const r = await personaClient('X').rpc('sm_emergency_assign', {
            p_shift_id: S2, p_employee_id: personaId('X'), p_reason: 'test', p_user_id: personaId('X'),
        });
        expect(r.error?.code).toBe('42501');
        expect(shift(S2)?.assignee).toBe('');
    });

    it('refuses to assign an employee with no contract in the shift\'s sub-department', async () => {
        const r = await personaClient('G2').rpc('sm_emergency_assign', {
            p_shift_id: S2, p_employee_id: personaId('X'), p_reason: 'test', p_user_id: personaId('G2'),
        });
        expect(r.error?.code).toBe('23514');
        expect(r.error?.message).toMatch(/no active contract/i);
        expect(shift(S2)?.assignee).toBe('');
    });
});

describe('clock in / clock out', () => {
    // Put X's shift inside the clock-in window [start − 1 h, start + 12.5 h]:
    // 00:00–03:00 before Sydney noon, 12:00–15:00 after. No geofence is
    // configured in the seed, so any location is accepted.
    beforeEach(() => {
        db(`SET session_replication_role = replica;
            UPDATE public.shifts
               SET shift_date = (now() AT TIME ZONE 'Australia/Sydney')::date,
                   start_time = CASE WHEN (now() AT TIME ZONE 'Australia/Sydney')::time < '12:00' THEN '00:00' ELSE '12:00' END::time,
                   end_time   = CASE WHEN (now() AT TIME ZONE 'Australia/Sydney')::time < '12:00' THEN '03:00' ELSE '15:00' END::time,
                   lifecycle_status = 'Published', start_at = NULL, end_at = NULL
             WHERE id = '${S1}';
            DELETE FROM public.timesheets WHERE shift_id = '${S1}';
            RESET session_replication_role;`);
    });

    const at = { p_lat: -33.87, p_lon: 151.2 };

    it('refuses a manager outside the shift\'s scope', async () => {
        const r = await personaClient('DD').rpc('check_in_shift', { p_shift_id: S1, ...at });
        expect(r.error?.code).toBe('42501');
    });

    it('the assigned employee clocks in once, then out', async () => {
        const x = personaClient('X');
        const inn = await x.rpc('check_in_shift', { p_shift_id: S1, ...at });
        expect(inn.data).toMatchObject({ success: true });

        const again = await x.rpc('check_in_shift', { p_shift_id: S1, ...at });
        expect(again.data).toMatchObject({ success: false, error: 'Already clocked in for this shift' });

        const out = await x.rpc('sm_clock_out_shift', { p_shift_id: S1, p_user_id: personaId('X'), ...at });
        expect(out.data).toMatchObject({ success: true });
    });
});

describe('timesheet approval', () => {
    const status = () => db(`SELECT status FROM public.timesheets WHERE id = '${TIMESHEET_S1}'`)[0][0];
    const approve = (p: Persona) =>
        personaClient(p).from('timesheets').update({ status: 'approved' }, { count: 'exact' }).eq('id', TIMESHEET_S1);

    it('refuses to approve a timesheet before its shift reaches a final attendance state', async () => {
        const r = await approve('G');
        expect(r.error?.code).toBe('23514');
        expect(r.error?.message).toMatch(/final attendance state/i);
        expect(status()).toBe('draft');
    });

    describe('once the employee has clocked out', () => {
        beforeEach(() => {
            db(`SET session_replication_role = replica;
                UPDATE public.timesheets SET clock_out = clock_in + interval '3 hours' WHERE id = '${TIMESHEET_S1}';
                RESET session_replication_role;`);
        });

        it('an employee cannot approve their own timesheet', async () => {
            const r = await approve('X');
            expect(r.error?.code).toBe('42501');
            expect(status()).toBe('draft');
        });

        it('a manager outside the timesheet\'s scope approves nothing', async () => {
            const r = await approve('DD');
            expect(r.error).toBeNull();
            expect(r.count).toBe(0);
            expect(status()).toBe('draft');
        });

        it.each(['D', 'E'] as const)('a view-only %s sees the timesheet but approves nothing', async (p) => {
            const seen = await personaClient(p).from('timesheets').select('id').eq('id', TIMESHEET_S1);
            expect(seen.data).toHaveLength(1);
            const r = await approve(p);
            expect(r.error).toBeNull();
            expect(r.count).toBe(0);
            expect(status()).toBe('draft');
        });

        it('the shift\'s manager approves it', async () => {
            const r = await approve('G');
            expect(r.error).toBeNull();
            expect(r.count).toBe(1);
            expect(status()).toBe('approved');
        });
    });
});

describe('the gateway does not delete', () => {
    // Asked by someone who holds shift.delete, so the refusal is the pointer, not FORBIDDEN.
    it('refuses its delete op and points to sm_delete_shift, the one deletion path', async () => {
        const r = await gateway('G2', S2, 1, 'delete');
        expect(r.data).toMatchObject({ ok: false, code: 'WRITE_REJECTED', note: 'USE_SM_DELETE_SHIFT' });
        expect(shift(S2)).not.toBeNull();
    });
});
