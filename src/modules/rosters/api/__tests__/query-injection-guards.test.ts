import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Attempted-injection cover for the My Roster query layer.
 *
 * Five call sites in `shifts.queries.ts` build PostgREST filters by STRING
 * INTERPOLATION:
 *
 *     query.or(`department_id.eq.${filters.departmentId},department_id.is.null`)
 *
 * PostgREST's `or=` grammar is comma-separated, so a value containing a comma
 * does not error — it adds a disjunct. `department_id.eq.<uuid>` becomes
 * `department_id.eq.<uuid>,department_id.not.is.null` and the query widens to
 * every department. RLS is the real boundary and would still hold, but a user
 * with legitimate access to ONE department could widen to all of them within
 * their org, which RLS permits.
 *
 * Each site is guarded by `isValidUuid`. These tests exercise the guard through
 * the real code path with a recording query builder, rather than grepping for
 * the guard's presence — a grep passes even if the guard is applied to the wrong
 * variable.
 */

/** Chainable, thenable PostgREST stand-in that records every filter call. */
function recorder() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rows: unknown[] = [];
  const builder: Record<string, unknown> = {};

  const chain = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'or', 'order', 'limit', 'not']) {
    builder[m] = chain(m);
  }
  // Awaiting the builder resolves like a PostgREST response.
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null, count: 0 });

  const client = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
  return { client, calls, filterStrings: () => calls.filter((c) => c.method === 'or').map((c) => String(c.args[0])) };
}

const rec = recorder();
vi.mock('@/platform/supabase/client', () => ({ supabase: rec.client }));
vi.mock('@/platform/supabase/rpc/client', () => ({ callAuthenticatedRpc: vi.fn() }));

const { shiftsQueries } = await import('../shifts.queries');

const GOOD_UUID = '11111111-1111-1111-1111-111111111111';
const EMPLOYEE = '22222222-2222-2222-2222-222222222222';

/** Payloads that try to escape the `or=` grammar or the uuid slot. */
const INJECTIONS: Array<[string, string]> = [
  ['extra disjunct',      `${GOOD_UUID},department_id.not.is.null`],
  ['wildcard',            '*'],
  ['negation',            `not.is.null`],
  ['nested or',           `${GOOD_UUID}),or(department_id.not.is.null`],
  ['sql-ish',             `${GOOD_UUID}' OR '1'='1`],
  ['whitespace prefix',   ` ${GOOD_UUID}`],
  ['newline',             GOOD_UUID + '\n' + 'department_id.not.is.null'],
  ['null byte',           GOOD_UUID + '\u0000'],
  ['unicode lookalike',   '1111111１-1111-1111-1111-111111111111'],
  ['empty',               ''],
];

beforeEach(() => { rec.calls.length = 0; });

describe('getMyOffers — department filter cannot be injected', () => {
  it.each(INJECTIONS)('drops a %s payload entirely', async (_label, payload) => {
    await shiftsQueries.getMyOffers(EMPLOYEE, { departmentId: payload });

    const ors = rec.filterStrings();
    // The guard is all-or-nothing: a rejected value adds NO filter at all. This
    // is the assertion that matters, and it holds for the empty payload too
    // (where a substring check would be vacuous, since '' is in everything).
    expect(ors, 'a rejected value must add no filter at all').toHaveLength(0);
    if (payload.trim()) {
      expect(ors.join('|'), 'payload reached the PostgREST filter string').not.toContain(payload.trim());
    }
  });

  it('still applies a LEGITIMATE department id', async () => {
    // Guard-too-tight is its own bug: the filter must actually work.
    await shiftsQueries.getMyOffers(EMPLOYEE, { departmentId: GOOD_UUID });
    expect(rec.filterStrings()).toEqual([`department_id.eq.${GOOD_UUID},department_id.is.null`]);
  });

  it('rejects an injected ORGANIZATION id without falling back to unfiltered', async () => {
    await shiftsQueries.getMyOffers(EMPLOYEE, { organizationId: `${GOOD_UUID},x.y.z` });
    const orgEq = rec.calls.filter((c) => c.method === 'eq' && c.args[0] === 'organization_id');
    expect(orgEq).toHaveLength(0);
  });
});

describe('employee id is validated before it reaches the wire', () => {
  it.each([
    ['sql-ish',   `${EMPLOYEE}' OR '1'='1`],
    ['wildcard',  '*'],
    ['empty',     ''],
    ['not a uuid', 'me'],
    ['injection', `${EMPLOYEE},assigned_employee_id.not.is.null`],
  ])('getEmployeeShifts refuses a %s employee id without querying', async (_l, bad) => {
    const out = await shiftsQueries.getEmployeeShifts(bad, '2026-01-01', '2026-12-31');
    expect(out).toEqual([]);
    // Crucially: it must not have issued a query at all.
    expect(rec.calls.filter((c) => c.method === 'from')).toHaveLength(0);
  });

  it('getPendingOfferCount returns 0 for a bad id without querying', async () => {
    const n = await shiftsQueries.getPendingOfferCount('not-a-uuid');
    expect(n).toBe(0);
    expect(rec.calls.filter((c) => c.method === 'from')).toHaveLength(0);
  });

  it('getMyOffers returns [] for a bad id without querying', async () => {
    const out = await shiftsQueries.getMyOffers('not-a-uuid');
    expect(out).toEqual([]);
    expect(rec.calls.filter((c) => c.method === 'from')).toHaveLength(0);
  });
});

describe('the employee scope is applied server-side, not just client-side', () => {
  it('getEmployeeShifts always constrains assigned_employee_id', async () => {
    // The hook ALSO filters by scope in the browser, but that is presentation.
    // If this `.eq` ever disappears, the page would rely on RLS alone to avoid
    // showing one employee another employee's roster.
    await shiftsQueries.getEmployeeShifts(EMPLOYEE, '2026-01-01', '2026-12-31');
    const eqs = rec.calls.filter((c) => c.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['assigned_employee_id', EMPLOYEE] });
  });

  it('getEmployeeShifts excludes soft-deleted rows', async () => {
    await shiftsQueries.getEmployeeShifts(EMPLOYEE, '2026-01-01', '2026-12-31');
    expect(rec.calls).toContainEqual({ method: 'is', args: ['deleted_at', null] });
  });

  it('getEmployeeShifts is bounded by the requested date window', async () => {
    await shiftsQueries.getEmployeeShifts(EMPLOYEE, '2026-04-01', '2026-04-30');
    expect(rec.calls).toContainEqual({ method: 'gte', args: ['shift_date', '2026-04-01'] });
    expect(rec.calls).toContainEqual({ method: 'lte', args: ['shift_date', '2026-04-30'] });
  });

  it('pending-offer queries are floored, and by the same value on both paths', async () => {
    await shiftsQueries.getMyOffers(EMPLOYEE);
    const listFloor = rec.calls.find((c) => c.method === 'gte' && c.args[0] === 'shift_date')?.args[1];
    rec.calls.length = 0;

    await shiftsQueries.getPendingOfferCount(EMPLOYEE);
    const countFloor = rec.calls.find((c) => c.method === 'gte' && c.args[0] === 'shift_date')?.args[1];

    expect(listFloor).toBeDefined();
    expect(listFloor).toBe(countFloor);
    expect(String(listFloor)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
