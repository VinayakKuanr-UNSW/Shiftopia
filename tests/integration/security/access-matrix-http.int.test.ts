/**
 * The access matrix, over the real API.
 *
 * supabase/tests/access_matrix/02_matrix_by_level.sql proves what each access
 * level can read and do INSIDE the database (SET ROLE + JWT claims). This file
 * runs the same probes the way a browser does — HTTP to PostgREST with a real
 * signed JWT per persona — and requires the exact same line per persona as
 * expected_matrix.txt. So it also covers what the SQL harness cannot: table
 * and function GRANTs, PostgREST's exposure of each table and RPC, and the
 * JWT → auth.uid() path. One source of truth: if access changes on purpose,
 * update expected_matrix.txt and both suites follow.
 *
 * Each write probe starts from freshly re-applied fixtures, the HTTP
 * equivalent of the SQL harness rolling each probe back.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { personaClient, personaId, stack, type Persona } from '../support/clients';
import { psql, REPO_ROOT, resetFixtures } from '../support/stack';

const shift = (k: number) => `b1000000-0000-4000-8000-00000000000${k}`;
const TIMESHEETS = ['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003'];
const BIDS = ['b0b00000-0000-4000-8000-000000000001', 'b0b00000-0000-4000-8000-000000000003'];
const SWAPS = ['5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000003'];
// Contracts carry access (supabase/tests/access_matrix/01_fixtures.sql).
const CONTRACT = {
    X: 'c0c00000-0000-4000-8000-000000000001',
    D: 'c0c00000-0000-4000-8000-000000000012',
    E2: 'c0c00000-0000-4000-8000-000000000015',
    Z: 'c0c00000-0000-4000-8000-000000000014',
};
const ORG = '00000000-0000-0000-0000-000000000001';
const DEPT_D1 = '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
const SUB_S2 = 'ed004483-7cb4-40cf-a151-57053e009ea8';

const PERSONAS: Persona[] = ['A', 'B', 'D', 'DD', 'E', 'E2', 'F', 'G', 'G2', 'X', 'Z'];

const expected: Record<string, string> = Object.fromEntries(
    readFileSync(resolve(REPO_ROOT, 'supabase/tests/access_matrix/expected_matrix.txt'), 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => [l.slice(0, 3).trim(), l.trimEnd()]),
);

/** Last character of each visible fixture id, in id order — the SQL harness's encoding. */
function tail(rows: { id: string }[] | null): string {
    const ids = (rows ?? []).map((r) => r.id).sort();
    return ids.length ? ids.map((id) => id.slice(-1)).join('') : '-';
}

function fail(what: string, error: PostgrestError): never {
    throw new Error(`${what} errored unexpectedly: ${error.code} ${error.message}`);
}

const fresh = () => resetFixtures(stack().dbContainer);

let roleId: string | undefined;
function existingRoleId(): string {
    roleId ??= psql(stack().dbContainer, 'SELECT id FROM hr.roles ORDER BY id LIMIT 1')[0]?.[0];
    if (!roleId) throw new Error('hr.roles is empty — is supabase/seeds/reference.sql loaded?');
    return roleId;
}

/** 'F' when the RPC refused on authorisation, 'y' when it got past the guard. */
function rpcOutcome(data: unknown, error: PostgrestError | null, refused: (d: any) => boolean): string {
    if (error) return error.code === '42501' ? 'F' : 'y';
    return refused(data) ? 'F' : 'y';
}

