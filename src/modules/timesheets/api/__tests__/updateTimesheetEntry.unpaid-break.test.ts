/**
 * Regression: a timesheet row CREATED by a plain "Approve" must carry the
 * shift's unpaid break.
 *
 * `timesheets.unpaid_break_minutes` defaults to 0, and every reader — this
 * page, Gross Pay and the TOIL accrual — takes the timesheet's value over the
 * shift's whenever the timesheet's is not null. The insert used to leave the
 * column out, so a row created on approval was billed with NO unpaid break:
 * a 30-minute break paid as worked time, and banked as time in lieu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSupabaseMock } from './helpers/supabase-mock';

const { ctx, supabaseProxy } = vi.hoisted(() => {
  const ctx = { mock: null as any, inserted: [] as any[] };
  return {
    ctx,
    supabaseProxy: new Proxy({} as any, {
      get(_: any, p: string) { return ctx.mock.client[p]; },
    }),
  };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: supabaseProxy }));

import { updateTimesheetEntry } from '../timesheets.supabase.api';

const SHIFT = {
  attendance_status: null,
  start_time: '09:00',
  end_time: '17:30',
  actual_start: '2024-01-01T09:00:00Z',
  actual_end: '2024-01-01T17:30:00Z',
  shift_date: '2024-01-01',
};

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  ctx.inserted = [];
  const makeChain = ctx.mock.client.from.getMockImplementation();
  ctx.mock.client.from = vi.fn().mockImplementation((table: string) => {
    const chain = makeChain(table);
    chain.insert = (payload: unknown) => { ctx.inserted.push(payload); return chain; };
    return chain;
  });
});

function enqueueApproveCreatesRow(shiftUnpaidBreak: number | null) {
  ctx.mock.enqueue(
    { data: null, error: null },                                   // 1. existing timesheet (none)
    { data: SHIFT, error: null },                                  // 2. shift (completeness guard)
    { data: { ...SHIFT, assigned_employee_id: 'emp-1', unpaid_break_minutes: shiftUnpaidBreak }, error: null }, // 3. shift for the insert
    { error: null },                                               // 4. insert
    { data: { lifecycle_status: 'Published' }, error: null },      // 5. lifecycle check
    { error: null },                                               // 6. shift → Completed
  );
}

describe('updateTimesheetEntry — new row carries the shift unpaid break', () => {
  it('copies the shift break onto a row created by Approve', async () => {
    enqueueApproveCreatesRow(30);
    expect(await updateTimesheetEntry('shift-1', { status: 'approved' })).toBe(true);
    expect(ctx.inserted).toHaveLength(1);
    expect(ctx.inserted[0].unpaid_break_minutes).toBe(30);
  });

  it('keeps a break the manager entered in the same call', async () => {
    enqueueApproveCreatesRow(30);
    expect(await updateTimesheetEntry('shift-1', { status: 'approved', unpaidBreak: '15' })).toBe(true);
    expect(ctx.inserted[0].unpaid_break_minutes).toBe(15);
  });

  it('leaves the column to the database when the shift has no break recorded', async () => {
    enqueueApproveCreatesRow(null);
    expect(await updateTimesheetEntry('shift-1', { status: 'approved' })).toBe(true);
    expect(ctx.inserted[0]).not.toHaveProperty('unpaid_break_minutes');
  });
});
