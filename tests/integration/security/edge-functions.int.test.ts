/**
 * The edge function the browser calls, which runs with the service-role key
 * and so must authorise the caller itself — and the compliance RPC that
 * replaced the other one (evaluate-compliance, retired 2026-10-26).
 *
 * get-roster-view had a real pre-auth leak: until 2026-10-05 the public anon
 * key alone returned any organisation's roster and staff list, because
 * `verify_jwt` accepts the anon key (it is a valid JWT). It also answers from a
 * shared cache whose key does not include the caller, so every request must be
 * authorised before the cache can answer.
 *
 * Needs the stack's edge runtime (`supabase start` without `-x edge-runtime`).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { personaToken, stack, type Persona } from '../support/clients';
import { resetFixtures } from '../support/stack';

const ORG = '00000000-0000-0000-0000-000000000001';
const DEPT_D1 = '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
const DEPT_D2 = 'c0000000-0000-0000-0000-000000000003';
const EMPLOYEE_X = 'a0000000-0000-4000-8000-000000000006';

type Caller = Persona | 'anon' | 'none';

async function invoke(fn: string, body: unknown, caller: Caller): Promise<{ status: number; json: any }> {
    const { apiUrl, anonKey } = stack();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: anonKey };
    if (caller === 'anon') headers.Authorization = `Bearer ${anonKey}`;
    else if (caller !== 'none') headers.Authorization = `Bearer ${personaToken(caller)}`;
    const res = await fetch(`${apiUrl}/functions/v1/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (res.status === 404 || res.status === 502 || res.status === 503) {
        throw new Error(`${fn} is not being served (${res.status}) — start the stack with the edge runtime.`);
    }
    return { status: res.status, json };
}

beforeAll(() => resetFixtures(stack().dbContainer));

describe('edge function get-roster-view', () => {
    const roster = (dept: string) => ({
        organization_id: ORG, department_ids: [dept], start_date: '2026-12-01', end_date: '2026-12-03',
    });

    it('refuses a request with no token', async () => {
        expect((await invoke('get-roster-view', roster(DEPT_D1), 'none')).status).toBe(401);
    });

    it('refuses the anon key (the 2026-10-05 pre-auth leak)', async () => {
        const r = await invoke('get-roster-view', roster(DEPT_D1), 'anon');
        expect(r.status).toBe(401);
        expect(r.json?.employees).toBeUndefined();
    });

    it.each([
        ['F', 'a manager in another organisation'],
        ['X', 'an employee without shift.view'],
    ] as const)('refuses %s — %s', async (p, _who) => {
        const r = await invoke('get-roster-view', roster(DEPT_D1), p);
        expect(r.status).toBe(403);
        expect(r.json?.shifts).toBeUndefined();
    });

    it('refuses a manager asking for a department outside their scope', async () => {
        expect((await invoke('get-roster-view', roster(DEPT_D2), 'D')).status).toBe(403);
    });

    it('serves a manager their own department, and nothing outside it', async () => {
        const r = await invoke('get-roster-view', roster(DEPT_D1), 'D');
        expect(r.status).toBe(200);
        const shifts = r.json.shifts as { id: string; organization_id: string; department_id: string }[];
        expect(shifts.map((s) => s.id.slice(-1)).sort()).toEqual(['1', '2']);
        expect(new Set(shifts.map((s) => s.department_id))).toEqual(new Set([DEPT_D1]));
        expect(new Set(shifts.map((s) => s.organization_id))).toEqual(new Set([ORG]));
    });

    it('authorises every caller even when the shared cache already holds the answer', async () => {
        expect((await invoke('get-roster-view', roster(DEPT_D1), 'D')).status).toBe(200);  // warm the cache
        for (const p of ['F', 'X', 'anon'] as const) {
            const r = await invoke('get-roster-view', roster(DEPT_D1), p);
            expect(r.status, `${p} after the cache was warmed`).toBeGreaterThanOrEqual(401);
            expect(r.json?.shifts, `${p} must not receive cached shifts`).toBeUndefined();
        }
    });
});

// The evaluate-compliance edge function was retired 2026-10-26: the browser and
// auto-assign-bids now ask the database's EBA engine directly, which carries
// the same guard (can_view_employee_schedule). Its assertions moved with it.
describe('compliance RPC eba_check_assignment', () => {
    const check = {
        p_shift_id: null, p_employee_id: EMPLOYEE_X, p_shift_date: '2026-12-05', p_start_time: '09:00', p_end_time: '12:00',
    };

    async function rpc(caller: Caller): Promise<{ status: number; json: any }> {
        const { apiUrl, anonKey } = stack();
        const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: anonKey };
        if (caller === 'anon') headers.Authorization = `Bearer ${anonKey}`;
        else if (caller !== 'none') headers.Authorization = `Bearer ${personaToken(caller)}`;
        const res = await fetch(`${apiUrl}/rest/v1/rpc/eba_check_assignment`, { method: 'POST', headers, body: JSON.stringify(check) });
        return { status: res.status, json: await res.json().catch(() => null) };
    }

    it('refuses the anon key', async () => {
        expect((await rpc('anon')).status).toBe(401);
    });

    it('refuses a manager in another organisation', async () => {
        const r = await rpc('F');
        expect(r.status).toBe(403);
        expect(Array.isArray(r.json)).toBe(false);
    });

    it.each([
        ['X', 'the employee themselves'],
        ['D', 'a manager whose scope covers the employee\'s contract'],
    ] as const)('answers %s — %s', async (p, _who) => {
        const r = await rpc(p);
        expect(r.status).toBe(200);
        expect(Array.isArray(r.json) && r.json.length > 0).toBe(true);
    });
});
