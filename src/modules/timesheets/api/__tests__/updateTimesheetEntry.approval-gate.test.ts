/**
 * AUDIT FIX regression test: a FINISHED shift (scheduled end passed) with no
 * manager edit and no actual clock-OUT (employee forgot to tap out) must not
 * be approvable. Before this fix, `bulkUpdateTimesheetStatus` — wired to the
 * Timesheets page's Bulk Approve button — set status='approved' with zero
 * validation, and the payroll read adapter then silently priced the missing
 * side from the SCHEDULED end time, paying the full rostered shift with no
 * record the clock-out never happened.
 *
 * Mock strategy mirrors planning/unified/__tests__ — a FIFO Supabase mock via
 * vi.hoisted() so `updateTimesheetEntry`'s `supabase.from(...)` calls resolve
 * in the exact order the function issues them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSupabaseMock } from './helpers/supabase-mock';

const { ctx, supabaseProxy } = vi.hoisted(() => {
  const ctx = { mock: null as any };
  return {
    ctx,
    supabaseProxy: new Proxy({} as any, {
      get(_: any, p: string) { return ctx.mock.client[p]; },
    }),
  };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: supabaseProxy }));

import { updateTimesheetEntry, TimesheetConflictError } from '../timesheets.supabase.api';

beforeEach(() => {
  ctx.mock = createSupabaseMock();
});

const FINISHED_SHIFT_ROW = {
  attendance_status: null,
  start_time: '09:00',
  end_time: '17:00',
  actual_start: '2024-01-01T09:07:00Z',
  actual_end: null, // never clocked out
  shift_date: '2024-01-01', // safely in the past
};

describe('updateTimesheetEntry — approval completeness guard', () => {
  it('refuses to approve a finished shift with a missing clock-out and no manager edit', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },        // 1. existing timesheet lookup (none yet)
      { data: FINISHED_SHIFT_ROW, error: null }, // 2. shift lookup
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved', notes: 'bulk approve' });

    expect(result).toBe(false);
    // No DB write should have been attempted beyond the two reads.
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(2);
  });

  it('allows approval once the manager supplies the missing side in the same call', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },                // 1. existing timesheet lookup
      { data: FINISHED_SHIFT_ROW, error: null },  // 2. shift lookup
      { data: { ...FINISHED_SHIFT_ROW, assigned_employee_id: 'emp-1' }, error: null }, // 3. shift refetch for insert
      { error: null },                             // 4. timesheets insert
      { data: { lifecycle_status: 'Published' }, error: null }, // 5. lifecycle check
      { error: null },                             // 6. shift → Completed update
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved', adjustedEnd: '17:00' });

    expect(result).toBe(true);
  });

  it('refuses to approve when the clock-IN is the missing side', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },
      { data: { ...FINISHED_SHIFT_ROW, actual_start: null, actual_end: '2024-01-01T17:05:00Z' }, error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved' });

    expect(result).toBe(false);
  });

  it('does not block approval for a shift with both sides resolved from real clock data', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },
      { data: { ...FINISHED_SHIFT_ROW, actual_end: '2024-01-01T17:05:00Z' }, error: null },
      { data: { ...FINISHED_SHIFT_ROW, assigned_employee_id: 'emp-1' }, error: null },
      { error: null },
      { data: { lifecycle_status: 'Published' }, error: null },
      { error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved' });

    expect(result).toBe(true);
  });
});

describe('updateTimesheetEntry — optimistic concurrency (F18)', () => {
  const EXISTING = { id: 'ts-1', status: 'submitted', start_time: null, end_time: null, version: 3 };
  const RESOLVED_SHIFT = { ...FINISHED_SHIFT_ROW, actual_end: '2024-01-01T17:05:00Z' };

  it('throws TimesheetConflictError when the CAS matches zero rows (stale version)', async () => {
    ctx.mock.enqueue(
      { data: EXISTING, error: null },        // 1. existing timesheet (version 3)
      { data: RESOLVED_SHIFT, error: null },  // 2. shift lookup
      { data: [], error: null },              // 3. UPDATE ... .eq('version', stale).select('id') → no row
    );

    await expect(
      updateTimesheetEntry('shift-1', { adjustedStart: '09:15' }, { expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(TimesheetConflictError);
  });

  it('succeeds when the CAS matches the loaded version', async () => {
    ctx.mock.enqueue(
      { data: EXISTING, error: null },              // 1. existing timesheet
      { data: RESOLVED_SHIFT, error: null },        // 2. shift lookup
      { data: [{ id: 'ts-1' }], error: null },      // 3. UPDATE ... .select('id') → one row
    );

    const result = await updateTimesheetEntry('shift-1', { adjustedStart: '09:15' }, { expectedVersion: 3 });
    expect(result).toBe(true);
  });

  it('skips the CAS entirely when no expectedVersion is supplied (legacy/bulk path)', async () => {
    ctx.mock.enqueue(
      { data: EXISTING, error: null },
      { data: RESOLVED_SHIFT, error: null },
      { data: [], error: null },  // empty, but ignored because no expectedVersion
    );

    // No conflict thrown even though the update returned no rows.
    const result = await updateTimesheetEntry('shift-1', { adjustedStart: '09:15' });
    expect(result).toBe(true);
  });
});
