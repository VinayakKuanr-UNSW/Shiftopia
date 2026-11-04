/**
 * Zero-fallback rule on public.billables:
 * Billables derives unpaid break from actuals (`timesheet_breaks`) or stays NULL
 * when unpunched (0 minutes deducted in net length). It NEVER falls back to
 * scheduled `shifts.unpaid_break_minutes`, but can be manager-overwritten
 * (`unpaid_break_is_manual = true`).
 *
 * The billable row already exists — trg_sync_timesheets_on_shift_change creates
 * it with the shift — so every save here is an UPDATE.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSupabaseMock } from './helpers/supabase-mock';

const { ctx, supabaseProxy } = vi.hoisted(() => {
  const ctx = { mock: null as any, updated: [] as any[], inserted: [] as any[] };
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
  assignment_outcome: null,
  start_time: '09:00',
  end_time: '17:30',
  shift_date: '2024-01-01',
  timesheets: {
    id: 'ts-raw-1',
    clock_in: '2024-01-01T09:00:00Z',
    clock_out: '2024-01-01T17:30:00Z',
    arrival_track: 'on_time',
    departure_track: 'on_time',
    is_no_show: false,
  },
};

const billable = (unpaidBreakMinutes: number | null) => ({
  id: 'bil-1',
  status: 'draft',
  billable_start: null,
  billable_end: null,
  payroll_exported: false,
  version: 1,
  timesheet_id: 'ts-raw-1',
  unpaid_break_minutes: unpaidBreakMinutes,
});

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  ctx.updated = [];
  ctx.inserted = [];
  const makeChain = ctx.mock.client.from.getMockImplementation();
  ctx.mock.client.from = vi.fn().mockImplementation((table: string) => {
    const chain = makeChain(table);
    chain.update = (payload: unknown) => { if (table === 'billables') ctx.updated.push(payload); return chain; };
    chain.insert = (payload: unknown) => { ctx.inserted.push(payload); return chain; };
    return chain;
  });
});

function enqueueApprove(existingUnpaidBreak: number | null) {
  ctx.mock.enqueue(
    { data: billable(existingUnpaidBreak), error: null },     // 1. existing billable
    { data: SHIFT, error: null },                             // 2. shift + timesheets
    { data: [{ id: 'bil-1' }], error: null },                 // 3. billables update
    { data: { lifecycle_status: 'Published' }, error: null }, // 4. lifecycle check
    { error: null },                                          // 5. shift → Completed
  );
}

describe('updateTimesheetEntry — zero-fallback unpaid break contract', () => {
  it('does not write an unpaid break when approved without one', async () => {
    enqueueApprove(null);
    expect(await updateTimesheetEntry('shift-1', { status: 'approved' })).toBe(true);
    expect(ctx.updated).toHaveLength(1);
    expect(ctx.updated[0]).not.toHaveProperty('unpaid_break_minutes');
    expect(ctx.updated[0]).not.toHaveProperty('unpaid_break_is_manual');
  });

  it('writes a changed break and marks it manual', async () => {
    enqueueApprove(30);
    expect(await updateTimesheetEntry('shift-1', { status: 'approved', unpaidBreak: '15' })).toBe(true);
    expect(ctx.updated[0].unpaid_break_minutes).toBe(15);
    expect(ctx.updated[0].unpaid_break_is_manual).toBe(true);
  });

  it('does not lock the punched break when the editor re-sends the value it displayed', async () => {
    enqueueApprove(30);
    expect(await updateTimesheetEntry('shift-1', { status: 'approved', adjustedEnd: '17:45', unpaidBreak: '30' })).toBe(true);
    expect(ctx.updated[0]).not.toHaveProperty('unpaid_break_minutes');
    expect(ctx.updated[0]).not.toHaveProperty('unpaid_break_is_manual');
  });

  it('does not lock an unpunched break when the editor re-sends the displayed 0', async () => {
    enqueueApprove(null);
    expect(await updateTimesheetEntry('shift-1', { status: 'approved', unpaidBreak: '0' })).toBe(true);
    expect(ctx.updated[0]).not.toHaveProperty('unpaid_break_minutes');
    expect(ctx.updated[0]).not.toHaveProperty('unpaid_break_is_manual');
  });

  it('refuses to save, and never creates a billable, when the shift has none', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },  // 1. no billable: shift is draft, unassigned or cancelled
      { data: SHIFT, error: null }, // 2. shift + timesheets
    );
    expect(await updateTimesheetEntry('shift-1', { status: 'approved', unpaidBreak: '15' })).toBe(false);
    expect(ctx.inserted).toHaveLength(0);
    expect(ctx.updated).toHaveLength(0);
  });
});