async function matrixLine(p: Persona): Promise<string> {
    const c = personaClient(p);
    const self = personaId(p);
    const x = personaId('X');
    const everyone = PERSONAS.map(personaId);

    // ── reads ────────────────────────────────────────────────────────────────
    fresh();
    const sh = await c.from('shifts').select('id').in('id', [1, 2, 3, 4].map(shift));
    if (sh.error) fail('read shifts', sh.error);
    const ts = await c.from('timesheets').select('id').in('id', TIMESHEETS);
    if (ts.error) fail('read timesheets', ts.error);
    const bid = await c.from('shift_bids').select('id').in('id', BIDS);
    if (bid.error) fail('read shift_bids', bid.error);
    const swp = await c.from('shift_swaps').select('id').in('id', SWAPS);
    if (swp.error) fail('read shift_swaps', swp.error);
    const ctr = await c.from('user_contracts').select('id', { count: 'exact', head: true }).eq('user_id', x);
    if (ctr.error) fail('read user_contracts', ctr.error);
    const cert = await c.from('app_access_certificates').select('id', { count: 'exact', head: true })
        .neq('user_id', self).in('user_id', everyone);
    if (cert.error) fail('read app_access_certificates', cert.error);

    let line = `${p.padEnd(3)}see[sh=${tail(sh.data)} ts=${tail(ts.data)} bid=${tail(bid.data)} swp=${tail(swp.data)}`
        + ` ctr=${ctr.count} cert=${cert.count}]`;

    // ── table writes ─────────────────────────────────────────────────────────
    line += ' upd=';
    for (const k of [1, 2, 3, 4]) {
        fresh();
        const r = await c.from('shifts').update({ notes: 'probe' }, { count: 'exact' }).eq('id', shift(k));
        line += r.error ? '!' : r.count === 1 ? String(k) : r.count === 0 ? '.' : '!';
    }
    fresh();
    const del = await c.from('shifts').delete({ count: 'exact' }).eq('id', shift(2));
    line += ` del2=${del.error ? -1 : del.count}`;

    // ── RPCs ─────────────────────────────────────────────────────────────────
    line += ' op=';
    for (const k of [1, 3]) {
        fresh();
        const r = await c.rpc('sm_apply_shift_op', { p_shift_id: shift(k), p_expected_version: 1, p_op: 'edit', p_payload: {} });
        line += k + rpcOutcome(r.data, r.error, (d) => d?.code === 'FORBIDDEN');
    }
    fresh();
    const rdel = await c.rpc('sm_delete_shift', { p_shift_id: shift(2) });
    line += ' rdel2=' + rpcOutcome(rdel.data, rdel.error, (d) => d?.code === 'FORBIDDEN');
    fresh();
    // sm_bulk_assign was dropped (20261026071831); the bulk assign that remains
    // is the autoscheduler's commit.
    const bulk = await c.rpc('sm_bulk_assign_atomic', { p_assignments: [{ employee_id: x, shift_ids: [shift(1), shift(3)] }] });
    line += ' bulk13=' + rpcOutcome(bulk.data, bulk.error, (d) => /^not authorized/i.test(d?.error ?? ''));
    fresh();
    const cxl = await c.rpc('sm_cancel_swap_request', { p_swap_id: SWAPS[1] });
    line += ' cxl3=' + rpcOutcome(cxl.data, cxl.error, (d) => d?.code === 'FORBIDDEN');

    // ── contract write: X gets a contract in S2 ──────────────────────────────
    // The SQL harness inserts with FK checks off to isolate the RLS decision;
    // HTTP cannot, so use a role that exists rather than the fixture's
    // placeholder id — otherwise an authorised insert reads as 23503.
    fresh();
    const ctrIns = await c.from('user_contracts').insert({
        user_id: x, role_id: existingRoleId(), organization_id: ORG, department_id: DEPT_D1, sub_department_id: SUB_S2,
        status: 'Active', employment_status: 'Casual', pay_basis: 'eba_level', remuneration_level: 2,
    });
    line += ' ctrS2=' + (!ctrIns.error ? 'y' : ctrIns.error.code === '42501' ? '.' : '!' + ctrIns.error.code);

    // ── access, set on contracts ───────────────────────────────────────────────
    fresh();
    const grant = await c.from('user_contracts').update({ access_level: 'gamma' }, { count: 'exact' }).eq('id', CONTRACT.X);
    line += ` grantX=${grant.error ? -1 : grant.count}`;
    for (const [label, id] of [['revD', CONTRACT.D], ['revE2', CONTRACT.E2]] as const) {
        fresh();
        const r = await c.from('user_contracts').update({ access_level: 'alpha' }, { count: 'exact' }).eq('id', id);
        line += ` ${label}=${r.error ? -1 : r.count}`;
    }
    fresh();
    const delD = await c.from('user_contracts').delete({ count: 'exact' }).eq('id', CONTRACT.D);
    line += ` delD=${delD.error ? -1 : delD.count}`;
    // certificates mirror contracts: nobody writes them, zeta included
    fresh();
    const certW = await c.from('app_access_certificates').insert({
        user_id: x, certificate_type: 'Y', access_level: 'gamma',
        organization_id: ORG, department_id: DEPT_D1, sub_department_id: SUB_S2, contract_id: CONTRACT.X,
    });
    line += ' certW=' + (!certW.error ? 'y' : certW.error.code === '42501' ? '.' : '!' + certW.error.code);
    if (p === 'Z') {
        fresh();
        const r = await c.from('user_contracts').update({ access_level: 'alpha' }, { count: 'exact' }).eq('id', CONTRACT.Z);
        line += ' lastZeta=' + (r.error ? 'refused:' + r.error.message.slice(0, 40) : `lowered(${r.count})`);
    }

    fresh();
    return line;
}

describe('access matrix over HTTP (PostgREST + real JWTs) matches expected_matrix.txt', () => {
    it.each(PERSONAS)('persona %s', async (p) => {
        expect(expected[p], `expected_matrix.txt has no line for ${p}`).toBeDefined();
        // The SQL harness's lastZeta is a 40-char message slice; the file trims
        // its trailing space, so compare trimmed.
        expect((await matrixLine(p)).trimEnd()).toBe(expected[p]);
    });
});
